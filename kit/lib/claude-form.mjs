// claude-form.mjs — primitives for driving the Anthropic (Claude) Connectors
// Directory submission portal at claude.ai/admin-settings/directory/submissions,
// over the chrome-bridge agent Chrome (CDP 127.0.0.1:9222).
//
// MCP is the shared protocol, so the SAME server submitted to OpenAI works here.
// The generic form primitives (React inputs, buttons, screenshots, Chrome
// connect) are portable — we re-export them from ./openai-form.mjs rather than
// duplicate. What differs is the portal: it lives inside claude.ai admin
// settings, is gated to **Team/Enterprise Owners**, and has an 11-step flow.
//
// ⚠️ Portal-specific DOM selectors are marked TODO(portal): they can only be
// finalized against the LIVE portal, which needs a Team/Enterprise org. Until
// then this module provides the reusable helpers + the intended step sequence so
// the first run with real access is a fill-in-the-selectors job, not a rewrite.
//
// See ../SUBMIT-FLOW-ANTHROPIC.md for the field map + requirements, and
// ../anthropic.config.json for NotesBridge's paste-ready listing values.

export {
  CDP_URL, sleep, lc,
  connectChrome,
  setReactValueByPlaceholder,
  clickButtonByText,
} from './openai-form.mjs';

import { sleep, lc } from './openai-form.mjs';

export const PORTAL_URL = 'https://claude.ai/admin-settings/directory/submissions/new';
export const STATUS_URL = 'https://claude.ai/admin-settings/directory/submissions';

/** The 11 portal steps, in order (matches SUBMIT-FLOW-ANTHROPIC.md). */
export const STEPS = [
  'Introduction', 'Connection', 'Tools', 'Listing', 'Use cases',
  'Company', 'Authentication', 'Data handling', 'Test & launch',
  'Compliance', 'Review',
];

/** Find the open claude.ai submission-portal tab. */
export async function getPortalPage(browser) {
  const pages = await browser.pages();
  return pages.find((p) => { try { return /claude\.ai\/admin-settings\/directory/.test(p.url()); } catch { return false; } }) || null;
}

/**
 * Preflight: is the account able to reach the portal at all? Returns
 * { reachable, reason }. If the org is individual/Pro, admin settings are
 * absent — the portal redirects or shows an upgrade/permission notice.
 */
export async function checkAccess(page) {
  await page.goto(PORTAL_URL, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await sleep(3000);
  return page.evaluate(() => {
    const t = document.body.innerText || '';
    const blocked = /(admin settings|Team or Enterprise|upgrade|don.t have (access|permission)|not available)/i.test(t)
      && !/Connection|Server URL|Submission/i.test(t);
    return { reachable: !blocked, reason: blocked ? 'portal not reachable — needs a Team/Enterprise org with Owner access' : 'portal reachable', snippet: t.slice(0, 160) };
  });
}

/** Advance to the next step. TODO(portal): confirm the Next/Continue label + selector. */
export async function nextStep(page) {
  // Anthropic portals typically use a bottom "Next"/"Continue"/"Save & continue".
  return page.evaluate(() => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const btn = [...document.querySelectorAll('button')].find((e) => /^(Next|Continue|Save (&|and) continue)$/i.test(norm(e.textContent)) && !e.disabled);
    if (btn) { btn.click(); return norm(btn.textContent); }
    return null;
  });
}

/** Which step are we on? Heuristic from the visible step header. */
export async function currentStep(page) {
  return page.evaluate((STEPS) => {
    const t = (document.body.innerText || '');
    for (const s of STEPS) { if (new RegExp('\\b' + s.replace(/[.*+?^${}()|[\]\\&]/g, '\\$&') + '\\b', 'i').test(t)) return s; }
    return null;
  }, STEPS);
}

/**
 * Intended driver — fills the portal from an anthropic.config.json object.
 * Portal-specific field selectors are TODO(portal); the shape below documents
 * the mapping so filling them in against the live DOM is mechanical.
 *
 * Steps that are the OWNER's to do (never automate): the Compliance
 * acknowledgments and the final submit — stop before them, same as OpenAI.
 */
export async function driveSubmission(page, browser, config, { screenshot } = {}) {
  const plan = [
    ['Connection', 'serverUrl → input; transport → select "Streamable HTTP"; connection model → single URL'],
    ['Tools', 'auto-synced from the server; verify NO tool is flagged for missing title/annotation'],
    ['Listing', 'serverName, tagline (≤55), description (≤2000), documentationUrl, privacyPolicyUrl, supportContact, icon upload, urlSlug, categories'],
    ['Use cases', 'primary use cases, prerequisites, read/write capabilities'],
    ['Company', 'company name, website, primary contact'],
    ['Authentication', 'select OAuth 2.0; discovery is auto from the server /.well-known'],
    ['Data handling', 'first-party API = yes; personal health data = no; sponsored content = no'],
    ['Test & launch', 'paste reviewerTest.instructions + demo creds; confirm every tool tested'],
    ['Compliance', 'OWNER ONLY — 7 acknowledgments + Terms. Do not auto-check.'],
    ['Review', 'OWNER ONLY — final submit.'],
  ];
  return { note: 'TODO(portal): implement per-step fills against the live portal DOM using the shared setReactValueByPlaceholder/clickButtonByText helpers. Mapping:', plan, config: { server: config?.connection?.serverUrl, name: config?.listing?.serverName } };
}
