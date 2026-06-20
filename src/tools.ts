import type { Database } from 'better-sqlite3'

/**
 * A fully loaded note including its body content.
 */
interface Note {
  id: number
  path: string
  title: string
  content: string
}

/**
 * Performs a fulltext search over all indexed notes using SQLite FTS5.
 *
 * Returns results ordered by relevance (`rank`). Each result includes a
 * highlighted snippet with matched terms wrapped in `**...**`.
 *
 * @param db - Open SQLite database instance.
 * @param query - FTS5 query string (supports `AND`, `OR`, prefix `*`, phrase `"..."` etc.).
 * @param limit - Maximum number of results to return. Defaults to `20`.
 * @returns Array of matching notes with path, title, and a context snippet.
 */
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

/**
 * Reads the full content of a note by its vault-relative path or its title.
 *
 * The lookup is case-sensitive and tries an exact match on `path` first,
 * then on `title`.
 *
 * @param db - Open SQLite database instance.
 * @param pathOrTitle - Vault-relative file path (e.g. `folder/Note.md`) or exact note title.
 * @returns The matching {@link Note}, or `undefined` if no note was found.
 */
export function readNote(db: Database, pathOrTitle: string): Note | undefined {
  return (db
    .prepare('SELECT id, path, title, content FROM notes WHERE path = ? OR title = ? LIMIT 1')
    .get(pathOrTitle, pathOrTitle) as Note | undefined)
}

/**
 * Lists notes in the vault, with optional filtering by subfolder or tag.
 *
 * When both `folder` and `tag` are provided, `tag` takes precedence.
 * Without any filter, all notes are returned sorted by path.
 *
 * @param db - Open SQLite database instance.
 * @param opts.folder - Vault-relative folder prefix (e.g. `projects`). Matched with `LIKE folder/%`.
 * @param opts.tag - Frontmatter tag to filter by (exact match).
 * @returns Array of `{ path, title }` objects sorted by path.
 */
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

/**
 * Finds all notes that link to the given note (backlinks).
 *
 * Resolves `pathOrTitle` to a note first and uses its title as the primary
 * lookup key, since wikilinks are stored by title (e.g. `[[Note Title]]`).
 * Also checks against the raw `pathOrTitle` string as a fallback for
 * markdown links that store a relative path.
 *
 * @param db - Open SQLite database instance.
 * @param pathOrTitle - Vault-relative path or title of the target note.
 * @returns Array of `{ path, title }` objects representing notes that link to the target.
 */
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

/**
 * Returns all notes that carry a specific frontmatter tag.
 *
 * The tag is matched exactly (case-sensitive) against values stored in the
 * `tags` table, which are normalized at index time by {@link parseNote}.
 *
 * @param db - Open SQLite database instance.
 * @param tag - Tag name to search for (without `#` prefix).
 * @returns Array of `{ path, title }` objects sorted by path.
 */
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
