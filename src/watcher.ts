import chokidar from 'chokidar'
import type { Database } from 'better-sqlite3'
import { indexFile, removeFile } from './indexer.js'

/**
 * Starts a file system watcher on the vault and keeps the database in sync.
 *
 * Uses chokidar to watch all `*.md` files under `vaultPath`. Hidden files and
 * directories are ignored. Write-finish debouncing (300 ms stability threshold)
 * prevents partial reads on slow saves.
 *
 * The watcher runs persistently for the lifetime of the process — there is
 * intentionally no teardown path since the MCP server owns the process.
 *
 * @param db - Open SQLite database instance shared with the indexer.
 * @param vaultPath - Absolute path to the Obsidian vault root to watch.
 */
export function watchVault(db: Database, vaultPath: string): void {
  const watcher = chokidar.watch(`${vaultPath}/**/*.md`, {
    ignoreInitial: true,
    ignored: /(^|[/\\])\../,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  })

  watcher
    .on('add', (path) => {
      console.error(`[watcher] Added: ${path}`)
      indexFile(db, vaultPath, path)
    })
    .on('change', (path) => {
      console.error(`[watcher] Changed: ${path}`)
      indexFile(db, vaultPath, path)
    })
    .on('unlink', (path) => {
      console.error(`[watcher] Deleted: ${path}`)
      removeFile(db, vaultPath, path)
    })
    .on('error', (err) => console.error('[watcher] Error:', err))

  console.error(`[watcher] Watching ${vaultPath}`)
}
