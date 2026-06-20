import type { Database } from 'better-sqlite3'

interface Note {
  id: number
  path: string
  title: string
  content: string
}

export function searchNotes(
  db: Database,
  query: string,
  limit = 20,
): { path: string; title: string; snippet: string }[] {
  const rows = db
    .prepare(
      `SELECT n.path, n.title, snippet(notes_fts, 1, '**', '**', '...', 32) AS snippet
       FROM notes_fts
       JOIN notes n ON notes_fts.rowid = n.id
       WHERE notes_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
    )
    .all(query, limit) as { path: string; title: string; snippet: string }[]
  return rows
}

export function readNote(db: Database, pathOrTitle: string): Note | undefined {
  return (db
    .prepare('SELECT id, path, title, content FROM notes WHERE path = ? OR title = ? LIMIT 1')
    .get(pathOrTitle, pathOrTitle) as Note | undefined)
}

export function listNotes(
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
      .prepare(
        `SELECT path, title FROM notes WHERE path LIKE ? ORDER BY path`,
      )
      .all(`${opts.folder}/%`) as { path: string; title: string }[]
  }
  return db
    .prepare('SELECT path, title FROM notes ORDER BY path')
    .all() as { path: string; title: string }[]
}

export function getBacklinks(
  db: Database,
  pathOrTitle: string,
): { path: string; title: string }[] {
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

export function searchByTag(db: Database, tag: string): { path: string; title: string }[] {
  return db
    .prepare(
      `SELECT n.path, n.title FROM notes n
       JOIN tags t ON t.note_id = n.id
       WHERE t.tag = ?
       ORDER BY n.path`,
    )
    .all(tag) as { path: string; title: string }[]
}
