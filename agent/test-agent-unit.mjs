// Unit tests for the pure functions in notes-jxa.mjs — no osascript, no Notes.
// Run: node --test test-agent-unit.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, renderBodyHtml, buildJxaArgs, cleanOsascriptError, runTool } from './notes-jxa.mjs';
import { buildPlist, xmlEscape } from './cli.mjs';

test('escapeHtml escapes all five entities', () => {
  assert.equal(escapeHtml(`<b>"a" & 'b'</b>`), '&lt;b&gt;&quot;a&quot; &amp; &#39;b&#39;&lt;/b&gt;');
  assert.equal(escapeHtml('plain'), 'plain');
  assert.equal(escapeHtml(''), '');
});

test('renderBodyHtml wraps each line in a div', () => {
  assert.equal(renderBodyHtml('one\ntwo'), '<div>one</div><div>two</div>');
  assert.equal(renderBodyHtml('single'), '<div>single</div>');
});

test('renderBodyHtml keeps blank lines as <div><br></div>', () => {
  assert.equal(renderBodyHtml('a\n\nb'), '<div>a</div><div><br></div><div>b</div>');
  assert.equal(renderBodyHtml(''), '<div><br></div>');
});

test('renderBodyHtml handles CRLF and escapes content', () => {
  assert.equal(renderBodyHtml('a\r\nb'), '<div>a</div><div>b</div>');
  assert.equal(renderBodyHtml('<x> & "y"'), '<div>&lt;x&gt; &amp; &quot;y&quot;</div>');
});

test('buildJxaArgs createNote: escaped title div first, then rendered body', () => {
  const out = buildJxaArgs('createNote', { title: 'T & Co', body: 'line<1>\nline2', folder: 'Work' });
  assert.equal(out.html, '<div>T &amp; Co</div><div>line&lt;1&gt;</div><div>line2</div>');
  assert.equal(out.folder, 'Work');
});

test('buildJxaArgs createNote: missing folder becomes null', () => {
  const out = buildJxaArgs('createNote', { title: 't', body: 'b' });
  assert.equal(out.folder, null);
});

test('buildJxaArgs appendToNote renders text to divs, keeps id', () => {
  const out = buildJxaArgs('appendToNote', { id: 'x-coredata://ABC/ICNote/p1', text: 'a\nb' });
  assert.deepEqual(out, { id: 'x-coredata://ABC/ICNote/p1', html: '<div>a</div><div>b</div>' });
});

test('buildJxaArgs updateNote: title div + rendered body + name', () => {
  const out = buildJxaArgs('updateNote', { id: 'n1', title: 'New <T>', body: 'b1\nb2' });
  assert.equal(out.id, 'n1');
  assert.equal(out.title, 'New <T>');
  assert.equal(out.html, '<div>New &lt;T&gt;</div><div>b1</div><div>b2</div>');
});

test('buildJxaArgs read tools pass args through untouched', () => {
  const search = { query: 'q & <r>', limit: 5 };
  assert.deepEqual(buildJxaArgs('searchNotes', search), search);
  const get = { id: 'x-coredata://ABC' };
  assert.deepEqual(buildJxaArgs('getNote', get), get);
  assert.deepEqual(buildJxaArgs('listFolders', {}), {});
  assert.deepEqual(buildJxaArgs('listNotes', { folder: 'Work' }), { folder: 'Work' });
});

test('built args survive the JSON round-trip used for the argv handoff', () => {
  const out = buildJxaArgs('createNote', { title: `quote " tick ' back \\ slash`, body: 'x\ny' });
  assert.deepEqual(JSON.parse(JSON.stringify(out)), out);
});

test('cleanOsascriptError strips osascript noise', () => {
  assert.equal(
    cleanOsascriptError('execution error: Error: Note not found: abc (-2700)'),
    'Note not found: abc'
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
    label: 'com.notesbridge.apple-notes-agent',
    nodePath: '/usr/local/bin/node',
    cliPath: '/Users/me/agent/cli.mjs',
    workingDir: '/Users/me',
    outLog: '/Users/me/Library/Logs/notesbridge-agent.log',
    errLog: '/Users/me/Library/Logs/notesbridge-agent.err.log',
  });
  assert.match(xml, /<key>Label<\/key>\s*<string>com\.notesbridge\.apple-notes-agent<\/string>/);
  // ProgramArguments must be node, cli.mjs, run — in that order.
  assert.match(
    xml,
    /<string>\/usr\/local\/bin\/node<\/string>\s*<string>\/Users\/me\/agent\/cli\.mjs<\/string>\s*<string>run<\/string>/,
  );
  assert.match(xml, /<key>KeepAlive<\/key>\s*<true\/>/);
  assert.match(xml, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(xml, /<key>WorkingDirectory<\/key>\s*<string>\/Users\/me<\/string>/);
  assert.match(xml, /<key>StandardOutPath<\/key>\s*<string>\/Users\/me\/Library\/Logs\/notesbridge-agent\.log<\/string>/);
  assert.match(xml, /<key>StandardErrorPath<\/key>\s*<string>\/Users\/me\/Library\/Logs\/notesbridge-agent\.err\.log<\/string>/);
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
