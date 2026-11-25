# no-push-guard

A Claude Code guard that denies every `git push` Claude tries to run, force and dry-run included.
Pushing stays a human decision: Claude prepares commits, you push.

It recognises a push in its usual spellings: after global options (`git -C ../repo push`,
`git -c user.name=x push`) and after shell separators (`cd repo && git push`, `npm test; git push`).
Commands that only mention the word, like `git stash push` or `git commit -m "push the button"`,
pass through.

When it blocks a command, Claude is told that the user pushes, so it hands you the command instead.
If the guard itself fails, the command is refused rather than run.

## Limits

It is a seatbelt against accidental pushes, not a security boundary. It matches the command text, so:

- **It can be talked around.** A push hidden inside another program or string (`sh -c "git push"`,
  `eval`, a script file, a git alias, `/usr/bin/git push`) is not recognised. If you need a hard
  guarantee, also block pushes in git itself (a `pre-push` hook, or no push credential where Claude runs).
- **It can be over-cautious.** Text that merely contains `git push`, such as a commit message or a file
  written with `echo`, is refused too. Put such text in a file (`git commit -F msg.txt`) instead.

## Files

- `hooks/register.ts`: the `tool.call` hook on `Bash` and the `isPush` matcher.
- `hooks/register.test.ts`: the spellings it must catch and the ones it must leave alone.

## Develop

```bash
claude plugin test .
```
