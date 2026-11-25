# usage-band — design

A Claude Code mod that draws a band above the prompt showing, at a glance, where the session is working
(folder, branch, sync with the remote), how many prompts it has taken and what it has cost, and how much of the context
window, the rate limits and the session have been used. Built for the owner's own use first,
then shipped through their plugin marketplace on GitHub, `nappozord/claude-toolkit`.

## Why

Checking usage today means running `/cost`, `/context` or opening settings. The owner wants the answer
always visible, so they can decide on the spot whether to start a big task, compact, or wait for a reset.

## What it shows

```
📁 my-app    ·    🌿 main ↑2 ↓0                        💬 Prompts 12    ·    💵 Cost $1.84
──────────────────────────────────────────────────────────────────────────────────────────────
🧠 Context 42% ▰▰▰▰▱▱▱▱▱▱    ·    420k / 1M
⏳ 5-hour 63% ▰▰▰▰▰▰▱▱▱▱ ↻ 1h52m    ·    📅 Week 28% ▰▰▰▱▱▱▱▱▱▱ ↻ Thu 09:00
🔥 Cache 38m    ·    ⏱️ Session 2h07m    ·    🪙 Tokens 184k
```

- **Top row — workspace (left) and session (right corner):**
  - **📁 folder:** the session's working directory's name; `🌳` after it when the session runs in a git
    worktree (its git dir differs from the common git dir), so it is clear it is not the main checkout.
  - **🌿 branch:** the current branch (`detached` on a detached HEAD), then `↑N ↓M` (commits not pushed /
    commits on the remote not pulled) when either is non-zero, `✓` when in sync, `(not pushed)` when the
    branch has no upstream. Outside a git repository only the folder shows.
  - Uncommitted changes are deliberately not shown (the owner chose not to).
  - The right corner reads, in this order, with dim labels like the usage rows:
    - **💬 Prompts:** how many prompts the person has sent this session (`$.session.turns()`).
    - **💵 Cost:** the session's cost as `/cost` estimates it, as `$1.84` (the owner chose no `≈`
      mark; it is still the client-side estimate, not a bill, and on a subscription nothing is billed per
      token). Hidden where the host keeps no ledger.
  - The model is deliberately not shown (the owner removed it).
  - Folder and branch carry an icon only: their values say what they are.
  - The top row is one wrapping row with `space-between`: the corner group sits at the right edge and
    wraps under the workspace only when the two really do not fit. No column threshold is used,
    because the desktop app reports fewer columns than its proportional font actually fits.
  - A dim full-width line divides this row from the usage rows. In the terminal it is a `─` line
    exactly `bodyColumns` long. On graphical surfaces it is a markdown rule (`Markdown` with `---`),
    which the app draws full width and vertically centred with no characters to count. Tried and
    dropped there: a `─` line sized to `bodyColumns` (the desktop font is wider, so it wrapped onto a
    second line), Text `wrap="clip"` (refused on desktop), and a long `─` line in a one-row Box with
    `overflow="hidden"` (it sat at the bottom of its row and stretched the band past the window,
    cutting off the right corner).
- **Row 1 — context:** percentage of the context window in use, a progress bar, and the tokens in the
  window over the window size (`420k / 1M`).
- **Row 2 — rate limits:** the 5-hour window's percentage, progress bar and time until it resets
  (relative, e.g. `1h52m`); the weekly window's percentage, progress bar and reset moment (weekday and
  local time on the 24-hour clock, e.g. `Thu 16:00`). A reset already past reads `↻ now` (the figures are only as fresh as
  the last reply). When the band is narrower than 80 cells the two windows stack on two rows, so the
  band is four rows tall instead of wrapping mid-bar.
- **Row 3 — session** (drawn in the order cache · session time · tokens):
  - **cache:** countdown until the prompt cache expires, counted from when the last main-thread request
    was answered (the first chunk of the reply, so a retry backoff does not count) plus its cache lifetime (5 min or 1 h, read from the request's cache write; a request that
    only read the cache keeps the previous lifetime; unknown → 5 min). Subagent requests never move it
    (their cache is their own). Shows `🧊 Cold` once it lapses, `🔥 Cache —` before any request.
  - **session tokens:** input + output + cache-write tokens of every model step (main thread and subagents),
    *excluding cache reads* (they re-count the whole conversation on every request and would inflate the
    number into the millions). Counts survive compaction, unlike row 1. The engine has no ready-made
    session total, so the band adds each request up itself (kept in session state, so hot reloads keep
    it): it starts at 0 when the mod is installed mid-session, and `/clear` or a resume starts it (and
    the cache timer) over. Not counted: a reply that was interrupted before it finished, a `/compact`
    the engine runs itself, other mods' own model calls and background classifier calls, so the figure
    can sit a little under `/cost`'s.
  - **session time:** time since the session started (resumed sessions count from their first launch).

