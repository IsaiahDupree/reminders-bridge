<div align="center">

# ✅ RemindersBridge

**Use your Apple Reminders inside ChatGPT — through your own Mac.**

[![License: MIT](https://img.shields.io/badge/License-MIT-f5b942.svg)](./LICENSE)
[![npm](https://img.shields.io/npm/v/apple-reminders-agent.svg?color=4ade80&label=apple-reminders-agent)](https://www.npmjs.com/package/apple-reminders-agent)

</div>

RemindersBridge is a [Model Context Protocol](https://modelcontextprotocol.io) (MCP) connector that lets ChatGPT work with your **Apple Reminders**. It never uploads your reminders to a third party — every action runs on **your own Mac** through a tiny local agent. The cloud piece is only a stateless relay that shuttles requests between ChatGPT and your Mac.

```
  ChatGPT  ──OAuth──►  RemindersBridge relay  ──job queue──►  apple-reminders-agent  ──►  Reminders.app
 (connector)          (Vercel, stateless)      (your Mac, polls & executes)        (on your Mac)
```

Your Mac is the only place your reminders are ever read or written. The relay stores only short-lived job payloads and your account record; it never sees a reminder unless a job is in flight, and jobs expire in seconds.

---

## For users — 3 steps

**1. Create your account** at **[remindersbridge.vercel.app](https://remindersbridge.vercel.app)** and generate a pairing code.

**2. Install the Mac agent** (needs [Node 18+](https://nodejs.org)):

```bash
npx apple-reminders-agent pair <YOUR-CODE>   # link this Mac to your account
npx apple-reminders-agent install            # keep it running on every restart
```

The first time it touches Reminders, macOS asks **"Terminal wants to control Reminders"** — click **OK** (one time).

**3. Connect ChatGPT:** Settings → **Plugins** → turn on **Developer mode** (Security & login) → **Create** a custom plugin → paste the MCP Server URL **`https://remindersbridge.vercel.app/mcp`** → Authentication **OAuth** → sign in & **Allow**.

That's it. In a new chat: *"Search my Apple Reminders for the dentist appointment"* or *"Add oat milk to my Groceries list, due tomorrow."*

> Your Mac must be awake with the agent running. `npx apple-reminders-agent install` makes it start automatically at login and restart if it ever crashes.

### Managing the agent

```bash
npx apple-reminders-agent status      # is it paired & reachable?
npx apple-reminders-agent logs        # recent activity
npx apple-reminders-agent uninstall   # stop auto-start
```

---

## What ChatGPT can do

| Tool | Action |
|------|--------|
| `search` | Search reminders by keyword |
| `fetch` | Fetch full details of one reminder by id |
| `list_lists` | List all reminder lists with open (incomplete) counts |
| `list_reminders` | List reminders (optionally filter to one list, or include completed) |
| `get_reminder` | Read a reminder by id or name |
| `create_reminder` | Create a reminder (name, optional notes, due date, target list) |
| `complete_reminder` | Mark a reminder complete (or reopen it) |
| `update_reminder` | Edit a reminder's name, notes, or due date |

---

## Self-hosting

You can run your own relay so nothing depends on the hosted instance.

**Prereqs:** a [Vercel](https://vercel.com) account and a [Supabase](https://supabase.com) project (free tiers are fine).

1. **Storage** — in your Supabase project's SQL editor, run [`supabase/schema.sql`](./supabase/schema.sql). It creates a tiny Redis-shaped KV + queue surface (`nb_*` functions) with RLS on.
2. **Deploy** the `server/` directory to Vercel.
3. **Set env vars** (see [`server/.env.example`](./server/.env.example)):
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — your project + service-role key
   - `JWT_SECRET` — `openssl rand -hex 32`
4. **Verify:** `curl https://YOUR-APP.vercel.app/api/health` → `redisConfigured`, `redisOk`, `jwtSecretSet` all `true`.
5. Point the agent at it: `npx apple-reminders-agent pair <CODE> --server https://YOUR-APP.vercel.app`.

---

## How it works

- **Auth** — OAuth 2.1 with PKCE and Dynamic Client Registration (RFC 7591). ChatGPT registers itself, the user signs in on the RemindersBridge consent page, and ChatGPT gets a scoped MCP access token. JWTs are HMAC-signed; three kinds (`session`, `agent`, `mcp`) with distinct privileges. Optional email verification via Resend (`RESEND_API_KEY`); off unless configured, and enforcement is opt-in (`REQUIRE_EMAIL_VERIFICATION`).
- **Relay** — MCP tool call → job pushed to `jobs:<user>` (TTL ≤ the caller's wait window, so an abandoned job can't run late) → the Mac agent (holding a hanging long-poll) is handed the job within ~200ms, executes it, pushes the result → the MCP handler returns it. The long-poll means jobs are delivered on arrival rather than on a fixed interval, so relay overhead is ~300ms instead of ~1s. The agent is considered "online" only while it's actively connected.
- **Agent** — a dependency-free Node CLI. Tools run via JXA (`osascript -l JavaScript`) against Reminders.app; arguments are passed as JSON over argv (never shell-interpolated). A macOS LaunchAgent keeps it alive across logins and crashes.

## Repository layout

```
server/    Vercel functions: OAuth + MCP endpoint + relay        (deploy this)
agent/     apple-reminders-agent — the npm-published Mac CLI          (users npx this)
kit/       Browser automations: register the dev-mode connector AND
           fill the OpenAI directory submission (see kit/README.md)
supabase/  schema.sql for self-hosting the storage
test/      end-to-end OAuth + MCP integration test
```

## Development

```bash
# server
cd server && cp .env.example .env.local   # fill in, then: vercel dev
# end-to-end test against a live deployment (reads ../.env.local)
node test/e2e-oauth.mjs
# agent unit tests
node --test agent/test-agent-unit.mjs
```

## Security & privacy

- Reminders are read/written **only on your Mac**. The relay never persists reminder content — job payloads live in Redis-shaped storage with a short TTL and are deleted on delivery.
- The agent token is stored at `~/.remindersbridge-agent.json` (mode `600`).
- No secrets are committed; see [`.gitignore`](./.gitignore) and the `.env.example` files.
- Write tools are marked destructive so ChatGPT asks before changing a reminder.

## License

[MIT](./LICENSE) © Isaiah Dupree
