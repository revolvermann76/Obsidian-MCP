/**
 * Parser and evaluator for Obsidian-style search queries.
 *
 * Supported syntax: free-text terms, "quoted phrases", boolean `OR`, implicit AND
 * (space-separated terms), exclusion via `-term`, grouping with `(...)`, field filters
 * (`path:`, `file:`, `tag:`, `content:`), and frontmatter property filters
 * (`[key]`, `[key:value]`, `[key:value OR value2]`).
 *
 * Deliberately unsupported (see docs/tools-overview.md): `line:`/`block:`/`section:`/`task:`
 * scoped search, comparison operators (`[duration:<5]`), and regex (`/pattern/`).
 */

export type QueryNode =
  | { type: 'and'; children: QueryNode[] }
  | { type: 'or'; children: QueryNode[] }
  | { type: 'not'; child: QueryNode }
  | { type: 'text'; value: string }
  | { type: 'field'; field: 'path' | 'file' | 'tag' | 'content'; value: string }
  | { type: 'property'; key: string; values?: string[] }

const FIELD_NAMES = new Set(['path', 'file', 'tag', 'content'])

class Parser {
  private pos = 0

  constructor(private readonly s: string) {}

  parse(): QueryNode {
    return this.parseExpression() ?? { type: 'and', children: [] }
  }

  private eof(): boolean {
    return this.pos >= this.s.length
  }

  private peek(): string {
    return this.s[this.pos] ?? ''
  }

  private skipWhitespace(): void {
    while (!this.eof() && /\s/.test(this.peek())) this.pos++
  }

  // Matches a standalone "OR" keyword at the current position (word-boundary on both sides).
  private matchKeywordOR(): boolean {
    if (this.s.slice(this.pos, this.pos + 2) !== 'OR') return false
    const before = this.s[this.pos - 1]
    const after = this.s[this.pos + 2]
    if (before !== undefined && /\S/.test(before)) return false
    if (after !== undefined && /\S/.test(after)) return false
    return true
  }

  private parseExpression(): QueryNode | null {
    const first = this.parseAnd()
    if (first === null) return null
    const children = [first]
    while (true) {
      this.skipWhitespace()
      if (!this.matchKeywordOR()) break
      this.pos += 2
      this.skipWhitespace()
      const right = this.parseAnd()
      if (right === null) break
      children.push(right)
    }
    return children.length === 1 ? children[0]! : { type: 'or', children }
  }

  private parseAnd(): QueryNode | null {
    this.skipWhitespace()
    const children: QueryNode[] = []
    while (!this.eof() && this.peek() !== ')' && !this.matchKeywordOR()) {
      const atom = this.parseNot()
      if (atom === null) break
      children.push(atom)
      this.skipWhitespace()
    }
    if (children.length === 0) return null
    return children.length === 1 ? children[0]! : { type: 'and', children }
  }

  private parseNot(): QueryNode | null {
    this.skipWhitespace()
    if (this.peek() === '-') {
      this.pos++
      const atom = this.parseAtom()
      return atom === null ? null : { type: 'not', child: atom }
    }
    return this.parseAtom()
  }

  private parseAtom(): QueryNode | null {
    this.skipWhitespace()
    if (this.eof() || this.peek() === ')') return null

    if (this.peek() === '(') {
      this.pos++
      const expr = this.parseExpression()
      this.skipWhitespace()
      if (this.peek() === ')') this.pos++
      return expr ?? { type: 'and', children: [] }
    }

    if (this.peek() === '[') return this.parseProperty()

    if (this.peek() === '"') return { type: 'text', value: this.parseQuoted() }

    const word = this.parseBareWord()
    if (word === '') {
      // Stray special character (e.g. a lone ':' or ']') — consume it to avoid stalling.
      this.pos++
      return null
    }

    if (this.peek() === ':' && FIELD_NAMES.has(word.toLowerCase())) {
      this.pos++
      const value = this.peek() === '"' ? this.parseQuoted() : this.parseBareWord()
      return {
        type: 'field',
        field: word.toLowerCase() as 'path' | 'file' | 'tag' | 'content',
        value,
      }
    }

    return { type: 'text', value: word }
  }

