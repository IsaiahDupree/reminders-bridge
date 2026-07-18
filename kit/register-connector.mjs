#!/usr/bin/env node
/**
 * NotesBridge → ChatGPT connector registration kit.
 *
 * Automates: Settings → Apps & Connectors → Advanced → Developer mode ON →
 * Connectors "Create" form → NotesBridge OAuth popup (sign in + Allow) →
 * verify the connector exists → screenshot proof.
 *
 * Reuses the persistent agent Chrome profile (chrome-bridge, CDP on :9222).
 *
 * Env flags:
 *   PREFLIGHT_ONLY=1  preflight + CDP connect + chatgpt.com login-state
 *                     detection + screenshots/01-chatgpt-state.png, then exit.
 *   CHAT_TEST=1       after registration, open a chat, attach NotesBridge,
 *                     ask it to list Apple Notes folders, screenshot reply.
 *
 * Config: NB_SERVER / NB_EMAIL / NB_PASSWORD from env first, falling back to
 * /Users/isaiahdupree/Software/notesbridge/.env.local
 *
 * Defensive pattern for EVERY UI step: try known selectors / text lookup;
 * on failure screenshot NN-<step>-FAILED.png, print exactly what to click
 * manually, then poll for the expected post-condition and resume.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';

// ---------------------------------------------------------------- constants

const KIT_DIR = '/Users/isaiahdupree/Software/notesbridge/kit';
const SHOTS_DIR = path.join(KIT_DIR, 'screenshots');
const ENV_FILE = '/Users/isaiahdupree/Software/notesbridge/.env.local';
const LAUNCHER = '/Users/isaiahdupree/Documents/Chrome/chrome-bridge/chrome-launcher.sh';
const CDP_URL = 'http://127.0.0.1:9222';
const CHATGPT_URL = 'https://chatgpt.com';
// ChatGPT renamed "Connectors" → "Plugins" (2026). Custom MCP servers are added
// via the developer-mode "New App" form, reached directly by this deep link
// (skips the settings→advanced→developer-mode navigation entirely). Verified live.
const PLUGINS_URL = 'https://chatgpt.com/#settings/Plugins';
const CREATE_DEEPLINK = 'https://chatgpt.com/plugins#settings/Connectors?create-connector=true';
const CONNECTOR_NAME = 'NotesBridge';
const CONNECTOR_DESC = 'Apple Notes on my Mac';

const PREFLIGHT_ONLY = process.env.PREFLIGHT_ONLY === '1';
const CHAT_TEST = process.env.CHAT_TEST === '1';

// ---------------------------------------------------------------- utilities

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(...args) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`[kit ${t}]`, ...args);
}

function loud(lines) {
  const bar = '='.repeat(72);
  console.log(`\n${bar}\n  ACTION NEEDED — do this manually in the open Chrome window:\n`);
  for (const l of [].concat(lines)) console.log(`    ${l}`);
  console.log(`\n  The script keeps polling and resumes automatically once done.\n${bar}\n`);
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

let shotN = 0;
async function shot(page, label) {
  shotN += 1;
  const file = path.join(SHOTS_DIR, `${String(shotN).padStart(2, '0')}-${slug(label)}.png`);
  try {
    await page.bringToFront().catch(() => {});
    await page.screenshot({ path: file });
    log(`screenshot -> ${file}`);
  } catch (e) {
    log(`screenshot failed (${label}): ${e.message}`);
  }
  return file;
}

/** Poll fn() until truthy. timeoutMs=0 → poll forever. Returns last value. */
async function waitFor(fn, { timeoutMs = 30000, intervalMs = 1000, desc = 'condition' } = {}) {
  const start = Date.now();
  for (;;) {
    let v;
    try { v = await fn(); } catch { v = false; }
    if (v) return v;
    if (timeoutMs > 0 && Date.now() - start > timeoutMs) {
      throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for: ${desc}`);
    }
    await sleep(intervalMs);
  }
}

/**
 * Defensive step wrapper. Runs attempt(); on any error:
 *  - screenshots NN-<step>-FAILED.png
 *  - prints manual instructions
 *  - polls postCondition (every 5s, forever) and resumes when it holds.
 * If optional=true and there is no postCondition, logs and continues instead.
 */
async function step(page, name, attempt, { manual, postCondition, optional = false } = {}) {
  log(`STEP: ${name}`);
  try {
    await attempt();
    return true;
  } catch (err) {
    log(`step "${name}" automation failed: ${err.message}`);
    await shot(page, `${slug(name)}-FAILED`);
    if (manual) loud(manual);
    if (postCondition) {
      await waitFor(postCondition, { timeoutMs: 0, intervalMs: 5000, desc: `${name} (manual)` });
      log(`step "${name}" post-condition reached — resuming.`);
      return true;
    }
    if (optional) {
      log(`step "${name}" is optional — continuing without it.`);
      return false;
    }
    throw err;
  }
}

// ------------------------------------------------------------------- config

function loadConfig() {
  const cfg = {
    NB_SERVER: process.env.NB_SERVER,
    NB_EMAIL: process.env.NB_EMAIL,
    NB_PASSWORD: process.env.NB_PASSWORD,
  };
  if (!cfg.NB_SERVER || !cfg.NB_EMAIL || !cfg.NB_PASSWORD) {
    try {
      const raw = fs.readFileSync(ENV_FILE, 'utf8');
      for (const line of raw.split('\n')) {
        const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (m && ['NB_SERVER', 'NB_EMAIL', 'NB_PASSWORD'].includes(m[1]) && !cfg[m[1]]) {
          cfg[m[1]] = m[2].trim();
        }
      }
    } catch (e) {
      log(`could not read ${ENV_FILE}: ${e.message}`);
    }
  }
  const missing = ['NB_SERVER', 'NB_EMAIL', 'NB_PASSWORD'].filter((k) => !cfg[k]);
  if (missing.length) {
    console.error(`Missing config: ${missing.join(', ')}. Set them as env vars or in ${ENV_FILE}`);
    process.exit(2);
  }
  cfg.NB_SERVER = cfg.NB_SERVER.replace(/\/+$/, '');
  log(`config: NB_SERVER=${cfg.NB_SERVER} NB_EMAIL=${cfg.NB_EMAIL} NB_PASSWORD=${'*'.repeat(8)}`);
  return cfg;
}

// ---------------------------------------------------------------- preflight

async function preflight(cfg) {
  const url = `${cfg.NB_SERVER}/api/health`;
  log(`preflight: GET ${url}`);
  let body;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    body = await res.json();
  } catch (e) {
    console.error(`\nPREFLIGHT FAILED — could not reach ${url}: ${e.message}`);
    console.error('Fix: check NB_SERVER is correct and the Vercel deployment is live, then retry.');
    process.exit(2);
  }
  const ok = body.redisConfigured && body.redisOk && body.jwtSecretSet;
  log(`preflight: ${JSON.stringify(body)}`);
  if (!ok) {
    console.error('\nPREFLIGHT FAILED — the NotesBridge server is not ready:');
    if (!body.redisConfigured) console.error('  - redisConfigured=false → set the Redis/KV env vars (UPSTASH/KV URL + token) in Vercel project settings.');
    if (body.redisConfigured && !body.redisOk) console.error('  - redisOk=false → Redis is configured but unreachable; check the Upstash/KV instance and credentials.');
    if (!body.jwtSecretSet) console.error('  - jwtSecretSet=false → set JWT_SECRET in Vercel project settings.');
    console.error('  Then redeploy (npx vercel --yes --prod) and re-run this script.');
    process.exit(2);
  }
  log('preflight OK — redisConfigured, redisOk, jwtSecretSet all true.');
}

// ------------------------------------------------------------------- chrome

async function cdpAlive() {
  try {
    const res = await fetch(`${CDP_URL}/json/version`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function connectChrome() {
  if (!(await cdpAlive())) {
    log(`CDP not responding on ${CDP_URL} — launching chrome-launcher.sh (agent profile)...`);
    const child = spawn('/bin/zsh', [LAUNCHER, 'agent'], { detached: true, stdio: 'ignore' });
    child.unref();
    await waitFor(cdpAlive, { timeoutMs: 90000, intervalMs: 1500, desc: `CDP endpoint ${CDP_URL}` });
  }
  const browser = await puppeteer.connect({
    browserURL: CDP_URL,
    defaultViewport: null,
    protocolTimeout: 180000,
  });
  log(`connected to Chrome ${await browser.version()}`);
  return browser;
}

async function gotoSafe(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (e) {
    log(`goto ${url}: ${e.message} (continuing)`);
  }
  await sleep(2500);
}

async function getChatGPTPage(browser) {
  const pages = await browser.pages();
  let page = pages.find((p) => {
    try { return /^https:\/\/(chatgpt\.com|chat\.openai\.com)/.test(p.url()); } catch { return false; }
  });
  if (!page) page = pages.find((p) => p.url() === 'about:blank');
  if (!page) page = await browser.newPage();
  await page.bringToFront().catch(() => {});
  await gotoSafe(page, CHATGPT_URL);
  return page;
}

// -------------------------------------------------- text-based DOM helpers
// ChatGPT's DOM churns constantly, so all lookups are text-based:
// page.evaluate + document.evaluate with XPath contains() on lowercased text.
// domScan is self-contained (no closures) so puppeteer can serialize it.

function domScan(matchers, opts, action) {
  const lc = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const visible = (el) => {
    if (!el.getClientRects().length) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  let roots = [document];
  if (opts.scope) {
    const scoped = [...document.querySelectorAll(opts.scope)];
    if (scoped.length) roots = scoped.reverse(); // topmost dialog last in DOM → first
  }
  const results = [];
  for (const m of matchers) {
    const needle = lc(m);
    if (needle.includes('"')) continue;
    const xpath =
      './/*[self::button or self::a or @role="button" or @role="menuitem" or ' +
      '@role="menuitemradio" or @role="tab" or @role="switch" or @role="radio" or ' +
      '@role="option" or @role="checkbox" or self::label]' +
      '[contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", ' +
      `"abcdefghijklmnopqrstuvwxyz"), "${needle}")]`;
    for (const root of roots) {
      const it = document.evaluate(xpath, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (let i = 0; i < it.snapshotLength; i++) {
        const el = it.snapshotItem(i);
        if (!visible(el)) continue;
        const text = lc(el.textContent);
        if (text.length > needle.length + 60) continue; // skip huge containers
        if (opts.exact && text !== needle) continue;
        results.push({ el, text, exact: text === needle });
      }
      if (results.length) break; // prefer topmost scope
    }
    if (results.length) break; // prefer earlier matchers
  }
  results.sort((a, b) => (b.exact - a.exact) || (a.text.length - b.text.length));
  if (!results.length) return { count: 0, clicked: false };
  if (action === 'click') {
    const { el, text } = results[0];
    el.scrollIntoView({ block: 'center' });
    el.click();
    return { count: results.length, clicked: true, text };
  }
  return { count: results.length, clicked: false, text: results[0].text };
}

async function clickByText(page, matchers, opts = {}) {
  const res = await page.evaluate(domScan, matchers, opts, 'click');
  if (res.clicked) log(`clicked "${res.text}" (matched ${JSON.stringify(matchers)})`);
  return res;
}

async function textExists(page, matchers, opts = {}) {
  const res = await page.evaluate(domScan, matchers, opts, 'exists').catch(() => ({ count: 0 }));
  return res.count > 0;
}

/** Plain-text presence check anywhere on the page (not restricted to clickables). */
async function pageContains(page, needle) {
  return page.evaluate((needle) => {
    const t = (document.body?.innerText || '').toLowerCase();
    return t.includes(needle.toLowerCase());
  }, needle).catch(() => false);
}

/** Fill a React-controlled input/textarea located by its label/placeholder text. */
async function fillFieldByLabel(page, labelMatchers, value) {
  const res = await page.evaluate((labelMatchers, value) => {
    const lc = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const dialogs = [...document.querySelectorAll('[role="dialog"]')].reverse();
    const roots = dialogs.length ? dialogs : [document.body];
    const setValue = (el) => {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      el.focus();
      if (setter) setter.call(el, value); else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
      return true;
    };
    for (const root of roots) {
      for (const m of labelMatchers) {
        const needle = lc(m);
        // 1. <label for=...> or label-wrapped input
        for (const lab of root.querySelectorAll('label')) {
          if (!lc(lab.textContent).includes(needle)) continue;
          let input = lab.htmlFor ? document.getElementById(lab.htmlFor) : lab.querySelector('input, textarea');
          if (!input) {
            let anc = lab;
            for (let i = 0; i < 3 && anc && !input; i++) { anc = anc.parentElement; input = anc?.querySelector('input, textarea'); }
          }
          if (input) return { ok: setValue(input), how: `label "${lab.textContent.trim().slice(0, 40)}"` };
        }
        // 2. any element whose own text matches, with a nearby input
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
        let node;
        while ((node = walker.nextNode())) {
          if (node.children.length > 3) continue;
          if (!lc(node.textContent).includes(needle) || lc(node.textContent).length > needle.length + 30) continue;
          let anc = node;
          for (let i = 0; i < 4 && anc; i++) {
            const input = anc.querySelector?.('input:not([type=checkbox]):not([type=radio]), textarea');
            if (input) return { ok: setValue(input), how: `near text "${needle}"` };
            anc = anc.parentElement;
          }
        }
        // 3. placeholder / aria-label
        for (const input of root.querySelectorAll('input, textarea')) {
          const hint = lc(input.placeholder) + ' ' + lc(input.getAttribute('aria-label'));
          if (hint.includes(needle)) return { ok: setValue(input), how: `placeholder "${needle}"` };
        }
      }
    }
    return { ok: false };
  }, labelMatchers, value);
  if (res.ok) log(`filled field ${JSON.stringify(labelMatchers[0])} via ${res.how}`);
  return res.ok;
}

// ---------------------------------------------------------- login detection

async function detectLoginState(page) {
  const st = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const composer = !!(q('#prompt-textarea') || q('[data-testid="composer"]') || q('form [contenteditable="true"]'));
    const profile = !!(q('[data-testid="profile-button"]') || q('[data-testid="accounts-profile-button"]'));
    const btnTexts = [...document.querySelectorAll('button, a')]
      .map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase());
    const loginBtn = btnTexts.some((t) => t === 'log in' || t === 'login' || t === 'sign up' || t === 'sign up for free');
    return { composer, profile, loginBtn, url: location.href, title: document.title };
  }).catch((e) => ({ composer: false, profile: false, loginBtn: false, error: e.message }));
  st.loggedIn = !st.loginBtn && (st.composer || st.profile);
  st.state = st.loggedIn ? 'logged-in' : st.loginBtn ? 'logged-out' : 'unknown';
  return st;
}

async function ensureLoggedIn(page) {
  let st = await detectLoginState(page);
  // Give the SPA a moment if state is ambiguous (still loading / interstitial)
  if (st.state === 'unknown') {
    try {
      st = await waitFor(async () => {
        const s = await detectLoginState(page);
        return s.state !== 'unknown' ? s : false;
      }, { timeoutMs: 30000, intervalMs: 2000, desc: 'login state' });
    } catch { st = await detectLoginState(page); }
  }
  log(`chatgpt.com login state: ${st.state} (composer=${st.composer} profile=${st.profile} loginBtn=${st.loginBtn})`);
  if (st.loggedIn || PREFLIGHT_ONLY) return st;

  // Best effort: the "Welcome back" account picker allows one-click re-login
  // when the auth session cookie is still valid.
  const picked = await page.evaluate(() => {
    const lc = (s) => (s || '').toLowerCase();
    const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
    if (!dlg || !lc(dlg.textContent).includes('welcome back')) return false;
    const tiles = [...dlg.querySelectorAll('button, [role="button"], a')];
    const tile = tiles.find((b) => /@[a-z0-9.-]+\./i.test(b.textContent || '') && !lc(b.textContent).includes('another account'));
    if (tile) { tile.click(); return true; }
    return false;
  }).catch(() => false);
  if (picked) {
    log('clicked the "Welcome back" account tile — waiting for session...');
    await sleep(8000);
    st = await detectLoginState(page);
    if (st.loggedIn) { log('one-click re-login worked.'); return st; }
  }

  loud([
    'ChatGPT is NOT logged in in the agent Chrome window.',
    `1. Focus the Chrome window showing ${CHATGPT_URL}`,
    '2. Click "Log in" and sign in with the isaiahdupree33@gmail.com account.',
    '3. Leave the tab open — polling every 5s, no timeout.',
  ]);
  let polls = 0;
  for (;;) {
    await sleep(5000);
    polls += 1;
    if (polls % 6 === 0) await gotoSafe(page, CHATGPT_URL); // refresh every 30s
    st = await detectLoginState(page);
    if (st.loggedIn) break;
    if (polls % 6 === 0) log('still logged out — waiting for manual login...');
  }
  log('ChatGPT login detected — continuing.');
  return st;
}

// -------------------------------------------------------- connector settings

async function connectorsSettingsVisible(page) {
  return page.evaluate(() => {
    const dlg = [...document.querySelectorAll('[role="dialog"]')].pop() || document.body;
    const t = (dlg.innerText || '').toLowerCase();
    // Current UI: "Plugins — Manage plugins you've installed" (+ "Browse plugins",
    // "Developer mode"). Kept the legacy "connector" terms for older builds.
    return (t.includes('plugin') && (t.includes('manage plugins') || t.includes('browse plugins') || t.includes('developer mode')))
      || (t.includes('connector') && (t.includes('advanced') || t.includes('create') || t.includes('developer mode')));
  }).catch(() => false);
}

/** Idempotency + verification: is the connector already in the plugins list? */
async function connectorListed(page, name = CONNECTOR_NAME) {
  return pageContains(page, name);
}

// Developer mode is an account-level setting (Settings → Security and login →
// "Developer mode") and is assumed already ON. The create flow below reaches the
// custom-plugin form directly via CREATE_DEEPLINK, so no settings navigation or
// toggle automation is needed. connectorsSettingsVisible() above is retained for
// the verify step and older builds.

// ----------------------------------------------------------- create connector

// Set a React-controlled input's value inside the topmost dialog, by a list of
// CSS selectors (aria-label / placeholder). Returns whether one matched.
async function setDialogInput(page, selectors, value) {
  return page.evaluate((selectors, value) => {
    const setNative = (el, val) => {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      el.focus(); if (setter) setter.call(el, val); else el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
    };
    const dlg = [...document.querySelectorAll('[role="dialog"]')].pop() || document.body;
    for (const sel of selectors) { const el = dlg.querySelector(sel); if (el) { setNative(el, value); return true; } }
    return false;
  }, selectors, value);
}

async function createFormVisible(page) {
  return page.evaluate(() => {
    const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
    if (!dlg) return false;
    const t = (dlg.innerText || '').toLowerCase();
    return (t.includes('new app') || t.includes('new connector') || t.includes('server url'))
      && !!dlg.querySelector('input[aria-label="Name"], input[placeholder="Custom Tool"], input[placeholder="https://example.com/sse"]');
  }).catch(() => false);
}

// The post-Create modal: "Add NotesBridge to ChatGPT" with a "Sign in with NotesBridge" button.
async function signInButtonVisible(page) {
  return textExists(page, ['Sign in with NotesBridge', 'Sign in with']);
}

async function createConnector(page, cfg, oauthSeen) {
  // The New App / create form is reached directly by deep link — no settings
  // navigation or developer-mode toggling needed (dev mode is account-level).
  await step(page, 'open create form', async () => {
    await gotoSafe(page, CREATE_DEEPLINK);
    await waitFor(() => createFormVisible(page), { timeoutMs: 20000, intervalMs: 1000, desc: 'New App create form' });
  }, {
    manual: [
      'Open the custom-plugin create form manually:',
      '1. Settings → Plugins → make sure Developer mode is ON (Security and login).',
      '2. Click "Browse plugins", then create a new custom plugin,',
      `   or just open this URL: ${CREATE_DEEPLINK}`,
    ],
    postCondition: () => createFormVisible(page),
  });
  await shot(page, 'create-form');

  await step(page, 'fill create form', async () => {
    const okName = await setDialogInput(page, ['input[aria-label="Name"]', 'input[placeholder="Custom Tool"]'], CONNECTOR_NAME);
    await setDialogInput(page, ['input[aria-label="Description (optional)"]', 'input[placeholder="Explain what it does in a few words"]'], CONNECTOR_DESC);
    const okUrl = await setDialogInput(page, ['input[placeholder="https://example.com/sse"]', 'input[placeholder*="sse"]'], `${cfg.NB_SERVER}/mcp`);
    if (!okName || !okUrl) throw new Error(`form fill incomplete (name=${okName} url=${okUrl})`);
    // Let ChatGPT run OAuth discovery against the MCP URL's /.well-known metadata.
    log('waiting for ChatGPT to discover OAuth settings from the MCP URL...');
    await sleep(6000);
    // Authentication: OAuth (usually auto-selected once discovered)
    await clickByText(page, ['OAuth'], { scope: '[role="dialog"]' });
    await sleep(800);
    // "I understand and want to continue" risk acknowledgement
    await page.evaluate(() => {
      const lc = (s) => (s || '').toLowerCase();
      const dlg = [...document.querySelectorAll('[role="dialog"]')].pop() || document.body;
      for (const box of dlg.querySelectorAll('input[type="checkbox"], [role="checkbox"]')) {
        const label = lc(box.closest('label')?.textContent || box.parentElement?.textContent || '');
        const checked = box.checked === true || box.getAttribute('aria-checked') === 'true';
        if (label.includes('understand') && !checked) { box.click(); return; }
      }
      const only = dlg.querySelector('input[type="checkbox"]');
      if (only && !only.checked) only.click();
    });
    await sleep(500);
  }, {
    manual: [
      'Fill the New App form manually:',
      `  Name:            ${CONNECTOR_NAME}`,
      `  Description:     ${CONNECTOR_DESC}`,
      `  Server URL:      ${cfg.NB_SERVER}/mcp`,
      '  Authentication:  OAuth',
      '  Tick "I understand and want to continue".',
    ],
    postCondition: () => createFormVisible(page),
  });
  await shot(page, 'create-form-filled');

  await step(page, 'submit create form', async () => {
    const clicked = await page.evaluate(() => {
      const lc = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const dlg = [...document.querySelectorAll('[role="dialog"]')].pop() || document.body;
      const btn = [...dlg.querySelectorAll('button, [role="button"]')].filter((e) => lc(e.textContent) === 'create' && !e.disabled).pop();
      if (btn) { btn.click(); return true; }
      return false;
    });
    if (!clicked) throw new Error('"Create" button not found or disabled');
    // Post-create, ChatGPT shows "Add NotesBridge to ChatGPT" with a sign-in button.
    await waitFor(async () => (await signInButtonVisible(page)) || (await oauthSeen()) || (await connectorListed(page)),
      { timeoutMs: 20000, intervalMs: 1000, desc: 'sign-in modal / OAuth page' });
  }, {
    manual: ['Click "Create" at the bottom of the New App form.'],
    postCondition: async () => (await signInButtonVisible(page)) || (await oauthSeen()) || (await connectorListed(page)),
  });
  await shot(page, 'after-create');

  // Launch OAuth from the "Add NotesBridge to ChatGPT" modal (unless it already opened).
  if (await signInButtonVisible(page)) {
    await step(page, 'launch OAuth (sign in with NotesBridge)', async () => {
      const res = await clickByText(page, ['Sign in with NotesBridge', 'Sign in with']);
      if (!res.clicked) throw new Error('"Sign in with NotesBridge" button not found');
    }, {
      manual: ['Click "Sign in with NotesBridge" to start the OAuth authorization.'],
      postCondition: async () => (await oauthSeen()) || (await connectorListed(page)),
    });
  }
}

// -------------------------------------------------------------- OAuth popup

function makeOAuthWatcher(browser, chatPage, nbOrigin) {
  // Returns { seen, getPage } — polls browser.targets() for a page on the NB origin
  const find = async () => {
    for (const t of browser.targets()) {
      try {
        if (t.type() === 'page' && t.url().startsWith(nbOrigin)) {
          const p = await t.page();
          if (p) return p;
        }
      } catch { /* target may vanish mid-scan */ }
    }
    try { if (chatPage.url().startsWith(nbOrigin)) return chatPage; } catch {}
    return null;
  };
  return {
    seen: async () => !!(await find()),
    getPage: find,
  };
}

async function completeOAuth(browser, chatPage, cfg, watcher) {
  log('waiting for NotesBridge OAuth page (popup tab or same tab)...');
  let oauthPage = null;
  try {
    oauthPage = await waitFor(watcher.getPage, { timeoutMs: 120000, intervalMs: 750, desc: 'NotesBridge OAuth page' });
  } catch {
    // Maybe OAuth already completed silently (existing grant) — check connector list.
    if (await pageContains(chatPage, 'NotesBridge')) {
      log('no OAuth page appeared but NotesBridge is already listed — continuing.');
      return;
    }
    loud([
      'The NotesBridge OAuth window did not open.',
      'If a popup was blocked, allow popups for chatgpt.com and click the connector /',
      '"Connect" again. The script polls for the OAuth page and resumes.',
    ]);
    oauthPage = await waitFor(watcher.getPage, { timeoutMs: 0, intervalMs: 5000, desc: 'NotesBridge OAuth page (manual)' });
  }
  await oauthPage.bringToFront().catch(() => {});
  log(`OAuth page: ${oauthPage.url()}`);
  await oauthPage.waitForSelector('#loginView, #consentView', { timeout: 30000 }).catch(() => {});
  await shot(oauthPage, 'oauth-page');

  const oauthState = () => oauthPage.evaluate(() => ({
    consent: !document.getElementById('consentView')?.classList.contains('hidden'),
    err: (document.getElementById('err')?.textContent || '').trim(),
  })).catch(() => ({ consent: false, err: '', gone: true }));

  // --- sign in (skipped when a session token already put us on the consent view)
  let st = await oauthState();
  if (!st.consent && !st.gone) {
    await step(oauthPage, 'oauth sign in', async () => {
      await oauthPage.click('#email', { clickCount: 3 });
      await oauthPage.type('#email', cfg.NB_EMAIL);
      await oauthPage.click('#password', { clickCount: 3 });
      await oauthPage.type('#password', cfg.NB_PASSWORD);
      await clickByText(oauthPage, ['Sign in & continue']);
      st = await waitFor(async () => {
        const s = await oauthState();
        return (s.consent || s.err) ? s : false;
      }, { timeoutMs: 20000, intervalMs: 500, desc: 'consent view or error' });
      if (!st.consent && st.err) {
        log(`sign-in error: "${st.err}" — retrying with "Create account & continue"`);
        await clickByText(oauthPage, ['Create account & continue']);
        st = await waitFor(async () => {
          const s = await oauthState();
          return (s.consent || s.err) ? s : false;
        }, { timeoutMs: 20000, intervalMs: 500, desc: 'consent view after signup' });
      }
      if (!st.consent) throw new Error(`OAuth login failed: ${st.err || 'no consent view'}`);
    }, {
      manual: [
        'Complete the NotesBridge sign-in manually in the OAuth window:',
        `  Email:    ${cfg.NB_EMAIL}`,
        '  Password: (NB_PASSWORD from .env.local)',
        '  Click "Sign in & continue" (or "Create account & continue" if the account is new).',
      ],
      postCondition: async () => (await oauthState()).consent,
    });
  }
  await shot(oauthPage, 'oauth-consent');

  // --- consent
  const redirected = async () => {
    try {
      if (oauthPage.isClosed()) return true;
      return !oauthPage.url().startsWith(new URL(cfg.NB_SERVER).origin);
    } catch { return true; }
  };
  await step(oauthPage, 'oauth allow', async () => {
    const res = await clickByText(oauthPage, ['Allow'], { exact: true });
    if (!res.clicked) throw new Error('"Allow" button not found');
    await waitFor(redirected, { timeoutMs: 60000, intervalMs: 750, desc: 'redirect back to ChatGPT / popup close' });
  }, {
    manual: ['Click "Allow" in the NotesBridge consent window.'],
    postCondition: redirected,
  });
  log('OAuth complete — redirected back / popup closed.');
  await sleep(3000);
}

// ------------------------------------------------------------------ verify

async function verifyConnector(page) {
  log('verifying the NotesBridge connector exists in the connectors list...');
  await page.bringToFront().catch(() => {});
  await gotoSafe(page, `${CHATGPT_URL}/#settings/Connectors`);
  if (!(await connectorsSettingsVisible(page))) {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await sleep(4000);
  }
  let found = false;
  try {
    await waitFor(() => pageContains(page, 'NotesBridge'), { timeoutMs: 60000, intervalMs: 2000, desc: 'NotesBridge in connectors list' });
    found = true;
  } catch {
    await shot(page, 'verify-FAILED');
    loud([
      'Could not see "NotesBridge" in Settings → Apps & Connectors.',
      'Check the "Created by me" section manually; if it is missing, re-run this script.',
      'Polling up to 5 more minutes for it to appear...',
    ]);
    try {
      await waitFor(() => pageContains(page, 'NotesBridge'), { timeoutMs: 300000, intervalMs: 5000, desc: 'NotesBridge (manual)' });
      found = true;
    } catch { /* fall through */ }
  }
  if (!found) {
    console.error('\nVERIFICATION FAILED — NotesBridge connector not visible in the connectors list.');
    process.exit(1);
  }
  const createdByMe = await pageContains(page, 'Created by me');
  log(`VERIFIED: NotesBridge connector is listed${createdByMe ? ' (a "Created by me" section is present)' : ''}.`);
  await shot(page, 'connector-verified');
}

