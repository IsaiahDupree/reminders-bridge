// agentauth.js — paired-device registry + revocation for agent tokens.
//
// Agent tokens are long-lived JWTs. To make them revocable without rotating
// JWT_SECRET (which would unpair everyone), each token carries:
//   - jti   : a per-device id. Deleting agentdev:<jti> revokes that one device.
//   - epoch : the user's revocation epoch at issue time. Bumping
//             agentepoch:<userId> revokes every token issued before the bump —
//             including legacy tokens that predate this feature (epoch 0).
// requireAgent() enforces both. Tokens with no jti/epoch (issued before this
// existed) are grandfathered so the currently-running agent keeps working until
// the user re-pairs.

import { requireAuth } from './auth.js';
import { redis } from './redis.js';

const DEV_TTL = 60 * 60 * 24 * 366; // ~1 year, matches the token lifetime
const dvKey = (jti) => `agentdev:${jti}`;
const idxKey = (userId) => `agentdevs:${userId}`;
const epochKey = (userId) => `agentepoch:${userId}`;

export async function currentEpoch(userId) {
  return Number(await redis.get(epochKey(userId))) || 0;
}

// Verify an agent request: valid signature + kind (via requireAuth) AND not
// revoked (epoch not bumped past it, jti still registered). Sends the 401 and
// returns null on failure; returns the token payload on success.
export async function requireAgent(req, res) {
  const payload = requireAuth(req, res, 'agent');
  if (!payload) return null;
  const epoch = await currentEpoch(payload.sub);
  if ((payload.epoch || 0) < epoch) {
    res.status(401).json({ error: 'revoked' });
    return null;
  }
  if (payload.jti && !(await redis.get(dvKey(payload.jti)))) {
    res.status(401).json({ error: 'revoked' });
    return null;
  }
  return payload;
}

async function loadIdx(userId) {
  const raw = await redis.get(idxKey(userId));
  try {
    const a = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}
const saveIdx = (userId, arr) => redis.set(idxKey(userId), JSON.stringify(arr), DEV_TTL);

export async function registerDevice(userId, jti, label) {
  const now = Date.now();
  await redis.set(dvKey(jti), JSON.stringify({ userId, jti, label: label || 'Mac', pairedAt: now, lastSeen: now }), DEV_TTL);
  const idx = await loadIdx(userId);
  if (!idx.includes(jti)) {
    idx.push(jti);
    await saveIdx(userId, idx);
  }
}

export async function touchDevice(jti) {
  if (!jti) return;
  const raw = await redis.get(dvKey(jti));
  if (!raw) return;
  try {
    const d = typeof raw === 'string' ? JSON.parse(raw) : raw;
    d.lastSeen = Date.now();
    await redis.set(dvKey(jti), JSON.stringify(d), DEV_TTL);
  } catch { /* ignore */ }
}

export async function listDevices(userId) {
  const idx = await loadIdx(userId);
  const out = [];
  const alive = [];
  for (const jti of idx) {
    const raw = await redis.get(dvKey(jti));
    if (!raw) continue; // revoked/expired — will be pruned from the index below
    try {
      const d = typeof raw === 'string' ? JSON.parse(raw) : raw;
      out.push({ jti: d.jti, label: d.label, pairedAt: d.pairedAt, lastSeen: d.lastSeen });
      alive.push(jti);
    } catch { /* skip corrupt */ }
  }
  if (alive.length !== idx.length) await saveIdx(userId, alive);
  out.sort((a, b) => (b.pairedAt || 0) - (a.pairedAt || 0));
  return out;
}

export async function revokeDevice(userId, jti) {
  await redis.del(dvKey(jti));
  const idx = await loadIdx(userId);
  await saveIdx(userId, idx.filter((x) => x !== jti));
}

export async function revokeAllDevices(userId) {
  const idx = await loadIdx(userId);
  for (const jti of idx) await redis.del(dvKey(jti));
  await redis.del(idxKey(userId));
  // Bump the epoch so ANY outstanding agent token (including legacy jti-less
  // ones) is invalidated on its next request.
  const next = (await currentEpoch(userId)) + 1;
  await redis.set(epochKey(userId), String(next)); // persistent (no TTL)
  return idx.length;
}
