import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Database } from 'better-sqlite3'
import { z } from 'zod'

function searchByTag(db: Database, tag: string): { path: string; title: string }[] {
  return db
    .prepare(
      `SELECT n.path, n.title FROM notes n
       JOIN tags t ON t.note_id = n.id
       WHERE t.tag = ?
       ORDER BY n.path`,
    )
    .all(tag) as { path: string; title: string }[]
}

export function registerTagTools(db: Database, server: McpServer): void {
  server.registerTool(
    'search_by_tag',
    {
      description: 'Find all notes that have a specific frontmatter tag',
      inputSchema: {
        tag: z.string().describe('Tag name (without #)'),
      },
    },
    async ({ tag }) => {
      const notes = searchByTag(db, tag)
      if (notes.length === 0)
        return { content: [{ type: 'text', text: `No notes with tag: ${tag}` }] }
      const text = notes.map((n) => `- **${n.title}** (${n.path})`).join('\n')
      return { content: [{ type: 'text', text }] }
    },
  )
}
