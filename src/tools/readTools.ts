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
}
