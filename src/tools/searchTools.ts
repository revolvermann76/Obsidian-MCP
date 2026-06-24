import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Database } from 'better-sqlite3'
import { z } from 'zod'

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
  return db
    .prepare('SELECT path, title FROM notes ORDER BY path')
    .all() as { path: string; title: string }[]
}

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
      const text = results.map((r) => `**${r.title}** (${r.path})\n${r.snippet}`).join('\n\n---\n\n')
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
}
