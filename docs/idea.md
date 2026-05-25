# clipboard-mcp-server

System clipboard access for MCP clients. Read, write, and inspect clipboard contents with type awareness.

## Why

Agents constantly work with text that needs to move between contexts — a URL you copied, a code snippet from a browser, an error message from another terminal. Today the workaround is "paste that into the chat" or reading a temp file. Direct clipboard access closes the loop.

Cross-platform viable (pbcopy/pbpaste on macOS, xclip/xsel on Linux, PowerShell on Windows), but macOS is the priority.

## Tools

### `clipboard_read`

Read current clipboard contents.

| Param | Type | Description |
|-------|------|-------------|
| `format` | `"text" \| "html" \| "rtf" \| "image" \| "auto"` | What format to return. `auto` (default) detects and returns the richest available representation. |

Returns:
- Text: raw string
- HTML: the HTML source (useful when you copy from a browser and want structure, not just plain text)
- RTF: raw RTF markup
- Image: base64-encoded PNG with dimensions metadata

### `clipboard_write`

Write content to the clipboard.

| Param | Type | Description |
|-------|------|-------------|
| `content` | `string` | The content to write |
| `format` | `"text" \| "html"` | Format of the content being written. Default `text`. |

HTML write sets both the HTML and plain-text representations (the plain-text version is the stripped content), so paste targets get whichever they prefer.

### `clipboard_inspect`

List the types/formats currently on the clipboard without reading the full content. Useful for deciding which format to request.

Returns: array of available UTI types with byte sizes (e.g., `public.utf8-plain-text: 342 bytes`, `public.html: 1.2 KB`, `public.png: 48 KB`).

## Implementation notes

**macOS approach:**
- Text read/write: `pbpaste` / `pbcopy` for plain text (fast, zero deps)
- Rich types and inspection: `osascript -e 'the clipboard info'` for type listing, NSPasteboard via JXA for HTML/RTF/image access
- Image read: JXA to get PNG data from pasteboard, return as base64

**Cross-platform (future):**
- Linux: `xclip -selection clipboard -o` / `xclip -selection clipboard`
- Windows: PowerShell `Get-Clipboard` / `Set-Clipboard`
- Detect platform at startup, select backend

## Scope boundaries

**In scope:** read, write, inspect what's currently on the clipboard. Simple, stateless operations.

**Out of scope (v1):**
- Clipboard history / ring buffer (needs a persistent daemon or polling loop)
- File references (the clipboard can hold file paths, but acting on them is filesystem-mcp-server's job)
- Clipboard monitoring / watching for changes (event-driven, needs long-running process)
- Drag-and-drop data

## Use cases

1. "Read my clipboard" — agent grabs what you just copied without you pasting it into chat
2. "Copy this to my clipboard" — agent stages output for you to paste elsewhere
3. "What did I just copy?" — inspect without reading full content (especially useful for large items or images)
4. "Get the HTML from what I copied" — preserve structure from browser copy, not just the rendered text
5. Agent pipelines — one tool's output goes to clipboard for handoff to a non-MCP tool
