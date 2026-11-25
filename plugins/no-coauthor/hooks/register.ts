import type { Register } from 'claude-code'

// A command that records a commit message or a PR body.
const WRITES_GIT_TEXT = /\bgit\b[^\n;|&]*\bcommit\b|\bgh\s+pr\s+(create|edit)\b/

// Claude as co-author, or the footer Claude Code adds to commits and PRs.
const CLAUDE_TRAILER = /co-authored-by:\s*claude|generated with\s*(\[?claude code|claude)|noreply@anthropic\.com/i

export const carriesClaudeTrailer = (command: string): boolean =>
  WRITES_GIT_TEXT.test(command) && CLAUDE_TRAILER.test(command)

export const register: Register = on => {
  // The engine's own instruction to add the trailer / footer is blanked.
  for (const kind of ['commit', 'pr'] as const)
    on('attribution.text', { kind }, () => ({ text: '' }))

  // Safety net: a command that still carries one is not run.
  on('tool.call', { tool: 'Bash' }, ($, e, next) =>
    carriesClaudeTrailer(e.command)
      ? {
          deny: `${$.plugin.name}: remove the Claude co-author / "Generated with" line from the commit or PR text, then run it again.`,
        }
      : next(e),
  ).catch(($, e, next) =>
    next.called ? next(e) : { deny: `${$.plugin.name}: its guard failed; not running the command.` },
  )
}
