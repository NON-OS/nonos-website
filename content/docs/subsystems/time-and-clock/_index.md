---
title: "Time and Clock"
description: "How NØNOS tells time. The kernel's clock is the CPU timestamp counter, calibrated once at boot to a real frequency, from which it derives two time bases: a monotonic uptime for ..."
weight: 16
---
How NØNOS tells time. The kernel's clock is the CPU timestamp counter, calibrated once at boot to
a real frequency, from which it derives two time bases: a monotonic uptime for scheduling and
durations, and a wall-clock Unix time for human-meaningful timestamps. The same counter also feeds
the random-number generator as a jitter entropy source.

| Page | What it covers |
|------|----------------|
| [calibration.md](/docs/subsystems/time-and-clock/calibration/) | Reading `RDTSC`, the CPUID -> PIT -> HPET calibration chain with its confidence, the stored frequency, and the 2.5 GHz fallback. |
| [time-bases.md](/docs/subsystems/time-and-clock/time-bases/) | Monotonic `now_ns` vs wall-clock `unix_timestamp_ms`, the boot epoch from the handoff or RTC, and the `crate::time` façade. |
| [consumers.md](/docs/subsystems/time-and-clock/consumers/) | Who reads the clock (scheduler deadlines, IPC timestamps, spawn validity, displays) and how the counter doubles as RNG entropy. |

The property worth keeping in view is that the two bases serve opposite needs and must not be
confused: monotonic time is for measuring intervals and must never move backward or be adjusted, so
it backs sleep and preemption; wall-clock time is for stamping events with a real date, so it backs
message timestamps and certificate validity. Both come from one calibrated counter, and the arch
layer owns the counter so the shared kernel can ask `crate::time` without knowing the hardware.

## Sources

The time source lives under `src/arch/x86_64/time/`: `timer/` (the counter, `now_ns`, uptime),
`tsc/calibration/` (CPUID, PIT, and HPET calibration), and `rtc/` (the real-time clock). It is
re-exported as `crate::time` ([`src/lib.rs:80`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/lib.rs#L80)). The local time-of-day display is `src/sys/clock/`,
the boot seeding is [`src/kernel_core/init/entry.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/init/entry.rs), and the entropy use is under `src/crypto/`.
Every page is verified against those trees with `file:line` references.
