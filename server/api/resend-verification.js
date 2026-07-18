// Re-send the email-verification link for the signed-in account.
import { redis } from '../lib/redis.js';
import { requireAuth, randomId } from '../lib/auth.js';
import { methodGuard, baseUrl } from '../lib/http.js';
import { rateLimit } from '../lib/ratelimit.js';
import { emailEnabled, isSendableEmail, sendVerificationEmail } from '../lib/email.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  if (!(await rateLimit(req, res, { name: 'resend-verify', limit: 5, windowSec: 600 }))) return;
  const session = requireAuth(req, res, 'session');
  if (!session) return;
  if (!emailEnabled) return res.json({ ok: true, sent: false, reason: 'email_disabled' });

  const email = String(session.email || '').toLowerCase();
  const raw = await redis.get(`user:email:${email}`);
  const user = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
  // Grandfather: a record without an explicit `verified:false` is already verified.
  if (!user || user.verified !== false) return res.json({ ok: true, sent: false, alreadyVerified: true });
  if (!isSendableEmail(email)) return res.json({ ok: true, sent: false, reason: 'undeliverable' });

  const token = randomId('vrf', 24);
  await redis.set(`verify:${token}`, email, 60 * 60 * 24);
  const r = await sendVerificationEmail(email, `${baseUrl(req)}/verify?token=${token}`);
  return res.json({ ok: r.ok, sent: r.ok });
}
