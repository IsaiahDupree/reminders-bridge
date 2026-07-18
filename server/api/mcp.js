// The MCP endpoint ChatGPT talks to. Bearer token (from our OAuth flow)
// identifies the user; tools relay to that user's Mac agent.
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildServer } from '../lib/mcpTools.js';
import { verifyJwt, bearer } from '../lib/auth.js';
import { baseUrl } from '../lib/http.js';
import { redis } from '../lib/redis.js';

export default async function handler(req, res) {
  const base = baseUrl(req);

  const token = bearer(req);
  const payload = token && verifyJwt(token);
  if (!payload || payload.kind !== 'mcp') {
    res.setHeader(
      'WWW-Authenticate',
      `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`
    );
    return res.status(401).json({ error: 'unauthorized' });
  }

  if (req.method === 'GET' || req.method === 'DELETE') {
    return res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed (stateless server)' },
      id: null,
    });
  }

  const demo = !!(await redis.get(`demo:${payload.sub}`));
  const server = buildServer(payload.sub, { demo });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('[mcp] error:', err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  }
}