// ---------------------------------------------------------------- chat test

async function chatTest(page) {
  log('CHAT_TEST=1 — running an end-to-end chat test...');
  await gotoSafe(page, CHATGPT_URL);
  await page.waitForSelector('#prompt-textarea, form [contenteditable="true"]', { timeout: 30000 }).catch(() => {});

  await step(page, 'attach NotesBridge connector', async () => {
    const plusClicked = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="composer-plus-btn"], button[aria-label="Add"], button[aria-label*="Attach"]');
      if (el) { el.click(); return true; }
      return false;
    });
    if (!plusClicked) throw new Error('composer "+" button not found');
    await sleep(1500);
    // The connector may be nested under "More" / "Connectors"
    await clickByText(page, ['Connectors', 'More']);
    await sleep(1500);
    const res = await clickByText(page, ['NotesBridge']);
    if (!res.clicked) throw new Error('NotesBridge entry not found in the + menu');
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(500);
  }, {
    manual: [
      'Attach the connector manually: click "+" in the composer → More/Connectors → NotesBridge.',
      '(If you skip this, the model may still route to the connector — continuing either way.)',
    ],
    optional: true,
  });
  await shot(page, 'chat-connector-attached');

  const baseline = await page.evaluate(() => document.querySelectorAll('[data-message-author-role="assistant"]').length).catch(() => 0);
  await page.click('#prompt-textarea').catch(() => {});
  await page.type('#prompt-textarea', 'Use NotesBridge to list my Apple Notes folders', { delay: 20 });
  await page.keyboard.press('Enter');
  log('prompt sent — waiting up to 90s for a reply...');
  try {
    await waitFor(async () => {
      const n = await page.evaluate(() => document.querySelectorAll('[data-message-author-role="assistant"]').length).catch(() => 0);
      return n > baseline;
    }, { timeoutMs: 90000, intervalMs: 2000, desc: 'assistant reply' });
    await sleep(8000); // let the reply stream in
  } catch {
    log('no assistant reply within 90s — screenshotting current state anyway');
  }
  await shot(page, 'chat-test-reply');
}

