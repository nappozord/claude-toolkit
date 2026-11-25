import { expect, test } from 'claude-code/testing'
import { isPush } from './register'

test('recognises pushes in their usual spellings', () => {
  for (const c of [
    'git push',
    'git push origin develop',
    'git push --force',
    'git push -f origin main',
    'git push --dry-run',
    'git -C ../other push',
    'git -c user.name=x push',
    'cd repo && git push',
    'npm test; git push origin HEAD',
    'echo ok | git push',
  ]) expect(isPush(c)).toBe(true)
})

test('leaves other git and shell commands alone', () => {
  for (const c of [
    'git status',
    'git commit -m "push the button"',
    'git log --oneline',
    'git pull',
    'git stash push',
    'echo pushing',
    'git remote -v',
  ]) expect(isPush(c)).toBe(false)
})
