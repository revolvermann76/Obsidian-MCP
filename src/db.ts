import Database from 'better-sqlite3'
import type { Database as DB } from 'better-sqlite3'

export function openDatabase(dbPath: string): DB {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      path        TEXT    NOT NULL UNIQUE,
      title       TEXT    NOT NULL,
      content     TEXT    NOT NULL DEFAULT '',
      content_hash TEXT   NOT NULL DEFAULT '',
      mtime       INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS tags (
      note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      tag     TEXT    NOT NULL,
      PRIMARY KEY (note_id, tag)
    );

    CREATE TABLE IF NOT EXISTS links (
      source_id   INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      target_path TEXT    NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_path);

    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
      title,
      content,
      content='notes',
      content_rowid='id'
    );

    CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
      INSERT INTO notes_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
    END;

    CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
      INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES ('delete', old.id, old.title, old.content);
    END;

    CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
      INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES ('delete', old.id, old.title, old.content);
      INSERT INTO notes_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
    END;
  `)
  return db
}
