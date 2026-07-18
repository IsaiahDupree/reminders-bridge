// ratelimit.js — fixed-window rate limiter backed by the shared store.
// Returns true if the request may proceed; sends a 429 and returns false otherwise.

import { redis } from './redis.js';

export function clientIp(req) {
  const h = req.headers || {};
  // Use a platform-trusted source. `x-real-ip` is set by Vercel (and most
  // reverse proxies) to the true client IP and is NOT client-spoofable like the
  // LEFTMOST x-forwarded-for entry (which the client fully controls). If only
  // x-forwarded-for is present, trust the RIGHTMOST hop — the one appended by
  // the proxy closest to us — never the leftmost. Fall back to the socket.
  const realIp = h['x-real-ip'];
  if (realIp) return String(Array.isArray(realIp) ? realIp[0] : realIp).trim();
  const xf = h['x-forwarded-for'];
  if (xf) {
    const parts = (Array.isArray(xf) ? xf.join(',') : String(xf)).split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return req.socket?.remoteAddress || 'unknown';
}

// In-process fallback, used only when the shared store is unreachable, so auth
// endpoints stay metered (per serverless instance) instead of failing wide open.
const localBuckets = new Map();
function localHit(key, windowSec) {
  const now = Date.now();
  const e = localBuckets.get(key);
  if (!e || e.exp <= now) { localBuckets.set(key, { n: 1, exp: now + windowSec * 1000 }); return 1; }
  e.n += 1;
  if (localBuckets.size > 5000) for (const [k, v] of localBuckets) if (v.exp <= now) localBuckets.delete(k);
  return e.n;
}

export async function rateLimit(req, res, { name, limit, windowSec }) {
  const ip = clientIp(req);
  const window = Math.floor(Date.now() / (windowSec * 1000));
  const key = `rl:${name}:${ip}:${window}`;
  let count;
  try {
    // Atomic incr that also sets the TTL when the key is first created, so a
    // failed follow-up expire can never strand a bucket without expiry.
    count = await redis.incr(key, windowSec + 5);
  } catch {
    count = localHit(key, windowSec); // degrade to a local limit, not to no limit
  }
  if (count > limit) {
    res.setHeader('retry-after', String(windowSec));
    res.status(429).json({ error: 'rate_limited', error_description: `Too many requests — try again in up to ${windowSec}s` });
    return false;
  }
  return true;
}
