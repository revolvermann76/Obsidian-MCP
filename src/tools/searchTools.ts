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
  folder?: string,
  caseSensitive = false,
): { path: string; title: string; snippet: string }[] {
  if (caseSensitive) {
    const sql = folder
      ? 'SELECT path, title, content FROM notes WHERE INSTR(content, ?) > 0 AND path LIKE ? ORDER BY path LIMIT ?'
      : 'SELECT path, title, content FROM notes WHERE INSTR(content, ?) > 0 ORDER BY path LIMIT ?'
    const rows = (
      folder
        ? db.prepare(sql).all(query, `${folder}/%`, limit)
        : db.prepare(sql).all(query, limit)
    ) as { path: string; title: string; content: string }[]
    return rows.map((r) => ({ path: r.path, title: r.title, snippet: makeSnippet(r.content, query) }))
  }

  if (folder) {
    return db
      .prepare(
        `SELECT n.path, n.title, snippet(notes_fts, 1, '**', '**', '...', 32) AS snippet
         FROM notes_fts
         JOIN notes n ON notes_fts.rowid = n.id
         WHERE notes_fts MATCH ? AND n.path LIKE ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(query, `${folder}/%`, limit) as { path: string; title: string; snippet: string }[]
  }
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

function makeSnippet(content: string, query: string): string {
  const idx = content.indexOf(query)
  if (idx === -1) return ''
  const start = Math.max(0, idx - 60)
  const end = Math.min(content.length, idx + query.length + 60)
  const fragment = content.slice(start, end).replace(query, `**${query}**`)
  return `${start > 0 ? '...' : ''}${fragment}${end < content.length ? '...' : ''}`
}

/**
 * Registers the `search_fulltext` MCP tool on the given server.
 *
 * @param db - Open SQLite database instance.
 * @param server - MCP server instance to register the tools on.
 */
export function registerSearchTools(db: Database, server: McpServer): void {
  server.registerTool(
    'search_fulltext',
    {
      description: 'Fulltext search across all notes in the vault, optionally limited to a subfolder',
      inputSchema: {
        query: z.string().describe('Search query (SQLite FTS5 syntax supported)'),
        folder: z.string().optional().describe('Limit search to this vault-relative folder path'),
        limit: z.number().int().min(1).max(100).default(20).optional(),
        case_sensitive: z.boolean().optional().describe('Case-sensitive search (default: false)'),
      },
    },
    async ({ query, folder, limit, case_sensitive }) => {
      const results = searchNotes(db, query, limit ?? 20, folder, case_sensitive ?? false)
      if (results.length === 0) return { content: [{ type: 'text', text: 'No results found.' }] }
      const text = results
        .map((r) => `**${r.title}** (${r.path})\n${r.snippet}`)
        .join('\n\n---\n\n')
      return { content: [{ type: 'text', text }] }
    },
  )

}
