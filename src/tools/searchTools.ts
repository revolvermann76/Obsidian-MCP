import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Database } from 'better-sqlite3'
import { z } from 'zod'
import { evaluateQuery, firstTextTerm, parseSearchQuery } from './searchQueryParser.js'

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

// Escapes all RegExp metacharacters so a plain user string can be used as a literal pattern.
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function makeSnippet(content: string, query: string, caseSensitive = true): string {
  const haystack = caseSensitive ? content : content.toLowerCase()
  const needle = caseSensitive ? query : query.toLowerCase()
  const idx = haystack.indexOf(needle)
  if (idx === -1) return ''
  const start = Math.max(0, idx - 60)
  const end = Math.min(content.length, idx + query.length + 60)
  const fragment = content.slice(start, end)

  // Use a global RegExp so every occurrence in the window is highlighted,
  // and escape query so characters like $1 or (foo) are treated as literals.
  const highlighted = fragment.replace(
    new RegExp(escapeRegExp(query), caseSensitive ? 'g' : 'gi'),
    (m) => `**${m}**`,
  )

  return `${start > 0 ? '...' : ''}${highlighted}${end < content.length ? '...' : ''}`
}

function stringifyPropertyValue(json: string): string[] {
  try {
    const v = JSON.parse(json) as unknown
    if (Array.isArray(v)) return v.map(String)
    if (v === null) return ['']
    return [String(v)]
  } catch {
    return [json]
  }
}

interface QueryableNote {
  path: string
  title: string
  content: string
  tags: string[]
  properties: Record<string, string[]>
}

function loadQueryableNotes(db: Database, folder?: string): QueryableNote[] {
  const noteRows = (
    folder
      ? db.prepare('SELECT id, path, title, content FROM notes WHERE path LIKE ? ORDER BY path').all(`${folder}/%`)
      : db.prepare('SELECT id, path, title, content FROM notes ORDER BY path').all()
  ) as { id: number; path: string; title: string; content: string }[]

  const tagsByNote = new Map<number, string[]>()
  for (const r of db.prepare('SELECT note_id, tag FROM tags').all() as { note_id: number; tag: string }[]) {
    const arr = tagsByNote.get(r.note_id) ?? []
    arr.push(r.tag)
    tagsByNote.set(r.note_id, arr)
  }

  const propsByNote = new Map<number, Record<string, string[]>>()
  for (const r of db.prepare('SELECT note_id, key, value FROM properties').all() as {
    note_id: number
    key: string
    value: string
  }[]) {
    const props = propsByNote.get(r.note_id) ?? {}
    props[r.key] = stringifyPropertyValue(r.value)
    propsByNote.set(r.note_id, props)
  }

  return noteRows.map((n) => ({
    path: n.path,
    title: n.title,
    content: n.content,
    tags: tagsByNote.get(n.id) ?? [],
    properties: propsByNote.get(n.id) ?? {},
  }))
}

/**
 * Searches notes using Obsidian-style query syntax (see `searchQueryParser.ts`).
 *
 * Loads all candidate notes (optionally scoped to a folder) into memory and evaluates
 * the parsed expression tree against each one, since the supported operators (field
 * filters, property filters, boolean combinators) span multiple tables that can't be
 * folded into a single FTS5 MATCH expression.
 *
 * @param db - Open SQLite database instance.
 * @param query - Obsidian-style query string.
 * @param opts.folder - Limit search to this vault-relative folder path.
 * @param opts.caseSensitive - Case-sensitive matching (default: false).
 * @param opts.limit - Maximum number of results to return.
 * @returns Array of `{ path, title, snippet }` objects ordered by path.
 */
function searchByQuery(
  db: Database,
  query: string,
  opts: { folder?: string; caseSensitive?: boolean; limit?: number } = {},
): { path: string; title: string; snippet: string }[] {
  const ast = parseSearchQuery(query)
  const caseSensitive = opts.caseSensitive ?? false
  const limit = opts.limit ?? 20
  const highlightTerm = firstTextTerm(ast)

  const matches = loadQueryableNotes(db, opts.folder).filter((note) => evaluateQuery(ast, note, caseSensitive))

  return matches.slice(0, limit).map((note) => ({
    path: note.path,
    title: note.title,
    snippet: highlightTerm ? makeSnippet(note.content, highlightTerm, caseSensitive) : '',
  }))
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

  server.registerTool(
    'search_query',
    {
      description:
        'Search notes using Obsidian-style query syntax. Supports free text, "exact phrases", ' +
        'boolean OR, implicit AND (space-separated terms), exclusion with -term, grouping with ' +
        '(parentheses), field filters path:, file:, tag:, content:, and frontmatter property ' +
        'filters [key], [key:value], [key:value OR value2]. ' +
        'Not supported: line:/block:/section:/task: scoped search, comparison operators ' +
        '(e.g. [duration:<5]), and regex (/pattern/) — use search_fulltext or note_read for those cases.',
      inputSchema: {
        query: z.string().describe('Obsidian-style search query'),
        folder: z.string().optional().describe('Limit search to this vault-relative folder path'),
        limit: z.number().int().min(1).max(100).default(20).optional(),
        case_sensitive: z.boolean().optional().describe('Case-sensitive matching (default: false)'),
      },
    },
    async ({ query, folder, limit, case_sensitive }) => {
      const results = searchByQuery(db, query, {
        folder,
        limit: limit ?? 20,
        caseSensitive: case_sensitive ?? false,
      })
      if (results.length === 0) return { content: [{ type: 'text', text: 'No results found.' }] }
      const text = results
        .map((r) => (r.snippet ? `**${r.title}** (${r.path})\n${r.snippet}` : `**${r.title}** (${r.path})`))
        .join('\n\n---\n\n')
      return { content: [{ type: 'text', text }] }
    },
  )
}