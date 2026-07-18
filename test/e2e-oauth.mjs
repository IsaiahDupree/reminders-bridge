// e2e-oauth.mjs — full-stack integration test against the LIVE NotesBridge server.
// Exercises: signup/login, RFC 7591 DCR, PKCE authorize, token exchange,
// authenticated MCP initialize + tools/list, and a relay-path probe.
// Usage: node test/e2e-oauth.mjs   (reads ../.env.local for NB_* values)

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const env = Object.fromEntries(
  fs.readFileSync(path.join(root, '.env.local'), 'utf8')
    .split('\n').filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
);

const BASE = env.NB_SERVER || 'https://notesbridge.vercel.app';
const EMAIL = env.NB_EMAIL;
const PASSWORD = env.NB_PASSWORD;

let failures = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

const json = async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) });
const post = (p, body, headers = {}) =>
  fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }).then(json);

// 1. health
const health = await fetch(BASE + '/api/health').then((r) => r.json());
ok('health: storage + jwt ready', health.redisConfigured && health.redisOk && health.jwtSecretSet, JSON.stringify(health));

// 2. session: signup, else login
let session = await post('/api/signup', { email: EMAIL, password: PASSWORD });
if (session.status === 409) session = await post('/api/login', { email: EMAIL, password: PASSWORD });
ok('signup/login returns session token', !!session.body.token, `status ${session.status}`);
const SESSION = session.body.token;

// 3. OAuth metadata discovery
const asMeta = await fetch(BASE + '/.well-known/oauth-authorization-server').then((r) => r.json());
ok('AS metadata: PKCE S256 + DCR', asMeta.code_challenge_methods_supported?.includes('S256') && !!asMeta.registration_endpoint);
const prMeta = await fetch(BASE + '/.well-known/oauth-protected-resource').then((r) => r.json());
ok('PR metadata points at /mcp', prMeta.resource === `${BASE}/mcp`);

// 4. DCR
const REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect';
const reg = await post('/api/oauth/register', { redirect_uris: [REDIRECT], client_name: 'e2e-test' });
ok('DCR issues client_id', reg.status === 201 && !!reg.body.client_id);
const CLIENT = reg.body.client_id;

// 5. authorize with PKCE (simulating the consent page's Allow)
const verifier = crypto.randomBytes(32).toString('base64url');
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
const auth = await post(
  '/api/oauth/authorize',
  { client_id: CLIENT, redirect_uri: REDIRECT, state: 'st_123', code_challenge: challenge, code_challenge_method: 'S256' },
  { authorization: `Bearer ${SESSION}` }
);
const redirectUrl = auth.body.redirect ? new URL(auth.body.redirect) : null;
const CODE = redirectUrl?.searchParams.get('code');
ok('authorize issues code + preserves state', !!CODE && redirectUrl?.searchParams.get('state') === 'st_123');

// 5b. wrong verifier must fail
const bad = await post('/api/oauth/token', { grant_type: 'authorization_code', code: CODE, code_verifier: 'wrong-verifier-wrong-verifier-wrong-verifier', redirect_uri: REDIRECT });
ok('token rejects bad PKCE verifier', bad.status === 400);

// 5c. code is single-use: re-authorize for the real exchange
const auth2 = await post(
  '/api/oauth/authorize',
  { client_id: CLIENT, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256' },
  { authorization: `Bearer ${SESSION}` }
);
const CODE2 = new URL(auth2.body.redirect).searchParams.get('code');

// 6. token exchange
const tok = await post('/api/oauth/token', { grant_type: 'authorization_code', code: CODE2, code_verifier: verifier, redirect_uri: REDIRECT });
ok('token exchange returns access + refresh', !!tok.body.access_token && !!tok.body.refresh_token);
const ACCESS = tok.body.access_token;

// 6b. refresh rotation
const ref = await post('/api/oauth/token', { grant_type: 'refresh_token', refresh_token: tok.body.refresh_token });
ok('refresh grant rotates tokens', !!ref.body.access_token && ref.body.refresh_token !== tok.body.refresh_token);

// 7. MCP: unauthenticated must 401 with resource metadata pointer
const noAuth = await fetch(BASE + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
ok('MCP 401 without token, advertises PR metadata', noAuth.status === 401 && String(noAuth.headers.get('www-authenticate')).includes('oauth-protected-resource'));

// 8. MCP initialize + tools/list with the OAuth token
async function mcp(body) {
  const r = await fetch(BASE + '/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${ref.body.access_token || ACCESS}` },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  // streamable HTTP may answer as SSE; extract the data payload
  const m = text.match(/^data: (.*)$/m);
  return { status: r.status, body: JSON.parse(m ? m[1] : text || '{}') };
}

const init = await mcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'e2e', version: '1.0' } } });
ok('MCP initialize', init.body.result?.serverInfo?.name === 'apple-notes-relay', JSON.stringify(init.body.result?.serverInfo));