## Look

- Every percentage has a 10-cell progress bar of `▰` glyphs: the filled cells in the level colour,
  the empty cells the same glyph in the theme's `subtle` colour, so both are the same height (the
  sketch shows empty cells as `▱` for readability; an outlined `▱` drew taller than `▰` in the desktop
  font, and solid background blocks looked worse). The percentage number itself is bold, and so is the cache countdown.
- Every label icon is a colour emoji from the same set (mixing emoji with plain text symbols like
  `◐` or `❄` looked uneven); the `↻` before a reset time is a value marker, not a label icon, and
  stays a plain symbol.
- Labels are capitalised words, each with an icon: `🧠 Context`, `⏳ 5-hour`, `📅 Week`, `🔥 Cache`, `⏱️ Session` and `🪙 Tokens` (dim, so values stand
  out); readings in a row are split by a dim `    ·    ` (four spaces each side), the context percentage and its token
  count included.
- Layout rule: every group of pieces that must sit on one line is an explicit `flexDirection="row"`
  Box. The desktop app stacks loose siblings (a fragment) vertically.
- Colour by level: blue below 75 %, yellow from 75 %, red from 90 % — applied to the number and its
  bar. These are the theme's own `suggestion` (blue) / `warning` / `error` colours, so they follow the person's
  theme.
- Cache countdown: blue with more than 20 minutes left, yellow from 20, red from 10; `🧊 Cold` is grey
  (the theme's `inactive`), so an expired cache never looks like a calm blue reading.
- Labels are dim so the numbers stand out.
- A reading that is not available yet (e.g. rate limits before the first reply) shows `—`.

## Behaviour

- Redraws when the engine reports changed usage figures, after each turn, and on a 30-second tick so
  countdowns and the session timer keep moving.
- Git is read (5 s timeout each) at session start, after every `Bash` tool call (git commands and
  branch switches run there) and on the 30-second tick, with four record-only commands:
  `rev-parse --path-format=absolute --git-dir --git-common-dir` (is it a repo, is it a worktree),
  `symbolic-ref --short -q HEAD` (branch; failing = detached), `rev-parse --abbrev-ref
  --symbolic-full-name @{upstream}` (upstream; failing = not pushed) and, with an upstream,
  `rev-list --left-right --count @{upstream}...HEAD` (behind / ahead). The result is kept in session
  state; drawing reads that, so a slow repository never delays the band. A failed read keeps the
  folder alone.
- Security: the band runs git in whatever folder a session opens, possibly a repository someone else
  wrote. So it never runs `status`, `diff` or anything else that refreshes the index or reads the
  working tree, because those can launch programs the repository's own config names (fsmonitor,
  clean/smudge filters). Every call is also `git -c core.fsmonitor=false --no-optional-locks …`, and
  repo hooks are already off for git that a mod runs. (An earlier version used `git status` with only
  fsmonitor off; a security review pointed out filters could still run.)
- Draws on every surface (desktop app, terminal). Yields the band to surveys (`hasSurvey`).

## Non-goals (for now)

- Usage history across sessions, charts, dashboards.
- Alerts or toasts when a limit gets close.
- Cost in money beyond the estimate in the top row (no budgets, no per-model split).
- Uncommitted-change counts and pull-request status.

## Approaches considered

- **Band mod (chosen):** an `AbovePrompt` render hook; lives next to the prompt on desktop and terminal,
  redraws live.
- **Status-line script:** could print three lines but sits at the bottom of the terminal, not in the
  band, and does not redraw a live countdown cleanly. Rejected.
- **Side pane:** more room but not glanceable; better suited to a later history/dashboard mod.

## Where it lives

In the `claude-toolkit` marketplace repo (`plugins/usage-band/`), beside `no-push-guard` and `no-coauthor`.
Install with `/plugin install usage-band@claude-toolkit`. To work on it with live reloading, start a
session with `claude --plugin-dir plugins/usage-band` from the repo root.
