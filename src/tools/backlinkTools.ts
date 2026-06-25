import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Database } from 'better-sqlite3'
import { z } from 'zod'
import { readNote } from './noteTools.js'

/**
 * Finds all notes that contain a wikilink or markdown link pointing to the given note.
 *
 * Resolves the input against the database first to obtain the note's title; if no
 * match is found the raw input is used as the target. Both the resolved title and
 * the original input are matched against `links.target_path` so that links stored
 * as either a title or a path are caught.
 *
 * @param db - Open SQLite database instance.
 * @param pathOrTitle - Vault-relative path or title of the target note.
 * @returns Array of `{ path, title }` objects for every note that links to the target,
 *   ordered by path. Empty array when no backlinks exist.
 */
function getBacklinks(db: Database, pathOrTitle: string): { path: string; title: string }[] {
  const note = readNote(db, pathOrTitle)
  const target = note ? note.title : pathOrTitle

  return db
    .prepare(
      `SELECT DISTINCT n.path, n.title FROM links l
       JOIN notes n ON n.id = l.source_id
       WHERE l.target_path = ? OR l.target_path = ?
       ORDER BY n.path`,
    )
    .all(target, pathOrTitle) as { path: string; title: string }[]
}

/**
 * Registers the `get_backlinks` MCP tool on the given server.
 *
 * @param db - Open SQLite database instance.
 * @param server - MCP server instance to register the tool on.
 */
export function registerBacklinkTools(db: Database, server: McpServer): void {
  server.registerTool(
    'get_backlinks',
    {
      description: 'Find all notes that link to a given note',
      inputSchema: {
        path_or_title: z.string().describe('Path or title of the target note'),
      },
    },
    async ({ path_or_title }) => {
      const links = getBacklinks(db, path_or_title)
      if (links.length === 0)
        return { content: [{ type: 'text', text: `No backlinks found for: ${path_or_title}` }] }
      const text = links.map((n) => `- **${n.title}** (${n.path})`).join('\n')
      return { content: [{ type: 'text', text }] }
    },
  )
}