const tools = await mcp({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
const names = (tools.body.result?.tools || []).map((t) => t.name).sort();
ok('MCP lists all 8 tools', JSON.stringify(names) === JSON.stringify(['append_to_note', 'create_note', 'fetch', 'get_note', 'list_folders', 'list_notes', 'search', 'update_note']), names.join(','));

// 9. relay path: agent offline error proves the queue lookup ran end to end
const call = await mcp({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_folders', arguments: {} } });
const text = call.body.result?.content?.[0]?.text || '';
ok('relay probe (agent offline or online)', text.includes('agent is offline') || text.includes('folders'), text.slice(0, 80));

// ---------------------------------------------------------------- submission readiness

// 10. privacy + support pages (required by the app directory review)
for (const p of ['/privacy', '/support']) {
  const r = await fetch(BASE + p);
  const t = await r.text();
  ok(`${p} page serves`, r.status === 200 && t.length > 500, `status ${r.status}`);
}

// 11. reviewer demo mode: full flow with NO Mac agent involved
const DEMO_EMAIL = 'reviewer@notesbridge.demo';
const DEMO_PASSWORD = env.DEMO_PASSWORD;
if (DEMO_PASSWORD) {
  let ds = await post('/api/signup', { email: DEMO_EMAIL, password: DEMO_PASSWORD });
  if (ds.status === 409) ds = await post('/api/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD });
  ok('demo account session', !!ds.body.token, `status ${ds.status}`);

  const dAuth = await post('/api/oauth/authorize',
    { client_id: CLIENT, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256' },
    { authorization: `Bearer ${ds.body.token}` });
  const dCode = new URL(dAuth.body.redirect).searchParams.get('code');
  const dTok = await post('/api/oauth/token', { grant_type: 'authorization_code', code: dCode, code_verifier: verifier, redirect_uri: REDIRECT });
  ok('demo OAuth issues mcp token', !!dTok.body.access_token);

  const dmcp = async (body) => {
    const r = await fetch(BASE + '/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${dTok.body.access_token}` },
      body: JSON.stringify(body),
    });
    const t = await r.text();
    const m = t.match(/^data: (.*)$/m);
    return JSON.parse(m ? m[1] : t || '{}');
  };
  const toolText = (r) => r.result?.content?.[0]?.text || '';

  const dFolders = await dmcp({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'list_folders', arguments: {} } });
  ok('demo list_folders (no agent)', toolText(dFolders).includes('"folders"') && !toolText(dFolders).includes('offline'), toolText(dFolders).slice(0, 60));

  const dSearch = await dmcp({ jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'search', arguments: { query: 'sourdough' } } });
  ok('demo search finds sample note', toolText(dSearch).includes('Sourdough'));

  const stamp = `e2e-${Date.now()}`;
  const dCreate = await dmcp({ jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'create_note', arguments: { title: stamp, body: 'created by e2e' } } });
  const createdId = (toolText(dCreate).match(/"id": "([^"]+)"/) || [])[1];
  ok('demo create_note', !!createdId, toolText(dCreate).slice(0, 60));

  const dGet = await dmcp({ jsonrpc: '2.0', id: 13, method: 'tools/call', params: { name: 'get_note', arguments: { id: createdId } } });
  ok('demo re-read of created note', toolText(dGet).includes(stamp) && toolText(dGet).includes('created by e2e'));
} else {
  ok('demo account checks (DEMO_PASSWORD in .env.local)', false, 'DEMO_PASSWORD not set');
}

// 12. rate limiting: /api/pair/claim allows 10/10min then 429s.
// (claim is the safe endpoint to exhaust — nothing later in this suite uses it)
let sawLimit = false;
let non429 = 0;
for (let i = 0; i < 11; i++) {
  const r = await post('/api/pair/claim', { code: 'E2E-BOGUS' });
  if (r.status === 429) { sawLimit = true; break; }
  if (r.status !== 400) non429++;
}
ok('rate limit fires (429 on claim)', sawLimit && non429 === 0, sawLimit ? '429 observed' : 'no 429 after 11 attempts');

// ---------------------------------------------------------------- email verification

// Uses the existing (grandfathered) main account + demo account so it never
// sends real email or trips the signup rate limit.
const me = await fetch(BASE + '/api/me', { headers: { authorization: `Bearer ${SESSION}` } }).then((r) => r.json()).catch(() => ({}));
ok('/api/me reports verification state', typeof me.verified === 'boolean' && typeof me.emailVerificationEnabled === 'boolean', JSON.stringify(me));
ok('grandfathered account is verified (not blocked)', me.verified === true);

const badVerify = await fetch(BASE + '/verify?token=definitely-not-a-real-token');
ok('/verify rejects a bad token', badVerify.status === 400);

const resend = await post('/api/resend-verification', {}, { authorization: `Bearer ${SESSION}` });
ok('resend on a verified account is a no-op (no email sent)', resend.body.sent === false && resend.body.alreadyVerified === true, JSON.stringify(resend.body));

if (DEMO_PASSWORD) {
  const dm = await post('/api/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD });
  const dme = await fetch(BASE + '/api/me', { headers: { authorization: `Bearer ${dm.body.token}` } }).then((r) => r.json()).catch(() => ({}));
  ok('demo account is exempt from verification', dme.demo === true && dme.verified === true, JSON.stringify(dme));
}

console.log(failures === 0 ? '\nALL GREEN' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
