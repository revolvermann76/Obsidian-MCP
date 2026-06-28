import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp'
import type { Database } from 'better-sqlite3'
import matter from 'gray-matter'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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

type PropertyType = 'text' | 'number' | 'boolean' | 'list' | 'date' | 'json'

function parsePropertyValue(
  raw: string,
  type: PropertyType,
): { yaml: unknown; dbJson: string } | { error: string } {
  switch (type) {
    case 'text':
    case 'date':
      return { yaml: raw, dbJson: JSON.stringify(raw) }
    case 'number': {
      const n = Number(raw)
      if (isNaN(n)) return { error: `"${raw}" is not a valid number` }
      return { yaml: n, dbJson: JSON.stringify(n) }
    }
    case 'boolean':
      if (raw !== 'true' && raw !== 'false')
        return { error: `"${raw}" is not a valid boolean — use "true" or "false"` }
      return { yaml: raw === 'true', dbJson: raw }
    case 'list': {
      const items = raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      return { yaml: items, dbJson: JSON.stringify(items) }
    }
    case 'json': {
      try {
        const parsed = JSON.parse(raw) as unknown
        return { yaml: parsed, dbJson: JSON.stringify(parsed) }
      } catch {
        return { error: `"${raw}" is not valid JSON` }
      }
    }
  }
}

/**
 * Adds a new frontmatter property to a note, updating both the file on disk and the database.
 *
 * The note is resolved by vault-relative path, title, or alias. The raw string value is
 * coerced to the requested type before writing. Returns an error result (without throwing)
 * if the note is not found, the property already exists, or the value cannot be parsed.
 *
 * @param db - Open SQLite database instance.
 * @param vaultPath - Absolute path to the vault root.
 * @param noteRef - Note identifier: vault-relative path, title, or alias.
 * @param key - Frontmatter key to add.
 * @param rawValue - Raw string value to coerce.
 * @param type - Target type for coercion.
 * @returns Object with `success` flag and a human-readable `message`.
 */
function addProperty(
  db: Database,
  vaultPath: string,
  noteRef: string,
  key: string,
  rawValue: string,
  type: PropertyType,
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

  const alreadyExists = db
    .prepare('SELECT 1 FROM properties WHERE note_id = ? AND key = ?')
    .get(note.id, key)
  if (alreadyExists) return { success: false, message: `Property "${key}" already exists in "${note.title}"` }

  const parsed = parsePropertyValue(rawValue, type)
  if ('error' in parsed) return { success: false, message: parsed.error }

  const absPath = join(vaultPath, note.path)
  const raw = readFileSync(absPath, 'utf-8')
  const { data, content } = matter(raw)

  data[key] = parsed.yaml

  writeFileSync(absPath, matter.stringify(content, data), 'utf-8')
  db.prepare('INSERT INTO properties (note_id, key, value) VALUES (?, ?, ?)').run(note.id, key, parsed.dbJson)

  return { success: true, message: `Added property "${key}" to "${note.title}"` }
}

/**
 * Updates an existing frontmatter property on a note, updating both the file on disk and the database.
 *
 * The note is resolved by vault-relative path, title, or alias. The raw string value is
 * coerced to the requested type before writing. Returns an error result (without throwing)
 * if the note is not found, the property does not exist, or the value cannot be parsed.
 *
 * @param db - Open SQLite database instance.
 * @param vaultPath - Absolute path to the vault root.
 * @param noteRef - Note identifier: vault-relative path, title, or alias.
 * @param key - Frontmatter key to update.
 * @param rawValue - Raw string value to coerce.
 * @param type - Target type for coercion.
 * @returns Object with `success` flag and a human-readable `message`.
 */
function updateProperty(
  db: Database,
  vaultPath: string,
  noteRef: string,
  key: string,
  rawValue: string,
  type: PropertyType,
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

  const exists = db
    .prepare('SELECT 1 FROM properties WHERE note_id = ? AND key = ?')
    .get(note.id, key)
  if (!exists) return { success: false, message: `Property "${key}" not found in "${note.title}"` }

  const parsed = parsePropertyValue(rawValue, type)
  if ('error' in parsed) return { success: false, message: parsed.error }

  const absPath = join(vaultPath, note.path)
  const raw = readFileSync(absPath, 'utf-8')
  const { data, content } = matter(raw)

  data[key] = parsed.yaml

  writeFileSync(absPath, matter.stringify(content, data), 'utf-8')
  db.prepare('UPDATE properties SET value = ? WHERE note_id = ? AND key = ?').run(parsed.dbJson, note.id, key)

  return { success: true, message: `Updated property "${key}" in "${note.title}"` }
}

