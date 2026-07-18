# Security Policy

Thanks for helping keep NotesBridge and its users safe.

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue.

- Email **isaiahdupree33@gmail.com** with subject `NotesBridge security: <short summary>`, or
- Use GitHub's [private vulnerability reporting](https://github.com/IsaiahDupree/notesbridge/security/advisories/new).

Include: affected component, a clear description, reproduction steps / PoC, and the impact you believe it has. We aim to acknowledge within 3 business days and to keep you updated through remediation. Please give us reasonable time to fix before any public disclosure. There is no paid bounty, but we're glad to credit reporters in the release notes.

## Scope

**In scope**
- The hosted relay: `https://notesbridge.vercel.app` (OAuth, token, MCP, agent, and pair endpoints).
- This repository's code: `server/`, `agent/` (the `apple-notes-agent` npm package), `kit/`.

**Out of scope**
- Denial-of-service / volumetric attacks (the endpoints are rate-limited; please don't stress-test production).
- Findings that require a compromised Mac, a malicious local user, or physical access to the user's machine.
- Social engineering, spam, or issues in third-party infrastructure we don't control (Vercel, Supabase, Resend, OpenAI).
- Self-XSS or issues only exploitable against your own account/notes.

## Design notes relevant to security

- **Your notes stay on your Mac.** The relay only carries a job for the seconds it is in flight; job payloads live in Redis-shaped storage with a short TTL and are deleted on delivery. The relay never persists note content.
- **Token model.** JWTs are HMAC-SHA256 signed with a server-only `JWT_SECRET`. Three distinct kinds — `session` (dashboard), `agent` (a paired Mac), `mcp` (ChatGPT's access token) — and each protected endpoint checks the required kind. Agent job/result endpoints only accept `agent` tokens.
- **OAuth.** Authorization Code + PKCE (S256 required) with Dynamic Client Registration (RFC 7591). Authorization codes are single-use; `redirect_uri` must match a value the client registered.
- **Isolation.** Jobs are keyed per user (`jobs:<userId>`); a paired agent only ever receives jobs for its own account. The reviewer demo account operates on isolated server-side sample notes.
- **Secrets** are never committed; configuration lives in environment variables (see `server/.env.example`).

## Known limitations / accepted residual risk

These are understood trade-offs, not undiscovered bugs — documented for transparency:

- **Agent tokens are long-lived (1 year) but revocable.** Each carries a per-device id (`jti`) and the user's revocation epoch. From the dashboard's "Paired Macs" list a user can remove one device (deletes its `jti`) or unpair all (bumps the epoch, invalidating every outstanding token — including legacy ones). Revoked tokens are rejected on their next request.
- **Refresh tokens rotate on use but there is no reuse-family detection** (RFC 9700). A stolen-and-used refresh token hijacks the chain; the victim's next refresh then fails, surfacing the compromise.
- **Open Dynamic Client Registration** (required by MCP clients like ChatGPT) means any party can register a client; the consent screen shows the redirect host so users can spot a client that isn't first-party. This is standard OAuth and requires user interaction to abuse.
- **Fixed-window rate limiting** permits up to ~2× the nominal limit across a window boundary. Acceptable for the abuse-prevention it provides.

## Hardening notes

The auth/OAuth and relay surfaces were reviewed for: JWT forgery/alg-confusion (mitigated — HMAC-only, signature always required), PKCE downgrade/replay (S256 enforced, codes single-use), open redirect (redirect_uri exact-matched), cross-user token minting and job/result isolation (per-user keys, kind-scoped tokens, jobId ownership checked on result), SQLi (parameterized RPCs), SSRF (fixed internal URLs), rate-limit spoofing (client IP taken from platform headers, not the client-controlled leftmost `X-Forwarded-For`), and XSS in the rendered UI component (all fields escaped; no inline event handlers).

If you're unsure whether something is in scope, email us and ask — we'd rather hear about it.
