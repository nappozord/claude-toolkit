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
📁 my-app  │  🌿 main ↑2 ↓0                        💬 Prompts 12  │  💵 Cost $1.84
──────────────────────────────────────────────────────────────────────────────────────────────
🧠 Context 42%  ▰▰▰▰▱▱▱▱▱▱  420k / 1M                      🔥 Cache   38m
⏳ 5-hour  63%  ▰▰▰▰▰▰▱▱▱▱  ↻ 1h52m                        ⏱️ Session 2h07m
📅 Week    28%  ▰▰▰▱▱▱▱▱▱▱  ↻ Thu 09:00                    🪙 Tokens  184k
```

- **Top row — workspace (left) and session (right corner):**
  - **📁 folder:** the session's working directory's name (the last folder of its path, split on `/` or `\` so Windows paths work too); `🌳` after it when the session runs in a git
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
- **Usage rows — a grid of three rows.** Each row has a bar reading on the left and a session reading
  pinned to the right edge (`space-between`): context with the cache, 5-hour with the session time, week
  with the tokens. The three bars sit one under the other, and every column lines up across the rows
  because each is a fixed-width cell (widths in cells): icon and label (10, just wide enough for
  `🧠 Context`), one space, percentage (4, left-aligned, so every value sits one space after the
  longest label), one space, the 10-cell bar, two spaces, the detail. On the right, each session reading
  is icon and label (10), one space, value (5, left-aligned): every reading is the same width, so the
  labels and the values each start in one column, with at most a couple of cells left after a short
  value. 0.5.0 had wider cells (11 for labels with a trailing space, percentages right-aligned, the right
  reading 18 wide), which left visible gaps between label and value and after the right-hand values. A bar row with no reading yet shows `—` in the
  percentage cell and an all-empty bar, so nothing shifts. There are no dividers in these rows: the
  columns do that job. Before (≤ 0.4.1) the bars were spread over three rows of different shape
  (context alone, 5-hour and week side by side, the session readings on their own row) and did not line up.
  When the band is narrower than 64 cells a bar row and a session reading no longer fit side by side:
  the three session readings move to a fourth row of their own, split by vertical rules.
- **Context (row 1, left):** percentage of the context window in use, a progress bar, and the tokens in the
  window over the window size (`420k / 1M`).
- **5-hour and week (rows 2 and 3, left):** the 5-hour window's percentage, progress bar and time until it resets
  (relative, e.g. `1h52m`); the weekly window's percentage, progress bar and reset moment (weekday and
  local time on the 24-hour clock, e.g. `Thu 16:00`). A reset already past reads `↻ now` (the figures are only as fresh as
  the last reply).
  The engine learns the windows only from API response headers, so a new or resumed session has none
  until its first reply. Until then the band shows the **last reading from any session** (the windows
  are account-wide), saved in the plugin's store on every measurement with window figures; a window
  whose reset has passed since then reads `0%` with no reset time, since it has started over.
- **Session readings (right column, top to bottom: cache · session time · tokens):
  - **cache:** countdown until the prompt cache expires, counted from when the last main-thread request
    was answered (the first chunk of the reply, so a retry backoff does not count) plus its cache lifetime (5 min or 1 h, read from the request's cache write; a request that
    only read the cache keeps the previous lifetime; unknown → 5 min). Subagent requests never move it
    (their cache is their own). Shows `🧊 Cold` once it lapses, `🔥 Cache —` before any request.
  - **session tokens:** input + output + cache-write tokens of every model step (main thread and subagents),
    *excluding cache reads* (they re-count the whole conversation on every request and would inflate the
    number into the millions). Counts survive compaction, unlike the context reading. The engine has no ready-made
    session total, so the band adds each request up itself (kept in session state, so hot reloads keep
    it) and **saves it per session id** in the plugin's store after every reply, with the cache timer.
    Resuming a session, in a new process or in-process, restores both (the cache shows its remaining
    time, or `🧊 Cold`). `/clear` runs the new conversation under a new id, so it starts from 0.
    Sessions never saved (from before this, or older than the 30-day pruning) start at 0.
    Not counted: a reply that was interrupted before it finished, a `/compact`
    the engine runs itself, other mods' own model calls and background classifier calls, so the figure
    can sit a little under `/cost`'s.
  - **session time:** time since the session started (resumed sessions count from their first launch).

## Look

- Every percentage has a 10-cell progress bar of `▰` glyphs: the filled cells in the level colour,
  the empty cells the same glyph in the theme's `subtle` colour, so both are the same height (the
  sketch shows empty cells as `▱` for readability; an outlined `▱` drew taller than `▰` in the desktop
  font, and solid background blocks looked worse). The percentage number itself is bold, and so is the cache countdown.
- **Icons.** Every label has an icon, all from one set. On graphical surfaces (desktop app, editor,
  mobile) they are Google **Material Symbols, filled**, drawn with the `Svg` element at 16 px, each in
  its own colour. An Svg is an image, so it cannot take theme colours: each colour has a dark-mode and
  a light-mode shade, switched by `prefers-color-scheme` inside the SVG. The terminal has no `Svg`, so
  there each icon is the matching colour emoji, which is also the Svg's alt text.

  | Label | Material Symbol | Colour (dark / light) | Emoji |
  | --- | --- | --- | --- |
  | folder | `folder` | orange-yellow `#E8A54B` / `#B7752A` | 📁 (worktree mark stays 🌳 text) |
  | branch | `fork_right` | the band's blue `#5B9DF5` / `#2F6FD6` | 🌿 |
  | Prompts | `chat_bubble` | cyan-leaning teal `#4DB6C4` / `#237F8C` | 💬 |
  | Cost | `payments` | teal `#5CC2B2` / `#1F8577` | 💵 |
  | Context | `memory` | violet `#A78BFA` / `#6D4FD6` | 🧠 |
  | 5-hour | `hourglass_top` | sand `#D9B98A` / `#9C7A45` | ⏳ |
  | Week | `calendar_month` | pink-red `#F07A9A` / `#C2456A` | 📅 |
  | Cache | `local_fire_department` | red `#F26B4F` / `#C8432F` | 🔥 |
  | Cold | `ac_unit` | ice `#8FD3F4` / `#2E8BB8` | 🧊 |
  | Session | `timer` | dark grey `#7A7A7A` / `#4A4A4A` | ⏱️ |
  | Tokens | `toll` | bronze `#C98E5A` / `#95602E` | 🪙 |

  The palette is the owner's choice. Branch deliberately uses the band's calm blue, and the cache flame
  is always red (an earlier version coloured it by its countdown level; the countdown's own text keeps
  doing that). `ICON_COLOURS` in `hooks/icons.ts` holds them, and a test pins them.
  Filled shapes carry colour better than 16 px outlines, which looked washed out; the outlined paths are
  still in `hooks/icons.ts` and `ICON_STYLE` switches back. All path data is Apache License 2.0
  (credited there and in the README); each icon's SVG is built from one path and a style, nothing else.
  Before: colour emoji (busier, uneven against plain text symbols like `◐`/`❄`), then grey outlines.
  The `↻` before a reset time is a value marker, not a label icon, and stays a plain symbol.
