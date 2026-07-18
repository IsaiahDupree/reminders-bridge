// Unit tests for the pure functions in reminders-jxa.mjs — no osascript, no
// Reminders app. Run: node --test test-agent-unit.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJxaArgs, cleanOsascriptError, runTool } from './reminders-jxa.mjs';
import { buildPlist, xmlEscape } from './cli.mjs';

// Reminders have plain-text bodies (no HTML rendering like Notes), so buildJxaArgs
// is an identity passthrough — the JXA programs receive args verbatim as JSON argv.
test('buildJxaArgs passes read args through untouched', () => {
  const search = { query: 'q & <r>', limit: 5 };
  assert.deepEqual(buildJxaArgs('search', search), search);
  const get = { id: 'x-apple-reminderkit://REMCDReminder/ABC' };
  assert.deepEqual(buildJxaArgs('get_reminder', get), get);
  assert.deepEqual(buildJxaArgs('list_lists', {}), {});
  assert.deepEqual(buildJxaArgs('list_reminders', { list: 'Work' }), { list: 'Work' });
});

test('buildJxaArgs passes write args through untouched', () => {
  const create = { name: 'Buy milk', body: 'oat', due: '2026-07-20T09:00:00Z', list: 'Groceries' };
  assert.deepEqual(buildJxaArgs('create_reminder', create), create);
  const update = { id: 'r1', name: 'New name', due: null };
  assert.deepEqual(buildJxaArgs('update_reminder', update), update);
  const complete = { id: 'r1', completed: true };
  assert.deepEqual(buildJxaArgs('complete_reminder', complete), complete);
});

test('built args survive the JSON round-trip used for the argv handoff', () => {
  const out = buildJxaArgs('create_reminder', { name: `quote " tick ' back \\ slash`, body: 'x\ny' });
  assert.deepEqual(JSON.parse(JSON.stringify(out)), out);
});

test('cleanOsascriptError strips osascript noise', () => {
  assert.equal(
    cleanOsascriptError('execution error: Error: Reminder not found: abc (-2700)'),
    'Reminder not found: abc'
  );
  assert.equal(cleanOsascriptError('execution error: Application isn’t running. (-600)'), 'Application isn’t running.');
  assert.equal(cleanOsascriptError('plain failure'), 'plain failure');
  assert.equal(cleanOsascriptError(''), 'osascript failed');
});

test('runTool rejects unknown tools without spawning osascript', async () => {
  await assert.rejects(() => runTool('nope', {}), /Unknown tool: nope/);
});

test('xmlEscape escapes &, <, > for plist text nodes', () => {
  assert.equal(xmlEscape('a & b < c > d'), 'a &amp; b &lt; c &gt; d');
  assert.equal(xmlEscape('/Users/me/App & Co'), '/Users/me/App &amp; Co');
  assert.equal(xmlEscape('plain/path'), 'plain/path');
});

test('buildPlist emits the correct label, ProgramArguments and KeepAlive', () => {
  const xml = buildPlist({
    label: 'com.remindersbridge.apple-reminders-agent',
    nodePath: '/usr/local/bin/node',
    cliPath: '/Users/me/agent/cli.mjs',
    workingDir: '/Users/me',
    outLog: '/Users/me/Library/Logs/remindersbridge-agent.log',
    errLog: '/Users/me/Library/Logs/remindersbridge-agent.err.log',
  });
  assert.match(xml, /<key>Label<\/key>\s*<string>com\.remindersbridge\.apple-reminders-agent<\/string>/);
  // ProgramArguments must be node, cli.mjs, run — in that order.
  assert.match(
    xml,
    /<string>\/usr\/local\/bin\/node<\/string>\s*<string>\/Users\/me\/agent\/cli\.mjs<\/string>\s*<string>run<\/string>/,
  );
  assert.match(xml, /<key>KeepAlive<\/key>\s*<true\/>/);
  assert.match(xml, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(xml, /<key>WorkingDirectory<\/key>\s*<string>\/Users\/me<\/string>/);
  assert.match(xml, /<key>StandardOutPath<\/key>\s*<string>\/Users\/me\/Library\/Logs\/remindersbridge-agent\.log<\/string>/);
  assert.match(xml, /<key>StandardErrorPath<\/key>\s*<string>\/Users\/me\/Library\/Logs\/remindersbridge-agent\.err\.log<\/string>/);
});

test('buildPlist starts with the standard plist XML/DOCTYPE header', () => {
  const xml = buildPlist({ label: 'x', nodePath: 'n', cliPath: 'c', workingDir: 'w', outLog: 'o', errLog: 'e' });
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<!DOCTYPE plist PUBLIC "-\/\/Apple\/\/DTD PLIST 1\.0\/\/EN"/);
  assert.match(xml, /<plist version="1\.0">/);
});

test('buildPlist xml-escapes paths that contain special characters', () => {
  const xml = buildPlist({
    label: 'l', nodePath: 'n', cliPath: '/Users/me & co/cli.mjs', workingDir: 'w', outLog: 'o', errLog: 'e',
  });
  assert.match(xml, /<string>\/Users\/me &amp; co\/cli\.mjs<\/string>/);
  assert.ok(!xml.includes('me & co')); // a raw ampersand must never survive into the plist
});
