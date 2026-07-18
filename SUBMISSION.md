# NotesBridge — App Directory Submission Playbook

Everything needed to submit NotesBridge to the OpenAI app directory (apps SDK /
connector review), what's already done, and what only the account owner can do.

## Status: what's built and verified

| Requirement | Status | Proof |
|---|---|---|
| MCP server, streamable HTTP, OAuth 2.1 + PKCE + DCR | ✅ live | `https://notesbridge.vercel.app/mcp`; e2e suite |
| Privacy policy | ✅ live | https://notesbridge.vercel.app/privacy (accurate: Supabase + Vercel subprocessors, transient job payloads, no note retention) |
| Support page | ✅ live | https://notesbridge.vercel.app/support |
| Rate limiting on auth + OAuth endpoints | ✅ live | signup 5/10min, login 10/10min, authorize 30/10min, token 60/min, register 20/hr, claim 10/10min — 429 verified in e2e |
| **Reviewer demo mode** | ✅ live | Any account with email `reviewer@notesbridge.demo` runs all 8 tools against server-side sample notes — works 24/7 with **no Mac agent**. Real accounts are unaffected. Verified in e2e (search/create/re-read with zero agents running). |
| Onboarding UX | ✅ live | 4-step wizard with live agent status at the root URL |
| Apps SDK UI component | ✅ built & wired | `ui://widget/notes.html` on the 5 read tools (folders/notes/search/note cards). Protocol-verified live. **Renders only once the app is approved** — developer-mode connectors display tool output as text (confirmed empirically with both `text/html+skybridge` and `text/html;profile=mcp-app`). No effect on the working connector; e2e stays green. |
| 512×512 icon | ✅ | `assets/icon-512.png` |
| OAuth tool scan | ✅ live | Form "Scan Tools" completes the OAuth consent and discovers all 8 tools |
| Domain verification | ✅ live | `/.well-known/openai-apps-challenge` (`server/api/challenge.js`) — form shows "Domain verified" |
| Complete tool annotations | ✅ | All 8 tools declare readOnly/destructive/idempotent/openWorld hints (0 form warnings) |
| Full e2e suite | ✅ 22 green checks | `node test/e2e-oauth.mjs` |

## Steps only the account owner can do

*(Portal flow verified live 2026-07-17: the submission form is at
`platform.openai.com/plugins` → **Create plugin** → **With MCP**. It is gated by
identity verification — clicking Create plugin shows "Complete identity
verification — you need a verified developer identity before you can create or
upload a plugin." That check requires a government ID / selfie and can only be
done by you.)*

1. **Complete developer identity verification.** platform.openai.com → **Plugins**
   → **Create plugin** → **With MCP** → **Continue** on the "Complete identity
   verification" dialog, and finish the ID check (or do it up front at Settings →
   Organization → **Verifications**). Requires the Owner role. *(Note: the org
   already shows a base "Verified" status, but plugin creation needs this
   developer-identity tier on top of it.)*
2. **Keep the demo credentials handy** for the form:
   - Email: `reviewer@notesbridge.demo`
   - Password: the `DEMO_PASSWORD` value in `.env.local` (already created &
     verified — do not rotate it after submitting; reviewers use it)
3. **Create the plugin & fill the form.** Back at Plugins → Create plugin →
   With MCP → Standard → Continue. The editor has **seven** sections, advanced
   by the bottom **Continue** button (not the top tabs). Verified end-to-end on
   the live portal 2026-07-17:

   1. **Info** — name, ≤30-char subtitle, description, Category + Developer
      Identity (custom comboboxes), author, Website/Support/Privacy/Terms URLs,
      Demo Recording URL (required — the YouTube link), two icon uploads. All
      paste-ready in **LISTING.md**.
   2. **MCP** — MCP Server URL `https://notesbridge.vercel.app/mcp`;
      Authentication **OAuth** (auto-discovers config from our `/.well-known`
      metadata); **Domain verification** — the form issues a token you must
      serve at `/.well-known/openai-apps-challenge` (our `server/api/challenge.js`
      already does this) then click **Verify Domain**; **Scan Tools** — opens an
      "Authorize MCP" OAuth consent (sign in with the reviewer demo account,
      Allow) and then discovers all 8 tools; **Tool justification** — one line
      per annotation per tool (Read Only / Open World / Destructive) explaining
      why it's accurate.
   3. **Skills** — none; click **Skip**.
   4. **Prompts** — up to 3 showcase prompts (list / search / create).
   5. **Testing** — reviewer demo credentials (email + `DEMO_PASSWORD`), exactly
      **5 positive** test cases (scenario / user prompt / tool / expected) and
      exactly **3 negative** test cases (scenario + prompt where the app should
      *not* trigger).
   6. **Global** — English (US) translation is prefilled from Info; Allowed
      Countries = Allow all.
   7. **Submit** — Release Notes, then the policy-compliance checkboxes and the
      mature-content radio (**the account owner's legal attestations**), which
      enable **Submit for Review**.

## Directory listing copy

All paste-ready form values (name, tagline, description, URLs, demo credentials,
test prompts + expected responses, OAuth endpoints) live in **LISTING.md**.

*(Copy refers to "the notes on your Mac" / Notes app descriptively; the product
name and branding contain no Apple marks.)*

## Review risks & mitigations

- **Novel architecture (desktop agent).** Most connectors are pure SaaS; ours
  relays to the user's machine. Mitigation: the reviewer demo account makes the
  app fully reviewable with no Mac. The listing copy and privacy policy explain
  the architecture honestly.
- **Latency.** A tool call round-trips through the queue to a polling agent
  (~1.5–4s typical). Within MCP norms; the relay caps waits at 50s and jobs
  expire at 45s so nothing runs stale.
- **Apple trademark.** Product is "NotesBridge"; copy says "your Apple Notes"
  descriptively only; the icon is generic (note + bridge). Do not use Apple's
  Notes app icon or "Apple" in the product name.
- **Destructive tools.** `update_note` is annotated `destructiveHint`; ChatGPT
  prompts for confirmation. Called out in the consent screen and privacy page.

## Fallback plan

If the directory review is rejected or slow: nothing is lost. The developer-mode
connector keeps working exactly as it does today for the owner and anyone who
creates an account on the dashboard and pairs their own Mac — the submission
only affects public discoverability.

## Automation

`kit/submit-plugin.mjs` drives the submission form in the agent Chrome (CDP :9222),
config-driven from `kit/submission.config.json`. It walks Create plugin → With MCP
→ Standard → the multi-section editor, fully automates the **App Info** section
(name, ≤30-char subtitle, description, Category + Developer Identity comboboxes,
author, all four URLs, icon uploads), fills later sections best-effort, detects
which required fields still block "Continue", and **stops before "Submit for review"**.

```bash
cd kit && npm install
node submit-plugin.mjs                                   # fill the form, stop before submit
DRAFT_URL="https://platform.openai.com/plugins/edit/..." \
  node submit-plugin.mjs                                 # resume an existing draft
SUBMIT=1 node submit-plugin.mjs                          # also click Submit for review
```

Two fields the script can only flag, not fill: **developer identity verification**
(step 1) and the **Demo Recording URL** (a hosted screen-recording of the plugin
working — put it in `submission.config.json`). Full details + the companion
connector automation: **[kit/README.md](./kit/README.md)**.

## Re-verify before submitting

```bash
node test/e2e-oauth.mjs        # 22 checks, includes demo-mode + rate limits
curl -s https://notesbridge.vercel.app/api/health   # all flags true
```
