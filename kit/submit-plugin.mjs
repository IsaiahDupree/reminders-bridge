#!/usr/bin/env node
/**
 * submit-plugin.mjs — OpenAI plugin ("app") submission automation.
 *
 * Drives platform.openai.com → Plugins → Create plugin → "With MCP", fills the
 * multi-section submission form from submission.config.json, and STOPS before
 * "Submit for review" so you can eyeball it. It is idempotent-ish: pass
 * DRAFT_URL=<editor url> to resume an existing draft instead of creating a new one.
 *
 * Reuses the chrome-bridge agent Chrome (CDP on 127.0.0.1:9222), the same setup
 * as register-connector.mjs.
 *
 * ── Two MANUAL prerequisites this script cannot do for you ──────────────────
 *   1. Developer identity verification (platform.openai.com; gov ID / business
 *      docs). Until done, "Create plugin → With MCP" shows an identity gate.
 *   2. A demo recording (screen video of the plugin working). OpenAI marks the
 *      "Demo Recording URL" field REQUIRED. Record + host it, then put the URL
 *      in submission.config.json (info.demoRecordingUrl).
 *
 * ── The form (learned from the live UI) ─────────────────────────────────────
 *   Create plugin → menu "With MCP" → dialog "Create new plugin" (Standard is
 *   the default; = same MCP URL for every user) → Continue → an editor opens
 *   with sections: Info · MCP · Skills · Prompts · Testing · Global · Submit.
 *   You advance with the "Continue" button at the BOTTOM of each section (the
 *   tabs across the top are not clickable to switch). The App Info section is
 *   fully automated here; later sections are filled best-effort (watch the run).
 *
 * Env: DRAFT_URL (resume a draft), SUBMIT=1 (also click Submit for review),
 *      HEADFUL section screenshots always saved to ./screenshots/.
 *
 * Config: submission.config.json (values) + ../.env.local (the demo password).
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const KIT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(KIT_DIR, 'screenshots');
const CONFIG = JSON.parse(fs.readFileSync(path.join(KIT_DIR, 'submission.config.json'), 'utf8'));
const ENV_FILE = path.join(KIT_DIR, '..', '.env.local');
const LAUNCHER = '/Users/isaiahdupree/Documents/Chrome/chrome-bridge/chrome-launcher.sh';
const CDP = 'http://127.0.0.1:9222';
const SUBMIT = process.env.SUBMIT === '1';
const DRAFT_URL = process.env.DRAFT_URL || '';

const env = fs.existsSync(ENV_FILE)
  ? Object.fromEntries(fs.readFileSync(ENV_FILE, 'utf8').split('\n').filter((l) => l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
  : {};
const demoPassword = env[CONFIG.reviewerDemo.passwordEnvVar] || '(set ' + CONFIG.reviewerDemo.passwordEnvVar + ' in .env.local)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[submit ${new Date().toTimeString().slice(0, 8)}]`, ...a);
function loud(lines) {
  const bar = '='.repeat(72);
  console.log(`\n${bar}\n  ACTION NEEDED (only you can do this):\n`);
  for (const l of [].concat(lines)) console.log(`    ${l}`);
  console.log(`${bar}\n`);
}
let shotN = 0;
const shot = async (page, label) => {
  shotN += 1;
  const f = path.join(SHOTS, `submit-${String(shotN).padStart(2, '0')}-${label}.png`);
  try { await page.bringToFront().catch(() => {}); await page.screenshot({ path: f, fullPage: true }); log('shot →', path.basename(f)); } catch {}
};
const waitFor = async (fn, { timeoutMs = 0, intervalMs = 3000, desc = 'condition' } = {}) => {
  const t0 = Date.now();
  for (;;) { let v; try { v = await fn(); } catch { v = false; } if (v) return v; if (timeoutMs && Date.now() - t0 > timeoutMs) throw new Error('timeout: ' + desc); await sleep(intervalMs); }
};

// ── chrome ──────────────────────────────────────────────────────────────────
async function cdpAlive() { try { return (await fetch(`${CDP}/json/version`, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; } }
async function connect() {
  if (!(await cdpAlive())) {
    log('CDP down — launching agent Chrome…');
    spawn('/bin/zsh', [LAUNCHER, 'agent'], { detached: true, stdio: 'ignore' }).unref();
    await waitFor(cdpAlive, { intervalMs: 1500, desc: 'CDP' });
  }
  const b = await puppeteer.connect({ browserURL: CDP, defaultViewport: null, protocolTimeout: 180000 });
  log('connected to Chrome', await b.version());
  return b;
}

// ── generic field helpers ────────────────────────────────────────────────────
async function fillByLabel(page, matchers, value) {
  if (value == null || value === '') return false;
  const ok = await page.evaluate((matchers, value) => {
    const lc = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const setVal = (el) => {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      el.focus(); setter ? setter.call(el, value) : (el.value = value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
    };
    for (const m of matchers) {
      const needle = lc(m);
      for (const el of document.querySelectorAll('input, textarea')) {
        if (el.type === 'file' || el.type === 'checkbox') continue;
        const lab = lc((el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent) || el.closest('label')?.textContent || '');
        const hint = lc(el.getAttribute('aria-label')) + ' ' + lc(el.placeholder) + ' ' + lab;
        if (hint.includes(needle)) { setVal(el); return true; }
      }
    }
    return false;
  }, matchers, value);
  log(`  ${matchers[0]}: ${ok ? 'set' : 'NOT FOUND'}`);
  return ok;
}

// Custom combobox: click the element showing `openText` to open, then click the
// option whose text contains `optionNeedle` (element-handle click = reliable).
async function pickCombo(page, openText, optionNeedle, label) {
  const openH = await page.evaluateHandle((openText) => {
    const lc = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    return [...document.querySelectorAll('button,[role="button"],[role="combobox"],div')]
      .find((e) => lc(e.textContent) === lc(openText) && e.getBoundingClientRect().width > 150) || null;
  }, openText);
  if (openH && (await openH.evaluate((e) => !!e))) { await openH.click(); await sleep(1000); }
  const optH = await page.evaluateHandle((needle) => {
    const lc = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    return [...document.querySelectorAll('[role="option"],[role="menuitem"],li,button,div,span')]
      .filter((e) => lc(e.textContent).includes(lc(needle)) && lc(e.textContent).length < 60 && e.getBoundingClientRect().height > 8 && e.getBoundingClientRect().width > 50)
      .sort((a, b) => a.textContent.length - b.textContent.length)[0] || null;
  }, optionNeedle);
  if (optH && (await optH.evaluate((e) => !!e))) {
    const txt = await optH.evaluate((e) => (e.textContent || '').replace(/\s+/g, ' ').trim());
    await optH.click(); await sleep(700);
    log(`  ${label}: picked "${txt}"`);
    return true;
  }
  log(`  ${label}: option matching "${optionNeedle}" not found — set it manually`);
  await page.keyboard.press('Escape').catch(() => {});
  return false;
}

async function uploadIcons(page, files) {
  const inputs = await page.$$('input[type="file"]');
  for (let i = 0; i < files.length && i < inputs.length; i++) {
    const abs = path.resolve(KIT_DIR, files[i]);
    if (!fs.existsSync(abs)) { log(`  icon ${i}: file not found ${abs}`); continue; }
    try { await inputs[i].uploadFile(abs); log(`  uploaded icon ${i} (${path.basename(abs)})`); await sleep(1200); } catch (e) { log(`  icon ${i} upload failed: ${e.message}`); }
  }
}

async function validationErrors(page) {
  return page.evaluate(() => [...new Set([...document.querySelectorAll('*')]
    .filter((e) => e.children.length === 0 && /\b(is required|must be|please)\b/i.test(e.textContent || ''))
    .map((e) => e.textContent.replace(/\s+/g, ' ').trim()))].slice(0, 12));
}
async function clickContinue(page) {
  const h = await page.evaluateHandle(() => [...document.querySelectorAll('button')]
    .filter((e) => e.textContent.replace(/\s+/g, ' ').trim() === 'Continue' && e.getBoundingClientRect().width > 60).pop() || null);
  if (h && (await h.evaluate((e) => !!e))) { await h.click(); await sleep(2500); return true; }
  return false;
}
const currentSection = (page) => page.evaluate(() => new URLSearchParams(location.search).get('section') || '?').catch(() => '?');

// ── flow ──────────────────────────────────────────────────────────────────
async function openEditor(browser) {
  const page = await browser.newPage();
  if (DRAFT_URL) { await page.goto(DRAFT_URL, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {}); await sleep(2500); log('resumed draft', DRAFT_URL); return page; }
  await page.goto('https://platform.openai.com/plugins', { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
  await sleep(2500);
  if (await page.evaluate(() => /login/i.test(location.href))) {
    loud(['Log in to platform.openai.com in the open Chrome window, then this resumes.']);
    await waitFor(async () => !(await page.evaluate(() => /login/i.test(location.href))), { intervalMs: 5000, desc: 'login' });
  }
  // Create plugin → With MCP
  const c = await page.evaluate(() => { const el = [...document.querySelectorAll('button')].filter((e) => /create plugin/i.test(e.textContent || '')).pop(); const r = el?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; });
  if (c) { await page.mouse.click(c.x, c.y); await sleep(1200); }
  const m = await page.evaluate(() => { const e = [...document.querySelectorAll('[role="menuitem"]')].find((x) => /with mcp/i.test(x.textContent || '')); const r = e?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; });
  if (m) { await page.mouse.click(m.x, m.y); await sleep(2500); }
  // identity gate?
  if (await page.evaluate(() => /identity verification|verified developer identity/i.test(document.body.innerText || ''))) {
    loud([
      'Developer identity verification is required before you can create a plugin.',
      'In the window: Continue on the identity dialog and finish verification',
      '(individual OR business — plugin submission needs the business/developer tier).',
      'When done, re-run this script (optionally with DRAFT_URL to resume).',
    ]);
    await shot(page, 'identity-gate');
    process.exit(2);
  }
  // "Create new plugin" dialog — Standard is default → Continue
  const cont = await page.evaluate(() => { const dlg = document.querySelector('[role="dialog"]') || document.body; const btn = [...dlg.querySelectorAll('button')].find((e) => e.textContent.trim() === 'Continue'); const r = btn?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; });
  if (cont) { await page.mouse.click(cont.x, cont.y); await sleep(3500); }
  log('editor opened:', page.url());
  return page;
}

async function fillAppInfo(page) {
  log('filling App Info…');
  const i = CONFIG.info;
  await fillByLabel(page, ['name', 'untitled plugin'], i.name);
  const subtitle = (i.subtitle || '').slice(0, 30);
  if ((i.subtitle || '').length > 30) log(`  ! subtitle truncated to 30 chars: "${subtitle}"`);
  await fillByLabel(page, ['subtitle'], subtitle);
  await fillByLabel(page, ['description'], i.description);
  await pickCombo(page, 'Select', i.category, 'Category');
  await pickCombo(page, 'No Identity Selected', i.developerIdentity, 'Developer Identity');
  await fillByLabel(page, ['plugin author', 'owner of the plugin'], i.pluginAuthor);
  await fillByLabel(page, ['website url'], i.websiteUrl);
  await fillByLabel(page, ['customer support url', 'support'], i.supportUrl);
  await fillByLabel(page, ['privacy policy url', 'privacy'], i.privacyUrl);
  await fillByLabel(page, ['terms of service url', 'terms'], i.termsUrl);
  if (i.demoRecordingUrl) await fillByLabel(page, ['demo recording url', 'demo'], i.demoRecordingUrl);
  else loud(['Demo Recording URL is REQUIRED and not set. Record a screen video of the',
             'plugin working, host it, and set info.demoRecordingUrl in submission.config.json.']);
  await uploadIcons(page, [i.directoryIcon, i.composerIcon]);
  await sleep(1200);
  await shot(page, 'app-info');
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  log('config:', JSON.stringify({ mcpUrl: CONFIG.mcpUrl, name: CONFIG.info.name, demoEmail: CONFIG.reviewerDemo.email }));
  const browser = await connect();
  const page = await openEditor(browser);

  await fillAppInfo(page);

  // Advance through the sections, filling best-effort, reporting validation gaps.
  for (let step = 0; step < 6; step++) {
    const before = await currentSection(page);
    // generic label fills that apply across MCP/skills/testing sections
    await fillByLabel(page, ['server url', 'mcp server url', 'streamable', 'sse'], CONFIG.mcpUrl);
    // OAuth + Scan Tools if present
    await page.evaluate(() => { const b = [...document.querySelectorAll('button,[role="button"],[role="tab"],[role="radio"]')].find((e) => /^oauth$/i.test((e.textContent || '').trim())); b?.click(); }).catch(() => {});
    const scanned = await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((e) => /scan tools|scan/i.test(e.textContent || '')); if (b) { b.click(); return true; } return false; });
    if (scanned) { log('  clicked Scan Tools — waiting for discovery'); await sleep(8000); }
    // reviewer demo credentials (Testing section)
    await fillByLabel(page, ['reviewer email', 'test email', 'demo email', 'email'], CONFIG.reviewerDemo.email);
    await fillByLabel(page, ['reviewer password', 'test password', 'demo password', 'password'], demoPassword);

    await shot(page, `section-${before}`.replace(/[^a-z0-9-]/gi, '_'));
    const errs = await validationErrors(page);
    if (errs.length) log('  validation:', JSON.stringify(errs));

    const advanced = await clickContinue(page);
    const after = await currentSection(page);
    if (!advanced || after === before) {
      if (errs.length) {
        loud(['Cannot advance past section "' + before + '" — required fields need YOUR input:',
              ...errs.map((e) => '  • ' + e),
              'Fill them in the open window (or update submission.config.json) and re-run.']);
      } else {
        log(`could not advance past "${before}" (no Continue / no change) — inspect the window.`);
      }
      break;
    }
    log(`advanced: ${before} → ${after}`);
    if (/submit/i.test(after)) break;
  }

  // Summary + stop before submit
  console.log('\n--- SUBMISSION VALUES (from submission.config.json) ---');
  console.log('  MCP URL:', CONFIG.mcpUrl, '| auth:', CONFIG.authentication);
  console.log('  name/subtitle/category:', CONFIG.info.name, '/', CONFIG.info.subtitle, '/', CONFIG.info.category);
  console.log('  developer identity:', CONFIG.info.developerIdentity, '| author:', CONFIG.info.pluginAuthor);
  console.log('  urls:', CONFIG.info.websiteUrl, CONFIG.info.privacyUrl, CONFIG.info.supportUrl, CONFIG.info.termsUrl);
  console.log('  demo recording URL:', CONFIG.info.demoRecordingUrl || '(NOT SET — required)');
  console.log('  reviewer demo:', CONFIG.reviewerDemo.email, '/', demoPassword);
  console.log('  test prompts:', CONFIG.testPrompts.map((t) => t.prompt).join(' | '));

  if (SUBMIT) {
    loud(['SUBMIT=1 — clicking "Submit for review" in 5s. Ctrl-C to abort.']);
    await sleep(5000);
    await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((e) => /submit for review|^submit$/i.test((e.textContent || '').trim())); b?.click(); });
    await sleep(3000); await shot(page, 'submitted');
    log('submit clicked — verify in the dashboard.');
  } else {
    loud(['Draft filled + saved. REVIEW every section in the open window, then click',
          '"Submit for review" yourself — or re-run with SUBMIT=1 to auto-click.']);
  }
  browser.disconnect();
}

main().catch((e) => { console.error('\nFATAL:', e.message); process.exit(1); });
