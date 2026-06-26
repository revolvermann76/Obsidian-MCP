import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Database } from 'better-sqlite3'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { indexFile } from '../indexer.js'
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
 * Converts a JSON-serialized property value back to a YAML-safe scalar string.
 *
 * Values stored in the `properties` table are JSON strings. This function
 * parses them and formats each type appropriately for inline YAML output:
 * arrays use flow sequence syntax, strings containing YAML special characters
 * are double-quoted, and primitives are stringified as-is.
 *
 * @param json - JSON string as stored in the `properties` table.
 * @returns A YAML-safe string representation of the value.
 */
function formatYamlValue(json: string): string {
  try {
    const v = JSON.parse(json) as unknown
    if (v === null) return 'null'
    if (typeof v === 'boolean' || typeof v === 'number') return String(v)
    if (Array.isArray(v)) return `[${v.map(String).join(', ')}]`
    const s = String(v)
    return /[:#\[\]{}&*!|>'"@`]/.test(s) || s.includes('\n') ? `"${s.replace(/"/g, '\\"')}"` : s
  } catch {
    return json
  }
}

/**
 * Reconstructs a YAML frontmatter block from the `properties` table for a note.
 *
 * @param db - Open SQLite database instance.
 * @param noteId - Primary key of the note in the `notes` table.
 * @returns A `---`-delimited YAML frontmatter string, or an empty string if the
 *   note has no stored properties.
 */
function buildFrontmatter(db: Database, noteId: number): string {
  const rows = db
    .prepare('SELECT key, value FROM properties WHERE note_id = ? ORDER BY key')
    .all(noteId) as { key: string; value: string }[]
  if (rows.length === 0) return ''
  return `---\n${rows.map((r) => `${r.key}: ${formatYamlValue(r.value)}`).join('\n')}\n---`
}

/**
 * Finds all notes that contain a wikilink or markdown link pointing to the given note.
 *
 * Resolves the input against the database first to obtain the note's title; if no
 * match is found the raw input is used as the target. Both the resolved title and
 * the original input are matched against `links.target_path` so that links stored
 * as either a title or a path are caught.
 *
 * @param db - Open SQLite database instance.
 * @param pathOrTitle - Vault-relative path, title, or alias of the target note.
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
 * Returns all outgoing links from a note, resolved against the notes table where possible.
 *
 * Each `target_path` stored in the `links` table is matched against both note paths
 * and titles. Unresolvable links (dead links) are included with `title` and `path` as
 * `null` so callers can format them differently.
 *
 * @param db - Open SQLite database instance.
 * @param pathOrTitle - Vault-relative path, title, or alias of the source note.
 * @returns Object with the source `note` (or `undefined` if not found) and an
 *   array of `{ targetPath, title, path }` entries ordered by `target_path`.
 */
function getOutgoingLinks(
  db: Database,
  pathOrTitle: string,
): {
  note: { id: number; title: string } | undefined
  links: { targetPath: string; title: string | null; path: string | null }[]
} {
  const note = db
    .prepare(
      `SELECT n.id, n.title FROM notes n
       LEFT JOIN aliases a ON a.note_id = n.id
       WHERE n.path = ? OR n.title = ? OR a.alias = ?
       LIMIT 1`,
    )
    .get(pathOrTitle, pathOrTitle, pathOrTitle) as { id: number; title: string } | undefined

  if (!note) return { note: undefined, links: [] }

  const rows = db
    .prepare(
      `SELECT l.target_path, n.title, n.path
       FROM links l
       LEFT JOIN notes n ON n.path = l.target_path OR n.title = l.target_path
       WHERE l.source_id = ?
       ORDER BY l.target_path`,
    )
    .all(note.id) as { target_path: string; title: string | null; path: string | null }[]

  return {
    note,
    links: rows.map((r) => ({ targetPath: r.target_path, title: r.title, path: r.path })),
  }
}

/**
 * Lists notes from the database with optional filtering by folder or tag.
 *
 * When `tag` is provided it takes precedence over `folder`. Without any filter
 * all notes are returned, ordered by vault-relative path.
 *
 * @param db - Open SQLite database instance.
 * @param opts.folder - Vault-relative folder prefix to filter by (e.g. `"projects"`).
 * @param opts.tag - Exact tag string to filter by (frontmatter or inline).
 * @returns Array of `{ path, title }` objects ordered by path.
 */
function listNotes(
  db: Database,
  opts: { folder?: string; tag?: string } = {},
): { path: string; title: string }[] {
  if (opts.tag) {
    return db
      .prepare(
        `SELECT n.path, n.title FROM notes n
         JOIN tags t ON t.note_id = n.id
         WHERE t.tag = ?
         ORDER BY n.path`,
      )
      .all(opts.tag) as { path: string; title: string }[]
  }
  if (opts.folder) {
    return db
      .prepare(`SELECT path, title FROM notes WHERE path LIKE ? ORDER BY path`)
      .all(`${opts.folder}/%`) as { path: string; title: string }[]
  }
  return db.prepare('SELECT path, title FROM notes ORDER BY path').all() as {
    path: string
    title: string
  }[]
}

/**
 * Returns all notes that have no outgoing links (wikilinks or MD links).
 *
 * @param db - Open SQLite database instance.
 * @returns Array of `{ path, title }` objects ordered by path.
 */
function deadendNotes(db: Database): { path: string; title: string }[] {
  return db
    .prepare(
      `SELECT path, title FROM notes
       WHERE id NOT IN (SELECT DISTINCT source_id FROM links)
       ORDER BY path`,
    )
    .all() as { path: string; title: string }[]
}

/**
 * Returns all notes that have no incoming links from any other note.
 *
 * Mirrors the backlink resolution logic: a note is considered "linked to" if
 * its title OR its vault-relative path appears as a `target_path` in the links table.
 *
 * @param db - Open SQLite database instance.
 * @returns Array of `{ path, title }` objects ordered by path.
 */
function orphanNotes(db: Database): { path: string; title: string }[] {
  return db
    .prepare(
      `SELECT path, title FROM notes
       WHERE path NOT IN (SELECT target_path FROM links)
         AND title NOT IN (SELECT target_path FROM links)
       ORDER BY path`,
    )
    .all() as { path: string; title: string }[]
}

/**
 * Returns all notes that are both orphans (no incoming links) and dead ends (no outgoing links).
 *
 * @param db - Open SQLite database instance.
 * @returns Array of `{ path, title }` objects ordered by path.
 */
function aloneNotes(db: Database): { path: string; title: string }[] {
  return db
    .prepare(
      `SELECT path, title FROM notes
       WHERE id NOT IN (SELECT DISTINCT source_id FROM links)
         AND path NOT IN (SELECT target_path FROM links)
         AND title NOT IN (SELECT target_path FROM links)
       ORDER BY path`,
    )
    .all() as { path: string; title: string }[]
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
 * Registers the `note_read` MCP tool on the given server.
 *
 * @param db - Open SQLite database instance.
 * @param server - MCP server instance to register the tool on.
 */
export function registerNoteTools(db: Database, server: McpServer, vaultPath: string): void {
  server.registerTool(
    'note_read',
    {
      description: 'Read the full content of a note by its path or title',
      inputSchema: {
        path_or_title: z.string().describe('Vault-relative path, note title, or alias'),
        show_filename: z.boolean().optional().describe('Prepend the vault-relative file path (default: false)'),
        show_frontmatter: z.boolean().optional().describe('Prepend the reconstructed YAML frontmatter block (default: false)'),
      },
    },
    async ({ path_or_title, show_filename, show_frontmatter }) => {
      const note = readNote(db, path_or_title)
      if (!note) return { content: [{ type: 'text', text: `Note not found: ${path_or_title}` }] }
      const parts: string[] = []
      if (show_filename) parts.push(note.path)
      if (show_frontmatter) {
        const fm = buildFrontmatter(db, note.id)
        if (fm) parts.push(fm)
      }
      parts.push(note.content)
      return { content: [{ type: 'text', text: parts.join('\n\n') }] }
    },
  )

  server.registerTool(
    'note_info',
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
    'note_outline',
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

  server.registerTool(
    'note_get_backlinks',
    {
      description: 'Find all notes that link to a given note',
      inputSchema: {
        path_or_title: z.string().describe('Vault-relative path, title, or alias of the target note'),
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

  server.registerTool(
    'note_get_links',
    {
      description: 'Find all outgoing links in a note (wikilinks and markdown links)',
      inputSchema: {
        path_or_title: z.string().describe('Vault-relative path, title, or alias of the source note'),
      },
    },
    async ({ path_or_title }) => {
      const { note, links } = getOutgoingLinks(db, path_or_title)
      if (!note) return { content: [{ type: 'text', text: `Note not found: ${path_or_title}` }] }
      if (links.length === 0)
        return { content: [{ type: 'text', text: `No outgoing links found in: ${path_or_title}` }] }
      const text = links
        .map((l) =>
          l.title && l.path
            ? `- **${l.title}** (${l.path})`
            : `- *${l.targetPath}* (not found)`,
        )
        .join('\n')
      return { content: [{ type: 'text', text }] }
    },
  )

  server.registerTool(
    'note_append',
    {
      description: 'Append markdown content to the end of a note, updating both disk and the database',
      inputSchema: {
        path_or_title: z.string().describe('Vault-relative path, note title, or alias'),
        content: z.string().describe('Markdown content to append'),
      },
    },
    async ({ path_or_title, content }) => {
      const note = readNote(db, path_or_title)
      if (!note) return { content: [{ type: 'text', text: `Note not found: ${path_or_title}` }] }

      const absPath = join(vaultPath, note.path)
      const raw = readFileSync(absPath, 'utf-8')
      writeFileSync(absPath, raw.trimEnd() + '\n\n' + content + '\n', 'utf-8')
      indexFile(db, vaultPath, absPath)

      return { content: [{ type: 'text', text: `Appended content to "${note.title}"` }] }
    },
  )

  server.registerTool(
    'note_create',
    {
      description:
        'Create a new note in the vault. ' +
        'Without a folder the note is created in the vault root. ' +
        'Missing folders are created automatically.',
      inputSchema: {
        name: z.string().describe('Note filename (with or without .md extension)'),
        folder: z.string().optional().describe('Vault-relative folder path (created if absent)'),
        content: z.string().optional().describe('Initial markdown content (default: empty)'),
        overwrite: z.boolean().optional().describe('Overwrite the note if it already exists (default: false)'),
      },
    },
    async ({ name, folder, content, overwrite }) => {
      const filename = name.endsWith('.md') ? name : `${name}.md`
      const relPath = folder ? `${folder}/${filename}` : filename
      const absPath = join(vaultPath, relPath)

      if (existsSync(absPath) && !overwrite)
        return { content: [{ type: 'text', text: `Note already exists: ${relPath}` }] }

      mkdirSync(dirname(absPath), { recursive: true })
      writeFileSync(absPath, content ?? '', 'utf-8')
      indexFile(db, vaultPath, absPath)

      return { content: [{ type: 'text', text: `${overwrite ? 'Overwrote' : 'Created'} note: ${relPath}` }] }
    },
  )

  server.registerTool(
    'note_delete',
    {
      description:
        'Delete a note from the vault by path, title, or alias. ' +
        'If a title or alias is given and multiple notes match, the deletion is refused — use the exact vault-relative path instead.',
      inputSchema: {
        note: z.string().describe('Vault-relative path, note title, or alias'),
      },
    },
    async ({ note: ref }) => {
      // Path match: unambiguous, delete directly
      const byPath = db
        .prepare('SELECT id, path, title FROM notes WHERE path = ?')
        .get(ref) as { id: number; path: string; title: string } | undefined

      if (byPath) {
        unlinkSync(join(vaultPath, byPath.path))
        db.prepare('DELETE FROM notes WHERE id = ?').run(byPath.id)
        return { content: [{ type: 'text', text: `Deleted "${byPath.title}" (${byPath.path})` }] }
      }

      // Title / alias match: guard against ambiguity
      const matches = db
        .prepare(
          `SELECT DISTINCT n.id, n.path, n.title FROM notes n
           LEFT JOIN aliases a ON a.note_id = n.id
           WHERE n.title = ? OR a.alias = ?`,
        )
        .all(ref, ref) as { id: number; path: string; title: string }[]

      if (matches.length === 0)
        return { content: [{ type: 'text', text: `Note not found: ${ref}` }] }

      if (matches.length > 1) {
        const list = matches.map((m) => `  - ${m.path}`).join('\n')
        return {
          content: [
            {
              type: 'text',
              text: `Multiple notes match "${ref}" — use the exact path to delete:\n${list}`,
            },
          ],
        }
      }

      const target = matches[0]!
      unlinkSync(join(vaultPath, target.path))
      db.prepare('DELETE FROM notes WHERE id = ?').run(target.id)
      return { content: [{ type: 'text', text: `Deleted "${target.title}" (${target.path})` }] }
    },
  )

  server.registerTool(
    'note_list',
    {
      description: 'List all notes, optionally filtered by subfolder or tag',
      inputSchema: {
        folder: z.string().optional().describe('Subfolder path relative to vault root'),
        tag: z.string().optional().describe('Frontmatter tag to filter by'),
      },
    },
    async ({ folder, tag }) => {
      const notes = listNotes(db, { folder, tag })
      if (notes.length === 0) return { content: [{ type: 'text', text: 'No notes found.' }] }
      const text = notes.map((n) => `- **${n.title}** (${n.path})`).join('\n')
      return { content: [{ type: 'text', text }] }
    },
  )

  server.registerTool(
    'note_deadends',
    {
      description: 'List all notes that have no outgoing links (wikilinks or markdown links)',
      inputSchema: {},
    },
    async () => {
      const notes = deadendNotes(db)
      if (notes.length === 0) return { content: [{ type: 'text', text: 'No dead-end notes found.' }] }
      const text = notes.map((n) => `- **${n.title}** (${n.path})`).join('\n')
      return { content: [{ type: 'text', text }] }
    },
  )

  server.registerTool(
    'note_orphans',
    {
      description: 'List all notes that no other note links to',
      inputSchema: {},
    },
    async () => {
      const notes = orphanNotes(db)
      if (notes.length === 0) return { content: [{ type: 'text', text: 'No orphan notes found.' }] }
      const text = notes.map((n) => `- **${n.title}** (${n.path})`).join('\n')
      return { content: [{ type: 'text', text }] }
    },
  )

  server.registerTool(
    'note_alones',
    {
      description: 'List all notes that have neither incoming nor outgoing links (orphan + dead end)',
      inputSchema: {},
    },
    async () => {
      const notes = aloneNotes(db)
      if (notes.length === 0) return { content: [{ type: 'text', text: 'No alone notes found.' }] }
      const text = notes.map((n) => `- **${n.title}** (${n.path})`).join('\n')
      return { content: [{ type: 'text', text }] }
    },
  )
}
