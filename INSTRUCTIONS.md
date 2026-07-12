# Obsidian Vault Instructions

This MCP server exposes an Obsidian vault indexed in SQLite. Use the
provided tools to search, read, and modify notes, tags, aliases,
properties, and the folder structure of this vault.

## Guidelines

- Prefer `search_fulltext` or `search_query` to locate notes before reading
  them by exact path or title.
- Use `note_read` to fetch the full content of a note once you know its
  title, path, or alias.
- Use `note_get_backlinks` / `note_get_links` to understand how notes are
  connected before renaming, moving, or deleting anything.
- When creating or editing notes, keep frontmatter (`tags`, `aliases`,
  custom properties) intact unless the user explicitly asks to change it.
- Always double-check with the user before deleting, renaming, or moving
  notes, since these actions modify files on disk.
