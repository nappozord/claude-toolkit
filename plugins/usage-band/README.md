# usage-band

A Claude Code mod that keeps your workspace and your usage in view: a band above the prompt, in the
desktop app and the terminal.

```
📁 my-app  │  🌿 main ↑2 ↓0                        💬 Prompts 12  │  💵 Cost $1.84
──────────────────────────────────────────────────────────────────────────────────────────────
🧠 Context 42%  ▰▰▰▰▱▱▱▱▱▱  420k / 1M                      🔥 Cache   38m
⏳ 5-hour  63%  ▰▰▰▰▰▰▱▱▱▱  ↻ 1h52m                        ⏱️ Session 2h07m
📅 Week    28%  ▰▰▰▱▱▱▱▱▱▱  ↻ Thu 16:00                    🪙 Tokens  184k
```

| Reading | What it means |
| --- | --- |
| `📁` | The folder the session works in; `🌳` after it when that is a git worktree, not the main checkout. |
| `🌿` | The current branch: `↑2 ↓0` = 2 commits not pushed, 0 on the remote not pulled; `✓` in sync; `(not pushed)` when the branch has no remote copy. Hidden outside a git repository. |
| `💬 Prompts` | How many prompts you have sent this session. |
| `💵 Cost` | The session's cost as Claude Code estimates it: an estimate, not a bill (a subscription is not billed per token). |
| `🧠 Context` | How full the context window is, and the tokens in it over the window size. |
| `⏳ 5-hour` | Use of the 5-hour rate-limit window and how long until it resets. |
| `📅 Week` | Use of the weekly window and the weekday and time it resets (local time, 24-hour clock: `16:00`). |
| `🔥 Cache` | How long the prompt cache of your last message stays warm; `🧊 Cold` once it has expired, so the next message re-sends the conversation at full price. |
| `⏱️ Session` | Time since the session started. |
| `🪙 Tokens` | Tokens sent and received by every model step this session, subagents included, cache reads left out. Counted by the band and saved per session, so resuming a session brings its count (and cache timer) back; `/clear` starts from 0. Interrupted replies, `/compact` and other mods' model calls are not counted, so it can sit a little under `/cost`. |

Percentages and the cache countdown are bold; each percentage has a 10-cell bar beside it: blue under
75 %, yellow from 75 %, red from 90 %. The cache countdown turns yellow with 20 minutes left and red
with 10. A reset time already past reads `↻ now`. Before a session's first reply the 5-hour and weekly
readings are the last ones seen in any session (a window that has reset since reads `0%`). A reading
not available at all (rate limits on an API-key account, or before any reply ever) shows `—`.

The band keeps a small file under `~/.claude/plugins/store/` with those last readings and each
session's token count and cache timer, for 30 days. It stays on your machine and is removed with the
plugin.

Prompts and cost sit in the top-right corner and wrap under the folder and branch only when the
window is too narrow for both. Below it the three bars sit one under the other with their labels,
percentages and bars in aligned columns, and the cache, session time and tokens down the right side;
under 64 columns those three move to a row of their own. The band steps aside
while a survey uses that spot, and you can collapse it with the `[-]` next to it.

It redraws whenever Claude Code reports new usage figures and every 30 seconds. Git is read when the
session starts, after every shell command Claude runs, and every 30 seconds.

## Files

- `hooks/register.tsx` — records each model request, reads git, and draws the band.
- `hooks/icons.ts` — the Material Symbols path data and the SVG built from it.
- `hooks/format.ts` — the formatting rules (bars, colours, durations, token counts, cache lifetime,
  git branch line, price).
- `types/index.d.ts` — what the band keeps in session state.
- `DESIGN.md` — what it shows and why.

## Develop

```bash
claude plugin test .
```

```bash
claude plugin validate .
```

## Icons

In the desktop app (and other graphical surfaces) the labels use Google's filled
[Material Symbols](https://github.com/google/material-design-icons), licensed under the
[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0); their path data is in
`hooks/icons.ts`. Each icon has its own colour, and readings are separated by thin vertical rules. The terminal
shows the matching emoji instead, and `│` for the rules.
