// Dynamic Client Registration (RFC 7591) — ChatGPT registers itself here.
import { redis } from '../../lib/redis.js';
import { randomId } from '../../lib/auth.js';
import { readBody, methodGuard } from '../../lib/http.js';
import { rateLimit } from '../../lib/ratelimit.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  if (!(await rateLimit(req, res, { name: 'register', limit: 20, windowSec: 3600 }))) return;
  const body = readBody(req);
  const redirectUris = body.redirect_uris;
  if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
    return res.status(400).json({ error: 'invalid_client_metadata', error_description: 'redirect_uris required' });
  }
  const clientId = randomId('client');
  await redis.set(
    `client:${clientId}`,
    JSON.stringify({ redirectUris, name: body.client_name || 'MCP client' }),
    60 * 60 * 24 * 180
  );
  res.status(201).json({
    client_id: clientId,
    client_name: body.client_name || 'MCP client',
    redirect_uris: redirectUris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  });
}
