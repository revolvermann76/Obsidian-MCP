# MCP Tools Overview

This server exposes the following tools over the MCP stdio protocol. 

Note resolution — wherever a tool accepts a note reference by `file`, `path`, or `path_or_title`, the lookup matches against:
1. Vault-relative path (e.g. `projects/my-note.md`)
2. Note title (from frontmatter `title` key, or derived from the file name)
3. Alias (any value stored in the frontmatter `aliases` key)

---

## Folder Structure

### `folder_get_subfolders`

Lists subfolders of a vault folder, derived from the indexed note paths (no filesystem access). A folder is considered to exist if at least one note lives inside it.

| Parameter   | Type    | Required | Description                                                                              |
| ----------- | ------- | -------- | ---------------------------------------------------------------------------------------- |
| `folder`    | string  | no       | Vault-relative folder path (e.g. `projects`). Defaults to the vault root.                |
| `recursive` | boolean | no       | When `true`, return all descendant folders. When `false` (default), only direct children. |

**Result:** Bullet list of folder paths:
```
- projects
- projects/work
- projects/personal
```
Returns `No subfolders found.` when the folder contains no subfolders.

---

### `folder_info`

Returns a metadata summary for a vault folder. Without a `folder` parameter, reports on the vault root.

| Parameter | Type   | Required | Description                                                                |
| --------- | ------ | -------- | -------------------------------------------------------------------------- |
| `folder`  | string | no       | Vault-relative folder path (e.g. `projects`). Defaults to the vault root. |

**Result:**
```
folder:           projects/work
notes (direct):   3
notes (total):    12
subfolders:       projects/work/design, projects/work/backend
total subfolders: 5
words (total):    8432
tags:             active, project, work
```
`notes (direct)` counts only notes at the top level of the folder; `notes (total)` includes all descendants. `subfolders` lists direct children by full vault-relative path.

---

## Searching & Listing

### `search_fulltext`

Fulltext search across all notes using SQLite FTS5. Matched terms are highlighted with `**` in the returned snippet.

| Parameter        | Type            | Required | Description                                                                                                              |
| ---------------- | --------------- | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| `query`          | string          | yes      | Search query. Supports FTS5 syntax: `"exact phrase"`, `term*`, `term1 OR term2`, `-excluded`. Treated as a plain string when `case_sensitive` is true. |
| `folder`         | string          | no       | Limit search to this vault-relative folder path (e.g. `projects`).                                                      |
| `limit`          | integer (1–100) | no       | Maximum number of results. Defaults to 20.                                                                               |
| `case_sensitive` | boolean         | no       | When `true`, uses exact case-sensitive matching via `INSTR` instead of FTS5 (default: `false`).                          |

**Result:** One entry per matching note, formatted as:
```
**Title** (path/to/note.md)
...snippet with **highlighted** terms...
```
Entries are separated by `---`. Returns `No results found.` when nothing matches.

---

### `search_query`

Search notes using Obsidian-style query syntax. The query is parsed into a boolean expression tree and evaluated against every note (optionally scoped to `folder`), since field and property filters span multiple tables that can't be folded into a single FTS5 `MATCH` expression.

| Parameter        | Type            | Required | Description                                                                |
| ---------------- | --------------- | -------- | --------------------------------------------------------------------------- |
| `query`          | string          | yes      | Obsidian-style search query (see syntax below).                            |
| `folder`         | string          | no       | Limit search to this vault-relative folder path (e.g. `projects`).         |
| `limit`          | integer (1–100) | no       | Maximum number of results. Defaults to 20.                                 |
| `case_sensitive` | boolean         | no       | Case-sensitive matching for text, field, and property values (default: `false`). |

**Supported syntax:**
| Syntax | Meaning | Example |
| --- | --- | --- |
| `term1 term2` | implicit AND | `meeting work` |
| `term1 OR term2` | OR | `meeting OR call` |
| `-term` | exclude | `meeting -cancelled` |
| `(...)` | grouping | `meeting (work OR personal)` |
| `"..."` | exact phrase | `"weekly sync"` |
| `path:value` | path contains | `path:"Daily notes"` |
| `file:value` | filename contains | `file:2022` |
| `tag:value` | exact tag match (leading `#` optional) | `tag:work` or `tag:#work` |
| `content:value` | body contains (excludes title) | `content:roadmap` |
| `[key]` | has frontmatter property | `[status]` |
| `[key:value]` | property equals value (list properties match by element) | `[status:Draft]` |
| `[key:value OR value2]` | property equals any listed value | `[status:Draft OR Published]` |

