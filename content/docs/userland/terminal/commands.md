---
title: "Terminal command engine"
description: "The command engine is the shell behind the terminal capsule's prompt: the code that turns a submitted line of bytes into filesystem, network, registry, and installer work."
weight: 2
---
The command engine is the shell behind the terminal capsule's prompt: the code that turns a submitted
line of bytes into filesystem, network, registry, and installer work. It lives entirely under
`userland/capsule_terminal/src/command/`, and this page walks that tree in the order data flows through
it. A line is tokenized (`parse/`), sequenced and routed through pipes and redirects (`dispatch/`),
handed to a command (`builtin/`), and its result is formatted (`output/`) or marshalled onto an IPC wire
to a service (`wire/`). The capsule identity, keybindings, and lifecycle live on the
[terminal overview](/docs/userland/terminal/); this page is only the engine. Every command a user can type is listed
below with its source line.

## parse: from a line to argv

`command/parse/` is the tokenizer. `parse` walks the input bytes, skips runs of whitespace, and emits at
most `MAX_ARGS` tokens into a fixed `Argv` ([`parse/split.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/parse/split.rs#L20), [`parse/types.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/parse/types.rs#L17)). `MAX_ARGS` is 8,
and `Argv` holds the token slices plus a count, all borrowing the original line
([`parse/types.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/parse/types.rs#L19)). A token wrapped in matching single or double quotes is taken verbatim between the
quotes, so an argument may contain spaces (`write notes.txt "hello world"`); only the quote bytes are
excluded, and an unterminated quote runs to end of line ([`parse/split.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/parse/split.rs#L35)). The module re-exports just
`parse` and `Argv` ([`parse/mod.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/parse/mod.rs#L20)).

Tokenization is the last step before a command runs. It happens after the line has already been split
into statements, alias-expanded, and variable-expanded, so quotes here are the tokenizer's own concern
and no longer carry sequencing meaning.

## dispatch: sequencing, redirects, pipes, and the command word

`command/dispatch/` is the pipeline. It takes one statement's `Argv` and decides how to run it: plain,
piped, or redirected. The public surface is `run`, `Outcome`, `split_program`/`Conn`, `alias_expand`,
and `expand` ([`dispatch/mod.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dispatch/mod.rs#L28)).

### Statement sequencing

`split_program` cuts a submitted line into `(Conn, statement)` pairs on the top-level separators `;`,
`&&`, and `||`, tracking single and double quotes so a separator inside quotes stays literal
([`dispatch/statements.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dispatch/statements.rs#L29)). `Conn` is the gate: `Always` for `;`, `And` for `&&`, `Or` for `||`
([`dispatch/statements.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dispatch/statements.rs#L22)). A single `|` is left untouched here so the pipeline stage can split it
([`dispatch/statements.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dispatch/statements.rs#L21)). The caller runs `b` after `a` only when the connector and `a`'s exit
status agree: `&&` needs success, `||` needs failure, `;` always runs.

### The runner

`run` is the top-level entry for one tokenized statement ([`dispatch/run.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dispatch/run.rs#L33)). Its order is fixed:

1. An empty argv repaints and does nothing ([`dispatch/run.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dispatch/run.rs#L34)).
2. `exit` or `quit` as the first word ends the shell, returning `Outcome::Exit`
   ([`dispatch/run.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dispatch/run.rs#L38), via [`builtin/exit_check.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/builtin/exit_check.rs#L17)).
3. `split_input` pulls off a `< file` input redirect, returning the args with the `< path` pair removed
   plus the captured path ([`dispatch/run.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dispatch/run.rs#L41), [`dispatch/redirect.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dispatch/redirect.rs#L31)).
4. `split` scans the remaining args for a `>` or `>>` output redirect, returning the command length, the
   append flag, and the destination path ([`dispatch/run.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dispatch/run.rs#L48), [`dispatch/redirect.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dispatch/redirect.rs#L54)).
5. If there is no input redirect, no `|`, and no output redirect, the command fast-paths straight to
   `exec` and prints to the screen ([`dispatch/run.rs:57`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dispatch/run.rs#L57)).
6. Otherwise it takes the capture-and-fold path: seed the lines from the input file, from a pipeline, or
   from a single captured command, then either write them to the redirect file or push them to the
   scrollback ([`dispatch/run.rs:60`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dispatch/run.rs#L60)).

Input reading for `< file` resolves the path against the shell's `cwd`, caches the terminal's own pid,
and reads up to 64 KiB through the app-skeleton vfs client, splitting the file on newlines
([`dispatch/run.rs:81`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dispatch/run.rs#L81)).

### The command-word dispatch

`exec` resolves the first token ([`dispatch/exec.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dispatch/exec.rs#L24)). A fixed set of verbs is matched directly; every
other word, and anything after `nox`, falls through to the `nox` family ([`dispatch/exec.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dispatch/exec.rs#L48)). The
direct verbs are `nox`, `help`, `about`, `version`, `whoami`, `capsules`/`caps`, `clear`, `display`,
`echo`, `history`, `market`, `motd`, `ping`, and `service`/`svc` ([`dispatch/exec.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dispatch/exec.rs#L29) through `:47`).
These are listed as the [top-level verbs](#top-level-verbs) below.

### Redirects

[`dispatch/redirect.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dispatch/redirect.rs) scans for both redirect directions. `split_input` removes a `< path` pair and
errors with `redirect: expected a file path after <` when the path is missing ([`dispatch/redirect.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dispatch/redirect.rs#L38)).
`split` returns a `Plan`: `Plain`, `Redirect { cmd_len, append, path }` where `append` is true for `>>`,
or `Error` with `redirect: expected a file path after >` ([`dispatch/redirect.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dispatch/redirect.rs#L22),
[`dispatch/redirect.rs:57`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dispatch/redirect.rs#L57)). `write_redirect` performs the write: it resolves the path against `cwd`,
reads the existing file first when appending, joins the captured lines with newlines, and writes through
the vfs client, printing `wrote to <path>` on success or the client's error string on failure
([`dispatch/write_redirect.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dispatch/write_redirect.rs#L30), [`dispatch/write_redirect.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dispatch/write_redirect.rs#L46)). Both reads are capped at 64 KiB
([`dispatch/write_redirect.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dispatch/write_redirect.rs#L24)).

### Pipes

[`dispatch/pipeline.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dispatch/pipeline.rs) runs a `a | b | c` chain. `run_pipeline` splits the args on `|`, runs the first
segment with its scrollback output captured, then folds each later segment as a filter over the
accumulated lines ([`dispatch/pipeline.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dispatch/pipeline.rs#L27)). `run_filters` is the same fold with no producer command,
used when `< file` supplies the seed instead of a leading command ([`dispatch/pipeline.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dispatch/pipeline.rs#L53)). The
capture is synchronous and in the terminal's own memory; there is no second process and no shared buffer.

### Pipe filters

Each pipe stage is one filter applied by `apply`, which matches the segment's first word
([`dispatch/filter/mod.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dispatch/filter/mod.rs#L24)). An unrecognised filter word yields a `pipe: unknown filter <name>` line
([`dispatch/filter/mod.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dispatch/filter/mod.rs#L34)). The finite filter set:

| Filter | Syntax | What it does | Handler |
|---|---|---|---|
| `grep` | `grep [-i] [-v] <pattern>` | keep matching lines; `-i` ignores case, `-v` inverts | [`filter/mod.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/filter/mod.rs#L26), [`filter/text.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/filter/text.rs#L22) |
| `sort` | `sort` | sort lines (unstable, byte order) | [`filter/mod.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/filter/mod.rs#L27), [`filter/text.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/filter/text.rs#L35) |
| `uniq` | `uniq` | drop repeated adjacent lines | [`filter/mod.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/filter/mod.rs#L28), [`filter/text.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/filter/text.rs#L42) |
| `cut` | `cut [-d<c>] [-f<n>]` | emit the n-th delim-separated field (1-based; default space, field 1) | [`filter/mod.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/filter/mod.rs#L29), [`filter/text.rs:68`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/filter/text.rs#L68) |
| `nl` | `nl` | number each line, 1-based, two spaces after the number | [`filter/mod.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/filter/mod.rs#L30), [`filter/text.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/filter/text.rs#L52) |
| `wc` | `wc` | emit the line count | [`filter/mod.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/filter/mod.rs#L31), [`filter/count.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/filter/count.rs#L22) |
| `head` | `head [n]` | keep the first n lines (default 10) | [`filter/mod.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/filter/mod.rs#L32), [`filter/count.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/filter/count.rs#L28) |
| `tail` | `tail [n]` | keep the last n lines (default 10) | [`filter/mod.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/filter/mod.rs#L33), [`filter/count.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/filter/count.rs#L32) |

`grep` with an empty pattern keeps every line; matching is a plain substring scan, case-folded under
`-i` ([`filter/text.rs:96`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/filter/text.rs#L96)). `head` and `tail` default their count to 10 when the argument is missing or
not a number ([`filter/count.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/filter/count.rs#L37)).

### Alias and variable expansion

Both run before tokenization, on the raw statement bytes. `alias_expand` replaces the first word of a
statement with its alias body, keeping the remaining arguments; expansion is single-level, so an alias
body is not itself re-aliased ([`dispatch/alias_expand.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dispatch/alias_expand.rs#L22)). `expand` substitutes `$NAME` shell
variables, suppressed inside single quotes the way POSIX does, with an undefined variable expanding to
nothing and quote bytes preserved for the tokenizer to strip ([`dispatch/expand.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dispatch/expand.rs#L23)). A name starts at
a letter or underscore and continues over alphanumerics and underscores ([`dispatch/expand.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dispatch/expand.rs#L35)).

### Outcome

Every dispatched command returns an `Outcome`, which is either `Repaint` or `Exit` ([`dispatch/outcome.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dispatch/outcome.rs#L17)).
`Exit` closes the tab, or the window if it is the last tab; `Repaint` redraws the frame.

## builtin: the commands

`command/builtin/` holds the commands themselves. The top-level module exposes `about`, `capsules`,
`clear`, `display`, `echo`, `exit_check`, `history_cmd`, `market`, `motd`, `nox`, `ping`, `service`,
`version`, and `whoami` ([`builtin/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/builtin/mod.rs#L17)). Most commands, though, live in the `nox` family; the
top-level verbs are a small curated set, several of them thin wrappers the `nox` family also exposes.

### Top-level verbs

Matched in `exec` before the `nox` fall-through ([`dispatch/exec.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/dispatch/exec.rs#L29)).

| Command | Syntax | What it does | Source |
|---|---|---|---|
| `nox` | `nox [verb ...]` | dispatch into the `nox` family; no verb prints the help index | `exec.rs:30` |
| `help` | `help` | print the `nox` help index | `exec.rs:31`, [`nox/help.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/help.rs#L19) |
| `about` | `about` | print the capsule self-description (CPL, wire, syscalls) | `exec.rs:32`, [`builtin/about.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/builtin/about.rs#L19) |
| `version` | `version` | print version, namespace, ABI, trust line | `exec.rs:33`, [`builtin/version.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/builtin/version.rs#L19) |
| `whoami` | `whoami` | print capsule identity (handle, namespace, CPL, signer) | `exec.rs:34`, [`builtin/whoami.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/builtin/whoami.rs#L19) |
| `capsules` / `caps` | `capsules` | list expected system services, each marked `[live]` or `[absent]` | `exec.rs:35`, [`builtin/capsules.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/builtin/capsules.rs#L47) |
| `clear` | `clear` | clear the scrollback | `exec.rs:38`, [`builtin/clear.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/builtin/clear.rs#L19) |
| `display` | `display` | query the primary display size and pixel format | `exec.rs:39`, [`builtin/display.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/builtin/display.rs#L22) |
| `echo` | `echo [text ...]` | print the arguments joined by spaces | `exec.rs:40`, [`builtin/echo.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/builtin/echo.rs#L21) |
| `history` | `history` | print the command history, numbered | `exec.rs:41`, [`builtin/history_cmd.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/builtin/history_cmd.rs#L22) |
| `market` | `market` | list the marketplace catalog through the market service | `exec.rs:44`, [`builtin/market/run.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/builtin/market/run.rs#L27) |
| `motd` | `motd` | print the banner | `exec.rs:45`, [`builtin/motd.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/builtin/motd.rs#L20) |
| `ping` | `ping <host>` | one-shot ICMP echo through the net.ip service | `exec.rs:46`, [`builtin/ping/mod.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/builtin/ping/mod.rs#L40) |
| `service` / `svc` | `service <name>` | resolve one service name to its port and pid | `exec.rs:47`, [`builtin/service.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/builtin/service.rs#L22) |

`capsules` reports a fixed expected set of system services (ramfs, vfs, keyring, entropy, crypto, market,
the virtio and input drivers, the compositor, wm, desktop_shell, input_router, the net.* stack, login,
wallpaper) and marks each from a registry lookup; it is not a live process table
([`builtin/capsules.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/builtin/capsules.rs#L22)).

### builtin/nox: the command family

[`nox/dispatch.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/dispatch.rs) is the family's dispatch table. An empty argv prints the help index
([`nox/dispatch.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/dispatch.rs#L27)); otherwise the first word selects a handler and the rest are its arguments
([`nox/dispatch.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/dispatch.rs#L31)). Each command yields a success boolean that is written to `state.last_status`,
which is what `&&` and `||` gate on; fallible commands return their own result, infallible commands
always report success, and an unknown word is a failure ([`nox/dispatch.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/dispatch.rs#L35), [`nox/dispatch.rs:135`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/dispatch.rs#L135)).
The family modules are declared in [`nox/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/mod.rs#L17).

Filesystem, all resolved against the shell's `cwd` and run through the app-skeleton vfs client, caching
the owner pid with `ensure_pid` ([`nox/ensure_pid.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/ensure_pid.rs#L21)):

| Command | Syntax | What it does | Source |
|---|---|---|---|
| `where` / `pwd` | `where` | print the current directory | `dispatch.rs:36`, [`nox/whereis.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/whereis.rs#L19) |
| `in` / `cd` | `in <path>` | change directory (stat-checked; must be a directory) | `dispatch.rs:40`, [`nox/enter.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/enter.rs#L24) |
| `ls` / `dir` | `ls [path]` | list the immediate children of a directory | `dispatch.rs:41`, [`nox/ls.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/ls.rs#L24) |
| `read` / `cat` | `read <file>` | print a file, split on newlines (up to 64 KiB) | `dispatch.rs:45`, [`nox/read.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/read.rs#L25) |
| `write` | `write <file> <text ...>` | write text (joined by spaces, newline appended) to a file | `dispatch.rs:46`, [`nox/write.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/write.rs#L24) |
| `copy` / `cp` | `copy <src> <dst>` | duplicate a file or a directory subtree in the store | `dispatch.rs:47`, [`nox/copy.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/copy.rs#L23) |
| `mk` / `mkdir` | `mk <dir>` | create a directory | `dispatch.rs:48`, [`nox/mk.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/mk.rs#L23) |
| `rm` / `del` | `rm [-r] <path>` | remove a file (unlink) or directory (rmdir, `-r` recursive) | `dispatch.rs:49`, [`nox/rm.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/rm.rs#L23) |
| `mv` / `move` | `mv <old> <new>` | move or rename a path | `dispatch.rs:50`, [`nox/mv.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/mv.rs#L23) |
| `stat` | `stat <path>` | print type, size in bytes, and path | `dispatch.rs:51`, [`nox/stat.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/stat.rs#L25) |
| `find` | `find [path]` | list the paths under a directory prefix | `dispatch.rs:52`, [`nox/find.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/find.rs#L23) |
| `du` | `du [path]` | sum the sizes of the files directly under a prefix | `dispatch.rs:53`, [`nox/du.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/du.rs#L25) |
| `touch` | `touch <file>` | create an empty file if it does not already exist | `dispatch.rs:54`, [`nox/touch.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/touch.rs#L23) |
| `basename` | `basename <path>` | print the final path component | `dispatch.rs:55`, [`nox/pathname.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/pathname.rs#L19) |
| `dirname` | `dirname <path>` | print the parent path component | `dispatch.rs:56`, [`nox/pathname.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/pathname.rs#L33) |

`find` is a single-level prefix listing, not a recursive walk ([`nox/find.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/find.rs#L31)). `du` sums only the
files the same listing returns, not a recursive tree ([`nox/du.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/du.rs#L41)). `ls` reduces the vfs path list to
immediate children through `children` ([`nox/children.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/children.rs#L20)).

Network, each a real request to a network service:

| Command | Syntax | What it does | Source |
|---|---|---|---|
| `ping` | `ping <host>` | resolve the host, build an ICMP echo, send it through net.ip, poll for the reply | `dispatch.rs:106`, [`builtin/ping/mod.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/builtin/ping/mod.rs#L40) |
| `ifconfig` / `ip` | `ifconfig` | print the interface lease, or `net0: down` if none | `dispatch.rs:58`, [`nox/ifconfig/run.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/ifconfig/run.rs#L23) |
| `nslookup` / `host` | `nslookup <host>` | resolve a name to an A record through net.dns | `dispatch.rs:59`, [`nox/nslookup.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/nslookup.rs#L29) |

Services, registry, and marketplace:

| Command | Syntax | What it does | Source |
|---|---|---|---|
| `caps` / `ps` | `caps` | list expected services live/absent (same as `capsules`) | `dispatch.rs:64`, [`nox/caps.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/caps.rs#L21) |
| `svc` | `svc <name>` | resolve one service to its port and pid | `dispatch.rs:68`, [`nox/svc.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/svc.rs#L21) |
| `apps` / `market` | `apps` | list the marketplace catalog | `dispatch.rs:84`, [`nox/apps.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/apps.rs#L21) |
| `run` / `open` | `run <app>` | focus an already-running desktop app with an NCTL focus frame | `dispatch.rs:88`, [`nox/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/run.rs#L29) |
| `install` | `install <name> [argv ...]` | ask the installer to verify, load, and spawn a store capsule | `dispatch.rs:89`, [`nox/install/run.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/install/run.rs#L24) |

System and introspection:

| Command | Syntax | What it does | Source |
|---|---|---|---|
| `id` | `id` | print capsule identity (delegates to `whoami`) | `dispatch.rs:72`, [`nox/id.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/id.rs#L21) |
| `sys` | `sys` | print version then about | `dispatch.rs:76`, [`nox/sysinfo.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/sysinfo.rs#L21) |
| `date` | `date` | print the RTC date and time | `dispatch.rs:57`, [`nox/date.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/date.rs#L22) |
| `env` | `env` | list shell variables (same as `set` with no args) | `dispatch.rs:60`, [`nox/set.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/set.rs#L24) |
| `echo` | `echo [text ...]` | print the arguments | `dispatch.rs:80`, [`nox/echo.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/echo.rs#L21) |
| `apps` / `market` | `market` | list the marketplace catalog | `dispatch.rs:84`, [`nox/apps.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/apps.rs#L21) |
| `motd` | `motd` | print the banner | `dispatch.rs:110`, [`nox/motd.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/motd.rs#L20) |
| `history` | `history` | print the numbered history | `dispatch.rs:114`, [`nox/history.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/history.rs#L22) |
| `display` | `display` | query the primary display | `dispatch.rs:118`, [`nox/display.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/display.rs#L22) |
| `clear` | `clear` | clear the scrollback | `dispatch.rs:122`, [`nox/clear.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/clear.rs#L19) |
| `help` | `help` | print the `nox` help index | `dispatch.rs:126`, [`nox/help.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/help.rs#L19) |

Several of these are thin delegations back to a top-level builtin: `id` calls `whoami`
([`nox/id.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/id.rs#L21)), `caps` calls `capsules` ([`nox/caps.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/caps.rs#L21)), `svc` calls `service` ([`nox/svc.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/svc.rs#L21)),
`apps` calls `market` ([`nox/apps.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/apps.rs#L21)), `sys` prints `version` then `about` ([`nox/sysinfo.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/sysinfo.rs#L21)),
`echo`/`display`/`clear`/`history`/`motd` under `nox` re-use the same builtins as their top-level twins.

Shell state, all held in the terminal's own `State`:

| Command | Syntax | What it does | Source |
|---|---|---|---|
| `set` | `set [name value ...]` | list variables, or define one (used later as `$name`) | `dispatch.rs:90`, [`nox/set.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/set.rs#L24) |
| `unset` | `unset <name>` | remove a variable | `dispatch.rs:94`, [`nox/unset.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/unset.rs#L20) |
| `alias` | `alias [name expansion ...]` | list aliases, or define one | `dispatch.rs:98`, [`nox/alias.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/alias.rs#L23) |
| `unalias` | `unalias <name>` | remove an alias | `dispatch.rs:102`, [`nox/unalias.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/unalias.rs#L20) |

An unrecognised word runs `unknown`, which prints `nox: unknown verb '<word>' (try: nox help)` and
reports failure, so `nonexistent || echo no` prints the fallback ([`nox/dispatch.rs:130`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/dispatch.rs#L130),
[`nox/unknown.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/unknown.rs#L21)).

### builtin/nox/ifconfig

The `ifconfig` command is its own subtree because it speaks a DHCP client wire. `run` looks up the lease
and either prints the formatted line or `net0: down`, always reporting success ([`nox/ifconfig/run.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/ifconfig/run.rs#L23)).
It talks to the `net.dhcp.client` service, magic `0x4E44_4843`, `OP_LEASE_STATUS 3`, with a 64 ms timeout,
and treats state 3 as bound ([`nox/ifconfig/constants.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/ifconfig/constants.rs#L17)). `lookup` resolves the service
([`nox/ifconfig/lookup.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/ifconfig/lookup.rs#L21)) and `call` issues the timed IPC round trip and parses the reply
([`nox/ifconfig/call.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/ifconfig/call.rs#L24)).

### builtin/nox/install

`install` is the only command that brings a new capsule to life, and it does so at arm's length. `run`
validates the name, packs an argv blob, and calls the installer ([`nox/install/run.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/install/run.rs#L24)). The name is
constrained to ascii letters, digits, `_`, and `-`, at most 64 bytes, with no path separators, so the
shell cannot point the installer outside the store ([`nox/install/run.rs:97`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/install/run.rs#L97)). `call_installer` resolves
the `installer` service and sends `seq(4) | op(2) | pad(2) | REQUESTED_CAPS(8) | name_len(1) | name |
argv`, with `OP_LOAD_BY_NAME 4`; the reply is `seq(4) | status(4) | pid(4)` ([`nox/install/call.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/install/call.rs#L30),
[`nox/install/call.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/install/call.rs#L52)). The `REQUESTED_CAPS = u64::MAX` field is a request, not a grant: the verified
manifest and the identity certificate ceiling are the real bounds, and this field only avoids restricting
a capsule below what it legitimately declares ([`nox/install/call.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/install/call.rs#L22)). After a successful load the
shell drains the child's stdout from its `proc.<pid>` inbox into the window, bounded by a 5 s deadline so
a child that never exits cannot freeze the shell ([`nox/install/run.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/install/run.rs#L54)). Debug markers
`[TERMINAL-INSTALL] load ok`, `[TERMINAL-INSTALL] load failed`, and `[TERMINAL-MOUT] output drained`
trace the path ([`nox/install/run.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/install/run.rs#L38)).

### builtin/market and builtin/ping

`market` is a subtree because it decodes a catalog reply. `run` looks up the `market` service, sends the
list request, checks the reply length, reads the entry count, and renders the entries
([`builtin/market/run.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/builtin/market/run.rs#L27)). The list op is carried on the shared NCMP wire (see below); the reply body
starts at offset 8 and the response buffer is capped at 4096 bytes ([`builtin/market/constants.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/builtin/market/constants.rs#L17)).

`ping` is a subtree because it drives DNS resolution and an ICMP probe. `run` resolves the host (a literal
IPv4 short-circuits DNS; otherwise it queries net.dns), looks up net.ip, sends the echo, and polls
([`builtin/ping/mod.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/builtin/ping/mod.rs#L40), [`builtin/ping/resolve.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/builtin/ping/resolve.rs#L28)). It uses the `net.ip` service, magic
`0x4E49_5034`, `OP_SEND_PACKET 4` and `OP_POLL_PACKET 5`, ICMP protocol, with a 1 s deadline
([`builtin/ping/mod.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/builtin/ping/mod.rs#L30)). The probe loop returns one of reply-with-rtt, no route, not ready,
unreachable (no ARP reply), timed out, or send failed, each mapped to a specific line
([`builtin/ping/probe.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/builtin/ping/probe.rs#L47), [`builtin/ping/mod.rs:57`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/builtin/ping/mod.rs#L57)).

## output: formatting a reply

`command/output/` is the thin formatting layer every command writes through. `Output` wraps a mutable
`Scrollback` reference ([`output/types.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/output/types.rs#L19)), `new` constructs one over the state's scrollback
([`output/new.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/output/new.rs#L20)), and `writeln` pushes one line into it ([`output/writeln.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/output/writeln.rs#L20)). The module
re-exports only `Output` ([`output/mod.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/output/mod.rs#L21)). Commands that need error styling or raw byte feeds reach
the scrollback directly (for example `push_error` in [`nox/read.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/read.rs#L40) and `feed_raw` in
[`nox/install/run.rs:63`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/install/run.rs#L63)); everything else prints through `Output::writeln`.

## wire: talking to a service over IPC

`command/wire/` is the marshalling for the NCMP protocol the market command speaks. `encode_header` lays
down the 20-byte header: magic `0x4E434D50` ("NCMP"), version 1, the op, a zero pad, a fixed field of 1,
and the payload length, all little-endian ([`wire/encode_header.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/wire/encode_header.rs#L19), [`wire/constants.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/wire/constants.rs#L17)). `HDR_LEN`
is 20 ([`wire/constants.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/wire/constants.rs#L19)) and `OP_LIST_APPS` is 2 ([`wire/market_op.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/wire/market_op.rs#L17)). The market command
builds a header-only request with this encoder and issues the call through `mk_ipc_call`
([`builtin/market/call_list.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/builtin/market/call_list.rs#L21)).

The other services the shell reaches encode their own wires inline at the call site rather than through
this module: the vfs client (`vfs_pool`) through the app-skeleton `clients::vfs` functions used by the
filesystem commands and both redirect forms; the installer wire in [`nox/install/call.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/install/call.rs); the DNS wire,
magic `0x4E44_4E53`, `OP_RESOLVE_A 2`, 2 s timeout, in [`nox/nslookup.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/nslookup.rs#L23); the IP wire in
[`builtin/ping/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/builtin/ping/mod.rs); and the DHCP client wire in [`nox/ifconfig/constants.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/ifconfig/constants.rs). In every case the shell
only marshals the request bytes and renders the reply; the service on the far side holds the real
authority and decides whether the operation is allowed. Service and pid lookups go through
`mk_service_lookup` / `lookup_service`, used by `svc`, `service`, `capsules`, `run`, and by every
filesystem command that first caches the terminal's own pid ([`builtin/service.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/builtin/service.rs#L30),
[`nox/ensure_pid.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/ensure_pid.rs#L21)).

## Source map

```
  src/command/parse/       tokenize a line into Argv (quotes, MAX_ARGS)
  src/command/dispatch/     sequencing (; && ||), run, exec, pipeline, redirect, filters, expansion
  src/command/dispatch/filter/   the pipe filters (grep sort uniq cut nl wc head tail)
  src/command/builtin/      the top-level verbs (about, capsules, ping, market, service, ...)
  src/command/builtin/nox/  the command family (ls cat cp mv rm find svc run install ...)
  src/command/builtin/nox/{ifconfig,install}/   the DHCP and installer commands
  src/command/builtin/{market,ping}/   the catalog and ICMP subtrees
  src/command/output/       Output over the scrollback (new, writeln)
  src/command/wire/         the NCMP header encoder (magic, op, HDR_LEN)
```

Every reference above is verified against those trees.
