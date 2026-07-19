#!/usr/bin/env node
// upload-youtube2.mjs — reliable single-pass uploader. Uploads VIDEO to the
// signed-in YouTube (agent Chrome CDP :9222) and publishes it UNLISTED, using
// the visibility-selection technique that actually works (detect the "Save or
// publish" panel, click the row whose label div reads "Unlisted", then Done).
//
//   VIDEO=/path/to.mp4 node upload-youtube2.mjs

import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const CDP = 'http://127.0.0.1:9222';
const VIDEO = process.env.VIDEO || '/Users/isaiahdupree/Desktop/remindersbridge-demo.mp4';
const SHOTS = path.join(process.cwd(), 'screenshots');
const TITLE = process.env.TITLE || 'RemindersBridge — Apple Reminders in ChatGPT (demo)';
const DESC = process.env.DESC ||
  'A short demo of the RemindersBridge MCP connector inside ChatGPT: listing reminder lists, seeing what\'s due, searching, and creating a reminder — run against a demo account (no Mac needed). https://remindersbridge.vercel.app · https://github.com/IsaiahDupree/reminders-bridge';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[yt2 ${new Date().toTimeString().slice(0, 8)}] ${m}`);
let n = 0;
const shot = async (page, l) => { n++; try { await page.screenshot({ path: path.join(SHOTS, `yt2-${String(n).padStart(2, '0')}-${l}.png`) }); } catch {} };

async function main() {
  if (!fs.existsSync(VIDEO)) { console.error(`no video at ${VIDEO}`); process.exit(2); }
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 950 });
  await page.goto('https://www.youtube.com/upload', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await sleep(4000);

  // Select file.
  await page.waitForSelector('input[type="file"]', { timeout: 30000 }).catch(() => {});
  const input = await page.$('input[type="file"]');
  if (!input) { await shot(page, 'no-input'); throw new Error('file input not found'); }
  await input.uploadFile(VIDEO);
  log('uploading');
  await sleep(6000);

  // Details: title + description.
  await page.waitForSelector('#textbox', { timeout: 45000 }).catch(() => {});
  await sleep(1500);
  const boxes = await page.$$('#textbox');
  if (boxes[0]) { await boxes[0].click({ clickCount: 3 }); await page.keyboard.press('Backspace'); await boxes[0].type(TITLE, { delay: 8 }); }
  if (boxes[1]) { await boxes[1].click(); await boxes[1].type(DESC, { delay: 4 }); }
  await sleep(1000);

  // Made for kids: No.
  await page.evaluate(() => {
    const r = document.querySelector('tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]');
    if (r) r.click();
  }).catch(() => {});
  await sleep(800);
  await shot(page, 'details');

  // Advance to the Visibility panel (detect by its copy).
  const onVis = () => page.evaluate(() => /save or publish|anyone with the video link/i.test(document.body.innerText || '')).catch(() => false);
  for (let i = 0; i < 6; i++) {
    if (await onVis()) { log(`on Visibility after ${i} next(s)`); break; }
    await page.evaluate(() => { const b = document.querySelector('#next-button'); if (b && b.getAttribute('aria-disabled') !== 'true') b.click(); }).catch(() => {});
    await sleep(2500);
  }
  await shot(page, 'vis');

  // Click the Unlisted row via its label div (proven).
  const picked = await page.evaluate(() => {
    const leaf = [...document.querySelectorAll('*')].find((e) => e.childElementCount === 0 && (e.innerText || e.textContent || '').trim() === 'Unlisted' && e.offsetParent !== null);
    if (!leaf) return { ok: false };
    let node = leaf;
    for (let up = 0; up < 6 && node; up++) {
      const tag = (node.tagName || '').toLowerCase();
      if (tag === 'tp-yt-paper-radio-button' || node.getAttribute?.('role') === 'radio' || /radio/i.test(node.id || '')) break;
      node = node.parentElement;
    }
    const t = node || leaf; const b = t.getBoundingClientRect(); t.click();
    return { ok: true, rect: { x: b.x + b.width / 2, y: b.y + b.height / 2 } };
  }).catch(() => ({ ok: false }));
  log(`unlisted picked: ${picked.ok}`);
  if (picked.rect) { await page.mouse.click(picked.rect.x, picked.rect.y); }
  await sleep(1200);
  await shot(page, 'unlisted');

  const doneDisabled = await page.evaluate(() => { const b = document.querySelector('#done-button'); return b ? b.getAttribute('aria-disabled') : 'no-btn'; }).catch(() => 'err');
  log(`done-button aria-disabled=${doneDisabled}`);
  if (doneDisabled === 'true') { await shot(page, 'done-disabled'); throw new Error('visibility not selected — done still disabled'); }

  await page.evaluate(() => { const b = document.querySelector('#done-button'); if (b) b.click(); }).catch(() => {});
  await sleep(6000);
  await shot(page, 'published');

  // Grab the share URL.
  const url = await page.evaluate(() => {
    const a = [...document.querySelectorAll('a')].map((x) => x.href).find((h) => /youtu\.be\/|watch\?v=/.test(h || ''));
    return a || null;
  }).catch(() => null);
  browser.disconnect();
  console.log(`\nVIDEO_URL=${url || 'UNKNOWN'} DONE_DISABLED=${doneDisabled}`);
}
main().catch((e) => { console.error('fatal:', e.message); process.exit(1); });
