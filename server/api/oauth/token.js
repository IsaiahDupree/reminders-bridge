// Token endpoint — authorization_code (with PKCE) and refresh_token grants.
import { redis } from '../../lib/redis.js';
import { signJwt, sha256b64u, randomId } from '../../lib/auth.js';
import { readBody, methodGuard } from '../../lib/http.js';
import { rateLimit } from '../../lib/ratelimit.js';

const ACCESS_TTL = 60 * 60; // 1h
const REFRESH_TTL = 60 * 60 * 24 * 90; // 90d

async function issueTokens(res, userId) {
  const accessToken = signJwt({ kind: 'mcp', sub: userId }, ACCESS_TTL);
  const refreshToken = randomId('rt', 24);
  await redis.set(`refresh:${refreshToken}`, userId, REFRESH_TTL);
  res.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TTL,
    refresh_token: refreshToken,
    scope: 'notes',
  });
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  if (!(await rateLimit(req, res, { name: 'token', limit: 60, windowSec: 60 }))) return;
  const body = readBody(req);

  if (body.grant_type === 'authorization_code') {
    const raw = body.code && (await redis.get(`oauthcode:${body.code}`));
    const data = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
    if (!data) return res.status(400).json({ error: 'invalid_grant' });
    await redis.del(`oauthcode:${body.code}`);
    if (!body.code_verifier || sha256b64u(body.code_verifier) !== data.challenge) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
    }
    if (body.redirect_uri && body.redirect_uri !== data.redirectUri) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
    }
    return issueTokens(res, data.userId);
  }

  if (body.grant_type === 'refresh_token') {
    const userId = body.refresh_token && (await redis.get(`refresh:${body.refresh_token}`));
    if (!userId) return res.status(400).json({ error: 'invalid_grant' });
    await redis.del(`refresh:${body.refresh_token}`); // rotate
    return issueTokens(res, userId);
  }

  res.status(400).json({ error: 'unsupported_grant_type' });
}
