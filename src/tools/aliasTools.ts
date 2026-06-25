import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp'
import type { Database } from 'better-sqlite3'
import matter from 'gray-matter'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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

/**
 * Adds a new alias to a note, updating both the frontmatter on disk and the database.
 *
 * The note is resolved by vault-relative path, title, or existing alias.
 * Returns an error result (without throwing) if the note is not found or the
 * alias already exists.
 *
 * @param db - Open SQLite database instance.
 * @param vaultPath - Absolute path to the vault root.
 * @param noteRef - Note identifier: vault-relative path, title, or existing alias.
 * @param newAlias - Alias to add.
 * @returns Object with `success` flag and a human-readable `message`.
 */
function addAlias(
  db: Database,
  vaultPath: string,
  noteRef: string,
  newAlias: string,
): { success: boolean; message: string } {
  const note = db
    .prepare(
      `SELECT n.id, n.path, n.title FROM notes n
       LEFT JOIN aliases a ON a.note_id = n.id
       WHERE n.path = ? OR n.title = ? OR a.alias = ?
       LIMIT 1`,
    )
    .get(noteRef, noteRef, noteRef) as { id: number; path: string; title: string } | undefined

  if (!note) return { success: false, message: `Note not found: ${noteRef}` }

  const exists = db.prepare('SELECT 1 FROM aliases WHERE note_id = ? AND alias = ?').get(note.id, newAlias)
  if (exists) return { success: false, message: `Alias "${newAlias}" already exists on "${note.title}"` }

  const absPath = join(vaultPath, note.path)
  const raw = readFileSync(absPath, 'utf-8')
  const { data, content } = matter(raw)

  const current: string[] = Array.isArray(data['aliases'])
    ? (data['aliases'] as string[])
    : data['aliases']
      ? [String(data['aliases'])]
      : []
  data['aliases'] = [...current, newAlias]

  writeFileSync(absPath, matter.stringify(content, data), 'utf-8')
  db.prepare('INSERT INTO aliases (note_id, alias) VALUES (?, ?)').run(note.id, newAlias)

  return { success: true, message: `Added alias "${newAlias}" to "${note.title}"` }
}

/**
 * Removes an alias from a note, updating both the frontmatter on disk and the database.
 *
 * The note is resolved by vault-relative path, title, or existing alias.
 * If removing the alias leaves the `aliases` list empty, the key is deleted
 * from the frontmatter entirely. Returns an error result (without throwing) if
 * the note or alias is not found.
 *
 * @param db - Open SQLite database instance.
 * @param vaultPath - Absolute path to the vault root.
 * @param noteRef - Note identifier: vault-relative path, title, or existing alias.
 * @param targetAlias - Alias to remove.
 * @returns Object with `success` flag and a human-readable `message`.
 */
function removeAlias(
  db: Database,
  vaultPath: string,
  noteRef: string,
  targetAlias: string,
): { success: boolean; message: string } {
  const note = db
    .prepare(
      `SELECT n.id, n.path, n.title FROM notes n
       LEFT JOIN aliases a ON a.note_id = n.id
       WHERE n.path = ? OR n.title = ? OR a.alias = ?
       LIMIT 1`,
    )
    .get(noteRef, noteRef, noteRef) as { id: number; path: string; title: string } | undefined

  if (!note) return { success: false, message: `Note not found: ${noteRef}` }

  const exists = db.prepare('SELECT 1 FROM aliases WHERE note_id = ? AND alias = ?').get(note.id, targetAlias)
  if (!exists) return { success: false, message: `Alias "${targetAlias}" not found on "${note.title}"` }

  const absPath = join(vaultPath, note.path)
  const raw = readFileSync(absPath, 'utf-8')
  const { data, content } = matter(raw)

  const current: string[] = Array.isArray(data['aliases'])
    ? (data['aliases'] as string[])
    : data['aliases']
      ? [String(data['aliases'])]
      : []
  const updated = current.filter((a) => a !== targetAlias)
  if (updated.length === 0) {
    delete data['aliases']
  } else {
    data['aliases'] = updated
  }

  writeFileSync(absPath, matter.stringify(content, data), 'utf-8')
  db.prepare('DELETE FROM aliases WHERE note_id = ? AND alias = ?').run(note.id, targetAlias)

  return { success: true, message: `Removed alias "${targetAlias}" from "${note.title}"` }
}

/**
 * Registers the `list-aliases`, `add-alias`, and `remove-alias` MCP tools on the given server.
 *
 * @param db - Open SQLite database instance.
 * @param server - MCP server instance to register the tools on.
 * @param vaultPath - Absolute path to the vault root, required for on-disk frontmatter writes.
 */
export function registerAliasesTools(db: Database, server: McpServer, vaultPath: string) {
  server.registerTool(
    'list_aliases',
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

  server.registerTool(
    'add_alias',
    {
      description: 'Add an alias to a note, identified by its title, existing alias, or path',
      inputSchema: {
        note: z.string().describe('Note title, existing alias, or vault-relative path'),
        alias: z.string().describe('New alias to add'),
      },
    },
    async ({ note, alias }) => {
      const result = addAlias(db, vaultPath, note, alias)
      return { content: [{ type: 'text', text: result.message }] }
    },
  )

  server.registerTool(
    'remove_alias',
    {
      description: 'Remove an alias from a note, identified by its title, existing alias, or path',
      inputSchema: {
        note: z.string().describe('Note title, existing alias, or vault-relative path'),
        alias: z.string().describe('Alias to remove'),
      },
    },
    async ({ note, alias }) => {
      const result = removeAlias(db, vaultPath, note, alias)
      return { content: [{ type: 'text', text: result.message }] }
    },
  )
}
