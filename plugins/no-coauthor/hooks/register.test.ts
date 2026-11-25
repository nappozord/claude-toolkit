import { expect, test } from 'claude-code/testing'
import { carriesClaudeTrailer } from './register'

test('denies commit and PR text that credits Claude', () => {
  for (const c of [
    `git commit -m "fix\n\nCo-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`,
    `git commit -m "$(cat <<'EOF'\nfix\n\nco-authored-by: claude <x>\nEOF\n)"`,
    `git -C ../r commit -m "x" -m "Co-Authored-By: Claude <noreply@anthropic.com>"`,
    `gh pr create --title t --body "done\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)"`,
    `gh pr edit 3 --body "Generated with Claude Code"`,
  ]) expect(carriesClaudeTrailer(c)).toBe(true)
})

test('lets normal commits and unrelated commands through', () => {
  for (const c of [
    'git commit -m "fix login redirect"',
    `git commit -m "Co-Authored-By: Maria <maria@example.com>"`,
    'git status',
    'echo "Co-Authored-By: Claude" > notes.txt',
    'gh pr view 3',
  ]) expect(carriesClaudeTrailer(c)).toBe(false)
})

test('blanks the attribution text for commits and PRs only', async $ => {
  expect(await $.attribution.text({ kind: 'commit', text: 'Co-Authored-By: Claude' })).toEqual({ text: '' })
  expect(await $.attribution.text({ kind: 'pr', text: 'Generated with Claude Code' })).toEqual({ text: '' })
})
