---
title: "Debugging capsule_terminal"
description: "This page lists the log markers the terminal and its boot path emit, and the concrete failure modes with where to look for each."
weight: 6
---
This page lists the log markers the terminal and its boot path emit, and the concrete failure modes with
where to look for each. For the shell model see the [README](/docs/userland/terminal/), the
[command reference](/docs/userland/terminal/commands/), the [input model](/docs/userland/terminal/input/), the [rendering](/docs/userland/terminal/rendering/), and the
[terminal emulation](/docs/userland/terminal/emulation/) pages in this folder.

## Log markers

The first thing to confirm is that the capsule ran. On a successful boot the kernel logs
`[APP-TERMINAL] capsule spawned` from the capsule boot path: the `Ok` arm calls `boot_log::ok(prefix,
"capsule spawned")` ([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)). If that line is absent the capsule
never started, and the `Err` arm logged an error line through `boot_log::error` instead
([`src/userspace/init/capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L32)), which is the usual signature, manifest, or capability
failure.

The installer path emits its own markers. A successful `install` prints `[TERMINAL-INSTALL] load ok`
after the installer returns a pid ([`src/command/builtin/nox/install/run.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/command/builtin/nox/install/run.rs#L38)), and a failure prints the
matching failure marker from the `Err` arm. The child's captured stdout is drained after a load
([`src/command/builtin/nox/install/run.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/command/builtin/nox/install/run.rs#L39)).

The `nonos-autorun-selftest` build emits graded `[TERMINAL-TEST]` serial markers that exercise the shell
paths on a boot harness. It is off by default and gated behind the feature; see the
[contributing](/docs/userland/terminal/contributing/) page for the `nonos-mk-terminal-test` target.

## Failure modes

### Terminal opens but no input reaches it

The window subscribes to key-down events, and `on_event` returns `Idle` for anything that is not a
key-down ([`src/event/on_event.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/event/on_event.rs#L23)). If keys do nothing at all, the shell never sees them, so the
suspect is the input path into the app (compositor, wm, input_router), not the line editor. Run `caps`
to see whether those services are reported live ([`src/command/builtin/nox/caps.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/command/builtin/nox/caps.rs#L21)).

### Command not found

An unrecognised word falls through the dispatch to the `other =>` arm, which runs `unknown` and reports
failure ([`src/command/builtin/nox/dispatch.rs:130`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/command/builtin/nox/dispatch.rs#L130)). `unknown` prints `nox: unknown verb '<word>' ...`
([`src/command/builtin/nox/unknown.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/command/builtin/nox/unknown.rs#L21)). Because every command writes `state.last_status`, the fastest
way to tell an unknown verb from a known command that failed against a live service is `<word> || echo
no`: the `||` fires only on a failure status.

### A service call is denied

The terminal holds no file, network, or hardware authority of its own; every such command is an outbound
IPC call and the terminal only renders the reply. So a denial surfaces as the service's own error string,
not a shell error.

- Filesystem: a failing command sits next to a working one in the same directory (a failing `read` beside
  a working `ls`) because each is a separate vfs op. The command pushes the vfs client's error verbatim,
  for example [`src/command/builtin/nox/stat.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/command/builtin/nox/stat.rs#L27) on a usage error. Paths resolve against the shell's
  `cwd`, not the caller's, so check `where` before assuming a vfs bug ([`src/term/cwd/resolve.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/term/cwd/resolve.rs)).
- Network: `ping` and `nslookup` are the probes. `ping` prints a distinct line for each stage: `ping: dns
  service unavailable`, `ping: dns query timed out (no reply in 6s)`, `ping: dns lookup failed
  (servfail)`, `ping: unknown host`, and `ping: net unavailable`
  ([`src/command/builtin/ping/mod.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/command/builtin/ping/mod.rs#L47)). The message names the stage that failed.
- Install: a rejected name never reaches IPC. `valid_name` requires a non-empty stem, at most 64 bytes,
  ascii alphanumeric plus `_` and `-`, and no path separators
  ([`src/command/builtin/nox/install/run.rs:97`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/command/builtin/nox/install/run.rs#L97)); a name outside that set is refused in the shell. A name
  that passes but the installer rejects returns the installer's negative status alongside the
  `[TERMINAL-INSTALL]` failure marker.

### Rendering blank or wrong

If the shell responds (history grows, `where` changes) but the window shows nothing or a stale frame, the
split is between the model and the renderer. The shell mutates the active tab's `State`; `paint` projects
that `State` into the surface (`src/paint/`). A blank frame with a live shell points at the paint path,
not the command layer. If the shell itself is unresponsive to keys, that is the input case above, not a
render bug.

## Source map

```
  src/userspace/init/capsule_boot/run.rs           [APP-TERMINAL] capsule spawned / error path
  userland/capsule_terminal/src/event/on_event.rs  key-down gate; Idle for everything else
  userland/capsule_terminal/src/command/builtin/nox/dispatch.rs   unknown-verb fall-through, last_status
  userland/capsule_terminal/src/command/builtin/nox/unknown.rs    the unknown-verb line
  userland/capsule_terminal/src/command/builtin/ping/mod.rs       the per-stage ping messages
  userland/capsule_terminal/src/command/builtin/nox/install/run.rs  install markers and name validation
  userland/capsule_terminal/src/term/cwd/resolve.rs               cwd-relative path resolution
  userland/capsule_terminal/src/paint/                            the frame renderer
```

Every reference above is verified against those trees.
