// reminders-jxa.mjs — runs RemindersBridge tools against the real Apple
// Reminders app.
//
// Each tool is a complete JXA program executed via `osascript -l JavaScript -e`.
// Args travel as one JSON string in argv (execFile, no shell) — never
// interpolated into the source — and every program prints JSON on stdout.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const JOB_TIMEOUT_MS = 40_000; // relay's MCP side gives up at 50s; leave headroom

// Write tools that take a due date get it validated here; JXA does `new Date()`.
export function buildJxaArgs(tool, args = {}) {
  return args;
}

// osascript stderr looks like "execution error: Error: <msg> (-2700)".
export function cleanOsascriptError(msg) {
  const s = String(msg || '').trim();
  const m = s.match(/execution error:\s*(?:Error:\s*)?([\s\S]*?)(?:\s*\(-?\d+\))?$/);
  return (m && m[1].trim()) || s || 'osascript failed';
}

// Shared JXA helpers: find a reminder by id (byId can dangle on some macOS
// versions → whose() fallback → per-list scan) and serialize one reminder.
const HELPERS = `
function findReminderById(app, id) {
  try { var r = app.reminders.byId(id); r.name(); return r; } catch (e) {}
  try { var hits = app.reminders.whose({ id: id }); if (hits.length > 0) return hits[0]; } catch (e) {}
  var lists = app.lists();
  for (var i = 0; i < lists.length; i++) {
    try { var inList = lists[i].reminders.whose({ id: id }); if (inList.length > 0) return inList[0]; } catch (e) {}
  }
  return null;
}
function safe(fn, dflt) { try { return fn(); } catch (e) { return dflt; } }
function reminderOut(r) {
  var due = safe(function () { var d = r.dueDate(); return d ? d.toISOString() : null; }, null);
  return {
    id: r.id(),
    name: r.name(),
    body: safe(function () { return r.body() || ''; }, ''),
    completed: safe(function () { return r.completed(); }, false),
    due: due,
    priority: safe(function () { return r.priority(); }, 0),
    list: safe(function () { return r.container().name(); }, ''),
    modified: safe(function () { var d = r.modificationDate(); return d ? d.toISOString() : null; }, null)
  };
}
`;

