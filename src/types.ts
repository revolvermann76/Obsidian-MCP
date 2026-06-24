/** A fully loaded note including its body content. */
export interface Note {
  id: number
  path: string
  title: string
  content: string
}

/** Represents a fully parsed markdown note. */
export interface ParsedNote {
  /** Note title — from frontmatter `title` field, or derived from the file name. */
  title: string
  /** Body text after stripping the YAML frontmatter block. */
  content: string
  /** Frontmatter tags, normalized to a flat string array. */
  tags: string[]
  /** Frontmatter aliases under which this note can also be found. */
  aliases: string[]
  /** All outgoing link targets found in the body (wikilinks and markdown links). */
  links: string[]
  /** SHA-1 hex digest of the raw file content, used for change detection. */
  hash: string
}
