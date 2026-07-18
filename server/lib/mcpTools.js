// mcpTools.js — the MCP server exposed to ChatGPT. Every tool forwards to the
// paired Mac agent through the relay; the agent does the actual Reminders work.
// (Tool names match the agent's reminders-jxa executor keys 1:1.)

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { enqueueJob } from './relay.js';
import { demoExec } from './demoStore.js';

const asText = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });
const asError = (err) => ({
  isError: true,
  content: [{ type: 'text', text: `Error: ${err.message || String(err)}` }],
});

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export function buildServer(userId, { demo = false } = {}) {
  const server = new McpServer({ name: 'apple-reminders-relay', version: '1.0.0' });

  // Demo accounts run against server-side sample reminders (no Mac agent needed);
  // real accounts relay to the user's paired Mac.
  const exec = demo ? (tool, args) => demoExec(userId, tool, args) : (tool, args) => enqueueJob(userId, tool, args);
  const forward = (tool) => async (args) => {
    try {
      return asText(await exec(tool, args ?? {}));
    } catch (e) {
      return asError(e);
    }
  };

  server.registerTool(
    'search',
    {
      title: 'Search Reminders',
      description: "Search the user's Apple Reminders by keyword. Returns matching reminders with ids; use fetch to read one.",
      inputSchema: { query: z.string(), limit: z.number().int().min(1).max(100).optional() },
      annotations: RO,
    },
    forward('search')
  );

  server.registerTool(
    'fetch',
    {
      title: 'Fetch a reminder',
      description: 'Fetch the full details of a reminder by id (from search or list results): name, notes, due date, completion, list.',
      inputSchema: { id: z.string() },
      annotations: RO,
    },
    forward('fetch')
  );

  server.registerTool(
    'list_lists',
    {
      title: 'List reminder lists',
      description: 'List all Apple Reminders lists with the number of open (incomplete) reminders in each.',
      inputSchema: {},
      annotations: RO,
    },
    forward('list_lists')
  );

  server.registerTool(
    'list_reminders',
    {
      title: 'List reminders',
      description: "List the user's reminders (incomplete first, soonest due first). Optionally filter to one list, or include completed ones.",
      inputSchema: {
        list: z.string().optional(),
        include_completed: z.boolean().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: RO,
    },
    forward('list_reminders')
  );

  server.registerTool(
    'get_reminder',
    {
      title: 'Read a reminder',
      description: 'Read a reminder by id or (fuzzy) name.',
      inputSchema: { id: z.string().optional(), name: z.string().optional() },
      annotations: RO,
    },
    forward('get_reminder')
  );

  server.registerTool(
    'create_reminder',
    {
      title: 'Create a reminder',
      description: "Create a new Apple Reminder. Optionally set notes, a due date (ISO 8601, e.g. 2026-07-20T09:00:00Z), and a target list (defaults to the user's default list).",
      inputSchema: {
        name: z.string(),
        body: z.string().optional(),
        due: z.string().optional(),
        list: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    forward('create_reminder')
  );

  server.registerTool(
    'complete_reminder',
    {
      title: 'Complete a reminder',
      description: 'Mark a reminder completed (or set completed:false to reopen it).',
      inputSchema: { id: z.string(), completed: z.boolean().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    forward('complete_reminder')
  );

  server.registerTool(
    'update_reminder',
    {
      title: 'Update a reminder',
      description: "Edit a reminder's name, notes, or due date. WARNING: overwrites the fields you pass — read it first. Pass due:null to clear the due date.",
      inputSchema: {
        id: z.string(),
        name: z.string().optional(),
        body: z.string().optional(),
        due: z.string().nullable().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    forward('update_reminder')
  );

  return server;
}
