# Contributing

## Setup

```bash
pnpm install
pnpm build
```

## Development

```bash
pnpm dev  # watch mode
```

## Changesets

When adding features or fixing bugs:

```bash
pnpm changeset
# Select packages, version bump, write summary (past tense)
# Commit the .changeset/*.md file with your PR
```

## Testing

```bash
pnpm test
pnpm type-check
pnpm lint
```

## Claude plugins

`plugins/kopai-oncall` is a Claude plugin, listed in the Claude Directory
from this folder. It isn't an npm package and takes no changeset.

- Its `root-cause-analysis` and `create-live-page` skills are copies of
  `skills/`. Change the originals, then copy them; CI fails on a stale copy:

  ```bash
  node scripts/sync-plugin-skills.mjs
  ```

- Check a change before the PR, and run the evals in
  `plugins/kopai-oncall/evals/` (its README says how):

  ```bash
  npx @anthropic-ai/claude-code plugin validate --strict plugins/kopai-oncall
  ```

- To release, raise `version` in `.claude-plugin/plugin.json`, merge, and
  once the Kopai server it needs is deployed, push the tag
  `kopai-oncall@<version>` on that commit. The Directory follows the tag,
  not `main`, so a merge alone reaches no one.
