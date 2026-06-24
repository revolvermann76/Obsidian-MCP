import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Database } from 'better-sqlite3'
import { registerSearchTools } from './tools/searchTools.js'
import { registerReadTools } from './tools/readTools.js'
import { registerBacklinkTools } from './tools/backlinkTools.js'
import { registerAliasesTools } from './tools/aliasTools.js'
import { registerTagTools } from './tools/tagTools.js'
import { registerPropertyTools } from './tools/propertyTools.js'

/**
 * Registers all MCP tools and starts the server on stdio.
 *
 * Exposes five tools to MCP clients:
 * - `search_notes` — FTS5 fulltext search with highlighted snippets
 * - `read_note` — read the full content of a note by path or title
 * - `list_notes` — list all notes, filterable by folder or tag
 * - `get_backlinks` — find notes that link to a given note
 * - `search_by_tag` — find notes by frontmatter tag
 *
 * All tools are pure read operations; the server never modifies the vault or database.
 *
 * @param db - Open SQLite database instance populated by the indexer.
 * @returns A promise that resolves once the server is connected to the stdio transport.
 */
export async function startServer(db: Database, vaultPath: string): Promise<void> {
  const server = new McpServer({
    name: 'obsidian-mcp',
    version: '1.0.0',
  })

  registerAliasesTools(db, server, vaultPath)
  registerPropertyTools(db, server)
  registerBacklinkTools(db, server)
  registerReadTools(db, server)
  registerSearchTools(db, server)
  registerTagTools(db, server)

  server.registerTool('exit', { description: 'Shut down the MCP server process.' }, async () => {
    console.error('[server] Shutting down by tool request')
    setImmediate(() => process.exit(0))
    return { content: [{ type: 'text', text: 'Server is shutting down.' }] }
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[server] MCP server running on stdio')
}
