# RemindersBridge — paste-ready submission answers

Fill the OpenAI plugin submission form (platform.openai.com/plugins → **Create
plugin** → **With MCP**) with the values below. Fields verified against the live
portal on 2026-07-17. Requires developer identity verification first (see
SUBMISSION.md).

---

## Connection

| Field | Value |
|---|---|
| MCP Server URL | `https://remindersbridge.vercel.app/mcp` |
| Authentication | OAuth |
| OAuth — the portal auto-discovers these from the URL's `/.well-known` metadata | authorization: `https://remindersbridge.vercel.app/oauth/authorize` · token: `https://remindersbridge.vercel.app/api/oauth/token` · registration (DCR): `https://remindersbridge.vercel.app/api/oauth/register` · PKCE S256 · scope `reminders` |

After entering the URL, click **Scan Tools** — it should discover all 8 tools.

## Listing (App Info section — exact fields on the live form)

| Field | Value |
|---|---|
| **Name** | RemindersBridge |
| **Subtitle** ⚠️ ≤30 chars | `Apple Reminders in ChatGPT` |
| **Category** | Productivity |
| **Developer Identity** | Business — Dupree Ops LLC *(the verified identity; requires ID verification first)* |
| **Plugin Author** | Isaiah Dupree |
| **Website URL** | `https://remindersbridge.vercel.app` |
| **Customer support URL** | `https://remindersbridge.vercel.app/support` |
| **Privacy policy URL** | `https://remindersbridge.vercel.app/privacy` |
| **Terms of Service URL** | `https://remindersbridge.vercel.app/terms` |
| **Demo Recording URL** ⚠️ required | *(a hosted screen-recording of the plugin working — you must record this)* |
| **Directory icon / composer icon** | `assets/icon-512.png` (512×512 PNG) |
| **Commerce & Purchasing** | leave unchecked (no purchases) |

**Description:**
> RemindersBridge connects ChatGPT to the reminders on your Mac. Search and read any reminder, browse your lists, create new reminders with due dates, mark them complete, or edit them — all from a chat. Your reminders never live on our servers: every action is executed on your own Mac by a small open-source agent you install with one command (`npx apple-reminders-agent`), and the relay only carries each request for the seconds it's in flight. Write actions are always confirmed by you in ChatGPT before they happen. Open source (MIT) and self-hostable.

*These values are also encoded in [`kit/submission.config.json`](./kit/submission.config.json), which `kit/submit-plugin.mjs` fills automatically.*

## Demo / reviewer account (no MFA)

> This connector normally relays to the user's own Mac. For review, sign in with
> the account below — it runs every tool against built-in server-side sample
> reminders, so all 8 tools work 24/7 with no desktop app or pairing required.

- Email: `reviewer@remindersbridge.demo`
- Password: *(the `DEMO_PASSWORD` value in `.env.local` — paste it here at submission)*

## Test prompts & expected responses

Sign in as the reviewer account, add the connector via OAuth, then:

1. **"List my Apple Reminders lists"** → `list_lists` →
   `{ "lists": [ { "name": "Reminders", "open": 3 }, { "name": "Work", "open": 1 }, { "name": "Groceries", "open": 2 } ] }`
2. **"Search my reminders for oat milk"** → `search` →
   `{ "results": [ { "id": "demo-4", "name": "Buy oat milk" } ] }`
3. **"What's on my Groceries list?"** → `list_reminders` (list `Groceries`) → returns `Buy oat milk` (`demo-4`) and `Pick up eggs` (`demo-5`); follow with **"Open the oat milk one"** → `get_reminder` returns its notes and due date.
4. **"Add 'Call the dentist' to my Reminders list, due tomorrow at 9am"** → `create_reminder` →
   `{ "reminder": { "id": "demo-6", "name": "Call the dentist", "list": "Reminders", "due": "2026-07-18T09:00" } }` (ChatGPT confirms before writing)
5. **"Mark the oat milk reminder as done"** → `complete_reminder` →
   `{ "reminder": { "id": "demo-4", "name": "Buy oat milk", "completed": true } }` (ChatGPT confirms before writing)

## Negative test cases (exactly 3 — prompts where RemindersBridge should NOT trigger)

1. **General productivity advice** — *"What's a good method for staying on top of
   my to-do list?"* — abstract question, no action on the user's own Apple Reminders.
2. **A different app** — *"Add this to my Todoist inbox."* — RemindersBridge only
   works with Apple Reminders, not Todoist/Things/Google Tasks.
3. **A notes/document action** — *"Write up meeting minutes in a new note."* —
   RemindersBridge creates/edits reminders only, not notes or documents.

## Release notes (first release)

> Initial release. RemindersBridge connects ChatGPT to your Apple Reminders through a
> small open-source agent that runs on your own Mac — search and read any reminder,
> browse your lists, create new reminders with due dates, mark them complete, or edit
> them. Every write is confirmed by you before it happens. Your reminders never live on
> our servers; the cloud piece is only a stateless relay. Open source (MIT) and
> self-hostable.

## Tools declared (8)

`search`, `fetch`, `list_lists`, `list_reminders`, `get_reminder`,
`create_reminder`, `complete_reminder`, `update_reminder` (the write tools are
annotated destructive → ChatGPT confirms before changing a reminder).
