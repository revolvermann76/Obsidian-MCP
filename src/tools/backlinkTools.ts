import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Database } from 'better-sqlite3'
import { z } from 'zod'
import { readNote } from './readTools.js'

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
