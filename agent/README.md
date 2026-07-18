# apple-notes-agent

The Mac-side half of **NotesBridge** — it lets ChatGPT and Claude read and write your
**Apple Notes**. This tiny agent runs on your Mac, connects to the NotesBridge relay,
and does the actual talking to the Notes app (via macOS automation). Your notes never
leave your machine except for the specific request you make.

- No account, no password, no cloud copy of your notes.
- One command to pair, one command to keep it running forever.
- No dependencies — just Node 18+.

---

## Quick start

You need [Node.js 18 or newer](https://nodejs.org). Then:

```sh
# 1. On the NotesBridge site, click "Connect my Mac" to get a pairing code.
# 2. Pair this Mac (replace ABCD-1234 with your code):
npx apple-notes-agent pair ABCD-1234

# 3. Keep it running in the background — starts on login, restarts if it crashes:
npx apple-notes-agent install
```

That's it. You can close the terminal — the agent keeps running.

> **First run permission prompt:** the first time the agent touches Apple Notes,
> macOS shows a one-time prompt asking to allow automation of "Notes". Click **OK**.
> If you miss it, enable it later under
> **System Settings → Privacy & Security → Automation**.

### Want it permanent? Install globally

`npx` runs from a cache that npm can prune, which would break the background agent.
For an always-on setup, install it globally so the path is stable:

```sh
npm install -g apple-notes-agent
apple-notes-agent pair ABCD-1234
apple-notes-agent install
```

---

## Commands

| Command | What it does |
|---|---|
| `apple-notes-agent pair <CODE>` | Claim a pairing code and save the agent token to `~/.notesbridge-agent.json` (mode 600). |
| `apple-notes-agent install` | Install a macOS LaunchAgent so the agent auto-starts on login and restarts on crash. |
| `apple-notes-agent run` | Run the agent in the foreground (Ctrl-C to stop). `install` does this for you in the background. |
| `apple-notes-agent status` | Check that you're paired, the server is reachable, and whether auto-start is installed. |
| `apple-notes-agent logs` | Show the last ~50 lines of the background agent log. |
| `apple-notes-agent uninstall` | Stop and remove the background agent (LaunchAgent). |
| `apple-notes-agent --version` | Print the version. |
| `apple-notes-agent --help` | Show usage. |

All commands accept `--server <URL>` to point at a different relay
(default: `https://notesbridge.vercel.app`).

---

## How it works

```
ChatGPT / Claude  ──MCP──▶  NotesBridge relay  ◀──poll──  apple-notes-agent (your Mac)
                                                                   │
                                                                   ▼
                                                             Apple Notes (JXA)
```

The agent long-polls the relay for jobs, runs each one against the Notes app using
Apple's JavaScript automation (JXA / `osascript`), and posts the result back. When
there's nothing to do it just idles.

- Config/token: `~/.notesbridge-agent.json` (permissions `600`).
- Background logs: `~/Library/Logs/notesbridge-agent.log` and `notesbridge-agent.err.log`.
- LaunchAgent: `~/Library/LaunchAgents/com.notesbridge.apple-notes-agent.plist`.

---

## Troubleshooting

**"Not paired" / it stopped working after a while.**
Your pairing token may have been revoked. Re-pair and reinstall:

```sh
apple-notes-agent pair <NEW-CODE>
apple-notes-agent install
```

If the background agent hit a `401`, it writes `~/.notesbridge-agent.unauthorized`
and keeps the reason in the error log — check `apple-notes-agent logs`.

**Notes aren't being read/written.**
Make sure the Notes app is allowed under
**System Settings → Privacy & Security → Automation** (allow your terminal / `node`
to control **Notes**). Then `apple-notes-agent uninstall` and `install` again.

**Check what's happening.**

```sh
apple-notes-agent status   # paired? reachable? auto-start installed?
apple-notes-agent logs     # recent activity + errors
```

**Uninstall completely.**

```sh
apple-notes-agent uninstall
rm ~/.notesbridge-agent.json   # also forget the pairing token
```

**Non-macOS.** `install`/`uninstall`/`logs` are macOS-only (they use LaunchAgents).
`pair`, `run`, and `status` work anywhere Node runs, but the Notes automation itself
requires macOS.

---

## Privacy

The agent only contacts the relay server you paired with. It sends the result of the
specific note operation you (via ChatGPT/Claude) requested — nothing else. Your notes
are not uploaded or indexed anywhere.

## License

MIT © Isaiah Dupree
