import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Database } from 'better-sqlite3'
import { z } from 'zod'

/**
 * Performs a fulltext search across all indexed notes using SQLite FTS5.
 *
 * Results are ranked by relevance and each row includes a highlighted snippet
 * with matched terms wrapped in `**`. The snippet is extracted from the note
 * body (column index 1) and capped at 32 tokens with `...` as the ellipsis.
 *
 * @param db - Open SQLite database instance.
 * @param query - Search query in SQLite FTS5 syntax (e.g. `"exact phrase"`, `term*`).
 * @param limit - Maximum number of results to return. Defaults to 20.
 * @returns Array of `{ path, title, snippet }` objects ordered by relevance.
 */
function searchNotes(
  db: Database,
  query: string,
  limit = 20,
): { path: string; title: string; snippet: string }[] {
  return db
    .prepare(
      `SELECT n.path, n.title, snippet(notes_fts, 1, '**', '**', '...', 32) AS snippet
       FROM notes_fts
       JOIN notes n ON notes_fts.rowid = n.id
       WHERE notes_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
    )
    .all(query, limit) as { path: string; title: string; snippet: string }[]
}

/**
 * Lists notes from the database with optional filtering by folder or tag.
 *
 * When `tag` is provided it takes precedence over `folder`. Without any filter
 * all notes are returned, ordered by vault-relative path.
 *
 * @param db - Open SQLite database instance.
 * @param opts.folder - Vault-relative folder prefix to filter by (e.g. `"projects"`).
 * @param opts.tag - Exact tag string to filter by (frontmatter or inline).
 * @returns Array of `{ path, title }` objects ordered by path.
 */
function listNotes(
  db: Database,
  opts: { folder?: string; tag?: string } = {},
): { path: string; title: string }[] {
  if (opts.tag) {
    return db
      .prepare(
        `SELECT n.path, n.title FROM notes n
         JOIN tags t ON t.note_id = n.id
         WHERE t.tag = ?
         ORDER BY n.path`,
      )
      .all(opts.tag) as { path: string; title: string }[]
  }
  if (opts.folder) {
    return db
      .prepare(`SELECT path, title FROM notes WHERE path LIKE ? ORDER BY path`)
      .all(`${opts.folder}/%`) as { path: string; title: string }[]
  }
  return db.prepare('SELECT path, title FROM notes ORDER BY path').all() as {
    path: string
    title: string
  }[]
}

/**
 * Returns all notes that have no outgoing links (wikilinks or MD links).
 *
 * @param db - Open SQLite database instance.
 * @returns Array of `{ path, title }` objects ordered by path.
 */
function deadendNotes(db: Database): { path: string; title: string }[] {
  return db
    .prepare(
      `SELECT path, title FROM notes
       WHERE id NOT IN (SELECT DISTINCT source_id FROM links)
       ORDER BY path`,
    )
    .all() as { path: string; title: string }[]
}

/**
 * Returns all notes that have no incoming links from any other note.
 *
 * Mirrors the backlink resolution logic: a note is considered "linked to" if
 * its title OR its vault-relative path appears as a `target_path` in the links table.
 *
 * @param db - Open SQLite database instance.
 * @returns Array of `{ path, title }` objects ordered by path.
 */
function orphanNotes(db: Database): { path: string; title: string }[] {
  return db
    .prepare(
      `SELECT path, title FROM notes
       WHERE path NOT IN (SELECT target_path FROM links)
         AND title NOT IN (SELECT target_path FROM links)
       ORDER BY path`,
    )
    .all() as { path: string; title: string }[]
}

/**
 * Returns all notes that are both orphans (no incoming links) and dead ends (no outgoing links).
 *
 * @param db - Open SQLite database instance.
 * @returns Array of `{ path, title }` objects ordered by path.
 */
function aloneNotes(db: Database): { path: string; title: string }[] {
  return db
    .prepare(
      `SELECT path, title FROM notes
       WHERE id NOT IN (SELECT DISTINCT source_id FROM links)
         AND path NOT IN (SELECT target_path FROM links)
         AND title NOT IN (SELECT target_path FROM links)
       ORDER BY path`,
    )
    .all() as { path: string; title: string }[]
}

/**
 * Registers the `search_notes`, `list_notes`, `deadends`, `orphans`, and `alones` MCP tools on the given server.
 *
 * @param db - Open SQLite database instance.
 * @param server - MCP server instance to register the tools on.
 */
export function registerSearchTools(db: Database, server: McpServer): void {
  server.registerTool(
    'search_notes',
    {
      description: 'Fulltext search across all notes in the vault',
      inputSchema: {
        query: z.string().describe('Search query (SQLite FTS5 syntax supported)'),
        limit: z.number().int().min(1).max(100).default(20).optional(),
      },
    },
    async ({ query, limit }) => {
      const results = searchNotes(db, query, limit ?? 20)
      if (results.length === 0) return { content: [{ type: 'text', text: 'No results found.' }] }
      const text = results
        .map((r) => `**${r.title}** (${r.path})\n${r.snippet}`)
        .join('\n\n---\n\n')
      return { content: [{ type: 'text', text }] }
    },
  )

  server.registerTool(
    'list_notes',
    {
      description: 'List all notes, optionally filtered by subfolder or tag',
      inputSchema: {
        folder: z.string().optional().describe('Subfolder path relative to vault root'),
        tag: z.string().optional().describe('Frontmatter tag to filter by'),
      },
    },
    async ({ folder, tag }) => {
      const notes = listNotes(db, { folder, tag })
      if (notes.length === 0) return { content: [{ type: 'text', text: 'No notes found.' }] }
      const text = notes.map((n) => `- **${n.title}** (${n.path})`).join('\n')
      return { content: [{ type: 'text', text }] }
    },
  )

  server.registerTool(
    'deadends',
    {
      description: 'List all notes that have no outgoing links (wikilinks or markdown links)',
      inputSchema: {},
    },
    async () => {
      const notes = deadendNotes(db)
      if (notes.length === 0) return { content: [{ type: 'text', text: 'No dead-end notes found.' }] }
      const text = notes.map((n) => `- **${n.title}** (${n.path})`).join('\n')
      return { content: [{ type: 'text', text }] }
    },
  )

  server.registerTool(
    'orphans',
    {
      description: 'List all notes that no other note links to',
      inputSchema: {},
    },
    async () => {
      const notes = orphanNotes(db)
      if (notes.length === 0) return { content: [{ type: 'text', text: 'No orphan notes found.' }] }
      const text = notes.map((n) => `- **${n.title}** (${n.path})`).join('\n')
      return { content: [{ type: 'text', text }] }
    },
  )

  server.registerTool(
    'alones',
    {
      description: 'List all notes that have neither incoming nor outgoing links (orphan + dead end)',
      inputSchema: {},
    },
    async () => {
      const notes = aloneNotes(db)
      if (notes.length === 0) return { content: [{ type: 'text', text: 'No alone notes found.' }] }
      const text = notes.map((n) => `- **${n.title}** (${n.path})`).join('\n')
      return { content: [{ type: 'text', text }] }
    },
  )
}
