# Changelog

All notable changes to NotesBridge. Versions cover the server (relay) and the
`apple-notes-agent` npm package together.

## [1.3.0] — 2026-07-17

### Added
- **Agent token revocation.** Agent tokens now carry a per-device id (`jti`) and
  a per-user revocation epoch. A new **Paired Macs** dashboard card lists linked
  Macs (name, paired date, last seen) and lets you remove one device or unpair
  all. Endpoints: `GET /api/agent/devices`, `POST /api/agent/revoke`.
- The Mac agent sends its hostname as the device label when pairing.

### Security
- Agent endpoints (`poll`/`result`/`ping`) now reject revoked tokens on the next
  request; legacy tokens (pre-1.3) are grandfathered until re-paired.

## [1.2.0] — 2026-07-17

### Added
- **Push-based relay (long-poll).** The agent holds a connection open and the
  server returns the instant a job is enqueued — relay overhead dropped from
  ~950 ms to ~300 ms. Backward-compatible with older agents.
- **Apps SDK UI component.** Read tools render notes/folders/search as cards in
  ChatGPT (visible once the app is approved).
- **Email verification** via Resend (soft by default; opt-in enforcement via
  `REQUIRE_EMAIL_VERIFICATION`). `/verify`, `/api/resend-verification`, `/api/me`.
- Reviewer **demo mode** — the `reviewer@…` account exercises all tools against
  server-side sample notes with no Mac agent.
- **Rate limiting** on all auth/OAuth endpoints. Privacy & support pages.
- macOS **LaunchAgent** auto-start (`install`/`uninstall`/`logs`) so the agent
  survives login/restart and crashes.

### Security
- Adversarial auth + relay review; fixes: rate-limit IP no longer trusts the
  spoofable leftmost `X-Forwarded-For`; `JWT_SECRET` fails closed in production;
  login normalization + timing equalization; jobId-ownership check on results;
  widget XSS hardening; atomic rate-limit TTL; password-length cap; `PUBLIC_BASE_URL`
  host pinning. See [SECURITY.md](./SECURITY.md).

### Added (project)
- Server + agent unit tests, GitHub Actions CI, SECURITY.md.

## [1.1.0] — 2026-07-15

### Changed
- Storage moved from Upstash Redis to a Redis-shaped surface on Supabase
  Postgres (`nb_*` RPCs). `JWT_SECRET` support.

## [1.0.0] — 2026-07-15

### Added
- Initial release: OAuth 2.1 + PKCE + DCR, streamable-HTTP MCP endpoint, job
  relay, and the `apple-notes-agent` Mac CLI (JXA against Apple Notes).

Releases: https://github.com/IsaiahDupree/notesbridge/releases
