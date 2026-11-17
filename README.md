# Hamish (هامش)

A reader for the Arabic digitization corpus. You import books from the `arabic-digitization` API into Hamish's own local library, then read them right to left in a reader where you can:

- highlight passages in four colours,
- write notes on a word or phrase, edited in place in a popover,
- add your own harakat to the text,
- mark where you last read,
- ask Claude about a selected passage, with answers that link to lines on the page,
- export highlights and notes to Obsidian.

## Product decisions

- **Books are imported, then read locally.** Importing pulls every transcribed page of a corpus book, parses it (rules below) and stores the result in Hamish's local library, a SQLite database in the app's data folder. From then on the reader, the agent tools and Ask AI read only that local copy; the corpus is not queried while reading. The corpus is the only import source for now.
- **Syncing is explicit.** For an imported book you can pull pages the corpus has gained since import (existing pages are left alone), or overwrite chosen pages with the corpus's current text. Pages the corpus hasn't finished transcribing are skipped and counted as pending.
- **Pages:** Library, Reader and Settings. There is no search page and no page that lists every note.
- **Page text is the matn plus the ḥāshiya, nothing else.** Corpus pages are markdown: the matn first, then `---` and a `### الحاشية` heading before the footnotes. Interlinear glosses (small text written between the lines) come as `<ruby>base<rt>gloss</rt></ruby>`. Hamish keeps the base words and drops the `<rt>` gloss everywhere, in the matn and in the ḥāshiya. Highlights, notes and harakat are positioned against this cleaned text, and the agent API's `get_page` returns the same text.
- **Highlights and notes are separate.** A highlight is a colour on a range of text. A note is text anchored to a word or phrase, shown with a dotted underline. Hovering the anchor opens a popover above or below it, where the note is edited directly and saves itself.
- **The side panel has three tabs:** Highlights, Notes and Ask AI. The Highlights and Notes tabs show only the current page.
- **Your harakat never change the corpus.** They are stored as a separate layer (position in the page text plus the mark) and drawn over the corpus text in `ink-added` red, so they are easy to tell apart from the corpus's own marks.
- **Adding harakat works like typing.** Click a letter, or select one, to put a caret after it. Type the haraka with the normal Arabic layout (Shift+Q fatha, Shift+E damma, Shift+A kasra, Shift+X sukun, Shift+\` shadda, Shift+W/R/S tanwīn) and it attaches to that letter. Backspace removes your mark, ← → move one letter, Esc leaves. The typed character is used when the OS layout is Arabic. Otherwise Hamish maps the physical key (`KeyboardEvent.code`) to its position on the standard Arabic layout, so the same keys work on an English layout. The selection toolbar's Harakat button enters the same mode.
- **Harakat display:** a "Harakat" switch hides or shows all marks, the corpus's and yours (shortcut `H`). A "My harakat" switch hides only yours. It is disabled while all harakat are hidden.
- **Agent access:** Hamish runs a local MCP server so Claude, or any MCP client, can read pages from the local library and add or remove harakat, notes and highlights (`list_books`, `get_page`, `get_lines`, `list_annotations`, `add_harakat`, `remove_harakat`, `add_note`, `update_note`, `delete_note`, `add_highlight`, `remove_highlight`). Notes an agent writes are labelled with the agent's name.
- **Ask AI cites the page, not the corpus.** Answers link to lines of the matn and ḥāshiya on the current page as inline chips (`line 1`, `ḥāshiya ١`). Clicking one scrolls to that line and highlights it. There are no links to other books.
- **The contents sidebar collapses** with a toggle next to the back button. The page re-centres in the freed space.
- **Ask AI uses a local Claude Code session**, not an API key. Settings holds the path to the `claude` binary and the folder it starts in, so it can use the corpus search tools.

## Stack

- **Electron, not Tauri.** Electron ships its own Chromium, so Arabic shaping renders the same on every OS. Tauri uses the system webview (WebKitGTK on Linux), which caused Arabic rendering problems in the past. The harakat layer depends on Chromium's behaviour: a mark in its own coloured span stays attached and the letters stay joined.
- The Electron main process (Node) starts the local Claude Code session and hosts the MCP server for agent access.
- Same base as the Qiraa desktop app in `arabic-digitization/apps/desktop` (Electron, Vite, React, bundled Noto Naskh Arabic). Its markdown reader, which handles `### الحاشية` and `<ruby>`, can be shared through `@qiraa/shared`.

## Ask AI behaviour

**Hidden reading context.** Every message to Claude carries a small context block that the user never sees in their own message bubble or in the chat history. It holds only where the reader is:

- the book's ID in the local library,
- the page position (and printed page number),
- the selected text and its line range, when there is a selection.

Claude pulls everything else itself through the agent API (`get_page`, `get_lines`, `list_annotations`), which reads the local library, so the prompt stays small and the text Claude sees is exactly what the reader shows. The only visible trace is the composer badge (for example "Local Claude · page 3 + selection").

**Keeping Arabic and English on separate lines.** The system prompt tells Claude:

- An English paragraph may contain a few Arabic words inline.
- When a paragraph would start with Arabic, the Arabic goes on its own line or lines, and any English follows on a new line. A line never starts in Arabic and then switches to English.

The renderer gives each line or paragraph its own direction (`dir="auto"`, `unicode-bidi: plaintext`). An Arabic line then sets right to left and an English line left to right, whatever direction the panel is in.

## Status

Design only. No app code yet.

- `designs/hamish-components.lamsa.json` holds the design system: colour tokens, the type scale, and components with their state grids.
- `designs/hamish.lamsa.json` holds the screens, one row per page: Library, Reader, Ask AI, Settings, Dark mode.
- `src/styles/tokens.css` is the token source that lamsa reads, in Tailwind v4 `@theme` form, with light and dark values.

Render with `lamsa render`, and check with `lamsa validate`.
