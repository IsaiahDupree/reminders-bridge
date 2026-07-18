// Current-account info for the dashboard: email + verification status.
import { redis } from '../lib/redis.js';
import { requireAuth } from '../lib/auth.js';
import { emailEnabled } from '../lib/email.js';

export default async function handler(req, res) {
  const session = requireAuth(req, res, 'session');
  if (!session) return;
  const raw = await redis.get(`user:email:${String(session.email || '').toLowerCase()}`);
  const user = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
  // Grandfather: a record without an explicit `verified` field counts as verified.
  const verified = !user || user.verified !== false;
  const demo = !!(await redis.get(`demo:${session.sub}`));
  res.json({ email: session.email, verified, demo, emailVerificationEnabled: emailEnabled });
}
