// auth.js — minimal JWT (HMAC-SHA256) + password hashing with node:crypto.
// No external auth deps; JWT_SECRET env var signs everything.

import crypto from 'node:crypto';

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

// Fail closed: refuse to run in production with a missing/default signing secret
// (an attacker who knows the default could forge session/mcp tokens). Local dev
// (NODE_ENV !== 'production') keeps the convenient fallback.
if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || SECRET === 'dev-secret-change-me')) {
  throw new Error('JWT_SECRET must be set to a strong random value in production (refusing to start with the dev default).');
}

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(s, 'base64url').toString('utf8');

export function signJwt(payload, ttlSec) {
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(
    JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + ttlSec })
  );
  const sig = crypto.createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verifyJwt(token) {
  try {
    const [header, body, sig] = String(token).split('.');
    const expected = crypto.createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const payload = JSON.parse(fromB64u(body));
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function checkPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  const candidate = crypto.scryptSync(password, salt, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidate, 'hex'));
}

export function randomId(prefix, bytes = 12) {
  return `${prefix}_${crypto.randomBytes(bytes).toString('hex')}`;
}

export function pairingCode() {
  // 8 chars, unambiguous alphabet
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  const rnd = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) out += alphabet[rnd[i] % alphabet.length];
  return out;
}

export function sha256b64u(input) {
  return crypto.createHash('sha256').update(input).digest('base64url');
}

// ---- request helpers (Vercel Node functions) ----

export function bearer(req) {
  const h = req.headers['authorization'] || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

export function requireAuth(req, res, kind) {
  const token = bearer(req);
  const payload = token && verifyJwt(token);
  if (!payload || payload.kind !== kind) {
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
  return payload;
}
