// List the Macs paired to the signed-in account (for the dashboard).
import { requireAuth } from '../../lib/auth.js';
import { listDevices } from '../../lib/agentauth.js';

export default async function handler(req, res) {
  const session = requireAuth(req, res, 'session');
  if (!session) return;
  res.json({ devices: await listDevices(session.sub) });
}