- Labels are capitalised words, each after its icon: `Context`, `5-hour`, `Week`, `Cache`, `Session`, `Tokens`, `Prompts`, `Cost` (dim, so values stand
  out); readings side by side in the top row are split by a **vertical rule** with two spaces each side
  (the narrow fourth session row uses four). The usage rows have none: they are aligned columns. On graphical surfaces the rule is a thin Svg line (1 px wide, 16 px tall, dim grey
  `#5A5A5E`, `#B4B2A9` in light mode); in the terminal it is the `│` character (it was a `·` dot before). A percentage is followed by one space and its bar; a bar by two spaces, then what belongs to it: the
  `↻` reset time, or on the context row the token count directly (no divider there, since the bar and
  `420k / 1M` are one reading).
- Layout rule: every group of pieces that must sit on one line is an explicit `flexDirection="row"`
  Box. The desktop app stacks loose siblings (a fragment) vertically.
- Colour by level: blue below 75 %, yellow from 75 %, red from 90 % — applied to the number and its
  bar. Yellow and red are the theme's own `warning` / `error`, so they follow the person's theme. Blue
  is a fixed `#5B9DF5` (`CALM_BLUE`), not the theme's `suggestion`: the desktop app greys that key out
  while its window is unfocused, and the band must read the same focused or not.
- Cache countdown: blue with more than 20 minutes left, yellow from 20, red from 10; `🧊 Cold` is grey
  (the theme's `inactive`), so an expired cache never looks like a calm blue reading.
- Labels are dim so the numbers stand out.
- A reading that is not available yet (e.g. rate limits before any reply, in any session) shows `—`.

## Behaviour

- **Kept between sessions** in `$.store`, a JSON file of the plugin's own under
  `~/.claude/plugins/store/` (private to the user, never in the repo, removed with the plugin):
  `session:<session id>` → `{ tally, savedAt }`, written after every reply, dropped at session start
  once older than 30 days (or damaged); `limits` → `{ at, rateLimits }`, the latest window reading.
  Every value read back is shape-checked first (`asSavedSession`, `asStoredLimits`); anything that
  fails counts as absent. Store failures never break the band: it just behaves as without the store.
  A hot reload of a session with nothing saved keeps the tally already in memory.

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
  clean/smudge filters). Every call is also
  `git -c core.fsmonitor=false -c protocol.allow=never --no-optional-locks …` with
  `GIT_NO_LAZY_FETCH=1`: no network at all, because in a partial clone counting commits could otherwise
  fetch missing objects through a transport the repository's config chooses. Repo hooks are already
  off for git that a mod runs. (Earlier versions used `git status` with only fsmonitor off, then
  record-only reads without the network lock; security reviews pointed out filters and lazy fetches.)
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
