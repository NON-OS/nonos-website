---
title: "Sampling"
description: "This page mirrors src/pm/sample.rs and src/pm/state.rs: the two reads that give the process manager everything it shows."
weight: 4
---
This page mirrors [`src/pm/sample.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/sample.rs) and [`src/pm/state.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/state.rs): the two reads that give the process manager
everything it shows. One read resolves the monitored application names to pids; the other reads per-pid
CPU tick counts out of the kernel and turns them into a percentage. Neither read takes a handle on a
process, and neither can change one. Both are pulls: the capsule asks, the kernel answers, and the capsule
keeps the answer as plain values.

## The monitored list

The set of watched applications is fixed at compile time. `state.rs` defines a `KNOWN` array of eight
rows, in this order ([`src/pm/state.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/state.rs#L42)):

| Label | Service name resolved | Source |
|---|---|---|
| `terminal` | `app.terminal` | `state.rs:43` |
| `file_manager` | `app.file_manager` | `state.rs:44` |
| `text_editor` | `app.text_editor` | `state.rs:45` |
| `settings` | `app.settings` | `state.rs:46` |
| `process_manager` | `app.process_manager` | `state.rs:47` |
| `about` | `app.about` | `state.rs:48` |
| `calculator` | `app.calculator` | `state.rs:49` |
| `desktop_shell` | `desktop_shell` | `state.rs:50` |

There is no `shell` row and no way to add one at runtime. The array length is eight, and the `State`
fields that shadow it, `rows: [Row; 8]` and `last_ticks: [u64; 8]`, are the same fixed width
([`src/pm/state.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/state.rs#L54), `state.rs:58`). Changing the watched set means editing this table and keeping those
widths in step, which the [contributing](/docs/userland/process-manager/contributing/) page covers.

Each `Row` carries the static label and service name, the resolved pid, an online flag, and a 30-sample
circular CPU history ([`src/pm/state.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/state.rs#L31)). `HISTORY` is 30 ([`src/pm/state.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/state.rs#L19)).

## Resolving pids: the service lookup

The pid comes from service discovery, not from the process table. `State::refresh` walks the eight known
rows, resets each to offline with pid zero, then resolves its service name through the skeleton's
`lookup_service`; on success it records the pid and marks the row online ([`src/pm/state.rs:74`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/state.rs#L74),
`state.rs:81`). The status string is set to `PID from service lookup, caps unavailable`
([`src/pm/state.rs:86`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/state.rs#L86)), and a wrapping refresh counter is bumped once per refresh ([`src/pm/state.rs:75`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/state.rs#L75)).

`lookup_service` wraps the `mk_service_lookup` syscall and returns a `ServicePeer { port, pid }` or
`None` when the name does not resolve, the pid is zero, or the port is zero
([`userland/app_skeleton/src/discover/lookup_service.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/discover/lookup_service.rs#L21), `lookup_service.rs:25`). The manager uses only
the pid; it discards the port ([`src/pm/state.rs:82`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/state.rs#L82)). A row whose service has crashed and not yet
respawned reads offline until the next refresh, which is at most a few ticks away, or immediately if the
user forces a refresh from the [interface](/docs/userland/process-manager/interface/).

`refresh` also runs once at construction, so the first frame already carries resolved pids
([`src/pm/state.rs:70`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/state.rs#L70)).

## Sampling CPU: mk_proc_stat and the delta

The CPU column is the interesting mechanism. On every tick `sample` reads the kernel's
process-statistics syscall into a stack buffer sized for a header plus up to 64 entries, then computes
each monitored row's share of the total tick delta since the last sample ([`src/pm/sample.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/sample.rs#L25)):

```
  sample(state):
      written = mk_proc_stat(buf, MAX_ENTRIES = 64)     // header{total_ticks,count} + entries{pid,run_ticks}
      if written <= 0: return
      count = min(written, MAX_ENTRIES)
      dt = header.total_ticks - state.last_total_ticks
      warmed = state.last_total_ticks != 0 and dt > 0
      for each row:
          if row.pid == 0: last_ticks[row] = 0; continue
          ticks = find_ticks(buf, count, row.pid)        // linear scan of the returned entries
          if warmed:
              d = ticks - state.last_ticks[row]
              pct = min(d * 100 / dt, 100)               // this pid's share of the interval
              row.cpu.percent[head] = pct; head = (head + 1) % HISTORY
          state.last_ticks[row] = ticks
      state.last_total_ticks = header.total_ticks
```

Step by step against the source:

- The buffer is a stack array sized `HEADER_LEN + MAX_ENTRIES * ENTRY_LEN`, with `MAX_ENTRIES` fixed at
  64 ([`src/pm/sample.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/sample.rs#L21), `sample.rs:26`). Nothing is heap-allocated per sample.
- `mk_proc_stat(buf, 64)` returns the number of per-process entries written; a return of zero or less
  makes the sampler bail without touching state ([`src/pm/sample.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/sample.rs#L27), `sample.rs:28`). The count is then
  clamped to at most 64 (`sample.rs:31`).
- The header is read out of the buffer with an unaligned read into a `ProcStatHeader`
  ([`src/pm/sample.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/sample.rs#L32)). `dt` is `header.total_ticks - state.last_total_ticks`, saturating so it never
  underflows (`sample.rs:34`).
- The first sample is not warmed, because there is no prior baseline: `warmed` requires both a nonzero
  previous total and a positive `dt` ([`src/pm/sample.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/sample.rs#L35)). A percentage is therefore only computed from
  the second sample onward.
- For each row, an offline row (pid zero) is skipped, and its last-tick slot is reset to zero
  ([`src/pm/sample.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/sample.rs#L37)). For a live row, `find_ticks` locates the pid's `run_ticks` by a linear scan of
  the returned entries (`sample.rs:41`, `sample.rs:54`), returning zero if the pid is not present in the
  read (`sample.rs:66`).
- When warmed, the per-row delta `d = ticks - last_ticks[row]` (saturating) is turned into a percentage
  of the interval, `min(d * 100 / dt, 100)`, clamped to 100 ([`src/pm/sample.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/sample.rs#L43), `sample.rs:44`). The
  result is pushed into the row's 30-slot circular history at `head`, and `head` advances modulo `HISTORY`
  (`sample.rs:45`, `sample.rs:47`).
- Every row's `last_ticks` is updated for the next interval, and finally `state.last_total_ticks` is set
  to the new total ([`src/pm/sample.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/sample.rs#L49), `sample.rs:51`).

The history this fills is what the [interface](/docs/userland/process-manager/interface/) renders as a sparkline and a newest-sample
percentage.

## What mk_proc_stat is

`mk_proc_stat` is a direct syscall, `N_MK_PROC_STAT`, with no service on the far side
([`userland/libc/src/procstat.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/libc/src/procstat.rs#L36)). The buffer it fills is a `ProcStatHeader` carrying the system total
tick count and an entry count (`procstat.rs:30`), followed by one `ProcStatEntry { pid, state, run_ticks }`
per live pid (`procstat.rs:21`). The manager reads only `total_ticks` from the header and `run_ticks` per
entry; it ignores the per-entry `state` byte.

On the kernel side the call lands in `sys_proc_stat` ([`src/syscall/microkernel/procstat.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/microkernel/procstat.rs#L43)). It
enumerates all live pids (`procstat.rs:44`), and a NULL buffer or a zero `max_entries` returns the count
without copying anything (`procstat.rs:45`). Otherwise it seeds the header's `total_ticks` from the timer
tick count (`procstat.rs:54`), then writes up to `max_entries` entries, each pid's `run_ticks` taken from
the scheduler's per-pid tick accounting (`procstat.rs:67`). Every write is bounds-checked against the
caller's own address space, and a bad buffer returns `ERRNO_FAULT` (`procstat.rs:50`, `procstat.rs:58`,
`procstat.rs:69`). The call returns the number of entries written (`procstat.rs:74`).

This is a read. It copies data out and takes nothing in beyond a buffer and a length. There is no pid
argument that would let a caller act on a process, and there is no signalling or termination path anywhere
in the syscall or in the capsule. That the process manager can see the whole table is a property of the
syscall existing at all, not of a privileged bit the capsule holds: it does not gate on `Debug`, and the
manager does not hold `Debug` anyway.

## Source map

```
  userland/capsule_process_manager/src/pm/sample.rs   mk_proc_stat read, the delta math, find_ticks
  userland/capsule_process_manager/src/pm/state.rs    the eight KNOWN rows, refresh, service lookup, HISTORY
  userland/app_skeleton/src/discover/lookup_service.rs  lookup_service and the ServicePeer result
  userland/libc/src/procstat.rs                       mk_proc_stat and the ProcStat header/entry layout
  src/syscall/microkernel/procstat.rs                 the kernel sys_proc_stat handler
```

Every reference above is verified against those trees.
