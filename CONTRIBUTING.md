# Contributing to NotesBridge

Thanks for your interest! NotesBridge is three small pieces — the Vercel relay
(`server/`), the `apple-notes-agent` CLI (`agent/`), and the connector kit
(`kit/`). Contributions of any size are welcome.

## Getting set up

```bash
git clone https://github.com/IsaiahDupree/notesbridge
cd notesbridge

# server (relay)
cd server && cp .env.example .env.local   # fill in Supabase + JWT_SECRET
npm install                                # for local tests
node --test test-server-unit.mjs           # runs in-memory (no live DB needed)

# agent (no dependencies)
cd ../agent && node --test test-agent-unit.mjs
```

The unit tests are the fast inner loop; run them before opening a PR. The
end-to-end test (`test/e2e-oauth.mjs`) runs against a live deployment and reads
`.env.local` — you only need it if you're changing the OAuth/MCP flow.

## Guidelines

- **Match the surrounding style.** No formatter is enforced; keep the existing
  two-space indent and sparse, constraint-explaining comments.
- **No secrets in the repo.** Configuration lives in environment variables
  (`.env.example` documents them). `.env.local` is gitignored.
- **Keep the agent dependency-free.** It ships as an npm package and relies only
  on Node built-ins.
- **Add or update tests** for behavior changes; keep CI green (syntax check +
  both unit suites run on every push).
- **Security-sensitive changes** (auth, tokens, the relay's isolation) deserve
  extra care — see [SECURITY.md](./SECURITY.md). Report vulnerabilities
  privately, don't open a public issue.

## Pull requests

Keep PRs focused, describe what changed and why, and note anything you couldn't
test. By contributing you agree your work is licensed under the repository's
[MIT License](./LICENSE).
