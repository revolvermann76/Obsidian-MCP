# Obsidian MCP

An [MCP](https://modelcontextprotocol.io) (Model Context Protocol) server that indexes an Obsidian vault into SQLite and exposes it to MCP clients (e.g. Claude Desktop, Claude Code) through a rich set of query and editing tools.

The server keeps a live, queryable copy of your vault: full-text search, tags, aliases, frontmatter properties, and the link graph between notes, all backed by SQLite with an FTS5 index. A file watcher keeps the database in sync as notes change on disk.

## Features

- **Full-text search** over note content, with snippet highlighting (`search_fulltext`)
- **Obsidian-style query search** supporting phrases, boolean operators, field filters, and property filters (`search_query`)
- **Note operations**: read, create, delete, rename, move, append, prepend, list, and outline notes
- **Link graph queries**: backlinks, outgoing links, orphaned notes, dead ends, and fully isolated notes
- **Tags, aliases, and frontmatter properties**: list, add, remove, and update, with changes written straight back to disk
- **Folder queries**: list subfolders and folder metadata (note counts, word counts, tags)
- **Live sync**: a file watcher re-indexes notes automatically as they change, are created, or deleted
- **Two transports**: stdio (for local MCP clients) or streamable HTTP (for remote/server deployments)

## Installation

```bash
npm install
npm run build
```

`npm run build` type-checks the project with `tsc` and bundles it with `esbuild` into a single `dist/index.cjs` CommonJS file. `better-sqlite3` is a native addon and is kept external to the bundle.

## Usage

Run the server against an Obsidian vault:

```bash
node dist/index.cjs --vault /path/to/obsidian-vault
```

### CLI flags

| Flag | Description |
|------|-------------|
| `--vault <path>` | Path to the Obsidian vault (**required**) |
| `--db <path>` | Path to the SQLite database file (default: `<vault>/.mcp-index.db`) |
| `--transport stdio\|http` | Transport mode (default: `stdio`) |
| `--port <number>` | HTTP port when `--transport http` is used (default: `3000`) |
| `--instructions <path>` | File whose contents are sent as the MCP `instructions` field on `initialize` (default: a built-in note describing the vault) |

### Examples

```bash
# Default stdio transport, default DB location
node dist/index.cjs --vault /path/to/obsidian-vault

# Custom database path
node dist/index.cjs --vault /path/to/vault --db /path/to/index.db

# HTTP transport on the default port (3000)
node dist/index.cjs --vault /path/to/vault --transport http

# HTTP transport on a custom port
node dist/index.cjs --vault /path/to/vault --transport http --port 8080

# Custom MCP instructions
node dist/index.cjs --vault /path/to/vault --instructions /path/to/instructions.md
```

### Connecting an MCP client

Point your MCP client (e.g. Claude Desktop) at the built binary over stdio, for example:

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "node",
      "args": ["/absolute/path/to/Obsidian-MCP/dist/index.cjs", "--vault", "/absolute/path/to/your/vault"]
    }
  }
}
```

## Development

```bash
npm run build        # typecheck + bundle (production)
npm run bundle        # esbuild only, no typecheck
npm run dev           # esbuild watch mode (no typecheck)
npm run typecheck     # tsc --noEmit only
npm run format        # prettier over src/
npm run format:check  # prettier check (CI)
npm test              # vitest one-shot test run
npm run test:watch    # vitest watch mode
```

Convenience scripts for local testing against the bundled `test-vault/`:

```bash
npm run start:test    # build + run against test-vault/ with sample instructions
npm run inspect        # start the MCP Inspector UI at localhost:6277 against test-vault/
```

## Architecture

**Startup sequence (`src/index.ts`):**

1. Parse `--vault`, `--db`, `--transport`, `--port` CLI arguments
2. Open/create the SQLite database (`openDatabase`)
3. Run a full vault scan with delta detection (`scanVault`)
4. Start the file watcher (`watchVault`)
5. Start the MCP server on the chosen transport (`startServer`)

### Source files

| File | Responsibility |
|------|---------------|
| `src/types.ts` | Shared interfaces: `Note`, `ParsedNote` |
| `src/db.ts` | Schema creation, FTS5 virtual table, UPDATE/DELETE triggers |
| `src/parser.ts` | Parses raw markdown: frontmatter (gray-matter), inline tags, wikilinks (body + frontmatter values), Markdown links, aliases, SHA-1 hash |
| `src/indexer.ts` | Walks the vault recursively, upserts notes/tags/aliases/links/properties, removes deleted files |
| `src/watcher.ts` | chokidar watcher that calls `indexFile` / `removeFile` on changes |
| `src/server.ts` | Orchestrates MCP tool registration and stdio/HTTP transport |
| `src/parser.test.ts` | Vitest unit tests for `parseNote` |

### MCP tool modules (`src/tools/`)

Each file owns one thematic concern: query logic plus a `register*` function called by `server.ts`.

| File | Tool(s) | Concern |
|------|---------|---------|
| `src/tools/searchTools.ts` | `search_fulltext`, `search_query` | FTS5 full-text search; Obsidian-style query search |
| `src/tools/searchQueryParser.ts` | — | Parser/AST/evaluator for `search_query`'s Obsidian-style syntax (no DB/MCP dependency) |
| `src/tools/noteTools.ts` | `note_read`, `note_info`, `note_outline`, `note_append`, `note_prepend`, `note_get_backlinks`, `note_get_links`, `note_create`, `note_delete`, `note_rename`, `note_move`, `note_list`, `note_deadends`, `note_orphans`, `note_alones` | Reading, listing, creating, deleting, renaming, moving, and querying notes |
| `src/tools/tagTools.ts` | `tag_search`, `tag_list`, `tag_add`, `tag_remove` | Filtering by tag, listing and writing tags |
| `src/tools/folderTools.ts` | `folder_get_subfolders`, `folder_info` | Listing vault folder structure and folder metadata |
| `src/tools/aliasTools.ts` | `alias_list`, `alias_add`, `alias_remove` | Listing, adding, and removing aliases |
| `src/tools/propertyTools.ts` | `property_list`, `property_add`, `property_update`, `property_remove` | Listing, adding, updating, and removing frontmatter properties |
| `src/tools/indexTools.ts` | `index` | Triggering a full vault rescan to bring the database up to date |

### Database schema

- **`notes`** — id, path (relative to vault), title, content, content_hash (SHA-1), mtime
- **`notes_fts`** — FTS5 virtual table (content='notes'), kept in sync via INSERT/UPDATE/DELETE triggers
- **`tags`** — note_id → tag (frontmatter + inline body tags, cascading delete)
- **`aliases`** — note_id → alias (from the frontmatter `aliases` key, cascading delete)
- **`links`** — source_id → target_path (wikilinks in the body + frontmatter string values, Markdown links, cascading delete)
- **`properties`** — note_id → key, value (all raw frontmatter key-value pairs; value stored as a JSON string, cascading delete)

## MCP tools

### Folders
- `folder_get_subfolders` — list subfolders of a vault folder (defaults to root); `recursive=true` returns all descendant folders
- `folder_info` — return metadata for a folder: direct/total note counts, subfolders, total word count, tags (defaults to vault root)

### Search
- `search_fulltext` — FTS5 full-text search with snippet highlighting, returns title + path + snippet; optional `folder` limits scope; `case_sensitive` switches to INSTR-based exact match (default: `false`)
- `search_query` — Obsidian-style query search: free text, `"exact phrases"`, `OR`, implicit AND, `-term` exclusion, `(parentheses)` grouping, field filters `path:`/`file:`/`tag:`/`content:`, and property filters `[key]`/`[key:value]`/`[key:value OR value2]`; evaluates the parsed expression in memory against all notes (optionally scoped to `folder`) since field/property filters span multiple tables; does **not** support Obsidian's `line:`/`block:`/`section:`/`task:` operators, comparison operators (`[duration:<5]`), or regex (`/pattern/`)

### Notes
- `note_read` — read full content by exact path, title, or alias
- `note_info` — return metadata for a note: title, path, modified date, size, word count, outgoing links, backlinks, aliases, tags, frontmatter properties (excluding `tags`/`aliases`)
- `note_outline` — return the heading structure (H1–H6) of a note as a flat list of heading lines
- `note_append` — append markdown content to the end of a note by title, alias, or path; updates disk and re-indexes the DB immediately
- `note_prepend` — prepend markdown content to a note by title, alias, or path; inserted after the frontmatter block if one is present; updates disk and re-indexes the DB immediately
- `note_orphans` — list all notes that no other note links to (neither by path nor by title)
- `note_alones` — list all notes that are both orphans and dead ends (no incoming and no outgoing links)
- `note_list` — list all notes, filterable by `folder` (path prefix) or `tag`
- `note_deadends` — list all notes that have no outgoing links (wikilinks or Markdown links)
- `note_get_backlinks` — find notes linking to a given note (matches by title, path, or alias)
- `note_get_links` — list all outgoing links in a note; resolved links show title + path, dead links show the raw target marked as not found
- `note_create` — create a new note; `folder` is optional (defaults to vault root); missing folders are created automatically; `content` sets initial content; `overwrite` replaces an existing file
- `note_delete` — delete a note by path, title, or alias; refuses if a title/alias matches multiple notes — use the exact path in that case
- `note_rename` — rename a note's filename (stays in the same folder) by path, title, or alias; refuses if a title/alias matches multiple notes — use the exact path in that case
- `note_move` — move a note to a different folder (filename unchanged) by path, title, or alias; refuses if a file with the same name already exists at the destination; missing folders are created automatically; refuses if a title/alias matches multiple notes

### Tags
- `tag_search` — find notes by frontmatter tag or inline body tag
- `tag_list` — list all unique tags in the vault with their note counts
- `tag_add` — add a tag to a note's frontmatter by title, alias, or path; updates disk and DB immediately
- `tag_remove` — remove a frontmatter tag from a note; drops the `tags` key if the list becomes empty; inline body tags cannot be removed via this tool

### Aliases
- `alias_list` — list aliases; filterable by `file`, `path`; supports `total` (count only) and `verbose` (include paths)
- `alias_add` — add an alias to a note identified by title, existing alias, or path; updates frontmatter on disk and DB immediately
- `alias_remove` — remove an alias from a note identified by title, existing alias, or path; updates frontmatter on disk and DB immediately; drops the `aliases` key entirely if the list becomes empty

### Properties (frontmatter)
- `property_list` — list frontmatter properties from the DB index; no filters → unique property names across the vault; `file`/`path` → all properties for that note (`file` resolves by title or alias); add `name` → value of a specific property (or all notes that have it, if no file/path given)
- `property_add` — add a frontmatter property to a note by title, alias, or path; `type` controls coercion (`text` default, `number`, `boolean`, `list` comma-separated → array, `date`, `json` raw JSON string); fails if the property already exists
- `property_update` — update an existing frontmatter property on a note by title, alias, or path; same `type` coercion as `property_add`; fails if the property does not exist
- `property_remove` — remove a frontmatter property from a note by title, alias, or path; updates frontmatter on disk and DB immediately

### Index / maintenance
- `index` — rescan the vault and sync the database to the current file state (add/update changed notes, remove deleted ones); same delta-detection scan used at startup, reuses `scanVault`
- `exit` — shut down the MCP server process

For detailed parameters, result formats, and error messages for every tool, see [`docs/tools-overview.md`](docs/tools-overview.md).

## Key design decisions

- esbuild bundles everything into `dist/index.cjs` (CJS format); `tsc` is used only for type-checking (`--noEmit`)
- `"type": "module"` stays in `package.json` so `tsc` treats sources as ESM (required by `verbatimModuleSyntax`); the `.cjs` extension tells Node the bundle is CommonJS
- `better-sqlite3` is marked `--external` in esbuild because native `.node` addons cannot be bundled
- `better-sqlite3` is synchronous — the indexer uses transactions for performance, the watcher uses synchronous `readFileSync`
- Change detection uses a SHA-1 content hash, not mtime
- The DB defaults to `<vault>/.mcp-index.db`; override with `--db`
- Transport is selectable via `--transport stdio|http` (default: `stdio`); HTTP uses `StreamableHTTPServerTransport` (MCP Streamable HTTP spec) with per-session UUIDs; port defaults to `3000`, override with `--port`
- All server logs go to `stderr` so they don't interfere with the MCP stdio protocol
- MCP tools are registered with `server.registerTool()` — `server.tool()` is deprecated as of SDK 1.29
- Each tool module exports a `register*` function; `server.ts` calls them in sequence and contains no query logic itself
- `startServer` receives `vaultPath` (in addition to `db`) so write-capable tools can resolve absolute file paths
- `startServer` also receives the resolved `instructions` string (read from `--instructions <path>` or a built-in default), passed through to the `McpServer` constructor's `instructions` option so it's returned to clients in the `initialize` response
- Shared types (`Note`, `ParsedNote`) live in `src/types.ts`; `parser.ts` re-exports `ParsedNote` for backwards compatibility
- chokidar watches the vault directory directly (not a glob pattern) with `usePolling: true` — glob-based watching is unreliable on Windows with chokidar v5
- Inline tags (`#tag`, `#tag/subtag`) are extracted from the note body and merged with frontmatter tags; subtags are stored as a single flat string
- All frontmatter key-value pairs are stored in `properties` (values as JSON strings); this includes `tags`, `aliases`, and any custom keys
- Wikilinks are extracted from both the note body and from frontmatter string values (e.g. a `related` list)

## License

ISC
