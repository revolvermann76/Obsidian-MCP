# MCP Tools Overview

This server exposes the following tools over the MCP stdio protocol. 

Note resolution — wherever a tool accepts a note reference by `file`, `path`, or `path_or_title`, the lookup matches against:
1. Vault-relative path (e.g. `projects/my-note.md`)
2. Note title (from frontmatter `title` key, or derived from the file name)
3. Alias (any value stored in the frontmatter `aliases` key)

---

## Searching & Listing

### `search_notes`

Fulltext search across all notes using SQLite FTS5. Matched terms are highlighted with `**` in the returned snippet.

| Parameter | Type            | Required | Description                                                                                   |
| --------- | --------------- | -------- | --------------------------------------------------------------------------------------------- |
| `query`   | string          | yes      | Search query. Supports FTS5 syntax: `"exact phrase"`, `term*`, `term1 OR term2`, `-excluded`. |
| `limit`   | integer (1–100) | no       | Maximum number of results. Defaults to 20.                                                    |

**Result:** One entry per matching note, formatted as:
```
**Title** (path/to/note.md)
...snippet with **highlighted** terms...
```
Entries are separated by `---`. Returns `No results found.` when nothing matches.

---

### `list_notes`

Lists all notes in the vault, optionally filtered by folder or tag. When both `folder` and `tag` are given, `tag` takes precedence.

| Parameter | Type   | Required | Description                                                                                               |
| --------- | ------ | -------- | --------------------------------------------------------------------------------------------------------- |
| `folder`  | string | no       | Vault-relative folder path prefix (e.g. `projects`). Matches all notes whose path starts with this value. |
| `tag`     | string | no       | Exact tag to filter by (without `#`). Matches both frontmatter and inline body tags.                      |

**Result:** Bullet list of matching notes:
```
- **Title** (path/to/note.md)
```
Returns `No notes found.` when the filter matches nothing.

---

### `search_by_tag`

Finds all notes that carry a specific tag. Matches both frontmatter tags and inline body tags (e.g. `#tag`).

| Parameter | Type   | Required | Description                             |
| --------- | ------ | -------- | --------------------------------------- |
| `tag`     | string | yes      | Exact tag name without the leading `#`. |

**Result:** Bullet list of matching notes:
```
- **Title** (path/to/note.md)
```
Returns `No notes with tag: <tag>` when nothing matches.

---

## Reading

### `read_note`

Reads the full content of a single note. Resolves the note by path, title, or alias.

| Parameter       | Type   | Required | Description                                |
| --------------- | ------ | -------- | ------------------------------------------ |
| `path_or_title` | string | yes      | Vault-relative path, note title, or alias. |

**Result:** The note's full markdown body prefixed with its title as an H1 heading:
```
# Title

...full note content...
```
Returns `Note not found: <input>` when no match is found.

---

## Links & Backlinks

### `get_backlinks`

Finds all notes that contain a wikilink or markdown link pointing to a given note.

| Parameter       | Type   | Required | Description                                      |
| --------------- | ------ | -------- | ------------------------------------------------ |
| `path_or_title` | string | yes      | Vault-relative path or title of the target note. |

**Result:** Bullet list of notes that link to the target:
```
- **Title** (path/to/note.md)
```
Returns `No backlinks found for: <input>` when nothing links to the target.

---

## Aliases

### `list-aliases`

Lists aliases defined across the vault, with optional filtering and output modes.

| Parameter | Type    | Required | Description                                                         |
| --------- | ------- | -------- | ------------------------------------------------------------------- |
| `file`    | string  | no       | Filter by exact note title.                                         |
| `path`    | string  | no       | Filter by vault-relative path prefix.                               |
| `total`   | boolean | no       | When `true`, return only the total alias count instead of the list. |
| `verbose` | boolean | no       | When `true`, include the note's file path next to each alias.       |

**Result (default):** Bullet list of alias names:
```
- my alias
```
**Result (verbose):** Bullet list with paths:
```
- **my alias** (path/to/note.md)
```
**Result (total):** `Total aliases: <n>`

Returns `No aliases found.` when the filter matches nothing.

---

### `add-alias`

Adds a new alias to a note. Updates the frontmatter `aliases` key on disk and records the alias in the database immediately. Fails without making changes if the alias already exists on the note.

| Parameter | Type   | Required | Description                                                    |
| --------- | ------ | -------- | -------------------------------------------------------------- |
| `note`    | string | yes      | Note to target: vault-relative path, title, or existing alias. |
| `alias`   | string | yes      | New alias to add.                                              |

**Result:** Human-readable confirmation or error message, e.g.:
- `Added alias "my alias" to "Note Title"`
- `Note not found: <input>`
- `Alias "my alias" already exists on "Note Title"`

---

### `remove-alias`

Removes an alias from a note. Updates the frontmatter on disk and deletes the alias from the database immediately. If the `aliases` list becomes empty after removal, the `aliases` key is dropped from the frontmatter entirely.

| Parameter | Type   | Required | Description                                                    |
| --------- | ------ | -------- | -------------------------------------------------------------- |
| `note`    | string | yes      | Note to target: vault-relative path, title, or existing alias. |
| `alias`   | string | yes      | Alias to remove.                                               |

**Result:** Human-readable confirmation or error message, e.g.:
- `Removed alias "my alias" from "Note Title"`
- `Note not found: <input>`
- `Alias "my alias" not found on "Note Title"`

---

## Properties

### `list-properties`

Lists frontmatter properties indexed from the vault database. Behaviour depends on which parameters are provided.

| Parameter | Type   | Required | Description                                |
| --------- | ------ | -------- | ------------------------------------------ |
| `file`    | string | no       | Resolve note by title or alias.            |
| `path`    | string | no       | Resolve note by exact vault-relative path. |
| `name`    | string | no       | Specific frontmatter key to look up.       |

**Modes:**

| `file`/`path` | `name` | Result                                                    |
| ------------- | ------ | --------------------------------------------------------- |
| —             | —      | Sorted list of all unique property names across the vault |
| ✓             | —      | All frontmatter key-value pairs for that note             |
| ✓             | ✓      | Value of one specific property for that note              |
| —             | ✓      | All notes that have this property, with their values      |

**Result examples:**

All property names (no filters):
```
- aliases
- date
- status
- tags
```

All properties for a note:
```
aliases: my alias, other alias
date: 2026-01-15
status: active
tags: project, work
```

Single property for a note (`file` + `name`):
```
status: active
```

All notes with a property (`name` only):
```
- **Note A** (folder/note-a.md): active
- **Note B** (folder/note-b.md): draft
```

---

## Server

### `exit`

Shuts down the MCP server process. Takes no parameters.

**Result:** `Server is shutting down.`
