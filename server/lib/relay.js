// relay.js — job queue between the MCP endpoint and each user's Mac agent.
//
// MCP tool call → lpush jobs:<userId> → agent polls (rpop) → executes on Mac
// → posts result → lpush result:<jobId> → MCP handler picks it up (rpop poll).

import { redis } from './redis.js';
import { randomId } from './auth.js';

// JOB_TTL must stay <= RESULT_WAIT_MS: once the MCP caller has given up waiting,
// the job must expire out of the queue before a briefly-asleep/lagging agent can
// wake, pop it, and run it (an orphan write on the destructive tools).
const JOB_TTL = 45; // seconds
const RESULT_WAIT_MS = 50_000;
const RESULT_POLL_MS = 150; // how often the MCP side re-checks for a result
const WAIT_POLL_MS = 200; // how often a hanging long-poll re-checks for a new job

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function agentOnline(userId) {
  return !!(await redis.get(`online:${userId}`));
}

export async function markAgentOnline(userId) {
  await redis.set(`online:${userId}`, '1', 75);
}

export async function enqueueJob(userId, tool, args) {
  if (!(await agentOnline(userId))) {
    throw new Error(
      'Your Mac agent is offline. Start it on your Mac with: npx apple-notes-agent run (and make sure the Mac is awake).'
    );
  }
  const jobId = randomId('job');
  // Record the job's owner so /api/agent/result can reject a result posted by an
  // agent that wasn't issued this job (defense-in-depth: jobIds are 96-bit random
  // and never exposed, so this isn't currently reachable, but it hard-scopes the
  // destructive tools to the paired Mac that received the job).
  await redis.set(`jobowner:${jobId}`, userId, JOB_TTL + Math.ceil(RESULT_WAIT_MS / 1000) + 5);
  // Stamp enqueuedAt so the agent can skip any job it pops after the caller's
  // RESULT_WAIT_MS window has already elapsed (belt-and-suspenders with JOB_TTL).
  await redis.lpush(`jobs:${userId}`, JSON.stringify({ jobId, tool, args, enqueuedAt: Date.now() }));
  await redis.expire(`jobs:${userId}`, JOB_TTL);

  const deadline = Date.now() + RESULT_WAIT_MS;
  while (Date.now() < deadline) {
    const raw = await redis.rpop(`result:${jobId}`);
    if (raw) {
      const { ok, result, error } = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!ok) throw new Error(error || 'Agent reported an error');
      return result;
    }
    await sleep(RESULT_POLL_MS);
  }
  throw new Error('Timed out waiting for the Mac agent to respond (is the Mac asleep?).');
}

export async function popJob(userId) {
  const raw = await redis.rpop(`jobs:${userId}`);
  return raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
}

// Long-poll: return the next job immediately if one is queued, otherwise hold
// the connection open and re-check every WAIT_POLL_MS until a job arrives or
// waitSec elapses. This is the "push" path — a job is handed to the agent within
// WAIT_POLL_MS of being enqueued, instead of waiting out a fixed client poll
// interval. waitSec <= 0 preserves the old immediate-return behavior.
export async function waitForJob(userId, waitSec) {
  let job = await popJob(userId);
  if (job || !(waitSec > 0)) return job;
  const deadline = Date.now() + waitSec * 1000;
  while (Date.now() < deadline) {
    await sleep(WAIT_POLL_MS);
    job = await popJob(userId);
    if (job) return job;
  }
  return null;
}

export async function pushResult(jobId, payload) {
  await redis.lpush(`result:${jobId}`, JSON.stringify(payload));
  await redis.expire(`result:${jobId}`, 60);
}
