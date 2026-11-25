# no-coauthor

A Claude Code guard that keeps Claude out of commit and PR attribution.

- It blanks Claude Code's own attribution text for commits and pull requests, so Claude is never told
  to add a `Co-Authored-By: Claude` trailer or a "Generated with Claude Code" footer.
- As a safety net, it refuses any `git commit`, `gh pr create` or `gh pr edit` command whose text still
  carries such a line, and tells Claude to remove it and try again.

Ordinary co-authors (`Co-Authored-By: Maria <maria@example.com>`) and commands that only write the
words elsewhere (`echo "Co-Authored-By: Claude" > notes.txt`) pass through. If the guard itself fails,
the command is refused rather than run.

## Files

- `hooks/register.ts`: the `attribution.text` hooks, the `tool.call` hook on `Bash`, and the
  `carriesClaudeTrailer` matcher.
- `hooks/register.test.ts`: what it must refuse, what it must let through, and the blanked attribution.

## Develop

```bash
claude plugin test .
```
