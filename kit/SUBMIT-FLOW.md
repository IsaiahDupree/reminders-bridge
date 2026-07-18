# Submitting an MCP plugin to the OpenAI directory — the real flow

A complete, field-by-field map of the `platform.openai.com` plugin submission
form, verified end-to-end by actually submitting **NotesBridge v1.0.0** on
2026-07-17 (status: *Review*). Use this to submit any MCP connector. The reusable
primitives live in [`lib/openai-form.mjs`](./lib/openai-form.mjs); the listing
values live in [`submission.config.json`](./submission.config.json).

> **Golden rule:** you advance through the seven sections with the **Continue**
> (or **Skip**) button at the **bottom** of each section. The tabs across the top
> (`Info · MCP · Skills · Prompts · Testing · Global · Submit`) are *not* clickable
> to switch sections while filling.

## Prerequisites (only the account owner can do these)

1. **Developer identity verification** — platform.openai.com → Settings →
   Organization → Verifications (gov ID / business docs). Until done, "Create
   plugin → With MCP" shows an identity gate.
2. **A hosted demo recording** — a screen video of the plugin working. OpenAI
   marks the Demo Recording URL **required**. YouTube Unlisted is fine.
3. **A reviewer/demo account that works with no setup** — no signup, no 2FA.
   Ours is `reviewer@notesbridge.demo`, which runs every tool against
   server-side sample data (`server/lib/demoStore.js`).

## The 7 sections

### 1. Info
Name · Subtitle (**≤30 chars**, validated) · Description · Category *(custom
combobox)* · Developer Identity *(custom combobox — match a substring of the
verified identity)* · Plugin Author · Website / Support / Privacy / **Terms**
URLs (all required) · **Demo Recording URL** (required) · two icon uploads
(512×512). Category & Developer Identity are custom comboboxes
(`querySelectorAll('select')` = 0) — open by clicking the display text, click the
option via an element handle.

### 2. MCP  — the section with the most moving parts
- **MCP Server URL** — e.g. `https://notesbridge.vercel.app/mcp`.
- **Authentication** — a **Radix Select** (portal-rendered; a hidden
  `#mcp-auth-type` holds `NONE`/`MIXED`/`OAUTH`). Set it with
  `selectAuth(page, 'OAuth')`: Escape → mouse-click the trigger to open →
  `mouse.down()/up()` on the OAuth option's live rect. **Synthetic `.click()` and
  keyboard-arrows-without-Enter both fail.** With OAuth chosen, the portal
  auto-discovers your endpoints from `/.well-known/oauth-*` — no manual fields
  (Advanced settings shows the discovered DCR/authorize/token URLs).
- **Domain verification** — the form issues a token and a URL
  `https://<host>/.well-known/openai-apps-challenge`. Serve the token there
  (see `server/api/challenge.js`; the token is **public**, overridable via the
  `OPENAI_APPS_CHALLENGE` env var), deploy, then click **Verify Domain** → it
  flips to "Domain verified". A `vercel.app` subdomain verifies fine.
- **Scan Tools** — needs OAuth. It opens an **"Authorize MCP"** dialog →
  **Continue** runs the real OAuth (DCR client registration + PKCE) → your
  connector's own consent page opens → **sign in with the reviewer account** →
  **Allow** → redirect back → all tools are discovered. `runOAuthScan()` does the
  whole dance.
- **Tool justification** — after the scan, one **"Describe why …"** field per
  *explicit annotation* per tool (Read Only / Open World / Destructive). To make
  these appear cleanly and avoid "did not include an annotation" warnings, your
  MCP server should declare **complete** `ToolAnnotations` on every tool
  (`readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`). For
  a local-only tool, `openWorldHint: false`. `fillToolJustifications()` fills them.

### 3. Skills
Optional. NotesBridge has none → click **Skip**.

### 4. Prompts
Up to 3 showcase prompts (they render as `@Plugin …` chat bubbles). Each
**Add prompt** click adds one `Enter a default prompt` input.

### 5. Testing
- **Test credentials** — one textarea; put the reviewer email + password + a
  one-line "works immediately, no 2FA" note. *(The demo password is read from
  `../.env.local`, never committed.)*
- **Exactly 5 positive test cases** — each: Scenario, User prompt, Tool
  triggered, Expected output. A green check appears when a case is complete.
- **Exactly 3 negative test cases** — Scenario + User prompt only; prompts where
  the app should **not** trigger (e.g. "a different app", "a reminder"). This
  tunes invocation accuracy.

### 6. Global
English (US) translation is prefilled from Info (Description + Subtitle);
Allowed Countries defaults to **Allow all**. Usually nothing to do.

### 7. Submit
- **Release Notes** (required) — shown publicly on the details page.
- **Policy compliance** — 7 checkboxes + a mature-content radio. **These are the
  account owner's legal attestations — do not auto-check them.** They enable the
  **Submit for Review** button.
- Click **Submit for Review**. The plugins list then shows the plugin at
  **Status: Review**.

## Gotchas that cost real time

- **Stale editor session (the big one).** After ~1–2 h the editor tab silently
  stops saving — the *Draft saved* timestamp freezes, Scan Tools does nothing,
  and "MCP tools scan is required" reappears even though the tools were saved.
  **Fix: reload the draft URL** (`reloadDraft()`). Everything comes back.
- **Access-token TTL.** The MCP access token is 1 h (`ACCESS_TTL` in
  `server/api/oauth/token.js`); refresh works (90 d, rotating). The editor's
  stored scan can look expired after an hour — a reload + (if needed) re-scan
  fixes it. If you submit soon after scanning, it's a non-issue.
- **Read-only review version.** After submitting you view a "review version"
  ("Only draft versions can be edited"). To change anything, edit the draft
  version and re-submit.
- **React inputs.** Always set values with the native setter + `input`/`change`
  events (`setReactValueByPlaceholder()`), never `el.value =` alone.
- **Screenshots leak secrets.** The Testing credentials box shows the demo
  password; `kit/screenshots/*.png` is gitignored for this reason. Keep it that
  way.

## Reuse checklist for the NEXT plugin (e.g. MediaPoster)

1. Point `submission.config.json` at the new MCP URL + listing copy + prompts +
   test cases + release notes.
2. Ensure the server: (a) OAuth 2.1 + PKCE + DCR with `/.well-known` metadata,
   (b) serves `/.well-known/openai-apps-challenge`, (c) declares complete tool
   annotations, (d) has a working reviewer/demo account.
3. Record + host a demo video; set `info.demoRecordingUrl`.
4. Drive the form with the `lib/openai-form.mjs` helpers, section by section,
   screenshotting each step; **stop before the policy checkboxes**.