  private parseBareWord(): string {
    const start = this.pos
    while (!this.eof() && !/[\s()[\]":]/.test(this.peek())) this.pos++
    return this.s.slice(start, this.pos)
  }

  private parseQuoted(): string {
    this.pos++ // opening quote
    let result = ''
    while (!this.eof() && this.peek() !== '"') {
      if (this.peek() === '\\' && this.s[this.pos + 1] === '"') {
        result += '"'
        this.pos += 2
      } else {
        result += this.peek()
        this.pos++
      }
    }
    if (this.peek() === '"') this.pos++
    return result
  }

  private parseProperty(): QueryNode {
    this.pos++ // '['
    this.skipWhitespace()
    const key = this.parseBareWord()
    this.skipWhitespace()
    let values: string[] | undefined
    if (this.peek() === ':') {
      this.pos++
      this.skipWhitespace()
      values = []
      while (true) {
        const v = this.peek() === '"' ? this.parseQuoted() : this.parseBareWord()
        if (v !== '') values.push(v)
        this.skipWhitespace()
        if (this.matchKeywordOR()) {
          this.pos += 2
          this.skipWhitespace()
          continue
        }
        break
      }
    }
    this.skipWhitespace()
    if (this.peek() === ']') this.pos++
    return { type: 'property', key, values }
  }
}

/**
 * Parses an Obsidian-style search query string into a boolean expression tree.
 *
 * @param query - Raw query string as typed by the user.
 * @returns The root `QueryNode` of the parsed expression. An empty/unparseable
 *   query yields an empty `and` node, which evaluates to true for every note.
 */
export function parseSearchQuery(query: string): QueryNode {
  return new Parser(query).parse()
}

/** Flattened view of a note's content used by the query evaluator. */
export interface QueryNoteRecord {
  path: string
  title: string
  content: string
  /** Tag strings as stored (no leading `#`). */
  tags: string[]
  /** Frontmatter property values, stringified; lists keep one entry per item. */
  properties: Record<string, string[]>
}

function basename(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx === -1 ? path : path.slice(idx + 1)
}

/**
 * Evaluates a parsed query expression against a single note.
 *
 * @param node - Expression tree produced by `parseSearchQuery`.
 * @param note - Flattened note data to test.
 * @param caseSensitive - Whether text/field comparisons are case-sensitive.
 * @returns Whether the note matches the expression.
 */
export function evaluateQuery(
  node: QueryNode,
  note: QueryNoteRecord,
  caseSensitive: boolean,
): boolean {
  const norm = (s: string): string => (caseSensitive ? s : s.toLowerCase())

  switch (node.type) {
    case 'and':
      return node.children.every((c) => evaluateQuery(c, note, caseSensitive))
    case 'or':
      return node.children.some((c) => evaluateQuery(c, note, caseSensitive))
    case 'not':
      return !evaluateQuery(node.child, note, caseSensitive)
    case 'text': {
      const v = norm(node.value)
      if (v === '') return true
      return norm(note.title).includes(v) || norm(note.content).includes(v)
    }
    case 'field': {
      const v = norm(node.value)
      switch (node.field) {
        case 'path':
          return norm(note.path).includes(v)
        case 'file':
          return norm(basename(note.path)).includes(v)
        case 'content':
          return norm(note.content).includes(v)
        case 'tag': {
          const wanted = norm(node.value.replace(/^#/, ''))
          return note.tags.some((t) => norm(t) === wanted)
        }
      }
      break
    }
    case 'property': {
      const matchKey = Object.keys(note.properties).find((k) => norm(k) === norm(node.key))
      if (!matchKey) return false
      if (!node.values) return true
      const wanted = node.values.map((v) => norm(v))
      return note.properties[matchKey]!.some((v) => wanted.includes(norm(v)))
    }
  }
}

/**
 * Walks the expression tree for the first free-text or `content:` term, for snippet generation.
 * Returns `undefined` if the query has no positive text term (e.g. only field filters or NOTs).
 */
export function firstTextTerm(node: QueryNode): string | undefined {
  switch (node.type) {
    case 'text':
      return node.value || undefined
    case 'field':
      return node.field === 'content' ? node.value || undefined : undefined
    case 'and':
    case 'or':
      for (const child of node.children) {
        const v = firstTextTerm(child)
        if (v) return v
      }
      return undefined
    default:
      return undefined
  }
}
