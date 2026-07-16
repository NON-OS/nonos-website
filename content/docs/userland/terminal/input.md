---
title: "Terminal input handling"
description: "Input in capsuleterminal is a small tree of handlers under src/event/."
weight: 1
---
Input in `capsule_terminal` is a small tree of handlers under `src/event/`. The window subscribes only to
key-down, so an event arrives, gets filtered to key-down, is offered first to the pointer and multi-tab
layers, and then lands in the per-tab key router that owns editing, control chords, line submission, tab
completion, history recall, and clipboard. Each handler is one file, and this page walks them in that
order. For the wider capsule (commands, identity, IPC, security) see the [terminal overview](/docs/userland/terminal/).

## Event gate

Before anything reaches a tab, the `App` layer wraps the event. A pointer ButtonDown on the tab strip is
handled first, then the Ctrl multi-tab chords, and only then is the event forwarded to the active tab's
`on_event` ([`src/term/terminal/app_impl_on_event.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/terminal/app_impl_on_event.rs#L23)). `on_event` itself does one thing: it drops any
event that is not a key-down and passes the rest to the key router ([`src/event/on_event.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/event/on_event.rs#L22)).

| Step | What it does | Source |
|---|---|---|
| Pointer ButtonDown | route to the tab strip before any tab sees it | `app_impl_on_event.rs:24` |
| Ctrl multi-tab chords | offered next, claim tab open/close/switch/jump | `app_impl_on_event.rs:29` |
| Forward to active tab | hand the event to the tab's `on_event` | `app_impl_on_event.rs:32` |
| Non key-down | ignored, returns Idle | `on_event.rs:23` |

## Key dispatch

`on_key` is the per-tab router. If the Ctrl modifier is set it gives the control-chord handler first
refusal, and if that handler claims the code the result is returned immediately; otherwise it matches the
key code against the editing and navigation set ([`src/event/on_key.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/event/on_key.rs#L32)). A change to the line returns
Repaint and a no-op returns Idle, which is what `bool_to_outcome` encodes for the edits that report whether
they changed anything ([`src/event/bool_to_outcome.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/event/bool_to_outcome.rs#L19)).

| Key | Action | Source |
|---|---|---|
| Ctrl held | try the control-chord handler first | `on_key.rs:33` |
| Esc | close the window | `on_key.rs:39` |
| Enter | run the line | `on_key.rs:40`, `on_enter.rs:26` |
| Backspace | delete the char before the cursor | `on_key.rs:41` |
| Delete | delete the char at the cursor | `on_key.rs:42` |
| Left | move the cursor one column left | `on_key.rs:43` |
| Right | move the cursor one column right | `on_key.rs:44` |
| Home | move to start of line | `on_key.rs:45` |
| End | move to end of line | `on_key.rs:49` |
| Up | history recall, previous match | `on_key.rs:53`, `on_up.rs:21` |
| Down | history recall, next match | `on_key.rs:54`, `on_down.rs:21` |
| Page Up | scroll the scrollback up one screen | `on_key.rs:55` |
| Page Down | scroll the scrollback down one screen | `on_key.rs:59` |
| Tab | complete the command word or a vfs path | `on_key.rs:63`, `on_tab.rs:30` |
| Printable 0x20..=0x7E | insert at the cursor | `on_key.rs:64`, `on_printable.rs:21` |
| Anything else | ignored, returns Idle | `on_key.rs:65` |

Page Up and Page Down scroll by `VISIBLE_ROWS - 2`, a screen less two rows for overlap (`on_key.rs:56`,
`on_key.rs:60`). A printable byte is inserted, and on a successful insert the handler resets the history
cursor and jumps the scrollback to the bottom so typing always returns to the live prompt
([`src/event/on_printable.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/event/on_printable.rs#L22)).

## Control chords

When Ctrl is held, `on_ctrl` matches the key code against the chord set. Both the upper-case and lower-case
codes for each letter are accepted, so the chord fires regardless of Shift or Caps state, and Shift is
inspected separately only to split copy from interrupt ([`src/event/on_ctrl.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/event/on_ctrl.rs#L40)). A chord that matches
returns `Some(outcome)` and short-circuits the router; an unmatched code returns `None` and falls through
to normal key dispatch (`on_ctrl.rs:77`).

| Chord | Action | Source |
|---|---|---|
| Ctrl+V | paste printable clipboard bytes into the line | `on_ctrl.rs:43`, `paste_clipboard.rs:22` |
| Ctrl+Shift+C | copy the current line to the clipboard | `on_ctrl.rs:44`, `copy_line.rs:21` |
| Ctrl+L | clear the scrollback and jump to the bottom | `on_ctrl.rs:45` |
| Ctrl+C | clear the line, reset the history cursor, print `^C` | `on_ctrl.rs:50` |
| Ctrl+U | clear the line | `on_ctrl.rs:57` |
| Ctrl+W | delete the word before the cursor | `on_ctrl.rs:61` |
| Ctrl+K | kill from the cursor to end of line | `on_ctrl.rs:65` |
| Ctrl+A | move to start of line | `on_ctrl.rs:69` |
| Ctrl+E | move to end of line | `on_ctrl.rs:73` |

Ctrl+C alone is a line and interrupt reset that prints `^C`; it does not signal or kill a child, because
the shell runs commands inline rather than as separate processes (`on_ctrl.rs:50`). Copy is bound to
Ctrl+Shift+C, tested before the bare Ctrl+C arm, so it does not collide with the interrupt
(`on_ctrl.rs:44`). Ctrl+L clears the scrollback where Ctrl+U clears only the current input line.

## Line submission

Enter is handled in `on_enter`. It timestamps the block, echoes the prompt and the typed line into the
scrollback, records the line in history, then splits it into `(connector, statement)` pairs and runs each
one under `;`, `&&`, `||` gating before closing the block with the elapsed duration and the final status
([`src/event/on_enter.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/event/on_enter.rs#L26)).

| Step | What it does | Source |
|---|---|---|
| Open block | start a rendered command block stamped with the RTC time | `on_enter.rs:29` |
| Echo | push prompt plus the typed line to the scrollback | `on_enter.rs:36` |
| Record history | append the line to the history ring | `on_enter.rs:39` |
| Sequence | split on `;` `&&` `||` and gate each statement | `on_enter.rs:42` |
| Expand and run | alias-expand, variable-expand, parse, then run | `on_enter.rs:52` |
| Exit check | an `Exit` outcome from `run` closes the window | `on_enter.rs:55`, `on_enter.rs:66` |
| Close block | record elapsed ms and the last status, evict old blocks | `on_enter.rs:62` |
| Reset | clear the input line and jump to the bottom | `on_enter.rs:64` |

Each statement resets `last_status` to true before it runs, and the `&&`/`||` gate reads the previous
statement's status, so `a && b` runs `b` only if `a` succeeded and `a || b` runs `b` only if `a` failed
(`on_enter.rs:43`, `on_enter.rs:51`). If any statement's `run` returns `Exit` the loop breaks and the whole
event resolves to Close (`on_enter.rs:55`); otherwise it resolves to Repaint (`on_enter.rs:68`).

## Tab completion

Tab is handled in `on_tab`. It finds the current word as the text after the last space and completes it
against one of two sources: the first token completes against the shell's command table, and any later
token completes against vfs paths resolved relative to the shell's cwd ([`src/event/on_tab.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/event/on_tab.rs#L30)). When a
later token needs completing the handler first caches the terminal's own pid through a service lookup so it
can call the vfs list op (`on_tab.rs:37`).

| Case | What it does | Source |
|---|---|---|
| First token | candidates from the command table | `on_tab.rs:34`, `complete.rs:88` |
| Later token | candidates from vfs paths under the resolved prefix | `on_tab.rs:40`, `on_tab.rs:41` |
| Common prefix | extend the word by the candidates' shared prefix | `on_tab.rs:50` |
| Extension found | splice the extension into the line | `on_tab.rs:52` |
| No extension, many candidates | list the candidates on their own line | `on_tab.rs:57` |
| vfs list error | leave the line unchanged, repaint | `on_tab.rs:43` |

The command table is the fixed list of every command name and alias the shell accepts as a first token
([`src/event/complete.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/event/complete.rs#L21)); `command_candidates` filters it by the typed prefix (`complete.rs:88`) and
`common_prefix` returns the longest shared prefix across the surviving candidates (`complete.rs:92`). When
the common prefix extends past what is typed, the word grows by that extension; when it does not and more
than one candidate remains, the candidates are printed so the user can see the options and cannot extend
further (`on_tab.rs:52`, `on_tab.rs:57`).

## History recall

Up and Down drive a prefix-aware search over the history ring. Up starts a fresh search by capturing
whatever is typed so far as the prefix, or keeps the prefix an in-progress search began with, then walks
back to the previous matching entry ([`src/event/on_up.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/event/on_up.rs#L21)). Down walks forward through matches and, once
it runs past the newest one, restores the text the search started from ([`src/event/on_down.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/event/on_down.rs#L21)).

| Key | Action | Source |
|---|---|---|
| Up, no search active | capture the typed text as the search prefix | `on_up.rs:24` |
| Up | replace the line with the previous matching entry | `on_up.rs:28` |
| Down | replace the line with the next matching entry | `on_down.rs:22` |
| Down past newest | restore the text the search began from | `on_down.rs:24` |

A recall with no match returns Idle and leaves the line as it is (`on_up.rs:33`, `on_down.rs:32`). The
prefix is held on the tab's state so the search is stable across repeated presses until an edit resets the
history cursor (`on_up.rs:26`).

## Copy and paste

Copy and paste are the two clipboard chords, each a thin call into the app skeleton's clipboard client.
Ctrl+Shift+C sends the current line to the clipboard and reports Idle since the line itself does not change
([`src/event/copy_line.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/event/copy_line.rs#L21)). Ctrl+V reads the clipboard into a line-width buffer and inserts only the
printable bytes, skipping control bytes, then resets the history cursor and jumps to the bottom if anything
was inserted ([`src/event/paste_clipboard.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/event/paste_clipboard.rs#L22)).

| Chord | Action | Source |
|---|---|---|
| Ctrl+Shift+C | copy the current line, returns Idle | `copy_line.rs:22` |
| Ctrl+V | paste, insert printable bytes only | `paste_clipboard.rs:22` |
| Ctrl+V, empty or non-printable | nothing inserted, returns Idle | `paste_clipboard.rs:37` |

Paste is bounded to `COLS` bytes by the read buffer, and the filter keeps only 0x20..=0x7E so a clipboard
carrying newlines or control codes cannot break the single-line editor (`paste_clipboard.rs:23`,
`paste_clipboard.rs:30`).

## Pointer

Pointer input is handled above the tab in `tab_click`, reached only for a ButtonDown on the tab strip
([`src/term/terminal/app_impl_on_event.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/terminal/app_impl_on_event.rs#L24)). A click outside the strip's vertical band is ignored so it
never disturbs the active shell ([`src/term/terminal/tab_click.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/terminal/tab_click.rs#L24)). Within the strip the x coordinate
picks out the new-tab plus box, a tab's close box, or the tab body.

| Region | Action | Source |
|---|---|---|
| Outside the strip band | ignored, returns None | `tab_click.rs:24` |
| Plus box after the last tab | open a new tab | `tab_click.rs:29` |
| Past the last tab, not the plus | ignored, returns None | `tab_click.rs:34` |
| A tab's close box | select that tab and close it | `tab_click.rs:37` |
| A tab body | select that tab | `tab_click.rs:41` |

## Multi-tab shortcuts

The Ctrl multi-tab chords are claimed in `tab_command`, offered before the event reaches the active tab
([`src/term/terminal/app_impl_on_event.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/terminal/app_impl_on_event.rs#L29)). It fires only for a key-down with Ctrl held, uses Shift to
guard the open and close chords, and supports up to nine tabs ([`src/term/terminal/tabs.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/terminal/tabs.rs#L29)).

| Chord | Action | Source |
|---|---|---|
| Ctrl+Shift+T | open a new tab, up to 9 | `tabs.rs:35`, `tabs.rs:45` |
| Ctrl+Shift+W | close the active tab, or close the window if it is the last | `tabs.rs:36`, `tabs.rs:52` |
| Ctrl+Page Down | switch to the next tab, wrapping | `tabs.rs:37`, `tabs.rs:63` |
| Ctrl+Page Up | switch to the previous tab, wrapping | `tabs.rs:38`, `tabs.rs:63` |
| Ctrl+1 .. Ctrl+9 | jump to tab 1..9 | `tabs.rs:39`, `tabs.rs:68` |

Opening a tab is a no-op once nine are open (`tabs.rs:46`), closing the last tab returns Close so the
window goes away (`tabs.rs:53`), switching wraps around the tab count in both directions (`tabs.rs:65`), and
a jump to an index past the last tab is ignored (`tabs.rs:69`). A chord `tab_command` does not recognise
returns None and falls through to the tab's own key handling (`tabs.rs:40`).

## Source map

```
  src/event/on_event.rs        the key-down gate into the active tab
  src/event/on_key.rs          the per-tab key router (edit, navigate, dispatch)
  src/event/on_ctrl.rs         the control chords
  src/event/on_printable.rs    printable insert
  src/event/on_enter.rs        line submission, sequencing, and run
  src/event/on_tab.rs          tab completion
  src/event/complete.rs        the command table and prefix helpers
  src/event/on_up.rs           history recall, previous match
  src/event/on_down.rs         history recall, next match
  src/event/copy_line.rs       Ctrl+Shift+C copy
  src/event/paste_clipboard.rs Ctrl+V paste
  src/event/bool_to_outcome.rs changed -> Repaint / Idle
  src/event/mod.rs             the handler module tree
  src/term/terminal/app_impl_on_event.rs   pointer and multi-tab wrap over on_event
  src/term/terminal/tab_click.rs           pointer routing on the tab strip
  src/term/terminal/tabs.rs                the Ctrl multi-tab chords
```

Every reference above is verified against those trees.
