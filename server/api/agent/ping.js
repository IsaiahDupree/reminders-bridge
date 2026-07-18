import { requireAgent } from '../../lib/agentauth.js';

// Non-mutating agent reachability/pairing check for `apple-notes-agent status`.
// Unlike /api/agent/poll it does NOT markAgentOnline (which would make the relay
// report the Mac online for ~75s with no run-loop serving jobs) and does NOT
// popJob (which would steal/force-fail a real queued job). It validates the
// agent token AND that it hasn't been revoked, so `status` reports a revoked
// device as unpaired.
export default async function handler(req, res) {
  const agent = await requireAgent(req, res);
  if (!agent) return;
  res.json({ ok: true });
}
