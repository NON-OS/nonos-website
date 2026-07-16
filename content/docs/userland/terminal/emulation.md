---
title: "Terminal emulation"
description: "The emulator is the largest pillar of capsuleterminal: about ninety files under src/term/, one concern per file."
weight: 3
---
The emulator is the largest pillar of `capsule_terminal`: about ninety files under `src/term/`, one
concern per file. It is a real VT/ANSI terminal that happens to be driven by an in-process shell rather
than a pty. Bytes that the shell (or an installed capsule) produces are fed into a scrollback grid, an
ANSI escape parser walks them into a character-cell buffer, and a painter projects the visible window of
that buffer to the surface each frame. Around that core sit the input line editor, the command history,
the current-directory tracker, the per-tab shell state, and the top-level `Terminal` object that owns up
to nine tabs. This page mirrors `src/term/` subdir by subdir. For the wider capsule (commands, identity,
IPC, security) see the [terminal overview](/docs/userland/terminal/).

The screen is fixed at compile time: 96 columns, 15 visible rows, 256 rows of scrollback, and 32 command
history entries ([`src/term/dimensions.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/dimensions.rs#L17)).

## The parser (`term/vt/`)

The `vt` layer is a self-contained VT/ANSI state machine plus the color model. It has no dependency on
the shell; it only knows how to turn a byte stream into cursor moves, prints, and attribute changes on a
`Grid`.

[`term/vt/parser.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/term/vt/parser.rs) is the escape parser. `Parser` is a byte-at-a-time state machine over an eight-state
enum (`Ground`, `Escape`, `EscapeInter`, `CsiEntry`, `CsiParam`, `CsiInter`, `Osc`, `OscEsc`)
([`src/term/vt/parser.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/vt/parser.rs#L28)). It collects up to sixteen numeric CSI parameters, up to four intermediate
bytes, and an OSC string capped at 256 bytes, then calls back into a `Perform` trait with five methods:
`print`, `execute`, `csi`, `esc`, and `osc` ([`src/term/vt/parser.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/vt/parser.rs#L19)). In `Ground`, `0x1B` opens an
escape, `0x00..=0x1F` are C0 controls dispatched to `execute`, `0x7F` (DEL) is dropped, and everything
else prints ([`src/term/vt/parser.rs:66`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/vt/parser.rs#L66)). A parameter digit is folded into the current slot and clamped
at 65535, `;` opens the next slot, and a final byte in `0x40..=0x7E` fires the CSI callback
([`src/term/vt/parser.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/vt/parser.rs#L49), `:88`).

[`term/vt/state.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/term/vt/state.rs) is the `Perform` implementation. `VtState` holds a mutable `Grid` and turns parser
callbacks into grid edits ([`src/term/vt/state.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/vt/state.rs#L23)). `print` writes a cell; `execute` handles
backspace (0x08), tab to the next multiple of 8 (0x09), line feed (0x0A, a CR plus LF), and carriage
return (0x0D) ([`src/term/vt/state.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/vt/state.rs#L32)). `csi` routes by final byte: cursor letters go to
`csi_cursor`, the edit letters `J K P @` go to `csi_edit`, `m` is SGR, and `h`/`l` are DEC set/reset
([`src/term/vt/state.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/vt/state.rs#L45)). `esc` and `osc` are accepted but ignored.

[`term/vt/csi_cursor.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/term/vt/csi_cursor.rs) moves the cursor. It implements CUU/CUD/CUF/CUB (`A B C D`), CNL/CPL (`E F`),
column and row absolute (`G`, `d`), cursor position (`H`, `f`, one-based to zero-based), and scroll-up
(`S`), each clamped to the grid bounds ([`src/term/vt/csi_cursor.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/vt/csi_cursor.rs#L28)). [`term/vt/csi_edit.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/term/vt/csi_edit.rs) erases and
shifts: erase-in-display (`J`) and erase-in-line (`K`) with the standard modes 0/1/2, delete-character
(`P`), and insert-blank (`@`), the last two shifting the row with `move_cells` and blanking the vacated
span ([`src/term/vt/csi_edit.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/vt/csi_edit.rs#L24)).

[`term/vt/sgr.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/term/vt/sgr.rs) applies Select Graphic Rendition. An empty or `0` parameter resets fg, bg, and flags;
`1`/`4`/`7` set bold, underline, reverse and their `2x` counterparts clear them; `30..=37` and `40..=47`
set the eight base fg/bg colors, `90..=97` and `100..=107` the bright set, and `38`/`48` consume an
extended `5;n` (256-color) or `2;r;g;b` (truecolor) run through `ext_color`
([`src/term/vt/sgr.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/vt/sgr.rs#L21), `:53`). [`term/vt/decset.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/term/vt/decset.rs) handles the private DEC modes, and only when the
`?` intermediate is present: `25` toggles cursor visibility, `47`/`1047` swap to the alternate screen,
and `1049` swaps with a clear ([`src/term/vt/decset.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/vt/decset.rs#L19)).

[`term/vt/color.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/term/vt/color.rs) is the palette. `DEFAULT_FG` is 7 and `DEFAULT_BG` is 0 ([`src/term/vt/color.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/vt/color.rs#L17)).
`ansi_to_argb` maps an index to a packed ARGB pixel, covering the 16 named colors, the 6x6x6 color cube
(`16..=231`), and the 24-step grayscale ramp (`232..=255`) ([`src/term/vt/color.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/vt/color.rs#L20)).
`argb_nearest_ansi` goes the other way, snapping an r/g/b triple to the nearest cube index so a truecolor
SGR request degrades to the palette the cells actually store ([`src/term/vt/color.rs:55`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/vt/color.rs#L55)).

## Grid, scrollback, and history

These three subdirs hold the on-screen text. The grid is the live viewport plus its ring of scrolled-off
rows; the scrollback wraps the grid with the interface the shell writes lines through; the history is a
separate ring of submitted command lines for recall.

### `term/grid/`

[`term/grid/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/term/grid/types.rs) defines `Grid`. Alongside the live `cells` vector it carries an `alt` buffer for the
alternate screen, a `history` ring of `SCROLLBACK_ROWS` rows with `hist_head`/`hist_count`, a
`view_offset` for scrollback position, cursor `x`/`y`, current `fg`/`bg`/`flags`, the owned `Parser`, and
a monotonic `total_scrolled` counter used to give every line an absolute number
([`src/term/grid/types.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/grid/types.rs#L23)). A cell is four bytes: character, fg, bg, flags, with `F_BOLD`,
`F_UNDERLINE`, `F_REVERSE` bit flags ([`src/term/grid/cell.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/grid/cell.rs#L17)). `new.rs` allocates the three buffers
blank and seeds fg/bg to the defaults ([`src/term/grid/new.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/grid/new.rs#L26)).

[`term/grid/put.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/term/grid/put.rs) is the write path: `put_char` stamps a cell at the cursor with the current attributes
and advances, wrapping to a line feed at column 96; `line_feed` advances the row and scrolls when it runs
past the last visible row; `carriage_return` returns to column 0 ([`src/term/grid/put.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/grid/put.rs#L25)).
[`term/grid/scroll.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/term/grid/scroll.rs) is `scroll_up_one`, the one operation that moves a row out of view: it copies the
top visible row into the next scrollback ring slot, advances the ring (evicting the oldest once full),
bumps `total_scrolled`, shifts the visible rows up, and blanks the bottom row
([`src/term/grid/scroll.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/grid/scroll.rs#L21)).

[`term/grid/feed.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/term/grid/feed.rs) is the entry point the rest of the terminal uses. `feed` temporarily takes the grid's
own `Parser` out, runs every byte through it against a `VtState` wrapper, and puts it back, so escape
state persists across calls ([`src/term/grid/feed.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/grid/feed.rs#L22)). [`term/grid/erase.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/term/grid/erase.rs) holds `erase_line`,
`erase_display`, and `clear` ([`src/term/grid/erase.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/grid/erase.rs#L21)); [`term/grid/move_cells.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/term/grid/move_cells.rs) is the bounded
row-shift primitive that `csi_edit` builds on ([`src/term/grid/move_cells.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/grid/move_cells.rs#L21)); [`term/grid/alt.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/term/grid/alt.rs)
swaps `cells` with `alt` on enter/leave ([`src/term/grid/alt.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/grid/alt.rs#L20)).

[`term/grid/view.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/term/grid/view.rs) is what the painter reads: `visible_row(i)` returns the i-th visible row, resolving
whether that row currently comes from the scrollback ring or the live buffer given `view_offset`
([`src/term/grid/view.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/grid/view.rs#L22)). [`term/grid/scroll_view.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/term/grid/scroll_view.rs) moves that viewport: `scroll_view_up`,
`scroll_view_down`, and `jump_view_bottom` clamp `view_offset` between 0 and `hist_count`
([`src/term/grid/scroll_view.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/grid/scroll_view.rs#L20)). [`term/grid/absline.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/term/grid/absline.rs) derives absolute line numbers
(`current_abs_line`, `abs_base`, `abs_of_visible_row`) that the output-block model keys off
([`src/term/grid/absline.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/grid/absline.rs#L20)).

### `term/scrollback/`

[`term/scrollback/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/term/scrollback/types.rs) is a thin wrapper: `Scrollback` owns the `Grid` and an optional `capture`
buffer of captured lines ([`src/term/scrollback/types.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/scrollback/types.rs#L21)). The shell never touches the grid directly;
it calls `push_line` and `push_error`. [`term/scrollback/push_line.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/term/scrollback/push_line.rs) appends a normal line, but while a
capture is active it diverts the bytes into the capture buffer instead of the visible grid, which is how
`> file` and pipelines collect output ([`src/term/scrollback/push_line.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/scrollback/push_line.rs#L23)).
[`term/scrollback/push_raw.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/term/scrollback/push_raw.rs) is the real render: a normal line is fed to the grid followed by a newline,
an error line is wrapped in `\x1b[31m ... \x1b[0m` so it prints red ([`src/term/scrollback/push_raw.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/scrollback/push_raw.rs#L21)).
[`term/scrollback/push_error.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/term/scrollback/push_error.rs) routes an error line to the error color, but during capture sends it as
plain bytes so a redirected file never receives color escapes ([`src/term/scrollback/push_error.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/scrollback/push_error.rs#L24)).

[`term/scrollback/capture.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/term/scrollback/capture.rs) is the capture switch: `begin_capture` starts diverting, `end_capture`
takes the buffered lines back ([`src/term/scrollback/capture.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/scrollback/capture.rs#L24)). [`term/scrollback/role.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/term/scrollback/role.rs) is the
two-value `Role` (`Normal`, `Error`) that tags how a line renders ([`src/term/scrollback/role.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/scrollback/role.rs#L20)).
`feed_raw` passes bytes straight through to the grid parser for output that already carries its own
escapes ([`src/term/scrollback/feed_raw.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/scrollback/feed_raw.rs#L20)); `scroll_up`, `scroll_down`, `jump_bottom`, and `clear`
forward to the grid's viewport and clear operations ([`src/term/scrollback/scroll_up.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/scrollback/scroll_up.rs#L20)).

### `term/history/`

[`term/history/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/term/history/types.rs) defines `History` as a fixed `HISTORY_DEPTH` (32) array of `COLS`-wide lines with
their lengths, a `count`, and an optional recall `cursor` ([`src/term/history/types.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/history/types.rs#L19)).
[`term/history/push.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/term/history/push.rs) records a submitted line: empties are skipped, an exact repeat of the last entry
is deduplicated, and when the ring is full the oldest entry is shifted out
([`src/term/history/push.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/history/push.rs#L21)). Recall is prefix-aware: `prev_matching` walks toward older entries and
returns the first that starts with a given prefix, leaving the cursor on it
([`src/term/history/prev_matching.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/history/prev_matching.rs#L24)); `next_matching` walks toward newer entries and returns an empty
slice when it runs past the newest, so the caller can restore the line being typed
([`src/term/history/next_matching.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/history/next_matching.rs#L24)). `searching` reports whether a recall is in progress,
`reset_cursor` cancels it, and `get`/`count` expose the entries for the `history` command
([`src/term/history/searching.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/history/searching.rs#L22), `reset_cursor.rs:20`, `get.rs:21`).

## Line editing, prompt, and cwd

These subdirs are the input side: the editable command line, the prompt glyph printed before it, and the
directory the shell resolves paths against.

### `term/line/`

[`term/line/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/term/line/types.rs) is `Line`: a fixed `COLS`-byte buffer, a `len`, and a `cursor` column
([`src/term/line/types.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/line/types.rs#L19)). Every edit is one file and each returns a `bool` for whether it changed
anything, which the input layer turns into a repaint-or-idle outcome. `insert` places a byte at the
cursor, shifting the tail right, refusing once the line is full ([`src/term/line/insert.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/line/insert.rs#L21));
`backspace` removes the byte before the cursor and `delete` the byte at it. `delete_word` is Ctrl+W: it
skips trailing spaces then removes the preceding run of non-space characters
([`src/term/line/delete_word.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/line/delete_word.rs#L22)); `kill_to_end` is Ctrl+K, truncating at the cursor
([`src/term/line/kill_to_end.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/line/kill_to_end.rs#L21)). The five cursor moves (`move_left`, `move_right`, `move_home`,
`move_end`) and `clear` round out the editor. `replace` overwrites the whole line and parks the cursor at
the end, which is how history recall and the self-test inject a line ([`src/term/line/replace.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/line/replace.rs#L21));
`as_bytes` exposes the current text to the command dispatcher ([`src/term/line/as_bytes.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/line/as_bytes.rs#L20)).

### `term/prompt/`

[`term/prompt/bytes.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/term/prompt/bytes.rs) is a single constant: `PROMPT_BYTES` is the two bytes `\xd8 ` (the NØNOS glyph and
a space) printed before the input line ([`src/term/prompt/bytes.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/prompt/bytes.rs#L17)). The module re-exports it and
nothing else ([`src/term/prompt/mod.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/prompt/mod.rs#L19)).

### `term/cwd/`

[`term/cwd/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/term/cwd/types.rs) wraps a single byte-vector path ([`src/term/cwd/types.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/cwd/types.rs#L19)); `new` starts it at `/`
([`src/term/cwd/new.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/cwd/new.rs#L22)). The load-bearing file is [`term/cwd/resolve.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/term/cwd/resolve.rs): `resolve(cwd, arg)`
normalizes an argument against the current directory, taking an absolute `arg` from root, and folding
`.`, empty segments, and `..` (which pops a segment) into a clean absolute path
([`src/term/cwd/resolve.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/cwd/resolve.rs#L19)). This is what every filesystem command calls before it talks to the vfs,
so path handling lives in one place. `set` replaces the path (used by `cd`), `as_bytes` reads it back
(for `pwd` and the footer), and `dir_prefix` appends a trailing slash for directory listings
([`src/term/cwd/set.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/cwd/set.rs#L22), `as_bytes.rs:20`, `dir_prefix.rs:19`).

## The terminal object, tabs, and state

The top of the tree is the `Terminal` object and the per-tab `State` it multiplexes, plus the block model
that annotates output.

### `term/terminal/`

[`term/terminal/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/term/terminal/types.rs) is `Terminal`: a vector of `State` tabs and an `active` index, with `cur`/
`cur_ref` accessors for the focused tab ([`src/term/terminal/types.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/terminal/types.rs#L21)). `new` opens with a single tab
([`src/term/terminal/new.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/terminal/new.rs#L23)). [`term/terminal/app_impl.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/term/terminal/app_impl.rs) is the `App` trait implementation the app
skeleton drives: `manifest`, `on_event`, `paint`, and an `on_tick` heartbeat
([`src/term/terminal/app_impl.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/terminal/app_impl.rs#L21)). Each delegates to a sibling: `app_impl_manifest.rs` returns the
window manifest, `app_impl_paint.rs` stamps the tab's start time then calls `paint_tabs`
([`src/term/terminal/app_impl_paint.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/terminal/app_impl_paint.rs#L22)), and `app_impl_on_event.rs` is the routing order: a pointer
ButtonDown goes to `tab_click`, then Ctrl chords go to `tab_command`, and only then does the event reach
the active tab's `on_event` ([`src/term/terminal/app_impl_on_event.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/terminal/app_impl_on_event.rs#L23)).

[`term/terminal/tabs.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/term/terminal/tabs.rs) is the multi-tab model. `tab_command` claims Ctrl chords before the per-tab
editor sees them: Ctrl+Shift+T opens a tab, Ctrl+Shift+W closes the active one, Ctrl+PageDown/PageUp
switch, and Ctrl+1..9 jump to a tab by index ([`src/term/terminal/tabs.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/terminal/tabs.rs#L29)). `MAX_TABS` is 9, so
`open_tab` refuses a tenth ([`src/term/terminal/tabs.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/terminal/tabs.rs#L24), `:45`); `close_tab` returns `Close` when the
last tab goes, which ends the window, otherwise removes the tab and clamps the active index
([`src/term/terminal/tabs.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/terminal/tabs.rs#L52)). `switch` wraps around the tab count and `jump` is bounds-checked
([`src/term/terminal/tabs.rs:63`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/terminal/tabs.rs#L63)). [`term/terminal/tab_click.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/term/terminal/tab_click.rs) is the pointer path over the tab strip: a
click on the plus zone opens a tab, a click on a tab's close zone selects then closes it, and a click on
the body selects it, all keyed off the strip geometry constants from the painter
([`src/term/terminal/tab_click.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/terminal/tab_click.rs#L23)).

[`term/terminal/selftest.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/term/terminal/selftest.rs) is compiled only under the `nonos-autorun-selftest` feature. It is a headless
entry that brings up the heap, waits for vfs to answer, then grades the emulator and shell paths, one
`[TERMINAL-TEST]` serial marker per step: the parser callbacks, grid ops, SGR, alt-screen, the block
model, absolute line numbers, and a batch of shell commands ([`src/term/terminal/selftest.rs:63`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/terminal/selftest.rs#L63), `:230`).
It is the executable spec for much of this page; for example `vt-parser` asserts that `A\x1b[31mB\x1b[0m\n\x1b[2J`
produces exactly the prints, executes, and CSIs described above ([`src/term/terminal/selftest.rs:100`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/terminal/selftest.rs#L100)).

### `term/state/` and `term/block/`

[`term/state/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/term/state/types.rs) is one tab. `State` holds the `Line`, the `History`, the `Scrollback`, the `Cwd`,
the cached `owner_pid`, a `fresh` flag, a `start_ms`, the shell `vars` and `aliases`, the `last_status`
that `&&`/`||` gate on, the `hist_prefix` captured when recall began, and the vector of output `blocks`
([`src/term/state/types.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/state/types.rs#L25)). `new` starts every tab clean with `last_status = true`
([`src/term/state/new.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/state/new.rs#L24)). Because each tab is a whole `State`, tabs share nothing: separate line,
history, cwd, variables, and aliases.

[`term/block/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/term/block/types.rs) is the per-command output block: a `Status` (`Running`, `Ok`, `Err`), the start
absolute line, a timestamp, and a duration ([`src/term/block/types.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/block/types.rs#L17)). [`term/block/ops.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/term/block/ops.rs) manages
the vector on `State`: `open_block` records the current absolute line when a command starts (capped at
256 blocks), `close_block` stamps the outcome and duration, `evict_blocks` drops blocks that have
scrolled out of the ring, and `block_at` finds the block covering an absolute line so the painter can
tint a row by the command it belongs to ([`src/term/block/ops.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/block/ops.rs#L22)).

## Helpers (`term/util/`)

`term/util/` is three small no-alloc helpers shared across the tree: `copy_into` copies a slice into a
fixed buffer, returning the byte count ([`src/term/util/copy_into.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/util/copy_into.rs#L17)); `format_u64` renders an integer
into a buffer without allocating ([`src/term/util/format_u64.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/util/format_u64.rs#L17)); `is_space` tests for space or tab
([`src/term/util/is_space.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/util/is_space.rs#L17)).

## Source map

```
  src/term/dimensions.rs         COLS 96, VISIBLE_ROWS 15, SCROLLBACK_ROWS 256, HISTORY_DEPTH 32
  src/term/vt/                   the VT/ANSI parser (parser, state, csi_cursor, csi_edit, sgr, decset, color)
  src/term/grid/                 the character-cell grid, alt screen, scroll ring, viewport, absolute lines
  src/term/scrollback/           the grid wrapper the shell writes lines and errors through, plus capture
  src/term/history/              the command-history ring with prefix-aware recall
  src/term/line/                 the input line editor (insert, delete, word/kill, cursor moves, replace)
  src/term/prompt/               the PROMPT_BYTES constant
  src/term/cwd/                  current-directory tracking and path resolution
  src/term/state/                State: one tab's line, history, scrollback, cwd, vars, aliases, status
  src/term/block/                the per-command output block model
  src/term/terminal/             Terminal: tabs, active index, App impl, tab routing, selftest
  src/term/util/                 no-alloc helpers (copy_into, format_u64, is_space)
```

Every reference above is verified against those trees.
