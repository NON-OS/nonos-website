---
title: "Consumers and Entropy"
description: "Time is a shared dependency: the scheduler sleeps on it, IPC stamps messages with it, the spawn path ages tokens by it, and the RNG folds the raw counter into its entropy."
weight: 3
---
Time is a shared dependency: the scheduler sleeps on it, IPC stamps messages with it, the spawn
path ages tokens by it, and the RNG folds the raw counter into its entropy. This page collects who
reads the clock and how the timestamp counter doubles as an entropy source.

## Who reads the clock

The monotonic and wall-clock bases feed distinct consumers:

```
  scheduler       sleep_until deadlines and preemption timing   (monotonic now)
  IPC             IpcMessage.timestamp_ms + the MAC binds it      (wall-clock ms)
  capsule spawn   now_ms passed to preflight for cert/token validity windows
  page allocator  get_timestamp stamps each AllocatedPage         (raw TSC)
  boot log / shell  local time-of-day display
```

The split matters: the [scheduler](/docs/subsystems/scheduler/sleep-wake/) uses monotonic time so a sleep is
immune to any wall-clock adjustment, while the [IPC envelope](/docs/subsystems/ipc/envelope/) uses a wall-clock
millisecond timestamp because a message's time is a human-meaningful field, and it is bound into
the message MAC so it cannot be altered after the fact. The [spawn preflight](/docs/subsystems/elf-loader/integration/)
takes a millisecond `now` so certificate and token validity windows are evaluated against real
time. Each reads through the `crate::time` façade rather than calling `rdtsc` directly.

## The counter as entropy

The raw timestamp counter is also an entropy input. The RNG folds `rdtsc` into its output on
several paths ([`src/crypto/random_api/platform.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/crypto/random_api/platform.rs#L22), [`src/crypto/util/rng/global/generate.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/crypto/util/rng/global/generate.rs)):
the low bits of the counter at the moment of a draw carry timing jitter that an outside observer
cannot predict, so XOR-ing them into the generator adds unpredictability that does not depend on a
hardware RNG being present. This is a supplementary source, not the primary one; the primary secure
path and its hardware mixing are documented on the [randomness](/docs/subsystems/crypto/randomness/) page. The
counter is a good jitter source precisely because it is high-resolution and free-running: two draws
a few instructions apart differ in their low bits by an amount that depends on cache, contention,
and interrupts.

## The timer tick and preemption

One consumer reads no timestamp at all but is the reason the clock advances at a useful cadence: the
timer interrupt. `on_timer_interrupt` ([`src/interrupts/timer/tick.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/interrupts/timer/tick.rs#L20)) runs on every tick, bumps the
tick counter, calls `sched::tick`, wakes any sleeping processes whose monotonic deadline has passed, and
then, if a reschedule was requested, performs a `SwitchIntent::Preempt` context switch. So the tick is
what turns the free-running counter into forced progress: without it a CPU-bound capsule would never yield
and the monotonic deadlines the [scheduler](/docs/subsystems/scheduler/sleep-wake/) sets would never be examined. The
tick counter itself ([`src/interrupts/timer/state.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/interrupts/timer/state.rs#L22)) is a separate quantity from `now_ns`; it counts
interrupts, not nanoseconds, and drives the coarse periodic work like the alarm wheel every tenth tick.

## Security analysis

Time here is a shared input, and the security-relevant question for each consumer is what breaks if the
value is wrong or attacker-influenced.

**The consumers that gate on time read an uptime clock, so their windows are boot-relative.** The spawn
preflight takes a millisecond `now` to evaluate certificate and token validity windows, and the IPC
envelope stamps `timestamp_ms` from `crate::time::timestamp_millis` (`message.rs:41`), which is uptime,
not authenticated wall time. So a validity window or a message-age check is measured against milliseconds
since boot. The IPC timestamp is bound into the message's `checksum64` (`message.rs:73`) so it cannot be
altered after the fact by a party who cannot recompute the checksum, but the value it binds is still an
uptime reading, and `age_ms` (`message.rs:78`) is a difference of two uptime readings, which is exactly
the quantity that is meaningful across a single boot. This is the honest boundary already stated on the
[time bases](/docs/subsystems/time-and-clock/time-bases/) page, seen from the consumer side.

**Preemption liveness depends on the tick, not on the timestamp being correct.** The scheduler is forced
to make progress by the interrupt firing, so a mis-scaled or uncalibrated frequency changes how long a
sleep lasts in real seconds but does not stop preemption: the tick still arrives and still drives the
switch. What would freeze preemption is the interrupt not being delivered, which is an interrupt-routing
problem, not a clock problem, and is diagnosed on the [interrupts](/docs/subsystems/interrupts/safety/) side.

**The counter as entropy is a supplement, never the root.** Folding `rdtsc` into the RNG adds timing
jitter an outside observer cannot predict, but the page is explicit that this is a supplementary input
mixed alongside the primary secure path documented under [randomness](/docs/subsystems/crypto/randomness/). The honest
boundary is that TSC jitter alone is not a security-grade entropy source; its value is that it costs
nothing and does not depend on a hardware RNG being present, so it can only help.

## Debugging clock consumers

Because every consumer reads through `crate::time`, a clock fault shows up in all of them at once, which
is itself the diagnostic.

**Every timestamp small and boot-relative.** If message timestamps, token windows, and log times are all
"seconds since boot" rather than real dates, no single consumer is broken; they are all reading the uptime
façade as designed, and the fix belongs at the base, not at any one caller. Correlate against the
[time bases](/docs/subsystems/time-and-clock/time-bases/) security boundary rather than chasing the consumer.

**Sleeps and timeouts uniformly off, but preemption alive.** A consistent multiplicative error in every
duration with the system still responsive points at the calibrated frequency, not at the tick: the tick is
firing (preemption works) but `now_ns` is scaling by the wrong number. That splits the problem to
[calibration](/docs/subsystems/time-and-clock/calibration/). The opposite shape, a system that stops switching between tasks entirely,
is the tick not arriving, which is not a clock-consumer bug at all.

## Source map

```
  src/interrupts/timer/tick.rs             on_timer_interrupt: sched::tick, wake, preempt
  src/interrupts/timer/state.rs            the tick counter (get_ticks / increment_ticks)
  src/crypto/random_api/platform.rs        rdtsc folded into the RNG
  src/crypto/util/rng/global/generate.rs   rdtsc jitter in generation
  src/ipc/nonos_channel/message.rs         the message timestamp_ms (uptime) bound into checksum64
  src/scheduler/ (sleep)                    monotonic deadlines
```

Every reference above is verified against those trees. The two bases these consumers read are defined on
the [time bases](/docs/subsystems/time-and-clock/time-bases/) page, the frequency that scales durations comes from
[calibration](/docs/subsystems/time-and-clock/calibration/), the scheduler's deadline handling is on the
[scheduler](/docs/subsystems/scheduler/sleep-wake/) page, and the primary entropy path the TSC only supplements is on
the [randomness](/docs/subsystems/crypto/randomness/) page.
