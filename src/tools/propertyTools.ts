import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp'
import type { Database } from 'better-sqlite3'
import { z } from 'zod'

/**
 * Deserializes a JSON-encoded property value into a human-readable string.
 *
 * Arrays are joined with `, `. Null becomes an empty string. All other values
 * are coerced with `String()`. Falls back to the raw input if JSON parsing fails.
 *
 * @param json - JSON string as stored in the `properties` table.
 * @returns A display-ready string representation of the value.
 */
function formatValue(json: string): string {
  try {
    const v = JSON.parse(json) as unknown
    if (Array.isArray(v)) return v.map(String).join(', ')
    if (v === null) return ''
    return String(v)
  } catch {
    return json
  }
}

/**
 * Queries frontmatter properties from the database with optional filtering.
 *
 * Behaviour depends on which options are provided:
 * - `file` or `path` only — returns all properties for the matched note, formatted as `key: value` lines.
 * - `file`/`path` + `name` — returns the value of a single property for that note.
 * - `name` only — lists every note that has the property, with its value.
 * - No options — returns a sorted list of all unique property names in the vault.
 *
 * Note resolution accepts a vault-relative path, a note title, or an alias.
 *
 * @param db - Open SQLite database instance.
 * @param opts.file - Resolve note by title or alias.
 * @param opts.path - Resolve note by exact vault-relative path.
 * @param opts.name - Property key to look up.
 * @returns A formatted string ready to be returned as MCP tool output.
 */
function listProperties(
  db: Database,
  opts: { file?: string; path?: string; name?: string } = {},
): string {
  if (opts.file || opts.path) {
    const ref = opts.path ?? opts.file!
    const note = db
      .prepare(
        `SELECT n.id, n.title FROM notes n
         LEFT JOIN aliases a ON a.note_id = n.id
         WHERE n.path = ? OR n.title = ? OR a.alias = ?
         LIMIT 1`,
      )
      .get(ref, ref, ref) as { id: number; title: string } | undefined

    if (!note) return `Note not found: ${ref}`

    if (opts.name) {
      const row = db
        .prepare('SELECT value FROM properties WHERE note_id = ? AND key = ?')
        .get(note.id, opts.name) as { value: string } | undefined
      if (!row) return `Property "${opts.name}" not found in "${note.title}"`
      return `${opts.name}: ${formatValue(row.value)}`
    }

    const rows = db
      .prepare('SELECT key, value FROM properties WHERE note_id = ? ORDER BY key')
      .all(note.id) as { key: string; value: string }[]
    if (rows.length === 0) return `No properties found in "${note.title}"`
    return rows.map((r) => `${r.key}: ${formatValue(r.value)}`).join('\n')
  }

  if (opts.name) {
    const rows = db
      .prepare(
        `SELECT n.title, n.path, p.value
         FROM properties p JOIN notes n ON n.id = p.note_id
         WHERE p.key = ?
         ORDER BY n.path`,
      )
      .all(opts.name) as { title: string; path: string; value: string }[]
    if (rows.length === 0) return `No notes have property "${opts.name}"`
    return rows.map((r) => `- **${r.title}** (${r.path}): ${formatValue(r.value)}`).join('\n')
  }

  const rows = db
    .prepare('SELECT DISTINCT key FROM properties ORDER BY key')
    .all() as { key: string }[]
  if (rows.length === 0) return 'No properties found in vault.'
  return rows.map((r) => `- ${r.key}`).join('\n')
}

//TODO add-property
//TODO remove-property
//TODO update-property

/**
 * Registers the `list-properties` MCP tool on the given server.
 *
 * @param db - Open SQLite database instance.
 * @param server - MCP server instance to register the tool on.
 */
export function registerPropertyTools(db: Database, server: McpServer) {
  server.registerTool(
    'list-properties',
    {
      description:
        'List frontmatter properties indexed from the vault. ' +
        'Without filters, returns all unique property names. ' +
        'With file/path, returns all properties for that note. ' +
        'Add name to get the value of a specific property.',
      inputSchema: {
        file: z.string().optional().describe('Filter by note title'),
        path: z.string().optional().describe('Filter by vault-relative path'),
        name: z.string().optional().describe('Get a specific property by name'),
      },
    },
    async ({ file, path, name }) => {
      const text = listProperties(db, { file, path, name })
      return { content: [{ type: 'text', text }] }
    },
  )
}
