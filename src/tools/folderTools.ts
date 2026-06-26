import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Database } from 'better-sqlite3'
import { z } from 'zod'

/**
 * Derives the set of subfolders of a given folder from the indexed note paths.
 *
 * All intermediate folder segments are inferred from note paths stored in the DB —
 * no filesystem access required. A folder exists if at least one note lives inside it.
 *
 * @param db - Open SQLite database instance.
 * @param folder - Vault-relative folder path to list subfolders of. Empty string = vault root.
 * @param recursive - When true, return all descendant folders; when false, only direct children.
 * @returns Sorted array of vault-relative folder paths.
 */
function getSubFolders(db: Database, folder: string, recursive: boolean): string[] {
  const rows = db.prepare('SELECT DISTINCT path FROM notes').all() as { path: string }[]

  const allFolders = new Set<string>()
  for (const { path } of rows) {
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) {
      allFolders.add(parts.slice(0, i).join('/'))
    }
  }

  const prefix = folder ? folder + '/' : ''

  return [...allFolders]
    .filter((f) => {
      if (!f.startsWith(prefix)) return false
      const remainder = f.slice(prefix.length)
      return recursive ? remainder.length > 0 : !remainder.includes('/')
    })
    .sort()
}

/**
 * Collects metadata for a vault folder from the indexed note paths and tags.
 *
 * @param db - Open SQLite database instance.
 * @param folder - Vault-relative folder path. Empty string = vault root.
 * @returns A formatted metadata summary string.
 */
function infoFolder(db: Database, folder: string): string {
  const prefix = folder ? folder + '/' : ''
  const label = folder || 'vault root'

  const directNotes = folder
    ? (
        db
          .prepare('SELECT COUNT(*) AS cnt FROM notes WHERE path LIKE ? AND path NOT LIKE ?')
          .get(`${prefix}%`, `${prefix}%/%`) as { cnt: number }
      ).cnt
    : (
        db.prepare("SELECT COUNT(*) AS cnt FROM notes WHERE path NOT LIKE '%/%'").get() as {
          cnt: number
        }
      ).cnt

  const totalNotes = folder
    ? (
        db.prepare('SELECT COUNT(*) AS cnt FROM notes WHERE path LIKE ?').get(`${prefix}%`) as {
          cnt: number
        }
      ).cnt
    : (db.prepare('SELECT COUNT(*) AS cnt FROM notes').get() as { cnt: number }).cnt

  const contentRows = (
    folder
      ? db.prepare('SELECT content FROM notes WHERE path LIKE ?').all(`${prefix}%`)
      : db.prepare('SELECT content FROM notes').all()
  ) as { content: string }[]
  const totalWords = contentRows.reduce(
    (sum, r) => sum + r.content.split(/\s+/).filter(Boolean).length,
    0,
  )

  const directSubfolders = getSubFolders(db, folder, false)
  const totalSubfolderCount = getSubFolders(db, folder, true).length

  const tags = (
    folder
      ? db
          .prepare(
            'SELECT DISTINCT t.tag FROM tags t JOIN notes n ON n.id = t.note_id WHERE n.path LIKE ? ORDER BY t.tag',
          )
          .all(`${prefix}%`)
      : db.prepare('SELECT DISTINCT tag FROM tags ORDER BY tag').all()
  ) as { tag: string }[]

  const lines: string[] = [
    `folder:           ${label}`,
    `notes (direct):   ${directNotes}`,
    `notes (total):    ${totalNotes}`,
    `subfolders:       ${directSubfolders.length > 0 ? directSubfolders.join(', ') : '—'}`,
    `total subfolders: ${totalSubfolderCount}`,
    `words (total):    ${totalWords}`,
    `tags:             ${tags.length > 0 ? tags.map((r) => r.tag).join(', ') : '—'}`,
  ]

  return lines.join('\n')
}

/**
 * Registers the `folder_get_subfolders` MCP tool on the given server.
 *
 * @param db - Open SQLite database instance.
 * @param server - MCP server instance to register the tool on.
 */
export function registerFolderTools(db: Database, server: McpServer): void {
  server.registerTool(
    'folder_get_subfolders',
    {
      description:
        'List subfolders of a vault folder. ' +
        'Without a folder, lists top-level folders. ' +
        'Use recursive=true to include all descendant folders.',
      inputSchema: {
        folder: z
          .string()
          .optional()
          .describe('Vault-relative folder path (e.g. "projects"). Defaults to vault root.'),
        recursive: z
          .boolean()
          .optional()
          .describe('When true, return all descendant folders instead of only direct children.'),
      },
    },
    async ({ folder, recursive }) => {
      const folders = getSubFolders(db, folder ?? '', recursive ?? false)
      if (folders.length === 0)
        return { content: [{ type: 'text', text: 'No subfolders found.' }] }
      const text = folders.map((f) => `- ${f}`).join('\n')
      return { content: [{ type: 'text', text }] }
    },
  )

  server.registerTool(
    'folder_info',
    {
      description:
        'Return metadata for a vault folder: note counts, subfolder counts, total word count, and tags. ' +
        'Without a folder, reports on the vault root.',
      inputSchema: {
        folder: z
          .string()
          .optional()
          .describe('Vault-relative folder path (e.g. "projects"). Defaults to vault root.'),
      },
    },
    async ({ folder }) => {
      const text = infoFolder(db, folder ?? '')
      return { content: [{ type: 'text', text }] }
    },
  )
}
