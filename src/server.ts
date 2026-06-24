import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import type { Database } from 'better-sqlite3'
import { searchNotes, readNote, listNotes, getBacklinks, searchByTag } from './tools.js'

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
export async function startServer(db: Database): Promise<void> {
  const server = new McpServer({
    name: 'obsidian-mcp',
    version: '1.0.0',
  })

  server.registerTool(
    'search_notes',
    {
      description: 'Fulltext search across all notes in the vault',
      inputSchema: {
        query: z.string().describe('Search query (SQLite FTS5 syntax supported)'),
        limit: z.number().int().min(1).max(100).default(20).optional(),
      },
    },
    async ({ query, limit }) => {
      const results = searchNotes(db, query, limit ?? 20)
      if (results.length === 0) return { content: [{ type: 'text', text: 'No results found.' }] }
      const text = results.map((r) => `**${r.title}** (${r.path})\n${r.snippet}`).join('\n\n---\n\n')
      return { content: [{ type: 'text', text }] }
    },
  )

  server.registerTool(
    'read_note',
    {
      description: 'Read the full content of a note by its path or title',
      inputSchema: {
        path_or_title: z.string().describe('Exact file path (relative to vault) or note title'),
      },
    },
    async ({ path_or_title }) => {
      const note = readNote(db, path_or_title)
      if (!note) return { content: [{ type: 'text', text: `Note not found: ${path_or_title}` }] }
      return { content: [{ type: 'text', text: `# ${note.title}\n\n${note.content}` }] }
    },
  )

  server.registerTool(
    'list_notes',
    {
      description: 'List all notes, optionally filtered by subfolder or tag',
      inputSchema: {
        folder: z.string().optional().describe('Subfolder path relative to vault root'),
        tag: z.string().optional().describe('Frontmatter tag to filter by'),
      },
    },
    async ({ folder, tag }) => {
      const notes = listNotes(db, { folder, tag })
      if (notes.length === 0) return { content: [{ type: 'text', text: 'No notes found.' }] }
      const text = notes.map((n) => `- **${n.title}** (${n.path})`).join('\n')
      return { content: [{ type: 'text', text }] }
    },
  )

  server.registerTool(
    'get_backlinks',
    {
      description: 'Find all notes that link to a given note',
      inputSchema: {
        path_or_title: z.string().describe('Path or title of the target note'),
      },
    },
    async ({ path_or_title }) => {
      const links = getBacklinks(db, path_or_title)
      if (links.length === 0)
        return { content: [{ type: 'text', text: `No backlinks found for: ${path_or_title}` }] }
      const text = links.map((n) => `- **${n.title}** (${n.path})`).join('\n')
      return { content: [{ type: 'text', text }] }
    },
  )

  server.registerTool(
    'search_by_tag',
    {
      description: 'Find all notes that have a specific frontmatter tag',
      inputSchema: {
        tag: z.string().describe('Tag name (without #)'),
      },
    },
    async ({ tag }) => {
      const notes = searchByTag(db, tag)
      if (notes.length === 0)
        return { content: [{ type: 'text', text: `No notes with tag: ${tag}` }] }
      const text = notes.map((n) => `- **${n.title}** (${n.path})`).join('\n')
      return { content: [{ type: 'text', text }] }
    },
  )

  server.registerTool(
    'exit',
    { description: 'Shut down the MCP server process.' },
    async () => {
      console.error('[server] Shutting down by tool request')
      setImmediate(() => process.exit(0))
      return { content: [{ type: 'text', text: 'Server is shutting down.' }] }
    },
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[server] MCP server running on stdio')
}
