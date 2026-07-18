// demoStore.js — server-side sample reminders for the reviewer/demo account.
// Lets app reviewers exercise every tool 24/7 with no Mac agent involved.
// State persists in storage under demoReminders:<userId>.
// Result shapes mirror the real apple-reminders-agent exactly, so ChatGPT sees
// the same formats whether a call was served by the demo store or a paired Mac.

import { redis } from './redis.js';

export const DEMO_EMAIL = (process.env.DEMO_EMAIL || 'reviewer@remindersbridge.demo').toLowerCase();

const KEY = (userId) => `demoReminders:${userId}`;
const iso = (d) => new Date(d).toISOString();

function seed() {
  const now = iso('2026-07-18T09:00:00Z');
  const day = (n) => iso(new Date('2026-07-18T17:00:00Z').getTime() + n * 86400000);
  return {
    nextId: 8,
    reminders: {
      'demo-1': { id: 'demo-1', name: 'Buy oat milk', body: '', completed: false, due: day(1), priority: 0, list: 'Reminders', modified: now },
      'demo-2': { id: 'demo-2', name: 'Call the dentist', body: 'Ask about the 9am slot', completed: false, due: null, priority: 5, list: 'Reminders', modified: now },
      'demo-3': { id: 'demo-3', name: 'Renew passport', body: '', completed: false, due: day(21), priority: 0, list: 'Reminders', modified: now },
      'demo-4': { id: 'demo-4', name: 'Ship connector review', body: 'Finish the OpenAI submission', completed: false, due: day(0), priority: 9, list: 'Work', modified: now },
      'demo-5': { id: 'demo-5', name: 'Reply to design about the icon', body: '', completed: true, due: null, priority: 0, list: 'Work', modified: now },
      'demo-6': { id: 'demo-6', name: 'Coffee beans', body: '', completed: false, due: null, priority: 0, list: 'Groceries', modified: now },
      'demo-7': { id: 'demo-7', name: 'Blueberries', body: '', completed: false, due: null, priority: 0, list: 'Groceries', modified: now },
    },
  };
}

async function load(userId) {
  const raw = await redis.get(KEY(userId));
  if (!raw) {
    const db = seed();
    await redis.set(KEY(userId), JSON.stringify(db));
    return db;
  }
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

const save = (userId, db) => redis.set(KEY(userId), JSON.stringify(db));

const view = (r) => ({ id: r.id, name: r.name, body: r.body, completed: r.completed, due: r.due, priority: r.priority, list: r.list, modified: r.modified });

export async function demoExec(userId, tool, args = {}) {
  const db = await load(userId);
  const all = () => Object.values(db.reminders);

  switch (tool) {
    case 'search': {
      const q = String(args.query || '').toLowerCase();
      const hits = all().filter((r) => r.name.toLowerCase().includes(q) || (r.body || '').toLowerCase().includes(q));
      return { results: hits.slice(0, args.limit || 20).map((r) => ({ id: r.id, name: r.name, list: r.list, completed: r.completed })) };
    }
    case 'fetch': {
      const r = db.reminders[args.id];
      if (!r) throw new Error(`Reminder not found: ${args.id}`);
      return { reminder: view(r) };
    }
    case 'get_reminder': {
      let r = args.id ? db.reminders[args.id] : null;
      if (!r && args.name) {
        const t = String(args.name).toLowerCase();
        r = all().find((x) => x.name.toLowerCase() === t) || all().find((x) => x.name.toLowerCase().includes(t));
      }
      if (!r) throw new Error(`Reminder not found: ${args.id || args.name || ''}`);
      return { reminder: view(r) };
    }
    case 'list_lists': {
      const names = [...new Set(all().map((r) => r.list))];
      return { lists: names.map((name) => {
        const inList = all().filter((r) => r.list === name);
        return { name, count: inList.filter((r) => !r.completed).length, total: inList.length };
      }) };
    }
    case 'list_reminders': {
      let list = all();
      if (args.list) {
        list = list.filter((r) => r.list.toLowerCase() === String(args.list).toLowerCase());
        if (!list.length) throw new Error(`List not found: ${args.list}`);
      }
      if (args.include_completed !== true) list = list.filter((r) => !r.completed);
      list.sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        return (a.due || '9999') < (b.due || '9999') ? -1 : 1;
      });
      return { reminders: list.slice(0, Math.min(args.limit || 50, 200)).map((r) => ({ id: r.id, name: r.name, list: r.list, completed: r.completed, due: r.due })) };
    }
    case 'create_reminder': {
      const id = `demo-${db.nextId++}`;
      const now = iso('2026-07-18T09:00:00Z');
      db.reminders[id] = { id, name: args.name, body: args.body || '', completed: false, due: args.due || null, priority: 0, list: args.list || 'Reminders', modified: now };
      await save(userId, db);
      return { reminder: view(db.reminders[id]) };
    }
    case 'complete_reminder': {
      const r = db.reminders[args.id];
      if (!r) throw new Error(`Reminder not found: ${args.id}`);
      r.completed = args.completed === false ? false : true;
      await save(userId, db);
      return { reminder: view(r) };
    }
    case 'update_reminder': {
      const r = db.reminders[args.id];
      if (!r) throw new Error(`Reminder not found: ${args.id}`);
      if (args.name !== undefined) r.name = args.name;
      if (args.body !== undefined) r.body = args.body;
      if (args.due !== undefined) r.due = args.due;
      await save(userId, db);
      return { reminder: view(r) };
    }
    default:
      throw new Error(`Unknown tool: ${tool}`);
  }
}
