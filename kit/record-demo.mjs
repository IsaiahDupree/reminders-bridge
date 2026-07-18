#!/usr/bin/env node
// record-demo.mjs — records a demo of RemindersBridge working in ChatGPT.
// Connects to the agent Chrome (CDP :9222), opens a fresh chat, runs a scripted
// arc of prompts against the connector, screenshot-loops the page, and encodes
// the frames to an mp4 with ffmpeg. The connector must already be registered +
// OAuth'd (as the demo account) in this Chrome profile.
//
//   node record-demo.mjs
//
// Output: $OUT (default ./remindersbridge-demo.mp4)

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const CDP = 'http://127.0.0.1:9222';
const FRAME_DIR = process.env.FRAME_DIR || '/Users/isaiahdupree/.claude/jobs/c76af6d7/tmp/frames';
const OUT = process.env.OUT || path.join(process.cwd(), 'remindersbridge-demo.mp4');
const FPS = 4;                    // capture + playback rate (real-time)
const INTERVAL = Math.round(1000 / FPS);

// The demo arc. Each names the connector so the tool call routes reliably
// (reviewers can attach it via the + menu instead). Reads first, then one write.
const PROMPTS = [
  'Using RemindersBridge, what reminder lists do I have?',
  "Using RemindersBridge, what do I have coming up? Show me what's due soonest.",
  'Using RemindersBridge, search my reminders for the dentist.',
  "Using RemindersBridge, add 'Pick up dry cleaning' to my Work list.",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[rec ${new Date().toTimeString().slice(0, 8)}] ${m}`);

async function getChatPage(browser) {
  const pages = await browser.pages();
  let page = pages.find((p) => (p.url() || '').includes('chatgpt.com'));
  if (!page) { page = await browser.newPage(); }
  await page.bringToFront().catch(() => {});
  // Fresh chat.
  await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await page.waitForSelector('#prompt-textarea, form [contenteditable="true"]', { timeout: 30000 }).catch(() => {});
  await sleep(1500);
  return page;
}

// Click a button/element whose visible text matches any of `texts` (best-effort).
async function clickIfPresent(page, texts) {
  return page.evaluate((texts) => {
    const els = [...document.querySelectorAll('button, [role="button"], a')];
    for (const t of texts) {
      const el = els.find((e) => (e.innerText || e.textContent || '').trim().toLowerCase().includes(t.toLowerCase()) && e.offsetParent !== null);
      if (el) { el.click(); return t; }
    }
    return null;
  }, texts).catch(() => null);
}

const countRole = (page, role) =>
  page.evaluate((r) => document.querySelectorAll(`[data-message-author-role="${r}"]`).length, role).catch(() => 0);
const assistantCount = (page) => countRole(page, 'assistant');
const userCount = (page) => countRole(page, 'user');

async function clearComposer(page) {
  await page.click('#prompt-textarea').catch(() => {});
  await page.keyboard.down('Meta'); await page.keyboard.press('a'); await page.keyboard.up('Meta');
  await page.keyboard.press('Backspace');
  await sleep(250);
}

// Click ChatGPT's send button (falls back to Enter). Returns true if it fired.
async function pressSend(page) {
  const clicked = await page.evaluate(() => {
    const b = document.querySelector('button[data-testid="send-button"], #composer-submit-button, button[aria-label*="Send"]');
    if (b && !b.disabled) { b.click(); return true; }
    return false;
  }).catch(() => false);
  if (!clicked) await page.keyboard.press('Enter');
  return clicked;
}

async function sendPrompt(page, text) {
  const beforeA = await assistantCount(page);
  const beforeU = await userCount(page);
  await clearComposer(page);
  await page.click('#prompt-textarea').catch(() => {});
  await page.type('#prompt-textarea', text, { delay: 16 });
  await sleep(500);
  // Submit and VERIFY the user message actually posted before doing anything else
  // (Enter alone is flaky and causes the next prompt to concatenate into this one).
  let submitted = false;
  for (let i = 0; i < 6 && !submitted; i++) {
    await pressSend(page);
    await sleep(1300);
    if ((await userCount(page)) > beforeU) submitted = true;
  }
  log(`sent(${submitted ? 'ok' : 'UNCONFIRMED'}): ${text}`);
  // Some tool calls prompt an in-chat approval — click it if it appears.
  const start = Date.now();
  let approved = false;
  while (Date.now() - start < 90000) {
    if (!approved) {
      const hit = await clickIfPresent(page, ['Always allow', 'Allow', 'Confirm', 'Approve']);
      if (hit) { log(`clicked "${hit}"`); approved = true; }
    }
    if ((await assistantCount(page)) > beforeA) break;
    await sleep(1500);
  }
  await waitDoneStreaming(page);
  await sleep(2500); // hold on the finished reply
}

// After a reply starts, ChatGPT shows a Stop button while it streams. Wait until
// generation finishes (Stop gone / composer back to a send state) so the capture
// never cuts off mid-answer.
async function waitDoneStreaming(page) {
  const start = Date.now();
  await sleep(1500);
  while (Date.now() - start < 45000) {
    const streaming = await page.evaluate(() =>
      !!document.querySelector('button[data-testid="stop-button"], button[aria-label*="Stop streaming"], button[aria-label="Stop"]')
    ).catch(() => false);
    if (!streaming) return;
    await sleep(1000);
  }
}

async function main() {
  fs.rmSync(FRAME_DIR, { recursive: true, force: true });
  fs.mkdirSync(FRAME_DIR, { recursive: true });

  const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
  log('connected to Chrome');
  const page = await getChatPage(browser);

  // Screenshot loop (concurrent with the prompt arc).
  let running = true;
  let n = 0;
  const loop = (async () => {
    while (running) {
      const t = Date.now();
      const file = path.join(FRAME_DIR, `frame-${String(n).padStart(5, '0')}.png`);
      try { await page.screenshot({ path: file }); n += 1; } catch {}
      const dt = Date.now() - t;
      if (dt < INTERVAL) await sleep(INTERVAL - dt);
    }
  })();

  await sleep(1200); // a beat of the empty composer at the start
  for (const p of PROMPTS) await sendPrompt(page, p);
  await sleep(2500); // hold on the final reply

  running = false;
  await loop;
  browser.disconnect();
  log(`captured ${n} frames -> ${FRAME_DIR}`);

  // Encode.
  const args = [
    '-y', '-framerate', String(FPS), '-i', path.join(FRAME_DIR, 'frame-%05d.png'),
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', OUT,
  ];
  log(`ffmpeg encode -> ${OUT}`);
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (r.status !== 0) { console.error(r.stderr?.slice(-800)); process.exit(1); }
  const bytes = fs.statSync(OUT).size;
  log(`DONE: ${OUT} (${(bytes / 1e6).toFixed(1)} MB, ${n} frames @ ${FPS}fps)`);
}

main().catch((e) => { console.error('fatal:', e.message); process.exit(1); });
