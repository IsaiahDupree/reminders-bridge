import { redis } from '../../lib/redis.js';
import { signJwt, randomId } from '../../lib/auth.js';
import { readBody, methodGuard } from '../../lib/http.js';
import { rateLimit } from '../../lib/ratelimit.js';
import { currentEpoch, registerDevice } from '../../lib/agentauth.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  if (!(await rateLimit(req, res, { name: 'claim', limit: 10, windowSec: 600 }))) return;
  const { code, label } = readBody(req);
  const userId = code && (await redis.get(`pair:${String(code).trim().toUpperCase()}`));
  if (!userId) return res.status(400).json({ error: 'Invalid or expired pairing code' });
  await redis.del(`pair:${String(code).trim().toUpperCase()}`);

  // Issue a revocable, per-device agent token (jti = device id; epoch = the
  // user's current revocation epoch), and register the device so it shows up in
  // the dashboard and can be revoked individually.
  const jti = randomId('dev', 12);
  const epoch = await currentEpoch(userId);
  const token = signJwt({ kind: 'agent', sub: userId, jti, epoch }, 60 * 60 * 24 * 365);
  const deviceLabel = typeof label === 'string' && label.trim() ? label.trim().slice(0, 60) : 'Mac';
  await registerDevice(userId, jti, deviceLabel);

  res.json({ token });
}
