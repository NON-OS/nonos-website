---
title: "Listing and state"
description: "This page mirrors the model and the vfs listing units under src/fm/: the State struct and its enums (state.rs, statenew.rs), the entry list (entries.rs), the directory refresh a..."
weight: 3
---
This page mirrors the model and the vfs listing units under `src/fm/`: the `State` struct and its enums
(`state.rs`, `state_new.rs`), the entry list (`entries.rs`), the directory refresh and per-file stat
(`refresh.rs`, `refresh_meta.rs`), and the filtered and sorted view (`view.rs`, `filter.rs`,
`view_sort.rs`, `view_sort_mode.rs`, `view_sort_name.rs`, `sort_next.rs`, `sort_label.rs`). It is the
data model every other page draws on. The actions that mutate it are on [actions.md](/docs/userland/file-manager/actions/); the
paint pass that reads it is on [rendering.md](/docs/userland/file-manager/rendering/).

## The State model

The whole app is one `State` ([`src/fm/state.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/state.rs#L50)):

| Field | Holds |
|-------|-------|
| `owner_pid` | the pid the vfs calls are keyed on, resolved once (`state.rs:51`) |
| `prefix` | the current directory path (`state.rs:52`) |
| `all` | the full listing from the last refresh (`state.rs:53`) |
| `entries` | the filtered and sorted view actually shown (`state.rs:54`) |
| `cursor` | the highlighted row (`state.rs:55`) |
| `scroll` | the index of the first drawn row (`state.rs:58`) |
| `preview` | the open file preview, if any (`state.rs:59`) |
| `status` | the footer status line (`state.rs:60`) |
| `mode` | the interaction mode (`state.rs:61`) |
| `input` | the pending prompt text (`state.rs:62`) |
| `filter` | the live filter string (`state.rs:63`) |
| `sort_mode` | the current sort order (`state.rs:64`) |
| `selected` | the checkbox selection set (`state.rs:65`) |
| `clipboard` | the copy/cut clipboard (`state.rs:66`) |

`Mode` has five variants: Browse, Filter, Help, Prompt (with a `PromptKind` of NewFile, MkDir, Rename,
or Delete), and Preview ([`src/fm/state.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/state.rs#L26), `:34`). `SortMode` is Name, Size, Date, or Type
(`state.rs:42`). `State::new` starts at the root prefix `/`, in browse mode, with name sort, an empty
listing, and a `loading...` status ([`src/fm/state_new.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/state_new.rs#L23)).

## The refresh

`refresh` is the one path that reads the directory ([`src/fm/refresh.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/refresh.rs#L25)). It resolves the owner pid
once by looking up `app.file_manager` in the registry (`refresh.rs:27`), lists the prefix through the
vfs with `list_paths`, builds the entry list, fills per-file metadata, and rebuilds the view
(`refresh.rs:30`). On success the status is `empty directory` for an empty listing or
`click or Enter to open` otherwise (`refresh.rs:35`). On error it either shows `vfs unavailable` when
there is no prior listing to keep, or keeps the old entries and shows `refresh deferred`
(`refresh.rs:42`, `:47`). Because `on_event` and `paint` re-run `refresh` while the status is
`vfs unavailable`, the listing self-heals once `vfs_pool` comes up ([`src/fm/app.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/app.rs#L43), `:50`).

`build_entries` turns the length-prefixed path list into `Entry` values: for each path it strips the
prefix, takes the first segment as the name, marks it a directory if more path follows, and skips
duplicates and the prefix itself ([`src/fm/entries.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/entries.rs#L31), `:48`). An `Entry` carries a label, the full
path, the directory flag, and optional size, mtime, and a writable flag (`entries.rs:21`).

`fill_meta` fills size, mtime, and the writable flag by `stat`ing each non-directory entry, but it skips
the whole pass for a directory of more than `META_STAT_LIMIT = 128` entries so a huge listing does not
stall ([`src/fm/refresh_meta.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/refresh_meta.rs#L21), `:24`). The writable flag comes from the `0o200` bit of the returned
mode (`refresh_meta.rs:35`).

## The view: filter and sort

`rebuild_view` is called whenever the listing, filter, or sort mode changes ([`src/fm/view.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/view.rs#L28)). It
keeps entries whose lowercased label contains the lowercased filter, sorts them, writes them into
`entries`, clamps the cursor into range, and calls `ensure_visible` (`view.rs:29`, `:36`, `:38`).

Filter mode is a live incremental search: each ascii-graphic keystroke appends up to 48 characters and
rebuilds the view immediately, Backspace pops and rebuilds, Esc clears the filter and returns to browse,
and Enter keeps the filter and returns to browse ([`src/fm/filter.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/filter.rs#L24), `:42`).

`sort_view` always groups directories before files, then orders within a group by the sort mode
([`src/fm/view_sort.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/view_sort.rs#L24)). `by_mode` implements the four orders ([`src/fm/view_sort_mode.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/view_sort_mode.rs#L25)):

| Mode | Order | Source |
|------|-------|--------|
| Name | case-insensitive label | `view_sort_mode.rs:27`, `view_sort_name.rs:21` |
| Size | largest first, then by name | `view_sort_mode.rs:28` |
| Date | newest mtime first, then by name | `view_sort_mode.rs:29` |
| Type | by extension, then by name | `view_sort_mode.rs:30` |

The `s` key cycles the mode Name -> Size -> Date -> Type and rebuilds the view
([`src/fm/event_actions.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/event_actions.rs#L37), `sort_next.rs:20`). `SortMode::label` gives the short name the header
draws ([`src/fm/sort_label.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/sort_label.rs#L20)).

## The vfs ops the listing calls

The client is the app skeleton's vfs client at `userland/app_skeleton/src/clients/vfs/`, service
`vfs_pool`, magic `0x4E4F5646` ([`.../vfs/types.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/.../vfs/types.rs#L17)):

```
  OP_LIST   6   list_paths for the directory refresh    types.rs:24
  OP_STAT   5   stat_full for per-file size/mtime/mode   types.rs:23
```

`list_paths` returns the length-prefixed path list `build_entries` reads (`refresh.rs:30`,
[`.../vfs/list_paths.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/.../vfs/list_paths.rs)), and `stat_full` returns size, a directory flag, mtime, and mode
(`refresh_meta.rs:32`, [`.../vfs/stat_full.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/.../vfs/stat_full.rs)). The owner pid is resolved with `lookup_service`
(`refresh.rs:28`, [`.../discover/lookup_service.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/.../discover/lookup_service.rs)). The action and preview ops are on
[actions.md](/docs/userland/file-manager/actions/) and [preview.md](/docs/userland/file-manager/preview/).

## Source map

Everything here is drawn from the model and listing units under
`userland/capsule_file_manager/src/fm/` (`state.rs`, `state_new.rs`, `entries.rs`, `refresh.rs`,
`refresh_meta.rs`, `view.rs`, `filter.rs`, `view_sort.rs`, `view_sort_mode.rs`, `view_sort_name.rs`,
`sort_next.rs`, `sort_label.rs`) and the shared vfs client and service discovery under
`userland/app_skeleton/src/`. Every reference above is verified against those trees.
