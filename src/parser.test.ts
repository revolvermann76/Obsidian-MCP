import { describe, it, expect } from 'vitest'
import { parseNote } from './parser.js'

// ---------------------------------------------------------------------------
// Title
// ---------------------------------------------------------------------------

describe('title', () => {
  it('uses frontmatter title when present', () => {
    const result = parseNote('---\ntitle: My Title\n---\nBody', 'folder/file.md')
    expect(result.title).toBe('My Title')
  })

  it('falls back to filename without extension', () => {
    const result = parseNote('No frontmatter', 'folder/My Note.md')
    expect(result.title).toBe('My Note')
  })

  it('handles nested path correctly', () => {
    const result = parseNote('', 'a/b/c/Deep.md')
    expect(result.title).toBe('Deep')
  })
})

// ---------------------------------------------------------------------------
// Frontmatter tags
// ---------------------------------------------------------------------------

describe('frontmatter tags', () => {
  it('parses YAML sequence tags', () => {
    const raw = '---\ntags:\n  - foo\n  - bar\n---\n'
    expect(parseNote(raw, 'x.md').tags).toEqual(expect.arrayContaining(['foo', 'bar']))
  })

  it('parses inline array tags', () => {
    const raw = '---\ntags: ["alpha", "beta"]\n---\n'
    expect(parseNote(raw, 'x.md').tags).toEqual(expect.arrayContaining(['alpha', 'beta']))
  })

  it('parses comma-separated string tags', () => {
    const raw = '---\ntags: one, two, three\n---\n'
    expect(parseNote(raw, 'x.md').tags).toEqual(expect.arrayContaining(['one', 'two', 'three']))
  })

  it('returns empty array when no tags key', () => {
    expect(parseNote('---\ntitle: T\n---\n', 'x.md').tags).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Inline tags
// ---------------------------------------------------------------------------

describe('inline tags', () => {
  it('extracts a simple inline tag', () => {
    const result = parseNote('Hello #world today', 'x.md')
    expect(result.tags).toContain('world')
  })

  it('extracts subtag as combined string', () => {
    const result = parseNote('Status: #project/active now', 'x.md')
    expect(result.tags).toContain('project/active')
  })

  it('does not match heading markers', () => {
    const result = parseNote('# Heading\n## Section', 'x.md')
    expect(result.tags).toHaveLength(0)
  })

  it('does not split a mid-word hash', () => {
    // color: #ff0000 — the # is preceded by space, so it would try to match
    // but "ff0000" starts with letters only — this IS captured as a tag.
    // What must NOT happen: a word-internal hash like foo#bar
    const result = parseNote('foo#bar', 'x.md')
    expect(result.tags).not.toContain('bar')
  })

  it('merges inline tags with frontmatter tags and deduplicates', () => {
    const raw = '---\ntags: [existing]\n---\nSome #existing and #new text'
    const result = parseNote(raw, 'x.md')
    const count = result.tags.filter((t) => t === 'existing').length
    expect(count).toBe(1)
    expect(result.tags).toContain('new')
  })

  it('handles tags with hyphens and underscores', () => {
    const result = parseNote('See #my-tag and #another_tag', 'x.md')
    expect(result.tags).toContain('my-tag')
    expect(result.tags).toContain('another_tag')
  })

  it('extracts emoji tags', () => {
    const result = parseNote('Mood: #🚀launch', 'x.md')
    expect(result.tags).toContain('🚀launch')
  })
})

// ---------------------------------------------------------------------------
// Aliases
// ---------------------------------------------------------------------------

describe('aliases', () => {
  it('parses aliases as array', () => {
    const raw = '---\naliases: ["Terra", "Gaia"]\n---\n'
    expect(parseNote(raw, 'x.md').aliases).toEqual(['Terra', 'Gaia'])
  })

  it('parses a single string alias', () => {
    const raw = '---\naliases: Terra\n---\n'
    expect(parseNote(raw, 'x.md').aliases).toEqual(['Terra'])
  })

  it('parses YAML sequence aliases', () => {
    const raw = '---\naliases:\n  - A\n  - B\n---\n'
    expect(parseNote(raw, 'x.md').aliases).toEqual(['A', 'B'])
  })

  it('returns empty array when no aliases key', () => {
    expect(parseNote('---\ntitle: T\n---\n', 'x.md').aliases).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

describe('links', () => {
  it('extracts wikilinks', () => {
    const result = parseNote('See [[Sonnensystem]] for more.', 'x.md')
    expect(result.links).toContain('Sonnensystem')
  })

  it('extracts wikilinks with display text', () => {
    const result = parseNote('See [[Sonnensystem|Solar System]].', 'x.md')
    expect(result.links).toContain('Sonnensystem')
  })

  it('extracts markdown links to .md files', () => {
    const result = parseNote('[label](other-note.md)', 'x.md')
    expect(result.links).toContain('other-note.md')
  })

  it('ignores markdown links to non-.md targets', () => {
    const result = parseNote('[site](https://example.com)', 'x.md')
    expect(result.links).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Hash
// ---------------------------------------------------------------------------

describe('hash', () => {
  it('produces a 40-char hex SHA-1', () => {
    const { hash } = parseNote('hello', 'x.md')
    expect(hash).toMatch(/^[0-9a-f]{40}$/)
  })

  it('changes when content changes', () => {
    const a = parseNote('hello', 'x.md').hash
    const b = parseNote('world', 'x.md').hash
    expect(a).not.toBe(b)
  })

  it('is stable for the same input', () => {
    const raw = '---\ntitle: T\n---\nBody'
    expect(parseNote(raw, 'x.md').hash).toBe(parseNote(raw, 'x.md').hash)
  })
})
