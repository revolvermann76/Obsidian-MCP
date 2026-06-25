import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Database } from 'better-sqlite3'
import { z } from 'zod'
import type { Note } from '../types.js'

/**
 * Looks up a single note by vault-relative path, title, or alias.
 *
 * Exported so other tool modules (e.g. backlink resolution) can reuse the
 * same lookup logic without duplicating the query.
 *
 * @param db - Open SQLite database instance.
 * @param pathOrTitle - Vault-relative path, note title, or alias to match against.
 * @returns The matching {@link Note}, or `undefined` if no note is found.
 */
export function readNote(db: Database, pathOrTitle: string): Note | undefined {
  return db
    .prepare(
      `SELECT n.id, n.path, n.title, n.content FROM notes n
       LEFT JOIN aliases a ON a.note_id = n.id
       WHERE n.path = ? OR n.title = ? OR a.alias = ?
       LIMIT 1`,
    )
    .get(pathOrTitle, pathOrTitle, pathOrTitle) as Note | undefined
}

/**
 * Collects metadata for a single note from the database.
 *
 * @param db - Open SQLite database instance.
 * @param pathOrTitle - Vault-relative path, note title, or alias.
 * @returns A formatted metadata summary string, or an error message.
 */
function infoNote(db: Database, pathOrTitle: string): string {
  const note = db
    .prepare(
      `SELECT n.id, n.path, n.title, n.content, n.mtime FROM notes n
       LEFT JOIN aliases a ON a.note_id = n.id
       WHERE n.path = ? OR n.title = ? OR a.alias = ?
       LIMIT 1`,
    )
    .get(pathOrTitle, pathOrTitle, pathOrTitle) as
    | { id: number; path: string; title: string; content: string; mtime: number }
    | undefined

  if (!note) return `Note not found: ${pathOrTitle}`

  const aliases = (
    db.prepare('SELECT alias FROM aliases WHERE note_id = ? ORDER BY alias').all(note.id) as {
      alias: string
    }[]
  ).map((r) => r.alias)

  const tags = (
    db.prepare('SELECT tag FROM tags WHERE note_id = ? ORDER BY tag').all(note.id) as {
      tag: string
    }[]
  ).map((r) => r.tag)

  const properties = db
    .prepare(
      `SELECT key, value FROM properties
       WHERE note_id = ? AND key NOT IN ('tags', 'aliases')
       ORDER BY key`,
    )
    .all(note.id) as { key: string; value: string }[]

  const outgoingCount = (
    db.prepare('SELECT COUNT(*) AS cnt FROM links WHERE source_id = ?').get(note.id) as {
      cnt: number
    }
  ).cnt

  const backlinkCount = (
    db
      .prepare(
        'SELECT COUNT(DISTINCT source_id) AS cnt FROM links WHERE target_path = ? OR target_path = ?',
      )
      .get(note.title, note.path) as { cnt: number }
  ).cnt

  const wordCount = note.content.split(/\s+/).filter(Boolean).length
  const sizeBytes = Buffer.byteLength(note.content, 'utf8')
  const modified = new Date(note.mtime).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')

  const lines: string[] = [
    `title:          ${note.title}`,
    `path:           ${note.path}`,
    `modified:       ${modified}`,
    `size:           ${sizeBytes} bytes`,
    `words:          ${wordCount}`,
    `outgoing links: ${outgoingCount}`,
    `backlinks:      ${backlinkCount}`,
    `aliases:        ${aliases.length > 0 ? aliases.join(', ') : '—'}`,
    `tags:           ${tags.length > 0 ? tags.join(', ') : '—'}`,
  ]

  if (properties.length > 0) {
    lines.push('properties:')
    for (const { key, value } of properties) {
      let display: string
      try {
        const v = JSON.parse(value) as unknown
        display = Array.isArray(v) ? v.map(String).join(', ') : v === null ? '—' : String(v)
      } catch {
        display = value
      }
      lines.push(`  ${key}: ${display}`)
    }
  }

  return lines.join('\n')
}

/**
 * Extracts the heading structure from a note's content.
 *
 * @param db - Open SQLite database instance.
 * @param pathOrTitle - Vault-relative path, note title, or alias.
 * @returns Newline-separated heading lines, or an error/empty message.
 */
function outlineNote(db: Database, pathOrTitle: string): string {
  const note = readNote(db, pathOrTitle)
  if (!note) return `Note not found: ${pathOrTitle}`

  const headings = note.content
    .split('\n')
    .filter((line) => /^#{1,6}\s+/.test(line))
    .map((line) => line.trimEnd())

  if (headings.length === 0) return `No headings found in "${note.title}"`
  return headings.join('\n')
}

/**
 * Registers the `read_note` MCP tool on the given server.
 *
 * @param db - Open SQLite database instance.
 * @param server - MCP server instance to register the tool on.
 */
export function registerReadTools(db: Database, server: McpServer): void {
  server.registerTool(
    'read_note',
    {
      description: 'Read the full content of a note by its path or title',
      inputSchema: {
        path_or_title: z.string().describe('Exact file path (relative to vault) or note title'),
      },
    },
    async ({ path_or_title }) => {
      const note = readNote(db, path_or_title)
      if (!note) return { content: [{ type: 'text', text: `Note not found: ${path_or_title}` }] }
      return { content: [{ type: 'text', text: `# ${note.title}\n\n${note.content}` }] }
    },
  )

  server.registerTool(
    'info_note',
    {
      description:
        'Return metadata for a note: title, path, modified date, size, word count, ' +
        'outgoing links, backlinks, aliases, tags, and frontmatter properties',
      inputSchema: {
        path_or_title: z.string().describe('Vault-relative path, note title, or alias'),
      },
    },
    async ({ path_or_title }) => {
      const text = infoNote(db, path_or_title)
      return { content: [{ type: 'text', text }] }
    },
  )

  server.registerTool(
    'outline_note',
    {
      description: 'Return the heading structure of a note as a flat list of heading lines',
      inputSchema: {
        path_or_title: z.string().describe('Exact file path (relative to vault) or note title'),
      },
    },
    async ({ path_or_title }) => {
      const text = outlineNote(db, path_or_title)
      return { content: [{ type: 'text', text }] }
    },
  )

}

//TODO append-note
