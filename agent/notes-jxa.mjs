// notes-jxa.mjs — runs NotesBridge tools against the real Apple Notes app.
//
// Each tool is a complete JXA program executed via `osascript -l JavaScript -e`.
// Args travel as one JSON string in argv (execFile, no shell) — never
// interpolated into the source — and every program prints JSON on stdout.
// HTML rendering/escaping happens here in Node so it stays unit-testable.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const JOB_TIMEOUT_MS = 40_000; // relay's MCP side gives up at 50s; leave headroom

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Notes renders one <div> per line; a blank line needs <br> to survive.
export function renderBodyHtml(text) {
  return String(text)
    .split(/\r?\n/)
    .map((line) => (line.trim() === '' ? '<div><br></div>' : `<div>${escapeHtml(line)}</div>`))
    .join('');
}

// Prepare the JSON payload each JXA program receives. Write tools get their
// plain text pre-rendered to Notes HTML; read tools pass through.
export function buildJxaArgs(tool, args = {}) {
  if (tool === 'createNote') {
    return {
      html: `<div>${escapeHtml(args.title ?? '')}</div>` + renderBodyHtml(args.body ?? ''),
      folder: args.folder || null,
    };
  }
  if (tool === 'appendToNote') {
    return { id: args.id, html: renderBodyHtml(args.text ?? '') };
  }
  if (tool === 'updateNote') {
    return {
      id: args.id,
      title: String(args.title ?? ''),
      html: `<div>${escapeHtml(args.title ?? '')}</div>` + renderBodyHtml(args.body ?? ''),
    };
  }
  return args;
}

// osascript stderr looks like "execution error: Error: <msg> (-2700)".
export function cleanOsascriptError(msg) {
  const s = String(msg || '').trim();
  const m = s.match(/execution error:\s*(?:Error:\s*)?([\s\S]*?)(?:\s*\(-?\d+\))?$/);
  return (m && m[1].trim()) || s || 'osascript failed';
}

// byId can throw or return a dangling specifier on some macOS versions;
// fall back to a whose() filter, then a per-folder scan.
const FIND_NOTE = `
function findNoteById(app, id) {
  try { var n = app.notes.byId(id); n.name(); return n; } catch (e) {}
  try {
    var hits = app.notes.whose({ id: id });
    if (hits.length > 0) return hits[0];
  } catch (e) {}
  var folders = app.folders();
  for (var i = 0; i < folders.length; i++) {
    try {
      var inFolder = folders[i].notes.whose({ id: id });
      if (inFolder.length > 0) return inFolder[0];
    } catch (e) {}
  }
  return null;
}
`;

