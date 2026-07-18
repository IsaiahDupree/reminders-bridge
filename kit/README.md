# MCP connector automation kit

Browser automations that register and submit an MCP connector to **both**
directories — the **OpenAI** plugin directory (platform.openai.com) and the
**Anthropic (Claude) Connectors Directory** (claude.ai) — plus the reusable
primitives behind them, so you don't click through the flows by hand. Everything
drives the persistent **chrome-bridge** agent Chrome over CDP
(`127.0.0.1:9222`) with `puppeteer-core`, and is **defensive**: every step
screenshots to `screenshots/`, anything un-automatable is printed as an explicit
"do this" instruction, and the owner's legal attestations + final submit are
always left to a human.

The same MCP server satisfies both directories (MCP is the shared protocol) — only
the listing config differs.

### OpenAI directory
| File | What it does |
|--------|--------------|
| [`register-connector.mjs`](./register-connector.mjs) | Adds the connector as a **developer-mode connector** in your own ChatGPT (Settings → Plugins → Create → OAuth → Allow). Idempotent — try it today, no review. |
| [`submit-plugin.mjs`](./submit-plugin.mjs) | Fills the **directory submission** at platform.openai.com from [`submission.config.json`](./submission.config.json). Stops before "Submit for review". |
| [`lib/openai-form.mjs`](./lib/openai-form.mjs) | **Reusable primitives** — Radix-select auth, React inputs, the OAuth Scan-Tools flow, domain verification, tool-justification fills, stale-session reload. |
| [`SUBMIT-FLOW.md`](./SUBMIT-FLOW.md) | Field-by-field map of the real 7-section form + every gotcha, verified by submitting NotesBridge v1.0.0. |

### Anthropic (Claude) directory
| File | What it does |
|--------|--------------|
| [`lib/claude-form.mjs`](./lib/claude-form.mjs) | Primitives + step sequence for the 11-step portal at `claude.ai/admin-settings/directory/submissions`. Re-uses the generic helpers from `openai-form.mjs`; portal-specific selectors are `TODO(portal)` pending Team/Enterprise access. Includes a `checkAccess()` preflight. |
| [`SUBMIT-FLOW-ANTHROPIC.md`](./SUBMIT-FLOW-ANTHROPIC.md) | Field-by-field map of the 11-step portal + requirements + the **Team/Enterprise org gate**. |
| [`anthropic.config.json`](./anthropic.config.json) | NotesBridge's paste-ready Anthropic listing (name, ≤55-char tagline, ≤2000-char description, categories, reviewer test steps, etc.). |

**Reusing for another connector (e.g. MediaSuite):** point the config(s) at the
new MCP URL + listing copy, make sure the server meets the checklists in the two
SUBMIT-FLOW docs (OAuth + complete tool annotations + privacy policy + reviewer
demo account), then drive each form with its helpers. The OpenAI form also wants
a demo video + 5 positive / 3 negative test cases; the Anthropic portal wants
written test-account instructions instead and requires a **Team/Enterprise Claude
org** to reach.

## Setup

```bash
cd kit
npm install            # puppeteer-core only
```

Prerequisites for both:
- macOS with the chrome-bridge agent Chrome. If CDP isn't up on `:9222`, the
  scripts launch `chrome-launcher.sh agent` automatically.
- That Chrome logged in to the relevant site (ChatGPT and/or platform.openai.com).
  If not, the scripts print instructions and poll until you log in.

Config/secrets: `submission.config.json` holds the listing values (edit to reuse
for another plugin). The reviewer demo **password is never stored here** — it's
read from `../.env.local` by the env-var name in the config (`DEMO_PASSWORD`).

## 1. Register the dev-mode connector

```bash
node register-connector.mjs                 # create the connector via OAuth
PREFLIGHT_ONLY=1 node register-connector.mjs # health + login check only
CHAT_TEST=1 node register-connector.mjs      # then run a live "list my folders" prompt
```

Idempotent — if NotesBridge is already in your Plugins list it verifies and
exits. See screenshots `01…`–`19…`.

## 2. Submit to the OpenAI directory

```bash
node submit-plugin.mjs                        # fill the form, STOP before submit
DRAFT_URL="https://platform.openai.com/plugins/edit/…" node submit-plugin.mjs  # resume a draft
SUBMIT=1 node submit-plugin.mjs               # also click "Submit for review"
```

It walks the form: **Create plugin → "With MCP" → the "Create new plugin" dialog
(Standard = same MCP URL for every user) → Continue →** an editor with sections
**Info · MCP · Skills · Prompts · Testing · Global · Submit**. You advance with
the **Continue** button at the bottom of each section (the top tabs don't switch).
The App Info section is fully automated (name, subtitle [≤30 chars], description,
Category and Developer Identity comboboxes, author, all four URLs, icon uploads);
later sections are filled best-effort — watch the first run.

### Two things only you can do (the script flags both)

1. **Developer identity verification.** platform.openai.com → Plugins → Create
   plugin → With MCP → Continue on the identity dialog → finish (business/developer
   tier). Until then the create form is gated and the script exits with instructions.
2. **A demo recording.** OpenAI marks "Demo Recording URL" required. Record a
   screen video of the plugin working, host it (YouTube/Loom/…), and put the URL
   in `submission.config.json` → `info.demoRecordingUrl`.

The reviewer demo credentials (`reviewer@notesbridge.demo` + `DEMO_PASSWORD`) are
the important field — reviewers use them to exercise all tools 24/7 with no Mac
(the server's demo mode). Paste-ready listing copy also lives in
[`../LISTING.md`](../LISTING.md); the end-to-end walkthrough is in
[`../SUBMISSION.md`](../SUBMISSION.md).

## Notes

- Screenshots for every step are written to `screenshots/` — send them along if a
  step needed manual help so the selectors can be tightened.
- ChatGPT / platform.openai.com DOM churns; the scripts use text/label matching
  and print exactly what to set for anything they can't find, so a partial run is
  still useful.
