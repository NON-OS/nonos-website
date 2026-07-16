---
title: "Actions"
description: "This page mirrors the file-operation units under src/fm/: the checkbox selection and the acting set (selection.rs, selectionacting.rs, selectionselectall.rs, selectionclear.rs, ..."
weight: 2
---
This page mirrors the file-operation units under `src/fm/`: the checkbox selection and the acting set
(`selection.rs`, `selection_acting.rs`, `selection_select_all.rs`, `selection_clear.rs`,
`selection_is_selected.rs`), the clipboard (`clipboard.rs`, `clipboard_paste.rs`), the in-place
duplicate (`duplicate.rs`), the read-only toggle (`perms.rs`), and the text prompts (`prompt_start.rs`,
`prompt.rs`, `prompt_commit.rs`, `prompt_run_op.rs`). These are the operations the browse keys reach;
the keys themselves are on [input.md](/docs/userland/file-manager/input/), and the vfs ops they call are named at the bottom of
this page. The refresh they run afterward is on [listing.md](/docs/userland/file-manager/listing/).

Every action here mutates the store through the vfs client, then calls `refresh` and sets a status line.
None of them touch a block device: the capsule holds no FileSystem capability, and each call is an IPC
request to the `vfs_pool` service that decides whether it is allowed (see
[README](/docs/userland/file-manager/#identity)).

## The single-key actions

`run_action` claims eight browse keys before the navigation keys are reached
([`src/fm/event_actions.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/event_actions.rs#L28)):

| Key | Action | Handler |
|-----|--------|---------|
| space | check or uncheck the entry under the cursor | `event_actions.rs:30`, `selection.rs:20` |
| `a` | select every entry in the current view | `event_actions.rs:31`, `selection_select_all.rs:19` |
| `c` | copy the acting set to the clipboard | `event_actions.rs:32`, `clipboard.rs:34` |
| `x` | cut the acting set to the clipboard | `event_actions.rs:33`, `clipboard.rs:34` |
| `p` | paste the clipboard into the current directory | `event_actions.rs:34`, `clipboard_paste.rs:22` |
| `o` | duplicate the acting set in place | `event_actions.rs:35`, `duplicate.rs:28` |
| `u` | toggle the acting set between writable and read-only | `event_actions.rs:36`, `perms.rs:29` |
| `s` | cycle the sort mode | `event_actions.rs:37` |

Sort cycling is a view concern and is covered on [listing.md](/docs/userland/file-manager/listing/); the rest are below.

## The acting set

The acting set is what a batch action operates on. `acting` returns the checkbox selection when any
entries are checked, and otherwise just the entry under the cursor, so every action works whether or not
a selection is active ([`src/fm/selection_acting.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/selection_acting.rs#L23)). It returns each path with its directory flag
(`selection_acting.rs:29`, `:33`).

The checkbox selection is a `Vec<String>` of full paths in `State`. Space toggles the entry under the
cursor in and out of it ([`src/fm/selection.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/selection.rs#L20)), `a` fills it with every entry in the current view
([`src/fm/selection_select_all.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/selection_select_all.rs#L20)), `is_selected` tests membership for the row highlight
([`src/fm/selection_is_selected.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/selection_is_selected.rs#L19)), and `clear` empties it ([`src/fm/selection_clear.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/selection_clear.rs#L19)). Copy,
cut, duplicate, and the read-only toggle all clear the selection after they run so the next action
starts fresh (`clipboard.rs:44`, `duplicate.rs:45`, `perms.rs:44`).

## Copy, cut, and paste

Copy and cut both run `yank`, which records the acting paths into the clipboard as `Clip` entries and
marks the cut flag; each path is stored the way the store holds it, with any trailing slash trimmed
([`src/fm/clipboard.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/clipboard.rs#L34), `:42`). An empty acting set leaves `nothing to yank`
(`clipboard.rs:37`).

Paste walks the clipboard and, for each clip, takes the base name and joins it to the current prefix to
form the destination ([`src/fm/clipboard_paste.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/clipboard_paste.rs#L32)). A cut clip is moved with `rename`; a copy clip is
copied with `copy`, passing the directory flag so a directory copies recursively
(`clipboard_paste.rs:34`). A cut clipboard is emptied after the paste (`clipboard_paste.rs:41`). The run
is per-entry: if any single call fails the status is `paste: some failed` while the successful ones
still applied, otherwise it is `moved` for a cut and `pasted` for a copy (`clipboard_paste.rs:45`).

## Duplicate

`o` copies each acting entry into the current directory under a non-colliding name
([`src/fm/duplicate.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/duplicate.rs#L28)). `unique_name` builds `name (copy).ext`, then `name (copy 2).ext`,
`name (copy 3).ext`, and so on, splitting the stem and extension at the last dot, until the candidate
does not collide with an existing entry (`duplicate.rs:52`, `:57`). The copy carries the directory flag,
so a duplicated directory copies recursively (`duplicate.rs:41`). Like paste it is per-entry:
`duplicate: some failed` if any call errored, otherwise `duplicated` (`duplicate.rs:47`).

## The read-only toggle

`u` flips the acting set between writable and read-only ([`src/fm/perms.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/perms.rs#L29)). For each entry it reads
the current `writable` flag from the store and chmods to `0o444` if it was writable or `0o644` if it was
not (`perms.rs:24`, `:38`). It is per-entry: `chmod: some failed` if any call errored, otherwise
`permissions changed` (`perms.rs:46`).

## The name prompts

Four browse keys open a text prompt through `start_prompt`, which sets the prompt mode, clears the input
buffer, and shows a status hint ([`src/fm/prompt_start.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/prompt_start.rs#L22)):

| Key | Prompt | vfs op | Handler |
|-----|--------|--------|---------|
| `n` | name, then create an empty file | `write_file` | `event_browse.rs:43`, `prompt_run_op.rs:29` |
| `m` | name, then create a directory | `mkdir` | `event_browse.rs:44`, `prompt_run_op.rs:32` |
| `r` | new name, then rename the cursor entry | `rename` | `event_browse.rs:45`, `prompt_run_op.rs:33` |
| `d` | `y` confirmation, then delete the cursor entry | `unlink` | `event_browse.rs:46`, `prompt_run_op.rs:38` |

A prompt collects one line of text: each ascii-graphic keystroke appends up to 64 characters, Backspace
pops, Esc cancels back to browse with a `cancelled` status, and Enter commits ([`src/fm/prompt.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/prompt.rs#L24),
`:38`). Commit takes the typed name, returns to browse, rejects an empty name for everything but delete
with `empty name`, joins the name to the prefix to form the target, runs the op, refreshes, and shows
the resulting status ([`src/fm/prompt_commit.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/prompt_commit.rs#L23), `:26`, `:30`).

`run_op` dispatches by prompt kind ([`src/fm/prompt_run_op.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/prompt_run_op.rs#L28)). Rename targets the cursor entry with
any trailing slash trimmed (`prompt_run_op.rs:35`). Delete is deliberately conservative: it only
proceeds when the typed text is exactly `y`, leaving `not deleted` otherwise, and it refuses a directory
target with `dirs not supported` (`prompt_run_op.rs:39`, `:44`).

## The vfs ops these actions call

The client is the app skeleton's vfs client at `userland/app_skeleton/src/clients/vfs/`, service
`vfs_pool`, magic `0x4E4F5646` ([`.../vfs/types.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/.../vfs/types.rs#L17)). The ops the actions on this page use:

```
  OP_WRITE    4     write_file for a new empty file        types.rs:22
  OP_MKDIR    8     mkdir for a new directory              types.rs:25
  OP_UNLINK   9     unlink for delete and a cut source     types.rs:26
  OP_RENAME  10     rename for rename and a cut-paste move types.rs:27
  OP_COPY    11     copy for copy-paste and duplicate      types.rs:28
  OP_CHMOD   15     chmod for the read-only toggle         types.rs:32
```

Each call frames `magic | op | request_id | body`, sends it with `mk_ipc_call`, and reads back a status
word; a non-zero status or a short reply becomes the client's error string, which the action turns into
a status line ([`.../vfs/call.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/.../vfs/call.rs#L21), `:30`). The listing ops (`OP_LIST`, `OP_STAT`) are on
[listing.md](/docs/userland/file-manager/listing/), and the preview ops (`OP_OPEN`, `OP_READ`, `OP_CLOSE`) are on
[preview.md](/docs/userland/file-manager/preview/).

## Source map

Everything here is drawn from the action units under `userland/capsule_file_manager/src/fm/`
(`event_actions.rs`, `selection*.rs`, `clipboard.rs`, `clipboard_paste.rs`, `duplicate.rs`, `perms.rs`,
`prompt_start.rs`, `prompt.rs`, `prompt_commit.rs`, `prompt_run_op.rs`) and the shared vfs client under
`userland/app_skeleton/src/clients/vfs/` (`types.rs`, `call.rs`, and the per-op wrappers). Every
reference above is verified against those trees.
