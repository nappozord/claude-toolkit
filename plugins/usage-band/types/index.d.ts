/** How long the prompt cache keeps what a request wrote. */
export type CacheTtl = '5m' | '1h'

/**
 * What the band counts itself, kept in session state so it survives hot reloads:
 * `tokens` — every token sent and received this session (main thread and subagents),
 * cache reads excluded; `lastRequestAt` — when the main thread's last request was sent
 * (ms since epoch), null before any; `cacheTtl` — the lifetime its cache entry got.
 */
export type Tally = { tokens: number; lastRequestAt: number | null; cacheTtl: CacheTtl | null }

/** The current branch and its sync with its upstream, read from git. */
export type GitBranch = { branch: string; ahead: number; behind: number; hasUpstream: boolean }

/**
 * Where the session works, refreshed by the band from git (never while drawing):
 * `folder` — the working directory's name; `isWorktree` — the session runs in a linked git worktree;
 * `git` — null outside a git repository or when git could not be read.
 */
export type Workspace = { folder: string; isWorktree: boolean; git: GitBranch | null }

declare module 'claude-code' {
  interface PluginState {
    'usage-band': { tally: Tally; workspace: Workspace | null }
  }
}
