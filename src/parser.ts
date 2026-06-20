import matter from 'gray-matter'
import { createHash } from 'node:crypto'

export interface ParsedNote {
  title: string
  content: string
  tags: string[]
  links: string[]
  hash: string
}

const WIKILINK_RE = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g
const MD_LINK_RE = /\[(?:[^\]]*)\]\(([^)]+\.md)\)/g

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

function titleFromPath(filePath: string): string {
  const base = filePath.split('/').pop() ?? filePath
  return base.replace(/\.md$/i, '')
}

function normalizeTags(raw: unknown): string[] {
  if (!raw) return []
  if (typeof raw === 'string') return raw.split(/[\s,]+/).filter(Boolean)
  if (Array.isArray(raw)) return raw.flatMap((t) => normalizeTags(t))
  return []
}
