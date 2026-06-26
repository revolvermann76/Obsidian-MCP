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
function parseArgs(): { vaultPath: string; dbPath: string; transport: 'stdio' | 'http'; port: number } {
  const args = process.argv.slice(2)
  const vaultIdx = args.indexOf('--vault')
  if (vaultIdx === -1 || !args[vaultIdx + 1]) {
    console.error(
      'Usage: obsidian-mcp --vault <path-to-vault> [--db <path-to-db>] [--transport stdio|http] [--port <number>]',
    )
    process.exit(1)
  }
  const vaultPath = resolve(args[vaultIdx + 1]!)

  const dbIdx = args.indexOf('--db')
  const dbPath =
    dbIdx !== -1 && args[dbIdx + 1] ? resolve(args[dbIdx + 1]!) : join(vaultPath, '.mcp-index.db')

  const transportIdx = args.indexOf('--transport')
  const transportArg = transportIdx !== -1 ? args[transportIdx + 1] : 'stdio'
  if (transportArg !== 'stdio' && transportArg !== 'http') {
    console.error('--transport must be "stdio" or "http"')
    process.exit(1)
  }
  const transport = transportArg as 'stdio' | 'http'

  const portIdx = args.indexOf('--port')
  const portArg = portIdx !== -1 ? parseInt(args[portIdx + 1] ?? '', 10) : 3000
  if (isNaN(portArg) || portArg < 1 || portArg > 65535) {
    console.error('--port must be a valid port number (1–65535)')
    process.exit(1)
  }

  return { vaultPath, dbPath, transport, port: portArg }
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
  const { vaultPath, dbPath, transport, port } = parseArgs()

  console.error(`[main] Vault:     ${vaultPath}`)
  console.error(`[main] DB:        ${dbPath}`)
  console.error(`[main] Transport: ${transport}${transport === 'http' ? ` (port ${port})` : ''}`)

  const db = openDatabase(dbPath)

  await scanVault(db, vaultPath)
  watchVault(db, vaultPath)
  await startServer(db, vaultPath, transport, port)
}

main().catch((err) => {
  console.error('[main] Fatal error:', err)
  process.exit(1)
})
