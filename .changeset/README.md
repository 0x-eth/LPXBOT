# Changesets

Run `pnpm changeset` for a releasable package change and commit the generated Markdown file with that change. Run `pnpm changeset:status` to inspect the pending release plan, `pnpm version-packages` to apply it, and `pnpm release` only from the release workflow.

All current workspaces are private. Changesets still versions them so internal dependency ranges and release intent remain reviewable; publishing remains controlled separately.