/**
 * Removes a frontmatter property from a note, updating both the file on disk and the database.
 *
 * The note is resolved by vault-relative path, title, or alias.
 * Returns an error result (without throwing) if the note or property is not found.
 *
 * @param db - Open SQLite database instance.
 * @param vaultPath - Absolute path to the vault root.
 * @param noteRef - Note identifier: vault-relative path, title, or alias.
 * @param key - Frontmatter key to remove.
 * @returns Object with `success` flag and a human-readable `message`.
 */
function removeProperty(
  db: Database,
  vaultPath: string,
  noteRef: string,
  key: string,
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

  const exists = db
    .prepare('SELECT 1 FROM properties WHERE note_id = ? AND key = ?')
    .get(note.id, key)
  if (!exists) return { success: false, message: `Property "${key}" not found in "${note.title}"` }

  const absPath = join(vaultPath, note.path)
  const raw = readFileSync(absPath, 'utf-8')
  const { data, content } = matter(raw)

  delete data[key]

  writeFileSync(absPath, matter.stringify(content, data), 'utf-8')
  db.prepare('DELETE FROM properties WHERE note_id = ? AND key = ?').run(note.id, key)

  return { success: true, message: `Removed property "${key}" from "${note.title}"` }
}

/**
 * Registers the `property_list`, `property_add`, and `property_remove` MCP tools on the given server.
 *
 * @param db - Open SQLite database instance.
 * @param server - MCP server instance to register the tools on.
 * @param vaultPath - Absolute path to the vault root, required for on-disk frontmatter writes.
 */
export function registerPropertyTools(db: Database, server: McpServer, vaultPath: string) {
  server.registerTool(
    'property_list',
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

  server.registerTool(
    'property_add',
    {
      description:
        'Add a frontmatter property to a note, updating both disk and the database. ' +
        'Fails if the property already exists.',
      inputSchema: {
        note: z.string().describe('Note title, existing alias, or vault-relative path'),
        name: z.string().describe('Frontmatter key to add'),
        value: z.string().describe('Value as a string; coerced according to type'),
        type: z
          .enum(['text', 'number', 'boolean', 'list', 'date', 'json'])
          .default('text')
          .describe(
            'Value type: text (default), number, boolean (true/false), ' +
              'list (comma-separated → array), date (YYYY-MM-DD), json (raw JSON string)',
          ),
      },
    },
    async ({ note, name, value, type }) => {
      const result = addProperty(db, vaultPath, note, name, value, type)
      return { content: [{ type: 'text', text: result.message }] }
    },
  )

  server.registerTool(
    'property_remove',
    {
      description: 'Remove a frontmatter property from a note, updating both disk and the database',
      inputSchema: {
        note: z.string().describe('Note title, existing alias, or vault-relative path'),
        name: z.string().describe('Frontmatter key to remove'),
      },
    },
    async ({ note, name }) => {
      const result = removeProperty(db, vaultPath, note, name)
      return { content: [{ type: 'text', text: result.message }] }
    },
  )

  server.registerTool(
    'property_update',
    {
      description:
        'Update an existing frontmatter property on a note, updating both disk and the database. ' +
        'Fails if the property does not already exist — use property_add to create it.',
      inputSchema: {
        note: z.string().describe('Note title, existing alias, or vault-relative path'),
        name: z.string().describe('Frontmatter key to update'),
        value: z.string().describe('New value as a string; coerced according to type'),
        type: z
          .enum(['text', 'number', 'boolean', 'list', 'date', 'json'])
          .default('text')
          .describe(
            'Value type: text (default), number, boolean (true/false), ' +
              'list (comma-separated → array), date (YYYY-MM-DD), json (raw JSON string)',
          ),
      },
    },
    async ({ note, name, value, type }) => {
      const result = updateProperty(db, vaultPath, note, name, value, type)
      return { content: [{ type: 'text', text: result.message }] }
    },
  )
}