// --------------------------------------------------------------------- main

async function main() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const cfg = loadConfig();

  // (a) preflight
  await preflight(cfg);

  // (b) chrome via chrome-bridge CDP
  const browser = await connectChrome();

  // (c) chatgpt.com + login state
  const page = await getChatGPTPage(browser);
  const st = await ensureLoggedIn(page);
  await shot(page, 'chatgpt-state'); // -> 01-chatgpt-state.png

  if (PREFLIGHT_ONLY) {
    log(`PREFLIGHT_ONLY=1 — stopping before any settings interaction.`);
    log(`RESULT: preflight OK, CDP connected, chatgpt.com login state = ${st.state}`);
    browser.disconnect();
    process.exit(0);
  }

  // (g setup) start watching for the OAuth target before anything can open it
  const watcher = makeOAuthWatcher(browser, page, new URL(cfg.NB_SERVER).origin);

  // (d) idempotency: if the connector already exists, don't create a duplicate
  await gotoSafe(page, PLUGINS_URL);
  await sleep(2000);
  if (await connectorListed(page)) {
    log(`"${CONNECTOR_NAME}" is already in the Plugins list — skipping creation.`);
    await verifyConnector(page);
    if (CHAT_TEST) await chatTest(page);
    log('DONE (already registered). Screenshots in ' + SHOTS_DIR);
    browser.disconnect();
    process.exit(0);
  }

  // (e) create the custom plugin via the deep-linked "New App" form
  //     (developer mode is account-level and assumed ON; the form deep link
  //      bypasses settings navigation entirely)
  await createConnector(page, cfg, watcher.seen);

  // (f) OAuth popup: sign in + Allow
  await completeOAuth(browser, page, cfg, watcher);

  // (g) verify + proof screenshot
  await verifyConnector(page);

  // (i) optional chat test
  if (CHAT_TEST) await chatTest(page);

  log('DONE. Screenshots in ' + SHOTS_DIR);
  browser.disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('\nFATAL:', err.message);
  console.error(err.stack);
  process.exit(1);
});
