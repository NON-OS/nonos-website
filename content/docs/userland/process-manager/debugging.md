---
title: "Debugging"
description: "The process manager has no IPC server and no service port to receive on: it is an app-skeleton application on the app port app.processmanager :4730 that polls the kernel on a ti..."
weight: 3
---
The process manager has no IPC server and no service port to receive on: it is an app-skeleton
application on the app port `app.process_manager` :4730 that polls the kernel on a timer. Because it is an
observer rather than a server, its failure signatures are visual rather than errnos. Read this beside the
[sampling](/docs/userland/process-manager/sampling/) and [interface](/docs/userland/process-manager/interface/) pillars: most symptoms trace to one of the two reads
or to the renderer.

## Confirm the capsule ran

On a successful boot the kernel prints `[APP-PROCESS-MANAGER] capsule spawned` (tag
`APP-PROCESS-MANAGER`, message `capsule spawned`) from the boot log
([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29), [`src/sys/boot_log/output.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sys/boot_log/output.rs#L33)). An absent line means the
capsule never started, usually a signature, manifest, or attestation failure; the error path prints an
`[ERROR]` line with the specific `SpawnError` instead ([`src/userspace/init/capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L32),
[`src/sys/boot_log/output.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sys/boot_log/output.rs#L49)).

## Failure modes and where to look

- A row reads `offline`. `lookup_service` did not resolve that service name to a pid on the last refresh
  ([`src/pm/state.rs:81`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/state.rs#L81), [`userland/app_skeleton/src/discover/lookup_service.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/discover/lookup_service.rs#L25)). For a service that
  just crashed this lags the truth by up to one refresh interval (a few ticks); pressing any key or
  clicking forces an immediate re-resolve ([`src/pm/event.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/event.rs#L32)). A window that opens but shows every row
  offline points at the service registry or the monitored apps not being up, not at the manager itself.
- A flat or blank sparkline. The sampler has not warmed yet: a percentage is only computed from the
  second `mk_proc_stat` sample onward, when there is a prior baseline ([`src/pm/sample.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/sample.rs#L35)). A row also
  reads flat while its pid is zero, because an offline row is skipped in the sampler (`sample.rs:37`).
- The CPU column stays zero for a live row. `mk_proc_stat` returned `<= 0` and the sampler bailed
  ([`src/pm/sample.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/sample.rs#L28)), or the row's pid was not among the first 64 entries the read capped at, so
  `find_ticks` returned zero (`sample.rs:31`, `sample.rs:54`, `sample.rs:66`). The refresh counter still
  advances because it is driven by `refresh()`, not by the sampler ([`src/pm/state.rs:75`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/state.rs#L75)).
- The `caps` column always says `unavailable`. That is by design, not a fault: per-process capability
  reporting is not implemented ([`src/pm/paint.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pm/paint.rs#L46)).
- Every row shows the same tiny CPU number. The percentage is each pid's run-tick delta as a share of the
  total tick delta over the interval, so on a mostly idle system every share is small; a busy pid climbs
  its own sparkline. If the whole column pins to a suspicious constant, suspect the timer tick source that
  seeds `total_ticks` ([`src/syscall/microkernel/procstat.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/microkernel/procstat.rs#L54)) rather than the capsule.

## What it cannot be

Because the capsule holds no authority over the processes it lists, a class of bugs simply cannot occur
here: it cannot kill the wrong process, leak a process handle, or escalate past a read, because it never
holds a handle and has no signalling path. If a process misbehaves after the manager touched it, the
manager is not the cause; all it ever did was resolve a name to a pid and read a tick count.

## Source map

```
  src/userspace/init/capsule_boot/run.rs              [APP-PROCESS-MANAGER] capsule spawned / error path
  src/sys/boot_log/output.rs                          the ok and error boot-log writers
  userland/capsule_process_manager/src/pm/event.rs    the key/click forced refresh
  userland/capsule_process_manager/src/pm/state.rs    refresh, the service lookup, the refresh counter
  userland/capsule_process_manager/src/pm/sample.rs   the early return, the warm gate, find_ticks
  userland/capsule_process_manager/src/pm/paint.rs    the offline and unavailable text
  userland/app_skeleton/src/discover/lookup_service.rs  the None result behind an offline row
  src/syscall/microkernel/procstat.rs                 the timer tick source behind total_ticks
```

Every reference above is verified against those trees.
