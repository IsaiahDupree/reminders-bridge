// Called by the consent page (public/authorize.html) after the user logs in
// and clicks Allow. Issues an authorization code and returns the redirect URL.
import { redis } from '../../lib/redis.js';
import { requireAuth, randomId } from '../../lib/auth.js';
import { readBody, methodGuard } from '../../lib/http.js';
import { rateLimit } from '../../lib/ratelimit.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  if (!(await rateLimit(req, res, { name: 'authorize', limit: 30, windowSec: 600 }))) return;
  const session = requireAuth(req, res, 'session');
  if (!session) return;

  // Optional email-verification gate (off by default). When REQUIRE_EMAIL_VERIFICATION=1,
  // an account must verify its email before connecting to ChatGPT. Records without an
  // explicit `verified` field are grandfathered, and the reviewer demo account is exempt.
  if (process.env.REQUIRE_EMAIL_VERIFICATION === '1') {
    const raw = await redis.get(`user:email:${String(session.email || '').toLowerCase()}`);
    const user = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
    const isDemo = await redis.get(`demo:${session.sub}`);
    if (user && user.verified === false && !isDemo) {
      return res.status(403).json({ error: 'email_not_verified', error_description: 'Please verify your email first — check your inbox for a link from NotesBridge.' });
    }
  }

  const { client_id, redirect_uri, state, code_challenge, code_challenge_method } = readBody(req);
  const rawClient = client_id && (await redis.get(`client:${client_id}`));
  const client = rawClient ? (typeof rawClient === 'string' ? JSON.parse(rawClient) : rawClient) : null;
  if (!client) return res.status(400).json({ error: 'unknown client_id' });
  if (!client.redirectUris.includes(redirect_uri)) {
    return res.status(400).json({ error: 'redirect_uri not registered for this client' });
  }
  if (!code_challenge || (code_challenge_method && code_challenge_method !== 'S256')) {
    return res.status(400).json({ error: 'PKCE S256 code_challenge required' });
  }

  const code = randomId('code', 16);
  await redis.set(
    `oauthcode:${code}`,
    JSON.stringify({ userId: session.sub, clientId: client_id, redirectUri: redirect_uri, challenge: code_challenge }),
    300
  );

  const url = new URL(redirect_uri);
  url.searchParams.set('code', code);
  if (state) url.searchParams.set('state', state);
  res.json({ redirect: url.toString() });
}
