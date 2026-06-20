import { resolve, join } from 'node:path'
import { openDatabase } from './db.js'
import { scanVault } from './indexer.js'
import { watchVault } from './watcher.js'
import { startServer } from './server.js'

/**
 * Parses the `--vault` and optional `--db` command-line arguments.
 *
 * Exits the process with a usage message if `--vault` is missing.
 *
 * @returns An object containing the resolved absolute paths for the vault
 *   directory and the SQLite database file.
 */
function parseArgs(): { vaultPath: string; dbPath: string } {
  const args = process.argv.slice(2)
  const vaultIdx = args.indexOf('--vault')
  if (vaultIdx === -1 || !args[vaultIdx + 1]) {
    console.error('Usage: obsidian-mcp --vault <path-to-vault> [--db <path-to-db>]')
    process.exit(1)
  }
  const vaultPath = resolve(args[vaultIdx + 1]!)

  const dbIdx = args.indexOf('--db')
  const dbPath =
    dbIdx !== -1 && args[dbIdx + 1] ? resolve(args[dbIdx + 1]!) : join(vaultPath, '.mcp-index.db')

  return { vaultPath, dbPath }
}

/**
 * Application entry point.
 *
 * Runs the startup sequence in order:
 * 1. Parse CLI arguments
 * 2. Open / initialize the SQLite database
 * 3. Full vault scan with delta detection
 * 4. Start the file system watcher
 * 5. Start the MCP server on stdio
 */
async function main(): Promise<void> {
  const { vaultPath, dbPath } = parseArgs()

  console.error(`[main] Vault: ${vaultPath}`)
  console.error(`[main] DB:    ${dbPath}`)

  const db = openDatabase(dbPath)

  await scanVault(db, vaultPath)
  watchVault(db, vaultPath)
  await startServer(db)
}

main().catch((err) => {
  console.error('[main] Fatal error:', err)
  process.exit(1)
})
