// http.js — tiny helpers for Vercel Node functions.

export function baseUrl(req) {
  // Prefer an explicit canonical URL when set (defense-in-depth against Host /
  // X-Forwarded-Host injection behind proxies that pass the header through).
  // Vercel already overwrites x-forwarded-host with the real host, so this is
  // mainly for self-hosters behind a custom reverse proxy.
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/+$/, '');
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers['host'];
  return `${proto}://${host}`;
}

export function readBody(req) {
  // Vercel parses JSON and urlencoded bodies; fall back for strings.
  const b = req.body;
  if (b == null) return {};
  if (typeof b === 'object') return b;
  const s = String(b);
  try {
    return JSON.parse(s);
  } catch {
    return Object.fromEntries(new URLSearchParams(s));
  }
}

export function methodGuard(req, res, method) {
  if (req.method !== method) {
    res.status(405).json({ error: 'method_not_allowed' });
    return false;
  }
  return true;
}