All forms combine freely, e.g. `path:projects tag:active ("blocked" OR -done) [owner:Alice]`.

**Not supported** (use `search_fulltext` or `note_read` instead): Obsidian's `line:`, `block:`, `section:`, `task:`/`task-todo:`/`task-done:` scoped search, comparison operators (e.g. `[duration:<5]`), and regex (`/pattern/`).

**Result:** Same format as `search_fulltext` — `**Title** (path)` with an optional highlighted snippet from the first free-text or `content:` term, entries separated by `---`. Returns `No results found.` when nothing matches.

---

### `note_create`

Creates a new markdown note in the vault. Missing parent folders are created automatically.

| Parameter   | Type    | Required | Description                                                                          |
| ----------- | ------- | -------- | ------------------------------------------------------------------------------------ |
| `name`      | string  | yes      | Filename with or without `.md` extension.                                            |
| `folder`    | string  | no       | Vault-relative folder path. Defaults to the vault root when omitted.                 |
| `content`   | string  | no       | Initial markdown content. Creates an empty file when omitted.                        |
| `overwrite` | boolean | no       | Replace the file if it already exists (default: `false`).                            |

**Result:** `Created note: path/to/note.md` or `Overwrote note: path/to/note.md`. Returns an error message if the note already exists and `overwrite` is not set.

---

### `note_delete`

Deletes a note from the vault and removes it from the database. When using a title or alias, the deletion is refused if more than one note matches — use the exact vault-relative path in that case.

| Parameter | Type   | Required | Description                                      |
| --------- | ------ | -------- | ------------------------------------------------ |
| `note`    | string | yes      | Vault-relative path, note title, or alias.       |

**Result:** `Deleted "Title" (path/to/note.md)` on success. Returns an error listing all ambiguous paths when a title/alias matches multiple notes.

---

### `note_get_links`

Lists all outgoing links (wikilinks and markdown links) in a note.

| Parameter       | Type   | Required | Description                                          |
| --------------- | ------ | -------- | ---------------------------------------------------- |
| `path_or_title` | string | yes      | Vault-relative path, note title, or alias.           |

**Result:** Bullet list in the same format as `note_get_backlinks`. Resolved links show the note title and path; dead links (no matching note in the vault) are marked as `(not found)`.

```
- **Linked Note** (path/to/linked.md)
- *dead/link/target* (not found)
```

---

### `note_list`

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

### `tag_search`

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

### `tag_list`

Lists all unique tags across the vault with the number of notes each tag appears on.

Takes no parameters.

**Result:**
```
- project (12)
- active (7)
- work (3)
```
Returns `No tags found.` when the vault has no tags.

---

### `tag_add`

Adds a tag to a note's frontmatter. Updates the file on disk and inserts the tag into the database immediately. Fails without making changes if the tag already exists on the note.

| Parameter | Type   | Required | Description                                                    |
| --------- | ------ | -------- | -------------------------------------------------------------- |
| `note`    | string | yes      | Note to target: vault-relative path, title, or existing alias. |
| `tag`     | string | yes      | Tag to add (without leading `#`).                              |

**Result:** Human-readable confirmation or error message, e.g.:
- `Added tag "project" to "Note Title"`
- `Note not found: <input>`
- `Tag "project" already exists on "Note Title"`

---

### `tag_remove`

Removes a frontmatter tag from a note. Updates the file on disk and deletes the tag from the database immediately. If the `tags` list becomes empty after removal, the `tags` key is dropped from the frontmatter entirely.

**Note:** Only frontmatter tags can be removed. Inline body tags (`#tag` in the note body) require manual editing.

| Parameter | Type   | Required | Description                                                    |
| --------- | ------ | -------- | -------------------------------------------------------------- |
| `note`    | string | yes      | Note to target: vault-relative path, title, or existing alias. |
| `tag`     | string | yes      | Tag to remove (without leading `#`).                           |

**Result:** Human-readable confirmation or error message, e.g.:
- `Removed tag "project" from "Note Title"`
- `Note not found: <input>`
- `Tag "project" not found on "Note Title"`
- `Tag "project" is an inline body tag on "Note Title" and cannot be removed via this tool`

---


### `note_deadends`

Lists all notes that have no outgoing links — neither wikilinks nor markdown links. Useful for finding isolated notes that don't connect to the rest of the vault.

