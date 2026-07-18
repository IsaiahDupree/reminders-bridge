// openai-form.mjs — reusable primitives for driving the OpenAI plugin
// ("app") submission form at platform.openai.com over the chrome-bridge agent
// Chrome (CDP 127.0.0.1:9222). Extracted from the NotesBridge submission so any
// MCP connector can be submitted with the same battle-tested helpers.
//
// These encode the hard-won facts about the live form (verified 2026-07-17):
//   • The form has 7 sections advanced by the BOTTOM "Continue"/"Skip" button,
//     NOT the top tabs.
//   • Text inputs are React-controlled — set them with the native value setter
//     + input/change events, not el.value = ... alone (React overwrites it).
//   • "Authentication" is a Radix Select (portal-rendered, hidden #mcp-auth-type
//     holds NONE/MIXED/OAUTH). Synthetic .click() and keyboard-arrows-without-
//     Enter both FAIL. Open it and mouse-down/up on the option's live rect.
//   • "Scan Tools" needs OAuth: it opens an "Authorize MCP" dialog → the real
//     OAuth authorize (DCR + PKCE) → your consent page → sign in → Allow.
//   • Domain verification is a well-known-file challenge you must serve.
//   • The editor tab goes STALE after ~1-2h (its saves silently no-op, the
//     draft-saved timestamp freezes, Scan Tools does nothing). RELOAD to fix.
//
// Everything here is defensive: callers screenshot around each step.

import puppeteer from 'puppeteer-core';

export const CDP_URL = 'http://127.0.0.1:9222';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const lc = (s) => (s || '').replace(/\s+/g, ' ').trim();

/** Connect to the persistent agent Chrome over CDP. */
export async function connectChrome() {
  return puppeteer.connect({ browserURL: CDP_URL, defaultViewport: null, protocolTimeout: 120000 });
}

