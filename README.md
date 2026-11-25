# claude-toolkit

A Claude Code plugin marketplace: the plugins I use every day: mods that change Claude Code's
interface, hooks that guard what Claude may do, and (later) skills and commands.

## Install

Add the marketplace once:

```
/plugin marketplace add nappozord/claude-toolkit
```

Then install what you want:

```
/plugin install usage-band@claude-toolkit
```

```
/plugin install no-push-guard@claude-toolkit
```

```
/plugin install no-coauthor@claude-toolkit
```

To get updates automatically, turn on auto-update for `claude-toolkit` under **Marketplaces** in `/plugin`.

## Plugins

| Plugin | Kind | What it does |
| --- | --- | --- |
| [`usage-band`](plugins/usage-band/) | mod (band above the prompt) | Folder and branch, prompts and cost, context window, 5-hour and weekly limits with reset times, prompt-cache countdown, session time and tokens: all at a glance. |
| [`no-push-guard`](plugins/no-push-guard/) | guard (tool-call hook) | Denies every `git push`, force and dry-run included: pushing is always done by you. |
| [`no-coauthor`](plugins/no-coauthor/) | guard (attribution + tool-call hook) | Keeps Claude out of commit and PR attribution: blanks the co-author / "Generated with" text and refuses commits or PRs that still carry it. |

## Layout

```
.claude-plugin/marketplace.json   the marketplace: its name and one entry per plugin
plugins/<name>/                   one folder per plugin
  .claude-plugin/plugin.json      the plugin's manifest (name, version, description)
  hooks/                          its hooks module and tests
  README.md                       what it does and how to use it
```

## Adding a plugin

1. Create `plugins/<name>/` with its `.claude-plugin/plugin.json` and a `README.md`.
2. Add an entry to `.claude-plugin/marketplace.json`: `name` (same as in `plugin.json`), `source`
   (`./plugins/<name>`) and a one-line `description`.
3. Check it:

   ```bash
   claude plugin validate plugins/<name>
   ```

   ```bash
   claude plugin test plugins/<name>
   ```

4. Add it to the table above, commit, and bump `version` in its `plugin.json` on later changes so
   installs pick up the update.
