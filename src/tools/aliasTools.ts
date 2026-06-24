
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import type { Database } from 'better-sqlite3'
import { z } from 'zod'


/**
 * Lists aliases stored in the vault, with optional filtering and output modes.
 *
 * @param db - Open SQLite database instance.
 * @param opts.file - Filter by note title (exact match).
 * @param opts.path - Filter by vault-relative path prefix.
 * @param opts.total - When true, return only the total count.
 * @param opts.verbose - When true, include the note path next to each alias.
 * @returns Count (when `total`), or array of alias entries.
 */
function listAliases(
  db: Database,
  opts: { file?: string; path?: string; total?: boolean; verbose?: boolean } = {},
): number | { alias: string; path?: string }[] {
  const conditions: string[] = []
  const params: string[] = []

  if (opts.file) {
    conditions.push('n.title = ?')
    params.push(opts.file)
  }
  if (opts.path) {
    conditions.push('n.path LIKE ?')
    params.push(`${opts.path}%`)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  if (opts.total) {
    const row = db
      .prepare(`SELECT COUNT(*) AS cnt FROM aliases a JOIN notes n ON n.id = a.note_id ${where}`)
      .get(...(params as [])) as { cnt: number }
    return row.cnt
  }

  const rows = db
    .prepare(
      `SELECT a.alias, n.path FROM aliases a
       JOIN notes n ON n.id = a.note_id
       ${where}
       ORDER BY a.alias`,
    )
    .all(...(params as [])) as { alias: string; path: string }[]

  return opts.verbose ? rows : rows.map((r) => ({ alias: r.alias }))
}


export function registerAliasesTools(db: Database, server: McpServer) {
      server.registerTool(
        'aliases',
        {
          description: 'List aliases defined in the vault, with optional filtering',
          inputSchema: {
            file: z.string().optional().describe('Filter by exact note title'),
            path: z.string().optional().describe('Filter by path prefix (relative to vault)'),
            total: z.boolean().optional().describe('Return only the total alias count'),
            verbose: z.boolean().optional().describe('Include file paths in the result'),
          },
        },
        async ({ file, path, total, verbose }) => {
          const result = listAliases(db, { file, path, total, verbose })
          if (typeof result === 'number') {
            return { content: [{ type: 'text', text: `Total aliases: ${result}` }] }
          }
          if (result.length === 0) return { content: [{ type: 'text', text: 'No aliases found.' }] }
          const text = result
            .map((r) => (r.path ? `- **${r.alias}** (${r.path})` : `- ${r.alias}`))
            .join('\n')
          return { content: [{ type: 'text', text }] }
        },
      )
    
}