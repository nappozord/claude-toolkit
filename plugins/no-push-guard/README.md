# no-push-guard

A Claude Code guard that denies every `git push` Claude tries to run, force and dry-run included.
Pushing stays a human decision: Claude prepares commits, you push.

It recognises a push in its usual spellings: after global options (`git -C ../repo push`,
`git -c user.name=x push`) and after shell separators (`cd repo && git push`, `npm test; git push`).
Commands that only mention the word, like `git stash push` or `git commit -m "push the button"`,
pass through.

When it blocks a command, Claude is told that the user pushes, so it hands you the command instead.
If the guard itself fails, the command is refused rather than run.

## Files

- `hooks/register.ts`: the `tool.call` hook on `Bash` and the `isPush` matcher.
- `hooks/register.test.ts`: the spellings it must catch and the ones it must leave alone.

## Develop

```bash
claude plugin test .
```