/** Find the open plugin-editor tab (…/plugins/edit/…). */
export async function getEditorPage(browser) {
  const pages = await browser.pages();
  return pages.find((p) => { try { return /\/plugins\/edit\//.test(p.url()); } catch { return false; } }) || null;
}

/** Find any platform.openai.com tab (fallback / for the plugins list). */
export async function getPlatformPage(browser) {
  const pages = await browser.pages();
  return pages.find((p) => { try { return /platform\.openai\.com/.test(p.url()); } catch { return false; } }) || null;
}

/**
 * Set a React-controlled <input>/<textarea> to `value` via the native setter so
 * React's onChange fires. Pass an in-page element reference through page.evaluate.
 */
export async function setReactValueByPlaceholder(page, placeholderRe, value) {
  return page.evaluate(({ placeholderSrc, value }) => {
    const re = new RegExp(placeholderSrc, 'i');
    const el = [...document.querySelectorAll('input,textarea')].find((e) => re.test(e.placeholder || ''));
    if (!el) return false;
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, { placeholderSrc: placeholderRe.source, value });
}

/** Trusted click on a button whose visible text exactly equals `text`. */
export async function clickButtonByText(page, text, { includes = false } = {}) {
  const handle = await page.evaluateHandle(({ text, includes }) => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    return [...document.querySelectorAll('button')].find((e) => {
      const t = norm(e.textContent);
      return (includes ? t.includes(text) : t === text) && !e.disabled;
    }) || null;
  }, { text, includes });
  if (!(await handle.evaluate((e) => !!e))) return false;
  await handle.click(); // trusted mouse event
  return true;
}

/**
 * Set the MCP "Authentication" Radix Select to 'No Auth' | 'Mixed Auth' | 'OAuth'.
 * Returns the resulting hidden-input value (NONE/MIXED/OAUTH) or an error string.
 */
export async function selectAuth(page, target) {
  const readVal = () => page.evaluate(() => document.getElementById('mcp-auth-type')?.value);
  await page.keyboard.press('Escape');
  await sleep(300);
  const pos = await page.evaluate(() => {
    const t = [...document.querySelectorAll('[id^="select-trigger"]')].find((e) => /Auth/.test(e.textContent));
    if (!t) return null;
    const r = t.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!pos) return 'trigger-not-found';
  await page.mouse.click(pos.x, pos.y);
  await sleep(800);
  const opt = await page.evaluate((label) => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const el = [...document.querySelectorAll('[role="option"]')].find((e) => norm(e.textContent) === label);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, target);
  if (!opt) return 'option-not-found';
  await page.mouse.move(opt.x, opt.y);
  await sleep(150);
  await page.mouse.down();
  await sleep(60);
  await page.mouse.up();
  await sleep(1200);
  return readVal();
}

/** Are the tools scanned? true when the "scan required" notice is absent. */
export async function isScanComplete(page) {
  return page.evaluate(() => !/MCP tools scan is required/i.test(document.body.innerText));
}

/** "Domain verified"? */
export async function isDomainVerified(page) {
  return page.evaluate(() => /Domain verified/i.test(document.body.innerText) && !/Domain not verified/i.test(document.body.innerText));
}

/**
 * Run the full "Scan Tools" OAuth flow: click Scan Tools, handle the
 * "Authorize MCP" dialog, sign in on the connector's own consent page with the
 * reviewer/demo account, click Allow, and wait for tools to be discovered.
 * Returns { ok, tools:[], note }. `expectedTools` is used to confirm discovery.
 */
export async function runOAuthScan(page, browser, { email, password, expectedTools = [] }) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(300);
  await clickButtonByText(page, 'Scan Tools');
  await sleep(3500);

  // If the "Authorize MCP" dialog appears, walk the OAuth consent.
  const hasDialog = await page.evaluate(() => /Authorize MCP/i.test(document.body.innerText));
  if (hasDialog) {
    // Click the dialog's Continue (the one near "Authorize MCP").
    await page.evaluate(() => {
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
      const btns = [...document.querySelectorAll('button')].filter((e) => norm(e.textContent) === 'Continue');
      const inDlg = btns.find((e) => { let n = e; for (let i = 0; i < 6 && n; i++) { n = n.parentElement; if (n && /Authorize MCP/i.test(n.textContent)) return true; } return false; });
      (inDlg || btns[0])?.click();
    });
    await sleep(3500);

    // The connector's own OAuth consent page (…/oauth/authorize…) opens.
    const authPage = (await browser.pages()).find((p) => { try { return /\/oauth\/authorize/.test(p.url()); } catch { return false; } });
    if (authPage) {
      await authPage.bringToFront();
      await sleep(600);
      // Sign-in form (email + password). Skip if already past it.
      const needsSignin = await authPage.evaluate(() => !!document.querySelector('input[type="password"]'));
      if (needsSignin) {
        await authPage.evaluate(() => { const e = document.querySelector('input[type="email"]') || document.querySelectorAll('input')[0]; if (e) { e.focus(); e.value = ''; e.setAttribute('data-nb', 'email'); } });
        await authPage.type('[data-nb="email"]', email, { delay: 15 });
        await authPage.evaluate(() => { const e = document.querySelector('input[type="password"]'); if (e) { e.focus(); e.value = ''; e.setAttribute('data-nb', 'pw'); } });
        await authPage.type('[data-nb="pw"]', password, { delay: 15 });
        await authPage.evaluate(() => { const norm = (s) => (s || '').replace(/\s+/g, ' ').trim(); [...document.querySelectorAll('button')].find((e) => /sign in/i.test(norm(e.textContent)))?.click(); });
        await sleep(3500);
      }
      // Consent: click Allow.
      await authPage.evaluate(() => { const norm = (s) => (s || '').replace(/\s+/g, ' ').trim(); [...document.querySelectorAll('button')].find((e) => norm(e.textContent) === 'Allow')?.click(); });
      await sleep(4500);
    }
  }

  // Back to the editor; wait for tools to appear / scan requirement to clear.
  await page.bringToFront();
  for (let i = 0; i < 12; i++) {
    await sleep(2500);
    const st = await page.evaluate((expected) => {
      const t = document.body.innerText;
      return { scanReq: /MCP tools scan is required/i.test(t), present: expected.filter((k) => new RegExp('\\b' + k + '\\b').test(t)) };
    }, expectedTools);
    if (!st.scanReq && (expectedTools.length === 0 || st.present.length >= Math.min(5, expectedTools.length))) {
      return { ok: true, tools: st.present, note: 'scan complete' };
    }
  }
  return { ok: false, tools: [], note: 'tools not discovered — check auth/session' };
}

/**
 * Fill the per-tool annotation-justification fields. `annotations` is a map
 * { toolName: { readOnly, openWorld, destructive } } of accurate one-liners.
 * The form shows one field per (tool, annotation) with a "Describe why …"
 * placeholder; we anchor each on its "Enter tools triggered"-sibling isn't
 * present here — instead we match by the tool heading nearest above each field.
 */
export async function fillToolJustifications(page, textByToolAndType) {
  return page.evaluate((TEXT) => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const setVal = (el, val) => { const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype; const setter = Object.getOwnPropertyDescriptor(proto, 'value').set; setter.call(el, val); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
    const tools = Object.keys(TEXT).map((k) => k.split('|')[0]);
    const uniqTools = [...new Set(tools)];
    const headings = [...document.querySelectorAll('*')].filter((e) => e.children.length === 0 && uniqTools.includes(norm(e.textContent)));
    const toolFor = (el) => { let best = null, bestY = -1; const y = el.getBoundingClientRect().top; for (const h of headings) { const hy = h.getBoundingClientRect().top; if (hy <= y && hy > bestY) { bestY = hy; best = norm(h.textContent); } } return best; };
    const typeFor = (ph) => /Read Only/i.test(ph) ? 'ro' : /Open World/i.test(ph) ? 'ow' : /Destructive/i.test(ph) ? 'de' : null;
    const inputs = [...document.querySelectorAll('input,textarea')].filter((e) => /Describe why/i.test(e.placeholder || ''));
    let filled = 0;
    for (const el of inputs) { const key = toolFor(el) + '|' + typeFor(el.placeholder); if (TEXT[key]) { setVal(el, TEXT[key]); filled++; } }
    return { filled, total: inputs.length };
  }, textByToolAndType);
}

/** Reload the editor draft to refresh a stale session. Returns the url. */
export async function reloadDraft(page) {
  const url = page.url();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await sleep(4000);
  return url;
}

/** True if the editor session looks stale (frozen saves). Heuristic. */
export async function looksStale(page) {
  return page.evaluate(() => /Viewing the review version/i.test(document.body.innerText));
}
