import { requireAgent } from '../../lib/agentauth.js';
import { pushResult } from '../../lib/relay.js';
import { readBody, methodGuard } from '../../lib/http.js';
import { redis } from '../../lib/redis.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  const agent = await requireAgent(req, res);
  if (!agent) return;
  const { jobId, ok, result, error } = readBody(req);
  if (!jobId) return res.status(400).json({ error: 'jobId required' });
  // Only the agent this job was issued to may post its result. If the owner
  // record has already expired, the caller has long since timed out — drop it.
  const owner = await redis.get(`jobowner:${jobId}`);
  if (owner !== agent.sub) return res.status(403).json({ error: 'not your job' });
  await pushResult(jobId, { ok: !!ok, result, error });
  res.json({ received: true });
}
