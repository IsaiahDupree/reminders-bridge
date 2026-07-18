// Unit tests for the server's pure logic. Runs entirely in-memory — do NOT set
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY when running these (the storage layer
// falls back to its in-memory Map so no live DB is touched):
//   node --test test-server-unit.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { signJwt, verifyJwt, sha256b64u, pairingCode, hashPassword, checkPassword, randomId } from './lib/auth.js';
import { isSendableEmail } from './lib/email.js';
import { clientIp } from './lib/ratelimit.js';
import { redis } from './lib/redis.js';
import { waitForJob } from './lib/relay.js';
import { demoExec } from './lib/demoStore.js';
import { registerDevice, listDevices, revokeDevice, revokeAllDevices, currentEpoch } from './lib/agentauth.js';

// ---- auth: JWT ----
test('JWT round-trips and carries claims', () => {
  const t = signJwt({ kind: 'mcp', sub: 'usr_1' }, 60);
  const p = verifyJwt(t);
  assert.equal(p.kind, 'mcp');
  assert.equal(p.sub, 'usr_1');
});
test('JWT tamper is rejected', () => {
  const t = signJwt({ kind: 'session', sub: 'u' }, 60);
  const [h, b] = t.split('.');
  const forgedBody = Buffer.from(JSON.stringify({ kind: 'session', sub: 'admin', exp: 9999999999 })).toString('base64url');
  assert.equal(verifyJwt(`${h}.${forgedBody}.${t.split('.')[2]}`), null);
});
test('JWT with a bogus/short signature returns null (no throw/bypass)', () => {
  const t = signJwt({ kind: 'agent', sub: 'u' }, 60);
  const [h, b] = t.split('.');
  assert.equal(verifyJwt(`${h}.${b}.short`), null);
  assert.equal(verifyJwt(`${h}.${b}.`), null);
  assert.equal(verifyJwt('not.a.jwt'), null);
});
test('expired JWT returns null', () => {
  const t = signJwt({ kind: 'mcp', sub: 'u' }, -1);
  assert.equal(verifyJwt(t), null);
});

// ---- auth: PKCE + helpers ----
test('sha256b64u matches PKCE S256 of a verifier', () => {
  // known vector: verifier -> challenge
  const c = sha256b64u('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
  assert.equal(c, 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});
test('pairingCode is 8 chars from the unambiguous alphabet', () => {
  for (let i = 0; i < 200; i++) {
    const c = pairingCode();
    assert.match(c, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
  }
});
test('password hash verifies and rejects wrong password', () => {
  const stored = hashPassword('correct horse battery staple');
  assert.equal(checkPassword('correct horse battery staple', stored), true);
  assert.equal(checkPassword('wrong', stored), false);
});
test('randomId has prefix and hex entropy', () => {
  const id = randomId('job');
  assert.match(id, /^job_[0-9a-f]{24}$/);
});

// ---- email deliverability guard ----
test('isSendableEmail accepts real addresses, rejects junk/test TLDs', () => {
  assert.equal(isSendableEmail('a@b.com'), true);
  assert.equal(isSendableEmail('user+tag@gmail.com'), true);
  assert.equal(isSendableEmail('x@y.test'), false);
  assert.equal(isSendableEmail('r@notesbridge.demo'), false);
  assert.equal(isSendableEmail('nope'), false);
  assert.equal(isSendableEmail(''), false);
  assert.equal(isSendableEmail('a@localhost'), false);
});

// ---- rate-limit client IP parsing (must NOT trust the spoofable leftmost XFF) ----
test('clientIp prefers platform x-real-ip', () => {
  assert.equal(clientIp({ headers: { 'x-real-ip': '203.0.113.9', 'x-forwarded-for': 'spoofed, 203.0.113.9' }, socket: {} }), '203.0.113.9');
});
test('clientIp uses the RIGHTMOST forwarded hop, never the client-controlled leftmost', () => {
  // client sends "1.2.3.4" (spoofed), proxy appends the real IP on the right
  assert.equal(clientIp({ headers: { 'x-forwarded-for': '1.2.3.4, 203.0.113.7' }, socket: {} }), '203.0.113.7');
  assert.equal(clientIp({ headers: { 'x-forwarded-for': ['1.1.1.1', '203.0.113.5'] }, socket: {} }), '203.0.113.5');
  assert.equal(clientIp({ headers: {}, socket: { remoteAddress: '10.0.0.1' } }), '10.0.0.1');
});

// ---- storage (memory fallback) ----
test('redis memory: incr increments and expire works', async () => {
  await redis.del('t:c');
  assert.equal(await redis.incr('t:c'), 1);
  assert.equal(await redis.incr('t:c'), 2);
});
test('redis memory: lpush+rpop is FIFO', async () => {
  await redis.del('t:q');
  await redis.lpush('t:q', 'a');
  await redis.lpush('t:q', 'b');
  assert.equal(await redis.rpop('t:q'), 'a');
  assert.equal(await redis.rpop('t:q'), 'b');
  assert.equal(await redis.rpop('t:q'), null);
});

// ---- relay long-poll ----
test('waitForJob returns immediately when a job is queued', async () => {
  await redis.del('jobs:u');
  await redis.lpush('jobs:u', JSON.stringify({ jobId: 'j', tool: 'listFolders', args: {} }));
  const t0 = Date.now();
  const job = await waitForJob('u', 5);
  assert.equal(job.jobId, 'j');
  assert.ok(Date.now() - t0 < 300);
});
test('waitForJob times out to null with no job', async () => {
  await redis.del('jobs:none');
  const job = await waitForJob('none', 1);
  assert.equal(job, null);
});
test('waitForJob picks up a job enqueued mid-wait', async () => {
  await redis.del('jobs:mid');
  setTimeout(() => redis.lpush('jobs:mid', JSON.stringify({ jobId: 'later', tool: 'x', args: {} })), 400);
  const job = await waitForJob('mid', 5);
  assert.equal(job.jobId, 'later');
});

// ---- demo store: behaviour + cross-user isolation ----
test('demoExec seeds and lists folders/notes for a user', async () => {
  const f = await demoExec('demoA', 'listFolders', {});
  assert.ok(f.folders.length >= 3);
  const s = await demoExec('demoA', 'searchNotes', { query: 'sourdough' });
  assert.equal(s.results[0].title, 'Sourdough recipe');
});
test('demoExec writes are isolated per user', async () => {
  await demoExec('demoX', 'createNote', { title: 'X-secret', body: 'x' });
  const y = await demoExec('demoY', 'searchNotes', { query: 'X-secret' });
  assert.equal(y.results.length, 0); // user Y never sees user X's note
});

// ---- agent device registry + revocation ----
test('device register/list/revoke lifecycle', async () => {
  const u = 'usr_devtest';
  await registerDevice(u, 'dev_a', "Isaiah's MacBook");
  await registerDevice(u, 'dev_b', 'Studio');
  let list = await listDevices(u);
  assert.equal(list.length, 2);
  assert.ok(list.find((d) => d.jti === 'dev_a' && d.label === "Isaiah's MacBook"));
  await revokeDevice(u, 'dev_a');
  list = await listDevices(u);
  assert.equal(list.length, 1);
  assert.equal(list[0].jti, 'dev_b');
});
test('revokeAllDevices clears the list and bumps the epoch', async () => {
  const u = 'usr_epochtest';
  assert.equal(await currentEpoch(u), 0);
  await registerDevice(u, 'dev_x', 'X');
  const n = await revokeAllDevices(u);
  assert.equal(n, 1);
  assert.equal((await listDevices(u)).length, 0);
  assert.equal(await currentEpoch(u), 1); // any token issued at epoch < 1 is now revoked
});

