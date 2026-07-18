import { redis } from '../lib/redis.js';
import { hashPassword, signJwt, randomId } from '../lib/auth.js';
import { readBody, methodGuard, baseUrl } from '../lib/http.js';
import { rateLimit } from '../lib/ratelimit.js';
import { DEMO_EMAIL } from '../lib/demoStore.js';
import { emailEnabled, isSendableEmail, sendVerificationEmail } from '../lib/email.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  if (!(await rateLimit(req, res, { name: 'signup', limit: 5, windowSec: 600 }))) return;
  const { email, password } = readBody(req);
  if (!email || !password || password.length < 8 || password.length > 4096) {
    return res.status(400).json({ error: 'Valid email and a password of 8–4096 characters required' });
  }
  const normalized = String(email).trim().toLowerCase();
  const key = `user:email:${normalized}`;
  if (await redis.get(key)) {
    return res.status(409).json({ error: 'An account with that email already exists' });
  }
  const id = randomId('usr');
  const isDemo = normalized === DEMO_EMAIL;
  // Verify only when we both can and should: email configured, a deliverable
  // address, and not the reviewer demo account. Otherwise the account is born
  // verified (the `verified` field also grandfathers older records that lack it).
  const needsVerify = emailEnabled && !isDemo && isSendableEmail(normalized);
  await redis.set(key, JSON.stringify({ id, pw: hashPassword(password), email: normalized, verified: !needsVerify }));
  if (isDemo) {
    await redis.set(`demo:${id}`, '1'); // reviewer demo account: MCP tools use sample notes
  }
  if (needsVerify) {
    const token = randomId('vrf', 24);
    await redis.set(`verify:${token}`, normalized, 60 * 60 * 24); // 24h
    // Best-effort — a send failure never blocks signup (resend from the dashboard).
    await sendVerificationEmail(normalized, `${baseUrl(req)}/verify?token=${token}`).catch(() => {});
  }
  const session = signJwt({ kind: 'session', sub: id, email: normalized }, 60 * 60 * 24 * 30);
  res.json({ token: session, userId: id, verified: !needsVerify });
}
