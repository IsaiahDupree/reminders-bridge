import { redis } from '../lib/redis.js';
import { checkPassword, signJwt, hashPassword } from '../lib/auth.js';
import { readBody, methodGuard } from '../lib/http.js';
import { rateLimit } from '../lib/ratelimit.js';

// A precomputed hash to run scrypt against for unknown users, so login timing
// does not reveal whether an email is registered (constant-ish work either way).
const DUMMY_HASH = hashPassword('notesbridge-timing-equalizer');
const MAX_PW = 4096; // cap before scrypt so an oversized password can't DoS CPU/mem

export default async function handler(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  if (!(await rateLimit(req, res, { name: 'login', limit: 10, windowSec: 600 }))) return;
  const body = readBody(req);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const invalid = () => res.status(401).json({ error: 'Invalid email or password' });
  if (password.length > MAX_PW) return invalid();

  const raw = await redis.get(`user:email:${email}`);
  const user = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
  let ok = false;
  try {
    // Always run scrypt (real hash for a known user, dummy otherwise) to equalize timing.
    ok = user ? checkPassword(password, user.pw) : (checkPassword(password, DUMMY_HASH), false);
  } catch {
    ok = false;
  }
  if (!user || !ok) return invalid();

  const session = signJwt({ kind: 'session', sub: user.id, email }, 60 * 60 * 24 * 30);
  res.json({ token: session, userId: user.id });
}