const SOURCES = {
  searchNotes: `
function run(argv) {
  var args = JSON.parse(argv[0]);
  var query = String(args.query || '');
  var limit = args.limit || 20;
  var app = Application('Notes');
  var results = [];
  var seen = {};
  try {
    var byName = app.notes.whose({ name: { _contains: query } });
    var n = Math.min(byName.length, limit);
    for (var i = 0; i < n; i++) {
      var id = byName[i].id();
      if (!seen[id]) { seen[id] = true; results.push({ id: id, title: byName[i].name() }); }
    }
  } catch (e) {}
  if (results.length < limit) {
    // plaintext scan is one Apple Event per note — cap at 200 for perf
    var q = query.toLowerCase();
    var ids = app.notes.id();
    var names = app.notes.name();
    var cap = Math.min(ids.length, 200);
    for (var j = 0; j < cap && results.length < limit; j++) {
      if (seen[ids[j]]) continue;
      var text = '';
      try { text = String(app.notes[j].plaintext() || ''); } catch (e) { continue; }
      if (text.toLowerCase().indexOf(q) !== -1) {
        seen[ids[j]] = true;
        results.push({ id: ids[j], title: names[j] });
      }
    }
  }
  return JSON.stringify({ results: results });
}
`,

  getNote: FIND_NOTE + `
function run(argv) {
  var args = JSON.parse(argv[0]);
  var app = Application('Notes');
  var note = null;
  if (args.id) {
    note = findNoteById(app, args.id);
    if (!note) throw new Error('Note not found: ' + args.id);
  } else if (args.title) {
    try {
      var exact = app.notes.whose({ name: args.title });
      if (exact.length > 0) note = exact[0];
    } catch (e) {}
    if (!note) {
      var t = String(args.title).toLowerCase();
      var names = app.notes.name();
      for (var i = 0; i < names.length; i++) {
        if (String(names[i]).toLowerCase().indexOf(t) !== -1) { note = app.notes[i]; break; }
      }
    }
    if (!note) throw new Error('No note matching title: ' + args.title);
  } else {
    throw new Error('id or title is required');
  }
  var folder = '';
  try { folder = note.container().name(); } catch (e) {}
  return JSON.stringify({ note: {
    id: note.id(),
    title: note.name(),
    plaintext: note.plaintext(),
    folder: folder,
    created: note.creationDate().toISOString(),
    modified: note.modificationDate().toISOString()
  } });
}
`,

  listFolders: `
function run(argv) {
  var app = Application('Notes');
  var folders = app.folders();
  var out = [];
  for (var i = 0; i < folders.length; i++) {
    try { out.push({ name: folders[i].name(), count: folders[i].notes.length }); } catch (e) {}
  }
  return JSON.stringify({ folders: out });
}
`,

  listNotes: `
function run(argv) {
  var args = JSON.parse(argv[0]);
  var limit = Math.min(args.limit || 30, 100);
  var app = Application('Notes');
  var wanted = args.folder ? String(args.folder).toLowerCase() : null;
  var folders = app.folders();
  var rows = [];
  var found = false;
  for (var i = 0; i < folders.length; i++) {
    var fname = '';
    try { fname = folders[i].name(); } catch (e) { continue; }
    if (wanted && fname.toLowerCase() !== wanted) continue;
    found = true;
    try {
      // three bulk Apple Events per folder instead of three per note
      var ids = folders[i].notes.id();
      var names = folders[i].notes.name();
      var mods = folders[i].notes.modificationDate();
      for (var j = 0; j < ids.length; j++) {
        rows.push({
          id: ids[j],
          title: names[j],
          folder: fname,
          modified: mods[j] ? mods[j].toISOString() : null
        });
      }
    } catch (e) {}
  }
  if (wanted && !found) throw new Error('Folder not found: ' + args.folder);
  rows.sort(function (a, b) {
    var am = a.modified || '', bm = b.modified || '';
    return am > bm ? -1 : am < bm ? 1 : 0;
  });
  return JSON.stringify({ notes: rows.slice(0, limit) });
}
`,

  createNote: `
function run(argv) {
  var args = JSON.parse(argv[0]);
  var app = Application('Notes');
  var note = app.Note({ body: args.html });
  var folderName = '';
  if (args.folder) {
    var folders = app.folders();
    var target = null;
    var wanted = String(args.folder).toLowerCase();
    for (var i = 0; i < folders.length; i++) {
      try { if (folders[i].name().toLowerCase() === wanted) { target = folders[i]; break; } } catch (e) {}
    }
    if (!target) throw new Error('Folder not found: ' + args.folder);
    target.notes.push(note);
    folderName = target.name();
  } else {
    try { app.defaultAccount.notes.push(note); } catch (e) { app.notes.push(note); }
    try { folderName = note.container().name(); } catch (e) {}
  }
  return JSON.stringify({ note: { id: note.id(), title: note.name(), folder: folderName } });
}
`,

  appendToNote: FIND_NOTE + `
function run(argv) {
  var args = JSON.parse(argv[0]);
  var app = Application('Notes');
  var note = findNoteById(app, args.id);
  if (!note) throw new Error('Note not found: ' + args.id);
  note.body = note.body() + args.html;
  return JSON.stringify({ note: { id: note.id(), title: note.name() } });
}
`,

  updateNote: FIND_NOTE + `
function run(argv) {
  var args = JSON.parse(argv[0]);
  var app = Application('Notes');
  var note = findNoteById(app, args.id);
  if (!note) throw new Error('Note not found: ' + args.id);
  note.body = args.html;
  note.name = args.title;
  return JSON.stringify({ note: { id: note.id(), title: note.name() } });
}
`,
};

export async function runTool(tool, args = {}) {
  const source = SOURCES[tool];
  if (!source) throw new Error(`Unknown tool: ${tool}`);
  const payload = JSON.stringify(buildJxaArgs(tool, args));
  let stdout;
  try {
    ({ stdout } = await exec('osascript', ['-l', 'JavaScript', '-e', source, payload], {
      timeout: JOB_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      maxBuffer: 32 * 1024 * 1024,
    }));
  } catch (err) {
    if (err.killed || err.signal) throw new Error('timed out on the Mac');
    throw new Error(cleanOsascriptError(err.stderr || err.message));
  }
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`Bad JXA output for ${tool}: ${String(stdout).slice(0, 200)}`);
  }
}
