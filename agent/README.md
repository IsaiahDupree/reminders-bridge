# apple-reminders-agent

The Mac-side half of **RemindersBridge** — it lets ChatGPT and Claude read and write your
**Apple Reminders**. This tiny agent runs on your Mac, connects to the RemindersBridge relay,
and does the actual talking to the Reminders app (via macOS automation). Your reminders never
leave your machine except for the specific request you make.

- No account, no password, no cloud copy of your reminders.
- One command to pair, one command to keep it running forever.
- No dependencies — just Node 18+.

---

## Quick start

You need [Node.js 18 or newer](https://nodejs.org). Then:

```sh
# 1. On the RemindersBridge site, click "Connect my Mac" to get a pairing code.
# 2. Pair this Mac (replace ABCD-1234 with your code):
npx apple-reminders-agent pair ABCD-1234

# 3. Keep it running in the background — starts on login, restarts if it crashes:
npx apple-reminders-agent install
```

That's it. You can close the terminal — the agent keeps running.

> **First run permission prompt:** the first time the agent touches Apple Reminders,
> macOS shows a one-time prompt asking to allow automation of "Reminders". Click **OK**.
> If you miss it, enable it later under
> **System Settings → Privacy & Security → Automation**.

### Want it permanent? Install globally

`npx` runs from a cache that npm can prune, which would break the background agent.
For an always-on setup, install it globally so the path is stable:

```sh
npm install -g apple-reminders-agent
apple-reminders-agent pair ABCD-1234
apple-reminders-agent install
```

---

## Commands

| Command | What it does |
|---|---|
| `apple-reminders-agent pair <CODE>` | Claim a pairing code and save the agent token to `~/.remindersbridge-agent.json` (mode 600). |
| `apple-reminders-agent install` | Install a macOS LaunchAgent so the agent auto-starts on login and restarts on crash. |
| `apple-reminders-agent run` | Run the agent in the foreground (Ctrl-C to stop). `install` does this for you in the background. |
| `apple-reminders-agent status` | Check that you're paired, the server is reachable, and whether auto-start is installed. |
| `apple-reminders-agent logs` | Show the last ~50 lines of the background agent log. |
| `apple-reminders-agent uninstall` | Stop and remove the background agent (LaunchAgent). |
| `apple-reminders-agent --version` | Print the version. |
| `apple-reminders-agent --help` | Show usage. |

All commands accept `--server <URL>` to point at a different relay
(default: `https://remindersbridge.vercel.app`).

---

## How it works

```
ChatGPT / Claude  ──MCP──▶  RemindersBridge relay  ◀──poll──  apple-reminders-agent (your Mac)
                                                              │
                                                              ▼
                                                              Apple Reminders (JXA)
```

The agent long-polls the relay for jobs, runs each one against the Reminders app using
Apple's JavaScript automation (JXA / `osascript`), and posts the result back. When
there's nothing to do it just idles. It serves eight tools — `search`, `fetch`,
`list_lists`, `list_reminders`, `get_reminder`, `create_reminder`, `complete_reminder`,
and `update_reminder` — which operate on your reminder lists, due dates, and
completion status.

- Config/token: `~/.remindersbridge-agent.json` (permissions `600`).
- Background logs: `~/Library/Logs/remindersbridge-agent.log` and `remindersbridge-agent.err.log`.
- LaunchAgent: `~/Library/LaunchAgents/com.remindersbridge.apple-reminders-agent.plist`.

---

## Troubleshooting

**"Not paired" / it stopped working after a while.**
Your pairing token may have been revoked. Re-pair and reinstall:

```sh
apple-reminders-agent pair <NEW-CODE>
apple-reminders-agent install
```

If the background agent hit a `401`, it writes `~/.remindersbridge-agent.unauthorized`
and keeps the reason in the error log — check `apple-reminders-agent logs`.

**Reminders aren't being read/written.**
Make sure the Reminders app is allowed under
**System Settings → Privacy & Security → Automation** (allow your terminal / `node`
to control **Reminders**). Then `apple-reminders-agent uninstall` and `install` again.

**Check what's happening.**

```sh
apple-reminders-agent status   # paired? reachable? auto-start installed?
apple-reminders-agent logs     # recent activity + errors
```

**Uninstall completely.**

```sh
apple-reminders-agent uninstall
rm ~/.remindersbridge-agent.json   # also forget the pairing token
```

**Non-macOS.** `install`/`uninstall`/`logs` are macOS-only (they use LaunchAgents).
`pair`, `run`, and `status` work anywhere Node runs, but the Reminders automation itself
requires macOS.

---

## Privacy

The agent only contacts the relay server you paired with. It sends the result of the
specific reminder operation you (via ChatGPT/Claude) requested — nothing else. Your
reminders are not uploaded or indexed anywhere.

## License

MIT © Isaiah Dupree
