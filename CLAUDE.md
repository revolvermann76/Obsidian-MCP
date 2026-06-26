# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build        # typecheck + bundle (production)
npm run bundle       # esbuild only, no typecheck
npm run dev          # esbuild watch mode (no typecheck)
npm run typecheck    # tsc --noEmit only
npm run format       # prettier over src/
npm run format:check # prettier check (CI)
npm test             # vitest one-shot test run
npm run test:watch   # vitest watch mode
```

Run the server:
```bash
node dist/index.cjs --vault /path/to/obsidian-vault
node dist/index.cjs --vault /path/to/vault --db /path/to/index.db
npm run start:test   # runs against test-vault/
npm run inspect      # starts MCP Inspector UI at localhost:6277
```

## Documentation

- `docs/tools-overview.md` — detailed reference for all MCP tools: parameters, result formats, and error messages
- `reference/obsidian.help.md` — quick-reference for Obsidian command syntax

## Architecture

MCP server that indexes an Obsidian vault into SQLite and exposes query tools over stdio.

**Startup sequence (`src/index.ts`):**
1. Parse `--vault` and optional `--db` CLI args
2. Open/create SQLite DB (`openDatabase`)
3. Full vault scan with delta detection (`scanVault`)
4. Start file watcher (`watchVault`)
5. Start MCP server on stdio (`startServer`)

**Source files:**

| File | Responsibility |
|------|---------------|
| `src/types.ts` | Shared interfaces: `Note`, `ParsedNote` |
| `src/db.ts` | Schema creation, FTS5 virtual table, UPDATE/DELETE triggers |
| `src/parser.ts` | Parse raw markdown: frontmatter (gray-matter), inline tags, wikilinks (body + frontmatter values), MD links, aliases, SHA-1 hash |
| `src/indexer.ts` | Walk vault recursively, upsert notes/tags/aliases/links/properties, remove deleted files |
| `src/watcher.ts` | chokidar watcher → calls `indexFile` / `removeFile` on changes |
| `src/server.ts` | Orchestrates MCP tool registration + stdio transport |
| `src/parser.test.ts` | Vitest unit tests for `parseNote` |

**MCP tool modules (`src/tools/`):**

Each file owns one thematic concern: query logic + `register*` function called by `server.ts`.

| File | Tool(s) | Concern |
|------|---------|---------|
| `src/tools/searchTools.ts` | `search_fulltext` | FTS5 fulltext search |
| `src/tools/noteTools.ts` | `note_read`, `note_info`, `note_outline`, `note_append`, `note_get_backlinks`, `note_get_links`, `note_create`, `note_delete`, `note_list`, `note_deadends`, `note_orphans`, `note_alones` | Reading, listing, creating, deleting, and querying notes |
| `src/tools/tagTools.ts` | `tag_search`, `tag_list`, `tag_add`, `tag_remove` | Filtering by tag, listing and writing tags |
| `src/tools/folderTools.ts` | `folder_get_subfolders`, `folder_info` | Listing vault folder structure and folder metadata |
| `src/tools/aliasTools.ts` | `alias_list`, `alias_add`, `alias_remove` | Listing, adding, and removing aliases |
| `src/tools/propertyTools.ts` | `property_list`, `property_add`, `property_remove` | Listing, adding, and removing frontmatter properties |

**DB schema:**
- `notes` — id, path (relative to vault), title, content, content_hash (SHA-1), mtime
- `notes_fts` — FTS5 virtual table (content='notes'), kept in sync via INSERT/UPDATE/DELETE triggers
- `tags` — note_id → tag (frontmatter + inline body tags, CASCADE delete)
- `aliases` — note_id → alias (from frontmatter `aliases` key, CASCADE delete)
- `links` — source_id → target_path (wikilinks in body + frontmatter string values, MD links, CASCADE delete)
- `properties` — note_id → key, value (all raw frontmatter key-value pairs; value stored as JSON string, CASCADE delete)

**MCP tools:**
- `folder_get_subfolders` — list subfolders of a vault folder (defaults to root); `recursive=true` returns all descendant folders
- `folder_info` — return metadata for a folder: direct/total note counts, subfolders, total word count, tags (defaults to vault root)
- `search_fulltext` — FTS5 fulltext search with snippet highlighting, returns title + path + snippet; optional `folder` limits scope; `case_sensitive` switches to INSTR-based exact match (default: false)
- `note_read` — read full content by exact path, title, or alias
- `note_info` — return metadata for a note: title, path, modified date, size, word count, outgoing links, backlinks, aliases, tags, frontmatter properties (excluding `tags`/`aliases`)
- `note_outline` — return the heading structure (H1–H6) of a note as a flat list of heading lines
- `note_append` — append markdown content to the end of a note by title, alias, or path; updates disk and re-indexes DB immediately
- `note_orphans` — list all notes that no other note links to (neither by path nor by title)
- `note_alones` — list all notes that are both orphans and dead ends (no incoming and no outgoing links)
- `note_list` — list all notes, filterable by `folder` (path prefix) or `tag`
- `note_deadends` — list all notes that have no outgoing links (wikilinks or MD links)
- `note_get_backlinks` — find notes linking to a given note (matches by title, path, or alias)
- `note_get_links` — list all outgoing links in a note; resolved links show title + path, dead links show the raw target marked as not found
- `note_create` — create a new note; `folder` is optional (defaults to vault root); missing folders are created automatically; `content` sets initial content; `overwrite` replaces an existing file
- `note_delete` — delete a note by path, title, or alias; refuses if a title/alias matches multiple notes — use the exact path in that case
- `tag_search` — find notes by frontmatter tag or inline body tag
- `tag_list` — list all unique tags in the vault with their note counts
- `tag_add` — add a tag to a note's frontmatter by title, alias, or path; updates disk and DB immediately
- `tag_remove` — remove a frontmatter tag from a note; drops `tags` key if list becomes empty; inline body tags cannot be removed via this tool
- `alias_list` — list aliases; filterable by `file`, `path`; supports `total` (count only) and `verbose` (include paths)
- `alias_add` — add an alias to a note identified by title, existing alias, or path; updates frontmatter on disk and DB immediately
- `alias_remove` — remove an alias from a note identified by title, existing alias, or path; updates frontmatter on disk and DB immediately; drops the `aliases` key entirely if the list becomes empty
- `property_list` — list frontmatter properties from the DB index; no filters → unique property names across vault; `file`/`path` → all properties for that note (`file` resolves by title or alias); add `name` → value of a specific property (or all notes that have it, if no file/path given)
- `property_add` — add a frontmatter property to a note by title, alias, or path; `type` controls coercion (`text` default, `number`, `boolean`, `list` comma-separated → array, `date`, `json` raw JSON string); fails if property already exists
- `property_remove` — remove a frontmatter property from a note by title, alias, or path; updates frontmatter on disk and DB immediately
- `exit` — shut down the MCP server process

**Key design decisions:**
- esbuild bundles everything to `dist/index.cjs` (CJS format); tsc is only used for type-checking (`--noEmit`)
- `"type": "module"` stays in package.json so tsc treats sources as ESM (required by `verbatimModuleSyntax`); the `.cjs` extension tells Node the bundle is CommonJS
- `better-sqlite3` is marked `--external` in esbuild because native `.node` addons cannot be bundled
- `better-sqlite3` is synchronous — indexer uses transactions for performance, watcher uses sync `readFileSync`
- Change detection uses SHA-1 content hash, not mtime
- DB defaults to `<vault>/.mcp-index.db`; override with `--db`
- All server logs go to `stderr` so they don't interfere with the MCP stdio protocol
- MCP tools are registered with `server.registerTool()` — `server.tool()` is deprecated as of SDK 1.29
- Each tool module exports a `register*` function; `server.ts` calls them in sequence and contains no query logic itself
- `startServer` receives `vaultPath` (in addition to `db`) so write-capable tools can resolve absolute file paths
- Shared types (`Note`, `ParsedNote`) live in `src/types.ts`; `parser.ts` re-exports `ParsedNote` for backwards compatibility
- chokidar watches the vault directory directly (not a glob pattern) with `usePolling: true` — glob-based watching is unreliable on Windows with chokidar v5
- Inline tags (`#tag`, `#tag/subtag`) are extracted from the note body and merged with frontmatter tags; subtags are stored as a single flat string
- All frontmatter key-value pairs are stored in `properties` (values as JSON strings); this includes `tags`, `aliases`, and any custom keys
- Wikilinks are extracted from both the note body and from frontmatter string values (e.g. a `related` list)
