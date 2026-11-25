import type { Register } from 'claude-code'

// `git push`, also behind global options (`git -C dir push`, `git -c k=v push`)
// and after a shell separator (`cd x && git push`, `a; git push`, `$(git push)`).
const GIT_PUSH = /(^|[;&|(`\n]|\s)git(\s+(-[cC]\s+\S+|--[\w-]+(=\S+)?|-\S+))*\s+push(\s|$|[;&|)`])/

export const isPush = (command: string): boolean => GIT_PUSH.test(command)

export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, ($, e, next) =>
    isPush(e.command)
      ? { deny: `${$.plugin.name}: git push is never run by Claude. The user pushes.` }
      : next(e),
  ).catch(($, e, next) =>
    next.called ? next(e) : { deny: `${$.plugin.name}: its guard failed; not running the command.` },
  )
}
