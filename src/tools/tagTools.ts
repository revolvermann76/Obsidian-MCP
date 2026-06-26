import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Database } from 'better-sqlite3'
import matter from 'gray-matter'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

/**
 * Finds all notes that carry a specific tag (frontmatter or inline body tag).
 *
 * @param db - Open SQLite database instance.
 * @param tag - Exact tag string to match against, without the leading `#`.
 * @returns Array of `{ path, title }` objects ordered by vault-relative path.
 */
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

/**
 * Returns all unique tags across the vault with their note counts.
 *
 * @param db - Open SQLite database instance.
 * @returns Array of `{ tag, count }` objects ordered by tag name.
 */
function listTags(db: Database): { tag: string; count: number }[] {
  return db
    .prepare('SELECT tag, COUNT(*) AS count FROM tags GROUP BY tag ORDER BY tag')
    .all() as { tag: string; count: number }[]
}

/**
 * Adds a tag to a note's frontmatter, updating both the file on disk and the database.
 *
 * The note is resolved by vault-relative path, title, or alias. Returns an error
 * result (without throwing) if the note is not found or the tag already exists.
 *
 * @param db - Open SQLite database instance.
 * @param vaultPath - Absolute path to the vault root.
 * @param noteRef - Note identifier: vault-relative path, title, or alias.
 * @param tag - Tag to add (without leading `#`).
 * @returns Object with `success` flag and a human-readable `message`.
 */
function addTag(
  db: Database,
  vaultPath: string,
  noteRef: string,
  tag: string,
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

  const exists = db.prepare('SELECT 1 FROM tags WHERE note_id = ? AND tag = ?').get(note.id, tag)
  if (exists) return { success: false, message: `Tag "${tag}" already exists on "${note.title}"` }

  const absPath = join(vaultPath, note.path)
  const raw = readFileSync(absPath, 'utf-8')
  const { data, content } = matter(raw)

  const current: string[] = Array.isArray(data['tags'])
    ? (data['tags'] as string[])
    : data['tags']
      ? [String(data['tags'])]
      : []
  data['tags'] = [...current, tag]

  writeFileSync(absPath, matter.stringify(content, data), 'utf-8')
  db.prepare('INSERT INTO tags (note_id, tag) VALUES (?, ?)').run(note.id, tag)

  return { success: true, message: `Added tag "${tag}" to "${note.title}"` }
}

/**
 * Removes a frontmatter tag from a note, updating both the file on disk and the database.
 *
 * Only frontmatter tags can be removed; inline body tags (`#tag`) require manual editing.
 * Returns an error result (without throwing) if the note is not found or the tag is not
 * present in the frontmatter.
 *
 * @param db - Open SQLite database instance.
 * @param vaultPath - Absolute path to the vault root.
 * @param noteRef - Note identifier: vault-relative path, title, or alias.
 * @param tag - Tag to remove (without leading `#`).
 * @returns Object with `success` flag and a human-readable `message`.
 */
function removeTag(
  db: Database,
  vaultPath: string,
  noteRef: string,
  tag: string,
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

  const exists = db.prepare('SELECT 1 FROM tags WHERE note_id = ? AND tag = ?').get(note.id, tag)
  if (!exists) return { success: false, message: `Tag "${tag}" not found on "${note.title}"` }

  const absPath = join(vaultPath, note.path)
  const raw = readFileSync(absPath, 'utf-8')
  const { data, content } = matter(raw)

  const current: string[] = Array.isArray(data['tags'])
    ? (data['tags'] as string[])
    : data['tags']
      ? [String(data['tags'])]
      : []

  if (!current.includes(tag)) {
    return {
      success: false,
      message: `Tag "${tag}" is an inline body tag on "${note.title}" and cannot be removed via this tool`,
    }
  }

  const updated = current.filter((t) => t !== tag)
  if (updated.length === 0) {
    delete data['tags']
  } else {
    data['tags'] = updated
  }

  writeFileSync(absPath, matter.stringify(content, data), 'utf-8')
  db.prepare('DELETE FROM tags WHERE note_id = ? AND tag = ?').run(note.id, tag)

  return { success: true, message: `Removed tag "${tag}" from "${note.title}"` }
}

/**
 * Registers the `tag_search`, `tag_list`, `tag_add`, and `tag_remove` MCP tools on the given server.
 *
 * @param db - Open SQLite database instance.
 * @param server - MCP server instance to register the tools on.
 * @param vaultPath - Absolute path to the vault root, required for on-disk frontmatter writes.
 */
export function registerTagTools(db: Database, server: McpServer, vaultPath: string): void {
  server.registerTool(
    'tag_search',
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

  server.registerTool(
    'tag_list',
    {
      description: 'List all tags in the vault with their note counts',
      inputSchema: {},
    },
    async () => {
      const tags = listTags(db)
      if (tags.length === 0) return { content: [{ type: 'text', text: 'No tags found.' }] }
      const text = tags.map((t) => `- ${t.tag} (${t.count})`).join('\n')
      return { content: [{ type: 'text', text }] }
    },
  )

  server.registerTool(
    'tag_add',
    {
      description: 'Add a tag to a note\'s frontmatter, updating both disk and the database',
      inputSchema: {
        note: z.string().describe('Note title, existing alias, or vault-relative path'),
        tag: z.string().describe('Tag to add (without leading #)'),
      },
    },
    async ({ note, tag }) => {
      const result = addTag(db, vaultPath, note, tag)
      return { content: [{ type: 'text', text: result.message }] }
    },
  )

  server.registerTool(
    'tag_remove',
    {
      description:
        'Remove a frontmatter tag from a note, updating both disk and the database. ' +
        'Inline body tags (#tag in content) cannot be removed via this tool.',
      inputSchema: {
        note: z.string().describe('Note title, existing alias, or vault-relative path'),
        tag: z.string().describe('Tag to remove (without leading #)'),
      },
    },
    async ({ note, tag }) => {
      const result = removeTag(db, vaultPath, note, tag)
      return { content: [{ type: 'text', text: result.message }] }
    },
  )
}
