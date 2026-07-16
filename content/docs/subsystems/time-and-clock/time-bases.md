---
title: "The Two Time Bases"
description: "The kernel keeps two notions of time from the one counter: a monotonic uptime that only ever increases, used for scheduling deadlines and durations, and a wall-clock Unix time, ..."
weight: 2
---
The kernel keeps two notions of time from the one counter: a monotonic uptime that only ever
increases, used for scheduling deadlines and durations, and a wall-clock Unix time, used where a
human-meaningful timestamp is needed. Both derive from the calibrated TSC; they differ only in
their zero point. This page documents them and the façade that exposes them. The code is under
`src/arch/x86_64/time/`, re-exported as `crate::time` ([`src/lib.rs:80`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/lib.rs#L80)).

## Monotonic uptime

Monotonic time is elapsed time since boot, computed from the TSC delta ([`timer/time.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/timer/time.rs#L22)):

```
  now_ns()  = (rdtsc() - boot_tsc) * 1e9 / tsc_freq
  now_ms()  = now_ns() / 1_000_000
```

Because the subtraction from the boot TSC saturates and the counter only counts up, `now_ns` never
goes backward. This is the base the [scheduler](/docs/subsystems/scheduler/sleep-wake/) uses for sleep
deadlines and the durations any subsystem measures: it is unaffected by any wall-clock adjustment,
so a sleep or a timeout cannot be cut short or extended by the clock being set. `now_ns_checked`
returns `None` before the timer is initialized, so a caller can tell calibrated time from the
pre-init window.

## Wall-clock Unix time

Wall-clock time is the monotonic uptime added to a boot epoch ([`timer/uptime.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/timer/uptime.rs#L38) and the clock
core):

```
  unix_timestamp_ms() = boot_unix_ms + uptime_ms()
```

The boot epoch is the real Unix time at boot, established once at init. `clock::init`
([`src/kernel_core/init/entry.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/init/entry.rs#L43)) seeds it from the bootloader handoff, which carries the TSC
frequency and the Unix epoch in milliseconds:

```
  clock::init(handoff.timing.fixed_freq_hz, handoff.timing.unix_epoch_ms)
```

When no boot epoch is available, the code reads the real-time clock hardware directly
(`arch::x86_64::time::rtc::read_unix_timestamp`) and adds the uptime, so a wall-clock timestamp is
always anchored to real time from either the handoff or the RTC. The local time-of-day helper
([`src/sys/clock/time.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sys/clock/time.rs)) turns this Unix time into hours, minutes, and seconds, applying the
timezone offset from policy, which is what the boot log and the shell clock display.

## The façade

Callers throughout the kernel use `crate::time`, which is `arch::x86_64::time` re-exported: the
common entry points are `timestamp_millis` (wall-clock milliseconds) and the monotonic `now_ns` /
`now_ms`. Keeping the façade in the arch module is deliberate, the time source is inherently
architecture-specific (the counter and its calibration differ per ISA), so the shared kernel calls
`crate::time` and the arch layer provides the counter underneath, consistent with the
[multi-architecture](/docs/subsystems/smp/) boundary the rest of the kernel follows.

## Security analysis

The two bases are correctness primitives, not privilege boundaries, but several security checks read
time through this façade, so the guarantees the bases give and the ones they do not are worth stating
exactly.

**Monotonic time cannot be moved backward or forward by policy.** `now_ns` is `(rdtsc() - boot_tsc)`
scaled by the frequency, with a saturating subtraction ([`timer/time.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/timer/time.rs#L29)), so it is a pure function of
the free-running counter and the boot anchor. Nothing exposes a setter for it. A sleep deadline or a
validity window measured in monotonic time therefore cannot be shortened or extended by anyone setting a
clock, which is why the [scheduler](/docs/subsystems/scheduler/sleep-wake/) and any timeout use this base rather than
the wall clock.

**The security clock is uptime, not authenticated wall time, and that is the honest boundary.** The
façade's `timestamp_millis` and `timestamp_secs` (`api_time.rs:45`, `api_time.rs:60`) are literally
`now_ns() / 1_000_000` and `now_ns() / 1_000_000_000`. They carry no boot epoch. So when the key store
checks `crate::time::timestamp_secs() > entry.expires_at` ([`src/security/crypto/key_management/ops.rs:101`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/crypto/key_management/ops.rs#L101))
or the trusted-hash and trusted-key databases stamp `last_update` with `crate::time::timestamp_millis()`
([`src/security/crypto/trusted_hashes.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/crypto/trusted_hashes.rs#L33)), they are comparing against milliseconds since boot, not
against real calendar time. A wall-clock path does exist separately, `crate::sys::clock::unix_ms`
([`src/sys/clock/core.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sys/clock/core.rs#L39)), which adds `BOOT_UNIX_MS` to the elapsed TSC and is used by the
[time syscall](/docs/subsystems/syscall/) and the watchdog, but the security freshness checks named above do
not go through it. The consequence is that an expiry set as an absolute Unix time will not fire against
an uptime clock, and freshness measured this way resets to zero every boot. This is a real limitation to
be honest about, not a property to lean on.

**Neither base is cryptographically trusted.** Even the wall-clock `unix_ms` is seeded from
`BOOT_UNIX_MS`, which `clock::init` takes from the bootloader handoff ([`src/kernel_core/init/entry.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/init/entry.rs#L43))
or, failing that, straight off the RTC hardware (`api_init.rs:52`). Both sources are trusted as given;
nothing authenticates them. So time is fine for ordering, durations, and preemption, but it is not a
trustworthy answer to "is this the real wall-clock instant it claims," and no rollback or freshness
decision should rest on it being unforgeable. The place monotonicity does its real security work is the
anti-rollback index, which is checked against a TPM monotonic counter in the bootloader, not against this
clock.

## Debugging the time bases

Time bugs show up as either a wrong absolute answer or a base that does not advance, and the two split
cleanly by which base is wrong.

**A wall-clock timestamp that is decades off or resets to a few seconds after boot.** If a log line or a
certificate window reads as "seconds since boot" rather than a real date, the code path is reading the
uptime façade (`timestamp_millis` / `timestamp_secs`) where it wanted `sys::clock::unix_ms`. The tell is
that the value is small and grows from zero at each boot rather than being a large Unix epoch. This is
the security-clock boundary above surfacing as a symptom, not a hardware fault.

**Monotonic time stuck at zero or `None`.** `now_ns_checked` returns `None` until `TIMER_INITIALIZED` is
set ([`timer/time.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/timer/time.rs#L37)), so a caller seeing `None` is running in the pre-init window before
`timer::init` ran. If `now_ns` itself returns implausible values, the frequency is the thing to check:
`now_ns` substitutes a hard-coded `2_500_000_000` when `TSC_FREQUENCY` is still zero ([`timer/time.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/timer/time.rs#L26)),
so an uncalibrated boot produces time that is monotonic but scaled by a guessed frequency, which reads as
a clock that runs fast or slow rather than one that is stopped. The calibration marker to correlate
against is on the [calibration](/docs/subsystems/time-and-clock/calibration/) page.

## Source map

```
  src/arch/x86_64/time/timer/time.rs     now_ns, now_ms, now_ns_checked (monotonic) and the freq fallback
  src/arch/x86_64/time/api_time.rs       timestamp_millis / timestamp_secs, the uptime security clock
  src/arch/x86_64/time/rtc/              the real-time-clock read (read_unix_timestamp)
  src/arch/x86_64/time/api_init.rs       RTC fallback when no boot epoch is handed off
  src/sys/clock/core.rs                  unix_ms, the wall-clock base = BOOT_UNIX_MS + elapsed TSC
  src/sys/clock/time.rs                  local time-of-day with timezone offset
  src/kernel_core/init/entry.rs          clock::init from the boot handoff (fixed_freq_hz, unix_epoch_ms)
  src/lib.rs:80                          crate::time = arch::x86_64::time
```

Every reference above is verified against those trees. The frequency the monotonic base scales by comes
from [calibration](/docs/subsystems/time-and-clock/calibration/); the [consumers](/docs/subsystems/time-and-clock/consumers/) page collects who reads each base; the
scheduler's use of the monotonic base for sleep deadlines is on the
[scheduler](/docs/subsystems/scheduler/sleep-wake/) page, and the security checks that read the uptime clock are in
the [security](/docs/security/) tree.
