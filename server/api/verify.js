// Email verification landing page. The link in the verification email points
// here (/verify?token=…, rewritten to /api/verify). Marks the account verified
// and shows a small confirmation page.
import { redis } from '../lib/redis.js';
import { rateLimit } from '../lib/ratelimit.js';

function page(title, message, ok) {
  const accent = ok ? '#4ade80' : '#f87171';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} — NotesBridge</title>
<style>*{box-sizing:border-box;margin:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f1115;color:#e8eaf0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px}
.card{background:#181b22;border:1px solid #2a2f3a;border-radius:14px;padding:30px 28px;max-width:420px;text-align:center}
.logo{font-size:20px;font-weight:700;margin-bottom:16px}.logo span{color:#f5b942}
.mark{font-size:34px;color:${accent};margin-bottom:8px}h1{font-size:18px;margin-bottom:8px}
p{color:#9aa1af;font-size:14px;line-height:1.55}a{color:#f5b942;text-decoration:none;font-weight:600}</style></head>
<body><div class="card"><div class="logo">Notes<span>Bridge</span></div><div class="mark">${ok ? '✓' : '✕'}</div>
<h1>${title}</h1><p>${message}</p><p style="margin-top:16px"><a href="/">Go to your dashboard</a></p></div></body></html>`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  // Light limit so the token endpoint can't be used for unmetered guessing.
  if (!(await rateLimit(req, res, { name: 'verify', limit: 30, windowSec: 600 }))) return;
  const token = req.query.token;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  const email = token && (await redis.get(`verify:${token}`));
  if (!email) {
    return res.status(400).send(page('Link expired', 'This verification link is invalid or has already been used. Sign in and send yourself a fresh one.', false));
  }
  const key = `user:email:${String(email).toLowerCase()}`;
  const raw = await redis.get(key);
  const user = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
  if (user) {
    user.verified = true;
    await redis.set(key, JSON.stringify(user));
  }
  await redis.del(`verify:${token}`);
  return res.status(200).send(page('Email verified', 'Your NotesBridge email is confirmed. You can close this tab and head back to ChatGPT.', true));
}
