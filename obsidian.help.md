Notes:
  file resolves by name (like wikilinks), path is exact (folder/note.md)
  Most commands default to the active file when file/path is omitted
  Quote values with spaces: name="My Note"
  Use \n for newline, \t for tab in content values

Commands:
  aliases               List aliases in the vault
    file=<name>         - File name
    path=<path>         - File path
    total               - Return alias count
    verbose             - Include file paths
    active              - Show aliases for active file

  append                Append content to a file
    file=<name>         - File name
    path=<path>         - File path
    content=<text>      - Content to append (required)
    inline              - Append without newline

  backlinks             List backlinks to a file
    file=<name>         - Target file name
    path=<path>         - Target file path
    counts              - Include link counts
    total               - Return backlink count




  create                Create a new file
    name=<name>         - File name
    path=<path>         - File path
    content=<text>      - Initial content
    template=<name>     - Template to use
    overwrite           - Overwrite if file exists
    open                - Open file after creating
    newtab              - Open in new tab

  deadends              List files with no outgoing links
    total               - Return dead-end count
    all                 - Include non-markdown files

  delete                Delete a file
    file=<name>         - File name
    path=<path>         - File path
    permanent           - Skip trash, delete permanently

  file                  Show file info
    file=<name>         - File name
    path=<path>         - File path

  files                 List files in the vault
    folder=<path>       - Filter by folder
    ext=<extension>     - Filter by extension
    total               - Return file count

  folder                Show folder info
    path=<path>         - Folder path (required)
    info=files|folders|size  - Return specific info only

  folders               List folders in the vault
    folder=<path>       - Filter by parent folder
    total               - Return folder count

  links                 List outgoing links from a file
    file=<name>         - File name
    path=<path>         - File path
    total               - Return link count

  move                  Move or rename a file
    file=<name>         - File name
    path=<path>         - File path
    to=<path>           - Destination folder or path (required)

  orphans               List files with no incoming links
    total               - Return orphan count
    all                 - Include non-markdown files

  outline               Show headings for the current file
    file=<name>         - File name
    path=<path>         - File path
    format=tree|md|json - Output format (default: tree)
    total               - Return heading count

  prepend               Prepend content to a file
    file=<name>         - File name
    path=<path>         - File path
    content=<text>      - Content to prepend (required)
    inline              - Prepend without newline

  properties            List properties in the vault
    file=<name>         - Show properties for file
    path=<path>         - Show properties for path
    name=<name>         - Get specific property count
    total               - Return property count
    sort=count          - Sort by count (default: name)
    counts              - Include occurrence counts
    format=yaml|json|tsv  - Output format (default: yaml)
    active              - Show properties for active file

  property:read         Read a property value from a file
    name=<name>         - Property name (required)
    file=<name>         - File name
    path=<path>         - File path

  property:remove       Remove a property from a file
    name=<name>         - Property name (required)
    file=<name>         - File name
    path=<path>         - File path

  property:set          Set a property on a file
    name=<name>         - Property name (required)
    value=<value>       - Property value (required)
    type=text|list|number|checkbox|date|datetime  - Property type
    file=<name>         - File name
    path=<path>         - File path

  read                  Read file contents
    file=<name>         - File name
    path=<path>         - File path

  rename                Rename a file
    file=<name>         - File name
    path=<path>         - File path
    name=<name>         - New file name (required)

  search                Search vault for text
    query=<text>        - Search query (required)
    path=<folder>       - Limit to folder
    limit=<n>           - Max files
    total               - Return match count
    case                - Case sensitive

  search:context        Search with matching line context
    query=<text>        - Search query (required)
    path=<folder>       - Limit to folder
    limit=<n>           - Max files
    case                - Case sensitive
    format=text|json    - Output format (default: text)




  tag                   Get tag info
    name=<tag>          - Tag name (required)
    total               - Return occurrence count
    verbose             - Include file list and count

  tags                  List tags in the vault
    file=<name>         - File name
    path=<path>         - File path
    total               - Return tag count
    counts              - Include tag counts
    sort=count          - Sort by count (default: name)
    format=json|tsv|csv - Output format (default: tsv)
    active              - Show tags for active file



  unresolved            List unresolved links in vault
    total               - Return unresolved link count
    counts              - Include link counts
    verbose             - Include source files
    format=json|tsv|csv - Output format (default: tsv)

  wordcount             Count words and characters
    file=<name>         - File name
    path=<path>         - File path
    words               - Return word count only
    characters          - Return character count only

  workspace             Show workspace tree
    ids                 - Include workspace item IDs

