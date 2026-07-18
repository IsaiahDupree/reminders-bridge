import { redis } from '../../lib/redis.js';
import { requireAuth, pairingCode } from '../../lib/auth.js';
import { methodGuard } from '../../lib/http.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  const session = requireAuth(req, res, 'session');
  if (!session) return;
  const code = pairingCode();
  await redis.set(`pair:${code}`, session.sub, 600);
  res.json({ code, expiresInSec: 600 });
}
