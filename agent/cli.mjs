#!/usr/bin/env node
// apple-reminders-agent — Mac-side half of RemindersBridge.
// Polls the relay server for jobs, runs them against Apple Reminders via JXA,
// posts results back. Pair once, then `install` to keep it running on login.

import {
  readFileSync, writeFileSync, chmodSync, mkdirSync, rmSync, existsSync, realpathSync,
} from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { runTool } from './reminders-jxa.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// package.json is always shipped by npm, so it is a safe single source for the version.
const VERSION = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8')).version;

const DEFAULT_SERVER = 'https://remindersbridge.vercel.app';
const CONFIG_PATH = join(homedir(), '.remindersbridge-agent.json');
// Written when `run` gets a 401 so a background (launchd) agent leaves a trail
// explaining why it keeps exiting; cleared on the next healthy poll.
const UNAUTHORIZED_MARKER = join(homedir(), '.remindersbridge-agent.unauthorized');
// Long-poll: ask the server to hold the connection open for up to this many
// seconds and return the instant a job arrives (push-like). On return the agent
// reconnects immediately, so jobs are picked up with sub-second latency.
const POLL_WAIT_SEC = 25; // must stay under the server's poll maxDuration (30s)
const POLL_TIMEOUT_MS = (POLL_WAIT_SEC + 10) * 1000; // abort a stuck hang
// Fallback floor: if the server ever returns a null poll quickly (e.g. an older
// server that ignores ?wait), don't reconnect faster than this — protects the
// server from a tight loop while a proper long-poll server never triggers it.
const POLL_MIN_SPACING_MS = 1500;
const BACKOFF_MS = 5000; // starting backoff on failure
const MAX_BACKOFF_MS = 30_000; // cap so a long outage doesn't hammer the server
// Matches the server's RESULT_WAIT_MS. A job popped after this much time has
// elapsed since it was enqueued has already been abandoned by the MCP caller
// (it got a timeout), so running it would be an orphan write — skip it instead.
const STALE_JOB_MS = 50_000;

// LaunchAgent identifiers (macOS auto-start).
const LABEL = 'com.remindersbridge.apple-reminders-agent';
const PLIST_PATH = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const LOG_PATH = join(homedir(), 'Library', 'Logs', 'remindersbridge-agent.log');
const ERR_LOG_PATH = join(homedir(), 'Library', 'Logs', 'remindersbridge-agent.err.log');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const log = (msg) => console.log(`[${ts()}] ${msg}`);
const logErr = (msg) => console.error(`[${ts()}] ${msg}`);

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--server') out.server = argv[++i];
    else out._.push(argv[i]);
  }
  return out;
}

function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function saveConfig(config) {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  chmodSync(CONFIG_PATH, 0o600); // writeFileSync mode is ignored when the file already exists
}

