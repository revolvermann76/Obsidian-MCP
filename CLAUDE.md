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
| `src/indexer.ts` | Walk vault recursively, upsert notes/tags/aliases/links, remove deleted files |
| `src/watcher.ts` | chokidar watcher → calls `indexFile` / `removeFile` on changes |
| `src/server.ts` | Orchestrates MCP tool registration + stdio transport |
| `src/parser.test.ts` | Vitest unit tests for `parseNote` |

**MCP tool modules (`src/tools/`):**

Each file owns one thematic concern: query logic + `register*` function called by `server.ts`.

| File | Tool(s) | Concern |
|------|---------|---------|
| `src/tools/searchTools.ts` | `search_notes`, `list_notes` | Finding sets of notes |
| `src/tools/readTools.ts` | `read_note` | Reading a single note by path, title, or alias |
| `src/tools/backlinkTools.ts` | `get_backlinks` | Notes linking to a given note |
| `src/tools/tagTools.ts` | `search_by_tag` | Filtering by tag |
| `src/tools/aliasTools.ts` | `aliases` | Listing aliases with optional filters |

**DB schema:**
- `notes` — id, path (relative to vault), title, content, content_hash (SHA-1), mtime
- `notes_fts` — FTS5 virtual table (content='notes'), kept in sync via INSERT/UPDATE/DELETE triggers
- `tags` — note_id → tag (frontmatter + inline body tags, CASCADE delete)
- `aliases` — note_id → alias (from frontmatter `aliases` key, CASCADE delete)
- `links` — source_id → target_path (wikilinks in body + frontmatter string values, MD links, CASCADE delete)

**MCP tools:**
- `search_notes` — FTS5 fulltext search with snippet highlighting, returns title + path + snippet
- `read_note` — read full content by exact path, title, or alias
- `list_notes` — list all notes, filterable by `folder` (path prefix) or `tag`
- `get_backlinks` — find notes linking to a given note (matches by title, path, or alias)
- `search_by_tag` — find notes by frontmatter tag or inline body tag
- `aliases` — list aliases; filterable by `file`, `path`; supports `total` (count only) and `verbose` (include paths)
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
- Shared types (`Note`, `ParsedNote`) live in `src/types.ts`; `parser.ts` re-exports `ParsedNote` for backwards compatibility
- chokidar watches the vault directory directly (not a glob pattern) with `usePolling: true` — glob-based watching is unreliable on Windows with chokidar v5
- Inline tags (`#tag`, `#tag/subtag`) are extracted from the note body and merged with frontmatter tags; subtags are stored as a single flat string
- Wikilinks are extracted from both the note body and from frontmatter string values (e.g. a `related` list)
