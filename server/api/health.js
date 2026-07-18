// Public health check — lets tooling verify the deployment is ready
// (notably that Redis storage is configured) without authentication.
import { redisConfigured, redis } from '../lib/redis.js';

export default async function handler(req, res) {
  let redisOk = false;
  if (redisConfigured) {
    try {
      await redis.set('health:ping', '1', 10);
      redisOk = (await redis.get('health:ping')) != null;
    } catch {
      redisOk = false;
    }
  }
  res.json({
    ok: true,
    redisConfigured,
    redisOk,
    jwtSecretSet: !!process.env.JWT_SECRET,
    version: '1.3.0',
  });
}