Takes no parameters.

**Result:** Bullet list of matching notes:
```
- **Title** (path/to/note.md)
```
Returns `No dead-end notes found.` when all notes have at least one outgoing link.

---

### `note_alones`

Lists all notes that are completely disconnected from the vault — no incoming links (orphan) and no outgoing links (dead end).

Takes no parameters.

**Result:** Bullet list of matching notes:
```
- **Title** (path/to/note.md)
```
Returns `No alone notes found.` when every note has at least one link in either direction.

---

## Reading

### `note_read`

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

### `note_info`

Returns a metadata summary for a single note.

| Parameter       | Type   | Required | Description                                |
| --------------- | ------ | -------- | ------------------------------------------ |
| `path_or_title` | string | yes      | Vault-relative path, note title, or alias. |

**Result:**
```
title:          My Note
path:           folder/my-note.md
modified:       2026-01-15 10:30:00 UTC
size:           1234 bytes
words:          456
outgoing links: 3
backlinks:      7
aliases:        my alias, other alias
tags:           project, work
properties:
  date: 2026-01-15
  status: active
```
`aliases` and `tags` are listed separately; the `properties` block shows all other frontmatter keys. Returns `Note not found: <input>` when no match is found.

---

### `note_outline`

Returns the heading structure (H1–H6) of a note as a flat list of heading lines, preserving the `#` prefix so the hierarchy is visible.

| Parameter       | Type   | Required | Description                                |
| --------------- | ------ | -------- | ------------------------------------------ |
| `path_or_title` | string | yes      | Vault-relative path, note title, or alias. |

**Result:**
```
# Headline
## Sub Headline
### Sub Sub Headline
## Second Sub Headline
```
Returns `No headings found in "<title>"` when the note has no headings, or `Note not found: <input>` when no match is found.

---

### `note_orphans`

Lists all notes that no other note links to — neither by vault-relative path nor by title. Useful for finding notes that are completely disconnected from the rest of the vault.

Takes no parameters.

**Result:** Bullet list of matching notes:
```
- **Title** (path/to/note.md)
```
Returns `No orphan notes found.` when every note is linked to by at least one other note.

---

## Links & Backlinks

### `note_get_backlinks`

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

### `alias_list`

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

### `alias_add`

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

### `alias_remove`

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

### `property_list`

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

### `property_add`

Adds a new frontmatter property to a note. Updates the file on disk and inserts the entry into the database immediately. Fails without making changes if the property already exists.

| Parameter | Type   | Required | Description                                                    |
| --------- | ------ | -------- | -------------------------------------------------------------- |
| `note`    | string | yes      | Note to target: vault-relative path, title, or existing alias. |
| `name`    | string | yes      | Frontmatter key to add.                                        |
| `value`   | string | yes      | Value as a string; coerced according to `type`.                |
| `type`    | string | no       | One of `text` (default), `number`, `boolean`, `list`, `date`, `json`. See table below. |

**Type coercion:**

| `type`    | Input example          | Stored as                          |
| --------- | ---------------------- | ---------------------------------- |
| `text`    | `active`               | string                             |
| `number`  | `42`                   | number                             |
| `boolean` | `true` or `false`      | boolean                            |
| `list`    | `work, home, personal` | array (split by comma, trimmed)    |
| `date`    | `2026-06-25`           | string (rendered as YAML date)     |
| `json`    | `{"x":1}` or `[1,2]`  | parsed JSON value (any valid type) |

**Result:** Human-readable confirmation or error message, e.g.:
- `Added property "status" to "Note Title"`
- `Note not found: <input>`
- `Property "status" already exists in "Note Title"`
- `"notanumber" is not a valid number`

---

### `property_remove`

Removes a frontmatter property from a note. Updates the file on disk and deletes the entry from the database immediately.

| Parameter | Type   | Required | Description                                                    |
| --------- | ------ | -------- | -------------------------------------------------------------- |
| `note`    | string | yes      | Note to target: vault-relative path, title, or existing alias. |
| `name`    | string | yes      | Frontmatter key to remove.                                     |

**Result:** Human-readable confirmation or error message, e.g.:
- `Removed property "status" from "Note Title"`
- `Note not found: <input>`
- `Property "status" not found in "Note Title"`

---

## Server

### `exit`

Shuts down the MCP server process. Takes no parameters.

**Result:** `Server is shutting down.`
