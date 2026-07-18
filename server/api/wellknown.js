// OAuth metadata documents (served via vercel.json rewrites from /.well-known/*).
import { baseUrl } from '../lib/http.js';

export default async function handler(req, res) {
  const base = baseUrl(req);
  res.setHeader('cache-control', 'public, max-age=300');
  if (req.query.type === 'pr') {
    // Protected resource metadata (RFC 9728) — points MCP clients at our AS.
    return res.json({
      resource: `${base}/mcp`,
      authorization_servers: [base],
      bearer_methods_supported: ['header'],
    });
  }
  // Authorization server metadata (RFC 8414)
  res.json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['notes'],
  });
}
