// Revoke a paired Mac's agent token (one device, or all).
import { requireAuth } from '../../lib/auth.js';
import { readBody, methodGuard } from '../../lib/http.js';
import { rateLimit } from '../../lib/ratelimit.js';
import { revokeDevice, revokeAllDevices } from '../../lib/agentauth.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  if (!(await rateLimit(req, res, { name: 'revoke', limit: 20, windowSec: 600 }))) return;
  const session = requireAuth(req, res, 'session');
  if (!session) return;
  const { jti, all } = readBody(req);
  if (all) {
    const n = await revokeAllDevices(session.sub);
    return res.json({ ok: true, revoked: n, all: true });
  }
  if (jti && typeof jti === 'string') {
    await revokeDevice(session.sub, jti);
    return res.json({ ok: true, revoked: 1 });
  }
  return res.status(400).json({ error: 'jti or all required' });
}
