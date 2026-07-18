import { requireAuth } from '../../lib/auth.js';
import { agentOnline } from '../../lib/relay.js';
import { redisConfigured } from '../../lib/redis.js';

export default async function handler(req, res) {
  const session = requireAuth(req, res, 'session');
  if (!session) return;
  res.json({ online: await agentOnline(session.sub), redisConfigured });
}
