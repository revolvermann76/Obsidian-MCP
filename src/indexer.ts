import { readFile, readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type { Database } from 'better-sqlite3'
import { parseNote } from './parser.js'

/**
 * Performs a full scan of the vault and synchronizes it with the database.
 *
 * Walks the vault directory recursively, parses every `.md` file, and upserts
 * changed notes (detected via SHA-1 hash comparison). Notes whose files have
 * been deleted since the last scan are removed from the database.
 *
 * @param db - Open SQLite database instance.
 * @param vaultPath - Absolute path to the Obsidian vault root.
 */
export async function scanVault(db: Database, vaultPath: string): Promise<void> {
  console.error('[indexer] Scanning vault...')
  const files = await collectMarkdownFiles(vaultPath)
  console.error(`[indexer] Found ${files.length} markdown files`)

  const existingRows = db.prepare('SELECT path, content_hash FROM notes').all() as {
    path: string
    content_hash: string
  }[]
  const existingMap = new Map(existingRows.map((r) => [r.path, r.content_hash]))
  const seenPaths = new Set<string>()

  const upsert = db.transaction((relPath: string, raw: string, mtime: number) => {
    const parsed = parseNote(raw, relPath)
    console.error(`[indexer] Indexing ${relPath} (hash: ${parsed.hash})`, JSON.stringify(parsed, null, 2));
    const existing = existingMap.get(relPath)

    if (existing === parsed.hash) return

    const noteId = upsertNote(db, relPath, parsed, mtime)
    upsertTags(db, noteId, parsed.tags)
    upsertAliases(db, noteId, parsed.aliases)
    upsertLinks(db, noteId, parsed.links)
  })

  for (const absPath of files) {
    const relPath = relative(vaultPath, absPath)
    seenPaths.add(relPath)
    try {
      const [raw, fileStat] = await Promise.all([readFile(absPath, 'utf-8'), stat(absPath)])
      upsert(relPath, raw, Math.floor(fileStat.mtimeMs))
    } catch (err) {
      console.error(`[indexer] Failed to index ${relPath}:`, err)
    }
  }

  const toDelete = existingRows.filter((r) => !seenPaths.has(r.path))
  const del = db.prepare('DELETE FROM notes WHERE path = ?')
  for (const row of toDelete) {
    del.run(row.path)
    console.error(`[indexer] Removed deleted note: ${row.path}`)
  }

  console.error('[indexer] Scan complete')
}

/**
 * Indexes (or re-indexes) a single file into the database.
 *
 * Reads the file synchronously — this is intentional so the watcher callback
 * stays simple and free of async state. Tags and links are fully replaced on
 * every call.
 *
 * @param db - Open SQLite database instance.
 * @param vaultPath - Absolute path to the vault root (used to compute relative paths).
 * @param absPath - Absolute path to the markdown file to index.
 */
export function indexFile(db: Database, vaultPath: string, absPath: string): void {
  const relPath = relative(vaultPath, absPath)
  try {
    const raw = require('node:fs').readFileSync(absPath, 'utf-8')
    const fileStat = require('node:fs').statSync(absPath)
    const parsed = parseNote(raw, relPath)
    const noteId = upsertNote(db, relPath, parsed, Math.floor(fileStat.mtimeMs))
    upsertTags(db, noteId, parsed.tags)
    upsertAliases(db, noteId, parsed.aliases)
    upsertLinks(db, noteId, parsed.links)
  } catch (err) {
    console.error(`[indexer] Failed to index ${relPath}:`, err)
  }
}

/**
 * Removes a note from the database when its file has been deleted.
 *
 * Cascade deletes on `tags` and `links` are handled by the database schema.
 *
 * @param db - Open SQLite database instance.
 * @param vaultPath - Absolute path to the vault root.
 * @param absPath - Absolute path to the deleted markdown file.
 */
export function removeFile(db: Database, vaultPath: string, absPath: string): void {
  const relPath = relative(vaultPath, absPath)
  db.prepare('DELETE FROM notes WHERE path = ?').run(relPath)
}

/**
 * Inserts a new note row or updates the existing one if the path is already known.
 *
 * @param db - Open SQLite database instance.
 * @param relPath - Vault-relative file path (used as the unique key).
 * @param parsed - Parsed note data produced by {@link parseNote}.
 * @param mtime - File modification time in milliseconds since epoch.
 * @returns The `id` of the inserted or updated `notes` row.
 */
function upsertNote(
  db: Database,
  relPath: string,
  parsed: ReturnType<typeof parseNote>,
  mtime: number,
): number {
  const existing = db.prepare('SELECT id FROM notes WHERE path = ?').get(relPath) as
    | { id: number }
    | undefined

  if (existing) {
    db.prepare(
      'UPDATE notes SET title=?, content=?, content_hash=?, mtime=? WHERE id=?',
    ).run(parsed.title, parsed.content, parsed.hash, mtime, existing.id)
    return existing.id
  } else {
    const result = db
      .prepare('INSERT INTO notes (path, title, content, content_hash, mtime) VALUES (?,?,?,?,?)')
      .run(relPath, parsed.title, parsed.content, parsed.hash, mtime)
    return result.lastInsertRowid as number
  }
}

/**
 * Replaces all tag rows for a note with the current set of tags.
 *
 * Deletes existing tags first to handle renames and removals correctly.
 *
 * @param db - Open SQLite database instance.
 * @param noteId - Primary key of the note in the `notes` table.
 * @param tags - Current list of tags from the frontmatter.
 */
function upsertTags(db: Database, noteId: number, tags: string[]): void {
  db.prepare('DELETE FROM tags WHERE note_id = ?').run(noteId)
  const insert = db.prepare('INSERT INTO tags (note_id, tag) VALUES (?, ?)')
  for (const tag of tags) {
    insert.run(noteId, tag)
  }
}

function upsertAliases(db: Database, noteId: number, aliases: string[]): void {
  db.prepare('DELETE FROM aliases WHERE note_id = ?').run(noteId)
  const insert = db.prepare('INSERT INTO aliases (note_id, alias) VALUES (?, ?)')
  for (const alias of aliases) {
    insert.run(noteId, alias)
  }
}

/**
 * Replaces all link rows for a note with the current set of outgoing links.
 *
 * Deletes existing links first to handle edits and removals correctly.
 *
 * @param db - Open SQLite database instance.
 * @param noteId - Primary key of the note in the `notes` table.
 * @param links - Current list of link targets extracted from the note body.
 */
function upsertLinks(db: Database, noteId: number, links: string[]): void {
  db.prepare('DELETE FROM links WHERE source_id = ?').run(noteId)
  const insert = db.prepare('INSERT INTO links (source_id, target_path) VALUES (?, ?)')
  for (const link of links) {
    insert.run(noteId, link)
  }
}

/**
 * Recursively collects all `.md` file paths under a directory.
 *
 * Hidden directories and files (names starting with `.`) are skipped so that
 * the SQLite database stored inside the vault is not accidentally indexed.
 *
 * @param dir - Absolute path of the directory to walk.
 * @returns A flat array of absolute paths to all markdown files found.
 */
async function collectMarkdownFiles(dir: string): Promise<string[]> {
  const results: string[] = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...(await collectMarkdownFiles(full)))
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(full)
    }
  }
  return results
}
