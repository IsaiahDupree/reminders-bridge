# Submitting an MCP connector to the Anthropic (Claude) Connectors Directory

Companion to [`SUBMIT-FLOW.md`](./SUBMIT-FLOW.md) (which covers the OpenAI
directory). The good news: the **same MCP server** works for both — MCP is the
shared protocol, and NotesBridge already meets Anthropic's technical bar (OAuth
2.0 + DCR, streamable HTTP, complete tool annotations, privacy policy, reviewer
demo account). This doc maps Anthropic's submission portal and what it needs.

Sources: Anthropic "Submitting to the Connectors Directory" docs + Remote MCP
Server Submission Guide (claude.com/docs/connectors/building/submission,
support.claude.com). Verified July 2026.

---

## ⚠️ Hard gate: you need a Team or Enterprise Claude org

> "A Team or Enterprise organization. Admin settings aren't available on
> individual plans."

- The submission portal lives in **organization admin settings**. Individual /
  Pro plans **cannot** reach it.
- On **Team**, only the **Owner** can submit. On **Enterprise**, the Owner can
  delegate via a custom role with "Directory management" / "Libraries" permission.
- **Action needed:** confirm the account has a Team/Enterprise org with Owner
  access. If not, either upgrade, or use a Team org, before anything else here is
  actionable. (Meanwhile, anyone can already add NotesBridge to their own Claude
  as a **custom connector by URL** — no directory listing required.)

Portal: `https://claude.ai/admin-settings/directory/submissions/new`
Status/feedback: `https://claude.ai/admin-settings/directory/submissions`
Escalation: `mcp-review@anthropic.com`

---

## The 11-step portal

1. **Introduction** — overview.
2. **Connection** — Server URL (`https://` required) + transport (**streamable
   HTTP** or SSE) + connection model (single URL vs per-user URLs).
3. **Tools** — auto-synced from the connected server. **Flags any tool missing a
   `title` or a `readOnlyHint`/`destructiveHint`** — must be fixed before
   proceeding. *(NotesBridge already sets title + full annotations on all 8.)*
4. **Listing** — public metadata (see field table).
5. **Use cases** — primary use cases, prerequisites, read/write capabilities.
6. **Company** — organization name, website, primary contact.
7. **Authentication** — auth mode selection/config (OAuth 2.0 preferred; DCR /
   client-ID metadata / static client ID / custom / none).
8. **Data handling** — API ownership, personal-health-data flag, sponsored-content
   disclosures.
9. **Test & launch** — reviewer **test account instructions** + confirmation
   you've tested every tool (MCP Inspector or as a custom connector in Claude).
10. **Compliance** — seven mandatory policy acknowledgments (below).
11. **Review** — final verification + submit. Progress auto-saves in the session.

---

## Required listing fields & limits

| Field | Limit | NotesBridge value |
|---|---|---|
| Server name | 100 chars | `NotesBridge` |
| Tagline | **55 chars** | `Use your Apple Notes in ChatGPT and Claude` (43) |
| Description | 2,000 chars | see `anthropic.config.json` |
| Documentation URL | — | `https://github.com/IsaiahDupree/notesbridge` |
| Privacy policy URL | HTTPS, **required** | `https://notesbridge.vercel.app/privacy` |
| Support contact | — | `https://notesbridge.vercel.app/support` |
| Icon | — | `assets/icon-512.png` |
| URL slug | **permanent once published** | `notesbridge` |
| Categories | 1–5 | Productivity |
| Server URL | `https://` | `https://notesbridge.vercel.app/mcp` |
| Transport | streamable HTTP / SSE | streamable HTTP |
| Connection model | single vs per-user | single URL |
| Company name / website | — | Dupree Ops / `https://notesbridge.vercel.app` |
| Primary contact | — | (owner email) |

*A tagline mentioning "ChatGPT and Claude" is fine for the shared server; if you'd
rather keep the Claude listing Claude-only, use `Search and edit your Apple Notes
from Claude` (42 chars).*

## Technical requirements — NotesBridge status

| Requirement | Anthropic asks for | NotesBridge |
|---|---|---|
| Transport | streamable HTTP or SSE | ✅ streamable HTTP (`/mcp`) |
| Auth | OAuth 2.0 preferred; DCR ok | ✅ OAuth 2.1 + PKCE + **DCR** |
| Tool annotations | `title` + `readOnlyHint` **or** `destructiveHint` on every tool | ✅ all 8 have title + full hints |
| Privacy policy | HTTPS, covers collection/use/retention/sharing/contact | ✅ `/privacy` |
| Security | meet Anthropic security standards, respond to issues | ✅ security review + `SECURITY.md` |
| Reviewer testing | test account + you tested every tool | ✅ `reviewer@notesbridge.demo` demo mode |

**Missing/incomplete privacy policy = immediate rejection.** Ours is live and
specific (subprocessors, transient job payloads, no note retention).

## The 7 compliance acknowledgments (Compliance step)

You must acknowledge: (1) Directory guidelines, (2) first-party API usage,
(3) financial transactions, (4) AI media generation, (5) prompt-injection
safeguards, (6) conversation-data-collection restrictions, (7) public
documentation requirement — plus the Anthropic Software Directory Terms & Policy.
**These are the owner's legal attestations** — leave them for the account owner,
same as the OpenAI policy checkboxes.

---

## What we reuse vs. what's new

| | Reuse from NotesBridge |
|---|---|
| MCP server, OAuth, annotations, privacy/support, demo account | ✅ **zero server changes needed** |
| Listing copy, categories, reviewer creds, test steps | ✅ adapt from `LISTING.md` / OpenAI config |
| Form-driving primitives (React inputs, selects, buttons, screenshots) | ✅ shared via `lib/claude-form.mjs` (imports the generic helpers from `lib/openai-form.mjs`) |

**New / different from OpenAI:**
- Portal is **inside claude.ai admin settings** (not platform.openai.com) and
  gated to Team/Enterprise Owners.
- Tagline is **55 chars** (OpenAI subtitle was 30).
- No demo-video requirement (OpenAI required one); instead: written test-account
  instructions + a confirmation you tested every tool.
- 11 steps vs OpenAI's 7; different field names.

## Automation status

`lib/claude-form.mjs` provides the reusable primitives and the intended
step-by-step driver. **The claude.ai portal DOM selectors can only be finalized
against the live portal, which needs a Team/Enterprise org** — so the driver is
scaffolded with the generic helpers wired up, and the portal-specific selectors
are marked `TODO(portal)` to fill in on first run with real access. Everything
non-portal (config, listing copy, checklist) is complete and paste-ready in
`anthropic.config.json`.
