import { describe, it, expect } from 'vitest'
import {
  evaluateQuery,
  firstTextTerm,
  parseSearchQuery,
  type QueryNoteRecord,
} from './searchQueryParser.js'

function note(overrides: Partial<QueryNoteRecord> = {}): QueryNoteRecord {
  return {
    path: 'folder/Note.md',
    title: 'Note',
    content: '',
    tags: [],
    properties: {},
    ...overrides,
  }
}

function matches(query: string, n: QueryNoteRecord, caseSensitive = false): boolean {
  return evaluateQuery(parseSearchQuery(query), n, caseSensitive)
}

// ---------------------------------------------------------------------------
// Implicit AND / OR / NOT / grouping
// ---------------------------------------------------------------------------

describe('boolean logic', () => {
  it('implicit AND requires all terms', () => {
    const n = note({ content: 'meeting notes about work' })
    expect(matches('meeting work', n)).toBe(true)
    expect(matches('meeting holiday', n)).toBe(false)
  })

  it('OR matches if either term is present', () => {
    const n = note({ content: 'work' })
    expect(matches('meeting OR work', n)).toBe(true)
    expect(matches('holiday OR vacation', n)).toBe(false)
  })

  it('-term excludes notes containing it', () => {
    const n = note({ content: 'meeting work' })
    expect(matches('meeting -work', n)).toBe(false)
    expect(matches('meeting -holiday', n)).toBe(true)
  })

  it('parentheses control grouping', () => {
    const n = note({ content: 'meeting personal' })
    expect(matches('meeting (work OR personal)', n)).toBe(true)
    expect(matches('meeting (work OR holiday)', n)).toBe(false)
  })

  it('quoted phrases match exact substrings', () => {
    const n = note({ content: 'a star wars marathon' })
    expect(matches('"star wars"', n)).toBe(true)
    expect(matches('"wars star"', n)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Field filters
// ---------------------------------------------------------------------------

describe('field filters', () => {
  it('path: matches a substring of the vault-relative path', () => {
    const n = note({ path: 'Daily notes/2022-07-01.md' })
    expect(matches('path:"Daily notes"', n)).toBe(true)
    expect(matches('path:Projects', n)).toBe(false)
  })

  it('file: matches only the filename portion', () => {
    const n = note({ path: 'folder/Project Plan.md' })
    expect(matches('file:Plan', n)).toBe(true)
    expect(matches('file:folder', n)).toBe(false)
  })

  it('content: matches only the body, not the title', () => {
    const n = note({ title: 'Unique Title', content: 'unrelated body' })
    expect(matches('content:Unique', n)).toBe(false)
    expect(matches('content:unrelated', n)).toBe(true)
  })

  it('tag: matches an exact tag, with or without leading #', () => {
    const n = note({ tags: ['work'] })
    expect(matches('tag:work', n)).toBe(true)
    expect(matches('tag:#work', n)).toBe(true)
    expect(matches('tag:working', n)).toBe(false)
  })

  it('combines field filters with free text and OR', () => {
    const n = note({ path: 'work/Note.md', content: 'hello' })
    expect(matches('path:work hello', n)).toBe(true)
    expect(matches('path:personal OR hello', n)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Property filters
// ---------------------------------------------------------------------------

describe('property filters', () => {
  it('[key] checks existence regardless of value', () => {
    const n = note({ properties: { status: ['Draft'] } })
    expect(matches('[status]', n)).toBe(true)
    expect(matches('[priority]', n)).toBe(false)
  })

  it('[key:value] matches an exact value', () => {
    const n = note({ properties: { status: ['Draft'] } })
    expect(matches('[status:Draft]', n)).toBe(true)
    expect(matches('[status:Published]', n)).toBe(false)
  })

  it('[key:value OR value2] matches any listed value', () => {
    const n = note({ properties: { status: ['Published'] } })
    expect(matches('[status:Draft OR Published]', n)).toBe(true)
  })

  it('matches list properties by any element', () => {
    const n = note({ properties: { authors: ['Alice', 'Bob'] } })
    expect(matches('[authors:Bob]', n)).toBe(true)
    expect(matches('[authors:Carol]', n)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Case sensitivity
// ---------------------------------------------------------------------------

describe('case sensitivity', () => {
  it('is case-insensitive by default', () => {
    const n = note({ content: 'Meeting' })
    expect(matches('meeting', n, false)).toBe(true)
  })

  it('is case-sensitive when requested', () => {
    const n = note({ content: 'Meeting' })
    expect(matches('meeting', n, true)).toBe(false)
    expect(matches('Meeting', n, true)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// firstTextTerm
// ---------------------------------------------------------------------------

describe('firstTextTerm', () => {
  it('finds the first free-text term for snippet highlighting', () => {
    expect(firstTextTerm(parseSearchQuery('tag:work meeting'))).toBe('meeting')
  })

  it('returns undefined when the query has only field/property filters', () => {
    expect(firstTextTerm(parseSearchQuery('tag:work [status:Draft]'))).toBeUndefined()
  })
})
