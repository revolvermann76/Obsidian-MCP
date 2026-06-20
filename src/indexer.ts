import { readFile, readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type { Database } from 'better-sqlite3'
import { parseNote } from './parser.js'

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
    const existing = existingMap.get(relPath)

    if (existing === parsed.hash) return

    const noteId = upsertNote(db, relPath, parsed, mtime)
    upsertTags(db, noteId, parsed.tags)
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

  // Remove deleted notes
  const toDelete = existingRows.filter((r) => !seenPaths.has(r.path))
  const del = db.prepare('DELETE FROM notes WHERE path = ?')
  for (const row of toDelete) {
    del.run(row.path)
    console.error(`[indexer] Removed deleted note: ${row.path}`)
  }

  console.error('[indexer] Scan complete')
}

export function indexFile(db: Database, vaultPath: string, absPath: string): void {
  const relPath = relative(vaultPath, absPath)
  try {
    const raw = require('node:fs').readFileSync(absPath, 'utf-8')
    const fileStat = require('node:fs').statSync(absPath)
    const parsed = parseNote(raw, relPath)
    const noteId = upsertNote(db, relPath, parsed, Math.floor(fileStat.mtimeMs))
    upsertTags(db, noteId, parsed.tags)
    upsertLinks(db, noteId, parsed.links)
  } catch (err) {
    console.error(`[indexer] Failed to index ${relPath}:`, err)
  }
}

export function removeFile(db: Database, vaultPath: string, absPath: string): void {
  const relPath = relative(vaultPath, absPath)
  db.prepare('DELETE FROM notes WHERE path = ?').run(relPath)
}

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

function upsertTags(db: Database, noteId: number, tags: string[]): void {
  db.prepare('DELETE FROM tags WHERE note_id = ?').run(noteId)
  const insert = db.prepare('INSERT INTO tags (note_id, tag) VALUES (?, ?)')
  for (const tag of tags) {
    insert.run(noteId, tag)
  }
}

function upsertLinks(db: Database, noteId: number, links: string[]): void {
  db.prepare('DELETE FROM links WHERE source_id = ?').run(noteId)
  const insert = db.prepare('INSERT INTO links (source_id, target_path) VALUES (?, ?)')
  for (const link of links) {
    insert.run(noteId, link)
  }
}

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
