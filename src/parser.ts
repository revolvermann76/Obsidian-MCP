import matter from 'gray-matter'
import { createHash } from 'node:crypto'

/**
 * Represents a fully parsed markdown note.
 */
export interface ParsedNote {
  /** Note title — from frontmatter `title` field, or derived from the file name. */
  title: string
  /** Body text after stripping the YAML frontmatter block. */
  content: string
  /** Frontmatter tags, normalized to a flat string array. */
  tags: string[]
  /** All outgoing link targets found in the body (wikilinks and markdown links). */
  links: string[]
  /** SHA-1 hex digest of the raw file content, used for change detection. */
  hash: string
}

const WIKILINK_RE = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g
const MD_LINK_RE = /\[(?:[^\]]*)\]\(([^)]+\.md)\)/g

/**
 * Parses a raw markdown string into a {@link ParsedNote}.
 *
 * Extracts YAML frontmatter via `gray-matter`, collects wikilinks (`[[Target]]`)
 * and relative markdown links (`[label](file.md)`), and computes a SHA-1 hash
 * of the raw content for delta detection.
 *
 * @param raw - Raw file content including any YAML frontmatter.
 * @param filePath - File path used as fallback for deriving the title when no
 *   `title` key is present in the frontmatter.
 * @returns A fully populated {@link ParsedNote} object.
 */
export function parseNote(raw: string, filePath: string): ParsedNote {
  const { data, content } = matter(raw)

  const title = (data['title'] as string | undefined) ?? titleFromPath(filePath)

  const tags = normalizeTags(data['tags'])

  const links: string[] = []
  for (const match of content.matchAll(WIKILINK_RE)) {
    const target = match[1]
    if (target) links.push(target.trim())
  }
  for (const match of content.matchAll(MD_LINK_RE)) {
    const target = match[1]
    if (target) links.push(target.trim())
  }

  const hash = createHash('sha1').update(raw).digest('hex')

  return { title, content, tags, links, hash }
}

/**
 * Derives a human-readable title from a file path by stripping the directory
 * prefix and the `.md` extension.
 *
 * @param filePath - Absolute or relative file path.
 * @returns The bare file name without extension.
 */
function titleFromPath(filePath: string): string {
  const base = filePath.split('/').pop() ?? filePath
  return base.replace(/\.md$/i, '')
}

/**
 * Normalizes the raw `tags` value from YAML frontmatter into a flat string array.
 *
 * Handles the three common frontmatter tag formats:
 * - A single comma- or whitespace-separated string: `tags: foo, bar`
 * - A YAML sequence: `tags: [foo, bar]`
 * - Nested arrays (unusual but tolerated)
 *
 * @param raw - The raw value of the `tags` frontmatter key.
 * @returns A flat array of non-empty tag strings.
 */
function normalizeTags(raw: unknown): string[] {
  if (!raw) return []
  if (typeof raw === 'string') return raw.split(/[\s,]+/).filter(Boolean)
  if (Array.isArray(raw)) return raw.flatMap((t) => normalizeTags(t))
  return []
}
