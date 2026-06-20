import chokidar from 'chokidar'
import type { Database } from 'better-sqlite3'
import { indexFile, removeFile } from './indexer.js'

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