const SOURCES = {
  search: `
function run(argv) {
  var args = JSON.parse(argv[0]);
  var query = String(args.query || '').toLowerCase();
  var limit = Math.min(args.limit || 20, 100);
  var app = Application('Reminders');
  var results = [];
  var seen = {};
  var lists = app.lists();
  for (var i = 0; i < lists.length && results.length < limit; i++) {
    var listName = '';
    try { listName = lists[i].name(); } catch (e) { continue; }
    try {
      var ids = lists[i].reminders.id();
      var names = lists[i].reminders.name();
      var done = lists[i].reminders.completed();
      for (var j = 0; j < ids.length && results.length < limit; j++) {
        if (seen[ids[j]]) continue;
        if (String(names[j]).toLowerCase().indexOf(query) !== -1) {
          seen[ids[j]] = true;
          results.push({ id: ids[j], name: names[j], list: listName, completed: done[j] });
        }
      }
    } catch (e) {}
  }
  return JSON.stringify({ results: results });
}
`,

  fetch: HELPERS + `
function run(argv) {
  var args = JSON.parse(argv[0]);
  var app = Application('Reminders');
  var r = findReminderById(app, args.id);
  if (!r) throw new Error('Reminder not found: ' + args.id);
  return JSON.stringify({ reminder: reminderOut(r) });
}
`,

  get_reminder: HELPERS + `
function run(argv) {
  var args = JSON.parse(argv[0]);
  var app = Application('Reminders');
  var r = null;
  if (args.id) {
    r = findReminderById(app, args.id);
    if (!r) throw new Error('Reminder not found: ' + args.id);
  } else if (args.name) {
    var t = String(args.name).toLowerCase();
    var lists = app.lists();
    outer: for (var i = 0; i < lists.length; i++) {
      try {
        var ids = lists[i].reminders.id();
        var names = lists[i].reminders.name();
        for (var j = 0; j < names.length; j++) {
          if (String(names[j]).toLowerCase().indexOf(t) !== -1) { r = findReminderById(app, ids[j]); break outer; }
        }
      } catch (e) {}
    }
    if (!r) throw new Error('No reminder matching name: ' + args.name);
  } else {
    throw new Error('id or name is required');
  }
  return JSON.stringify({ reminder: reminderOut(r) });
}
`,

  list_lists: `
function run(argv) {
  var app = Application('Reminders');
  var lists = app.lists();
  var out = [];
  for (var i = 0; i < lists.length; i++) {
    try {
      var done = lists[i].reminders.completed();
      var open = 0;
      for (var j = 0; j < done.length; j++) { if (!done[j]) open++; }
      out.push({ name: lists[i].name(), count: open, total: done.length });
    } catch (e) {
      try { out.push({ name: lists[i].name(), count: null, total: null }); } catch (e2) {}
    }
  }
  return JSON.stringify({ lists: out });
}
`,

  list_reminders: HELPERS + `
function run(argv) {
  var args = JSON.parse(argv[0]);
  var limit = Math.min(args.limit || 50, 200);
  var includeCompleted = args.include_completed === true;
  var app = Application('Reminders');
  var wanted = args.list ? String(args.list).toLowerCase() : null;
  var lists = app.lists();
  var rows = [];
  var found = false;
  for (var i = 0; i < lists.length; i++) {
    var lname = '';
    try { lname = lists[i].name(); } catch (e) { continue; }
    if (wanted && lname.toLowerCase() !== wanted) continue;
    found = true;
    try {
      var ids = lists[i].reminders.id();
      var names = lists[i].reminders.name();
      var done = lists[i].reminders.completed();
      var dues = lists[i].reminders.dueDate();
      for (var j = 0; j < ids.length; j++) {
        if (!includeCompleted && done[j]) continue;
        rows.push({
          id: ids[j], name: names[j], list: lname, completed: done[j],
          due: dues[j] ? dues[j].toISOString() : null
        });
      }
    } catch (e) {}
  }
  if (wanted && !found) throw new Error('List not found: ' + args.list);
  // incomplete first, then by due date (soonest first, undated last)
  rows.sort(function (a, b) {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    var ad = a.due || '9999', bd = b.due || '9999';
    return ad < bd ? -1 : ad > bd ? 1 : 0;
  });
  return JSON.stringify({ reminders: rows.slice(0, limit) });
}
`,

  create_reminder: HELPERS + `
function run(argv) {
  var args = JSON.parse(argv[0]);
  var app = Application('Reminders');
  var props = { name: String(args.name || '') };
  if (args.body) props.body = String(args.body);
  if (args.due) { var d = new Date(args.due); if (!isNaN(d.getTime())) props.dueDate = d; }
  var r = app.Reminder(props);
  var listName = '';
  if (args.list) {
    var lists = app.lists();
    var target = null;
    var wanted = String(args.list).toLowerCase();
    for (var i = 0; i < lists.length; i++) {
      try { if (lists[i].name().toLowerCase() === wanted) { target = lists[i]; break; } } catch (e) {}
    }
    if (!target) throw new Error('List not found: ' + args.list);
    target.reminders.push(r);
    listName = target.name();
  } else {
    app.defaultList.reminders.push(r);
    listName = safe(function () { return app.defaultList.name(); }, '');
  }
  return JSON.stringify({ reminder: reminderOut(r) });
}
`,

  complete_reminder: HELPERS + `
function run(argv) {
  var args = JSON.parse(argv[0]);
  var app = Application('Reminders');
  var r = findReminderById(app, args.id);
  if (!r) throw new Error('Reminder not found: ' + args.id);
  r.completed = (args.completed === false) ? false : true;
  return JSON.stringify({ reminder: reminderOut(r) });
}
`,

  update_reminder: HELPERS + `
function run(argv) {
  var args = JSON.parse(argv[0]);
  var app = Application('Reminders');
  var r = findReminderById(app, args.id);
  if (!r) throw new Error('Reminder not found: ' + args.id);
  if (args.name !== undefined) r.name = String(args.name);
  if (args.body !== undefined) r.body = String(args.body);
  if (args.due !== undefined) {
    if (args.due === null || args.due === '') { r.dueDate = null; }
    else { var d = new Date(args.due); if (!isNaN(d.getTime())) r.dueDate = d; }
  }
  return JSON.stringify({ reminder: reminderOut(r) });
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
