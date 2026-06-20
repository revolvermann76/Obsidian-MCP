# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build        # typecheck + bundle (production)
npm run dev          # esbuild watch mode (no typecheck)
npm run typecheck    # tsc --noEmit only
npm run format       # prettier over src/
npm run format:check # prettier check (CI)
```

## Architecture

This is an MCP (Model Context Protocol) server for querying Obsidian vaults. It is started with a `--vault <path>` argument pointing to a folder of Markdown files.

**Core design:**
- On startup: scan the vault, build a SQLite index (FTS5), then start the MCP server
- At runtime: a `chokidar` file watcher keeps the index in sync with file changes
- Changed files are detected via content hash comparison, not mtime alone

**Planned DB schema:**
- `notes` — id, path, title, mtime, content_hash, raw content
- `notes_fts` — FTS5 virtual table over title + content
- `tags` — note_id → tag (from YAML frontmatter)
- `links` — source_id → target_path (for backlink resolution)

**MCP tools exposed:**
- `search_notes` — FTS5 fulltext search
- `read_note` — read a single note by path or title
- `list_notes` — list all notes, filterable by folder or tag
- `get_backlinks` — find notes linking to a given note
- `search_by_tag` — find notes by frontmatter tag

**Key packages (not yet installed):**
- `@modelcontextprotocol/sdk` — MCP server
- `better-sqlite3` + `@types/better-sqlite3` — embedded SQLite with FTS5
- `chokidar` — file watching
- `gray-matter` — YAML frontmatter parsing

**Build:**
- Source in `src/`, bundled to `dist/index.js` via esbuild (single file, ESM, Node platform)
- TypeScript strict mode, NodeNext module resolution
- `tsc` is used only for type-checking (`--noEmit`), not for emitting JS
