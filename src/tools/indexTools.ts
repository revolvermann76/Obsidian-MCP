import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Database } from 'better-sqlite3'
import { scanVault } from '../indexer.js'

/**
 * Registers the `index` MCP tool on the given server.
 *
 * @param db - Open SQLite database instance.
 * @param server - MCP server instance to register the tool on.
 * @param vaultPath - Absolute path to the Obsidian vault root.
 */
export function registerIndexTools(db: Database, server: McpServer, vaultPath: string): void {
  server.registerTool(
    'index',
    {
      description:
        'Reindex the vault: rescans all markdown files on disk and syncs the database with ' +
        'the current state (new and changed notes are re-parsed, deleted files are removed ' +
        'from the index). Takes no parameters.',
    },
    async () => {
      await scanVault(db, vaultPath)
      const { cnt } = db.prepare('SELECT COUNT(*) AS cnt FROM notes').get() as { cnt: number }
      return {
        content: [{ type: 'text', text: `Vault reindexed. ${cnt} notes currently indexed.` }],
      }
    },
  )
}
