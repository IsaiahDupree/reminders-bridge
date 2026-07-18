# NotesBridge — paste-ready submission answers

Fill the OpenAI plugin submission form (platform.openai.com/plugins → **Create
plugin** → **With MCP**) with the values below. Fields verified against the live
portal on 2026-07-17. Requires developer identity verification first (see
SUBMISSION.md).

---

## Connection

| Field | Value |
|---|---|
| MCP Server URL | `https://notesbridge.vercel.app/mcp` |
| Authentication | OAuth |
| OAuth — the portal auto-discovers these from the URL's `/.well-known` metadata | authorization: `https://notesbridge.vercel.app/oauth/authorize` · token: `https://notesbridge.vercel.app/api/oauth/token` · registration (DCR): `https://notesbridge.vercel.app/api/oauth/register` · PKCE S256 · scope `notes` |

After entering the URL, click **Scan Tools** — it should discover all 8 tools.

## Listing (App Info section — exact fields on the live form)

| Field | Value |
|---|---|
| **Name** | NotesBridge |
| **Subtitle** ⚠️ ≤30 chars | `Apple Notes in ChatGPT` |
| **Category** | Productivity |
| **Developer Identity** | Business — Dupree Ops LLC *(the verified identity; requires ID verification first)* |
| **Plugin Author** | Isaiah Dupree |
| **Website URL** | `https://notesbridge.vercel.app` |
| **Customer support URL** | `https://notesbridge.vercel.app/support` |
| **Privacy policy URL** | `https://notesbridge.vercel.app/privacy` |
| **Terms of Service URL** | `https://notesbridge.vercel.app/terms` |
| **Demo Recording URL** ⚠️ required | *(a hosted screen-recording of the plugin working — you must record this)* |
| **Directory icon / composer icon** | `assets/icon-512.png` (512×512 PNG) |
| **Commerce & Purchasing** | leave unchecked (no purchases) |

**Description:**
> NotesBridge connects ChatGPT to the notes on your Mac. Search and read any note, create new ones, append to lists, or rewrite drafts — all from a chat. Your notes never live on our servers: every action is executed on your own Mac by a small open-source agent you install with one command (`npx apple-notes-agent`), and the relay only carries each request for the seconds it's in flight. Write actions are always confirmed by you in ChatGPT before they happen. Open source (MIT) and self-hostable.

*These values are also encoded in [`kit/submission.config.json`](./kit/submission.config.json), which `kit/submit-plugin.mjs` fills automatically.*

## Demo / reviewer account (no MFA)

> This connector normally relays to the user's own Mac. For review, sign in with
> the account below — it runs every tool against built-in server-side sample
> notes, so all 8 tools work 24/7 with no desktop app or pairing required.

- Email: `reviewer@notesbridge.demo`
- Password: *(the `DEMO_PASSWORD` value in `.env.local` — paste it here at submission)*

## Test prompts & expected responses

Sign in as the reviewer account, add the connector via OAuth, then:

1. **"List my Apple Notes folders"** → `list_folders` →
   `{ "folders": [ { "name": "Notes", "count": 3 }, { "name": "Work", "count": 1 }, { "name": "Recipes", "count": 1 } ] }`
2. **"Search my notes for sourdough"** → `search` →
   `{ "results": [ { "id": "demo-4", "title": "Sourdough recipe" } ] }`
3. **"What's on my grocery list?"** → `search` → returns the "Grocery list" note (`demo-2`); follow with **"Read it"** → `fetch`/`get_note` returns `milk, eggs, coffee beans, blueberries`.
4. **"Create a note titled Demo idea with the body Try NotesBridge"** → `create_note` →
   `{ "note": { "id": "demo-6", "title": "Demo idea", "folder": "Notes" } }` (ChatGPT confirms before writing)
5. **"List the notes in my Work folder"** → `list_notes` →
   `{ "notes": [ { "id": "demo-3", "title": "Q3 planning", "folder": "Work" } ] }`

## Negative test cases (exactly 3 — prompts where NotesBridge should NOT trigger)

1. **General note-taking advice** — *"What's a good method for taking meeting
   notes?"* — abstract question, no action on the user's own Apple Notes.
2. **A different app** — *"Add this to my Notion workspace."* — NotesBridge only
   works with Apple Notes, not Notion/Evernote/Keep.
3. **A reminders/calendar action** — *"Set a reminder to call the dentist
   tomorrow at 9am."* — NotesBridge creates/edits notes only, not reminders.

## Release notes (first release)

> Initial release. NotesBridge connects ChatGPT to your Apple Notes through a
> small open-source agent that runs on your own Mac — search and read any note,
> create new ones, append to lists, or rewrite drafts. Every write is confirmed
> by you before it happens. Your notes never live on our servers; the cloud
> piece is only a stateless relay. Open source (MIT) and self-hostable.

## Tools declared (8)

`search`, `fetch`, `list_folders`, `list_notes`, `get_note`, `create_note`,
`append_to_note`, `update_note` (the last is annotated destructive → ChatGPT
confirms before overwriting).

## Custom UI component

NotesBridge ships an Apps SDK UI component (`ui://widget/notes.html`) that the 5
read tools (`search`, `fetch`, `list_folders`, `list_notes`, `get_note`) render:
folders as a card grid, notes/search results as a tappable list, a single note
as a formatted card. It adapts to ChatGPT's light/dark theme and lets the user
click a note to open it (`callTool('fetch', …)`). The component only renders in
ChatGPT once the app is approved (developer-mode connectors show tool output as
text) — so screenshots taken pre-approval will show text, not the cards.