async function api(server, path, { method = 'GET', token, body, signal } = {}) {
  return fetch(server.replace(/\/+$/, '') + path, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
}

// ---------------------------------------------------------------------------
// LaunchAgent plist generation (pure — unit tested, no launchctl side effects)
// ---------------------------------------------------------------------------

export function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Build the LaunchAgent plist XML. ProgramArguments run `<node> <cli.mjs> run`
// with absolute paths so launchd can start it with no PATH assumptions.
export function buildPlist({ label, nodePath, cliPath, workingDir, outLog, errLog }) {
  const args = [nodePath, cliPath, 'run'];
  const argXml = args.map((a) => `    <string>${xmlEscape(a)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(label)}</string>
  <key>ProgramArguments</key>
  <array>
${argXml}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(workingDir)}</string>
  <key>StandardOutPath</key>
  <string>${xmlEscape(outLog)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(errLog)}</string>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
`;
}

// Run launchctl and capture the outcome instead of throwing on non-zero exit —
// most launchctl subcommands are best-effort (e.g. booting out something that
// isn't loaded).
function runLaunchctl(args) {
  try {
    const out = execFileSync('launchctl', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}`.trim(), code: e.status };
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdPair(code, server) {
  if (!code) {
    console.error('Usage: apple-reminders-agent pair <CODE> [--server URL]');
    process.exit(1);
  }
  let res;
  try {
    // Send this Mac's hostname as a label so it's identifiable in the dashboard's
    // paired-devices list (used only for display).
    res = await api(server, '/api/pair/claim', { method: 'POST', body: { code, label: hostname() } });
  } catch (e) {
    console.error(`Could not reach ${server}: ${e.message}`);
    process.exit(1);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.token) {
    console.error(`Pairing failed (HTTP ${res.status}): ${data.error || 'unknown error'}`);
    process.exit(1);
  }
  saveConfig({ server, token: data.token });
  clearUnauthorizedMarker();
  console.log(`Paired with ${server}`);
  console.log(`Token saved to ${CONFIG_PATH} (mode 600)`);
  console.log('Start the agent with:  apple-reminders-agent run');
  console.log('Keep it running on login with:  apple-reminders-agent install');
}

function clearUnauthorizedMarker() {
  try {
    if (existsSync(UNAUTHORIZED_MARKER)) rmSync(UNAUTHORIZED_MARKER);
  } catch {}
}

// 401 during `run`: this Mac is unpaired. Under launchd KeepAlive the process
// would otherwise hot-loop, so we log LOUD instructions, drop a marker, pause
// briefly, and exit 0 (a clean exit throttles launchd's restarts).
async function handleRunUnauthorized(server) {
  logErr('==================================================================');
  logErr('UNAUTHORIZED (HTTP 401): the server rejected this agent token.');
  logErr('This Mac is no longer paired, so the background agent cannot work.');
  logErr('To fix it:');
  logErr('  1. Open the RemindersBridge site and generate a new pairing code.');
  logErr('  2. Run: apple-reminders-agent pair <CODE>');
  logErr('  3. Run: apple-reminders-agent install   (restarts the background agent)');
  logErr('==================================================================');
  try {
    writeFileSync(
      UNAUTHORIZED_MARKER,
      `${new Date().toISOString()} — 401 from ${server}\n` +
        'This Mac is unpaired. Re-pair with: apple-reminders-agent pair <CODE>\n',
    );
  } catch {}
  await sleep(5000); // short pause so launchd does not restart in a tight loop
  process.exit(0);
}

async function postResult(server, token, payload) {
  try {
    const res = await api(server, '/api/agent/result', { method: 'POST', token, body: payload });
    if (res.status === 401) return handleRunUnauthorized(server);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    log(`job ${payload.jobId}: ${payload.ok ? 'ok' : `error — ${payload.error}`}`);
  } catch (e) {
    logErr(`result post failed: ${e.message} — backing off ${BACKOFF_MS}ms`);
    await sleep(BACKOFF_MS);
  }
}

function installSignalHandlers() {
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      log(`received ${sig} — shutting down`);
      process.exit(0);
    });
  }
}

async function cmdRun(serverFlag) {
  const config = loadConfig();
  if (!config?.token) {
    console.error(`Not paired — no token in ${CONFIG_PATH}.`);
    console.error('Run: apple-reminders-agent pair <CODE>');
    process.exit(1);
  }
  const server = serverFlag || config.server || DEFAULT_SERVER;
  const token = config.token;

  installSignalHandlers();
  log(`apple-reminders-agent v${VERSION} starting — pid ${process.pid}, server ${server}, long-poll wait ${POLL_WAIT_SEC}s`);

  let backoff = BACKOFF_MS;
  for (;;) {
    // Outer guard: no single iteration may ever kill the daemon.
    try {
      let job = null;
      const t0 = Date.now();
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), POLL_TIMEOUT_MS);
      try {
        // Hanging long-poll: the server returns the moment a job is enqueued.
        const res = await api(server, `/api/agent/poll?wait=${POLL_WAIT_SEC}`, { token, signal: ac.signal });
        if (res.status === 401) return handleRunUnauthorized(server);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        ({ job } = await res.json());
        backoff = BACKOFF_MS; // healthy poll — reset backoff
        clearUnauthorizedMarker();
      } catch (e) {
        logErr(`poll error: ${e.message} — backing off ${backoff}ms`);
        await sleep(backoff);
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
        continue;
      } finally {
        clearTimeout(timer);
      }
      if (!job) {
        // Nothing queued during the hang. Reconnect immediately — unless the
        // server returned suspiciously fast (didn't honor the long-poll), in
        // which case throttle to avoid a tight loop against an older server.
        const elapsed = Date.now() - t0;
        if (elapsed < POLL_MIN_SPACING_MS) await sleep(POLL_MIN_SPACING_MS - elapsed);
        continue;
      }
      if (job.enqueuedAt && Date.now() - job.enqueuedAt > STALE_JOB_MS) {
        // Caller already timed out on this job; do not execute (avoids orphan writes).
        const ageS = Math.round((Date.now() - job.enqueuedAt) / 1000);
        log(`job ${job.jobId}: skipped — stale (queued ${ageS}s ago, caller gave up)`);
        continue;
      }
      log(`job ${job.jobId}: ${job.tool} ${JSON.stringify(job.args ?? {}).slice(0, 200)}`);
      let payload;
      try {
        payload = { jobId: job.jobId, ok: true, result: await runTool(job.tool, job.args ?? {}) };
      } catch (e) {
        payload = { jobId: job.jobId, ok: false, error: e.message || String(e) };
      }
      await postResult(server, token, payload);
      // no sleep here: poll again immediately to drain queued jobs
    } catch (e) {
      logErr(`unexpected loop error: ${e.message} — backing off ${backoff}ms`);
      await sleep(backoff);
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    }
  }
}

async function cmdStatus(serverFlag) {
  const config = loadConfig();
  if (!config?.token) {
    console.log(`Not paired — no token in ${CONFIG_PATH}.`);
    console.log('Run: apple-reminders-agent pair <CODE>');
    process.exit(1);
  }
  const server = serverFlag || config.server || DEFAULT_SERVER;
  console.log(`Server:    ${server}`);
  console.log(`Config:    ${CONFIG_PATH} (token present)`);
  try {
    // Use the non-mutating /api/agent/ping endpoint: unlike /api/agent/poll it
    // does not mark this agent online or pop a queued job, so running `status`
    // never fakes online state (which would make the relay accept jobs nobody
    // serves) or steal an in-flight job from a running `run` loop.
    const res = await api(server, '/api/agent/ping', { token: config.token });
    if (res.status === 401) {
      console.log('Paired:    NO — token rejected. Re-pair with: apple-reminders-agent pair <CODE>');
      process.exit(1);
    }
    if (!res.ok) {
      console.log(`Reachable: NO — HTTP ${res.status}`);
      process.exit(1);
    }
    console.log('Reachable: yes');
    console.log('Paired:    yes (token accepted)');
    console.log(`Auto-start: ${existsSync(PLIST_PATH) ? `installed (${PLIST_PATH})` : 'not installed — run: apple-reminders-agent install'}`);
    console.log('Note:      this check does not mark the agent online or consume jobs — run `apple-reminders-agent run` to serve requests.');
  } catch (e) {
    console.log(`Reachable: NO — ${e.message}`);
    process.exit(1);
  }
}

async function cmdInstall() {
  if (process.platform !== 'darwin') {
    console.error('`install` is only supported on macOS (LaunchAgents are a macOS feature).');
    console.error('On this platform, run the agent yourself with: apple-reminders-agent run');
    process.exit(1);
  }
  const config = loadConfig();
  if (!config?.token) {
    console.error(`Not paired yet — no token in ${CONFIG_PATH}.`);
    console.error('Pair first, then install:');
    console.error('  apple-reminders-agent pair <CODE>');
    console.error('  apple-reminders-agent install');
    process.exit(1);
  }

  const uid = process.getuid();
  const nodePath = process.execPath;
  const cliPath = realpathSync(__filename);
  const plist = buildPlist({
    label: LABEL,
    nodePath,
    cliPath,
    workingDir: homedir(),
    outLog: LOG_PATH,
    errLog: ERR_LOG_PATH,
  });

  mkdirSync(dirname(PLIST_PATH), { recursive: true });
  mkdirSync(dirname(LOG_PATH), { recursive: true });

  // Idempotent: tear down any existing instance before (re)writing the plist.
  runLaunchctl(['bootout', `gui/${uid}/${LABEL}`]);
  runLaunchctl(['unload', PLIST_PATH]);

  writeFileSync(PLIST_PATH, plist);

  // Load it: prefer modern `bootstrap`, fall back to legacy `load -w` on older macOS.
  let loaded = runLaunchctl(['bootstrap', `gui/${uid}`, PLIST_PATH]);
  if (!loaded.ok) loaded = runLaunchctl(['load', '-w', PLIST_PATH]);
  if (!loaded.ok) {
    console.error('Wrote the LaunchAgent but launchctl could not load it:');
    console.error(`  ${loaded.out || 'unknown launchctl error'}`);
    console.error(`Plist: ${PLIST_PATH}`);
    process.exit(1);
  }

  // (Re)start it now (-k kills any running copy first).
  runLaunchctl(['kickstart', '-k', `gui/${uid}/${LABEL}`]);

  console.log('Installed. apple-reminders-agent now runs automatically:');
  console.log('  - starts on every login');
  console.log('  - restarts automatically if it crashes');
  console.log(`  - node:  ${nodePath}`);
  console.log(`  - agent: ${cliPath}`);
  console.log(`  - plist: ${PLIST_PATH}`);
  console.log(`Logs:      ${LOG_PATH}`);
  console.log(`Error log: ${ERR_LOG_PATH}`);
  console.log('');
  console.log('The first time it touches Apple Reminders, macOS asks once to allow automation.');
  console.log('Approve it (or in System Settings > Privacy & Security > Automation).');
  console.log('');
  console.log('View logs anytime with:  apple-reminders-agent logs');
  console.log('Stop & remove with:      apple-reminders-agent uninstall');
}

async function cmdUninstall() {
  if (process.platform !== 'darwin') {
    console.error('`uninstall` is only supported on macOS.');
    process.exit(1);
  }
  const uid = process.getuid();
  runLaunchctl(['bootout', `gui/${uid}/${LABEL}`]);
  runLaunchctl(['unload', PLIST_PATH]);
  if (existsSync(PLIST_PATH)) {
    rmSync(PLIST_PATH);
    console.log(`Removed ${PLIST_PATH}`);
  } else {
    console.log(`No LaunchAgent found at ${PLIST_PATH} (nothing to remove).`);
  }
  console.log('The background agent is stopped and will no longer start on login.');
  console.log(`Logs are left in place: ${LOG_PATH}`);
}

function cmdLogs() {
  const N = 50;
  if (existsSync(LOG_PATH)) {
    const lines = readFileSync(LOG_PATH, 'utf8').split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop(); // drop trailing newline
    const tail = lines.slice(-N);
    console.log(`==> ${LOG_PATH} (last ${tail.length} line${tail.length === 1 ? '' : 's'}) <==`);
    console.log(tail.join('\n'));
  } else {
    console.log(`No log file yet at ${LOG_PATH}.`);
    console.log('Start the background agent with: apple-reminders-agent install');
  }
  console.log('');
  console.log(`Errors are logged separately at: ${ERR_LOG_PATH}`);
}

function printVersion() {
  console.log(VERSION);
}

function printHelp() {
  console.log(`apple-reminders-agent v${VERSION} — Mac-side relay for RemindersBridge (Apple Reminders in ChatGPT/Claude).

Usage: apple-reminders-agent <command> [--server URL]

Commands:
  pair <CODE>   Claim a pairing code from the RemindersBridge site and save the agent token.
  run           Long-poll the server for jobs and run them against Apple Reminders (foreground).
  install       Install a macOS LaunchAgent so the agent starts on login and restarts on crash.
  uninstall     Stop and remove the LaunchAgent.
  logs          Show the last ~50 lines of the background agent log.
  status        Check config and server reachability (does not consume jobs).

Options:
  --server URL  Override the relay server (default: ${DEFAULT_SERVER}).
  -h, --help    Show this help.
  -v, --version Show the version.

Typical setup:
  npx apple-reminders-agent pair ABCD-1234
  npx apple-reminders-agent install`);
}

async function main() {
  const { _: positional, server } = parseArgs(process.argv.slice(2));
  const [command, ...rest] = positional;

  switch (command) {
    case 'pair':
      await cmdPair(rest[0], server || DEFAULT_SERVER);
      break;
    case 'run':
      await cmdRun(server);
      break;
    case 'status':
      await cmdStatus(server);
      break;
    case 'install':
      await cmdInstall();
      break;
    case 'uninstall':
      await cmdUninstall();
      break;
    case 'logs':
      cmdLogs();
      break;
    case '-v':
    case '--version':
    case 'version':
      printVersion();
      break;
    case '-h':
    case '--help':
    case 'help':
    case undefined:
      printHelp();
      process.exit(0);
      break;
    default:
      console.error(`Unknown command: ${command}\n`);
      printHelp();
      process.exit(1);
  }
}

// Only run the CLI when invoked directly (`node cli.mjs …` or the installed bin),
// so importing this module for unit tests never triggers a command.
const invokedDirectly = (() => {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(__filename);
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main().catch((e) => {
    logErr(`fatal: ${e?.message || e}`);
    process.exit(1);
  });
}
