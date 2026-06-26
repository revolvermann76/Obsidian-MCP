import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Database } from 'better-sqlite3'
import { registerSearchTools } from './tools/searchTools.js'
import { registerNoteTools } from './tools/noteTools.js'
import { registerAliasesTools } from './tools/aliasTools.js'
import { registerTagTools } from './tools/tagTools.js'
import { registerPropertyTools } from './tools/propertyTools.js'
import { registerFolderTools } from './tools/folderTools.js'

/**
 * Registers all MCP tools and starts the server on stdio.
 *
 *
 * @param db - Open SQLite database instance populated by the indexer.
 * @returns A promise that resolves once the server is connected to the stdio transport.
 */
export async function startServer(
  db: Database,
  vaultPath: string,
  transport: 'stdio' | 'http' = 'stdio',
  port = 3000,
): Promise<void> {
  const server = new McpServer({
    name: 'obsidian-mcp',
    version: '1.0.0',
  })

  registerAliasesTools(db, server, vaultPath)
  registerPropertyTools(db, server, vaultPath)
  registerNoteTools(db, server, vaultPath)
  registerSearchTools(db, server)
  registerTagTools(db, server, vaultPath)
  registerFolderTools(db, server)

  server.registerTool('exit', { description: 'Shut down the MCP server process.' }, async () => {
    console.error('[server] Shutting down by tool request')
    setTimeout(() => process.exit(0), 500)
    return { content: [{ type: 'text', text: 'Server is shutting down.' }] }
  })

  if (transport === 'http') {
    const httpTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    })

    await server.connect(httpTransport)

    const httpServer = createServer(async (req, res) => {
      await httpTransport.handleRequest(req, res)
    })

    await new Promise<void>((resolve, reject) => {
      httpServer.listen(port, resolve)
      httpServer.on('error', reject)
    })

    console.error(`[server] MCP server running on http://0.0.0.0:${port}/`)
  } else {
    const stdioTransport = new StdioServerTransport()
    await server.connect(stdioTransport)
    console.error('[server] MCP server running on stdio')
  }
}
