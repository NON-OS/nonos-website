---
title: "TSC and Calibration"
description: "The kernel's clock is the CPU timestamp counter."
weight: 1
---
The kernel's clock is the CPU timestamp counter. `RDTSC` returns a monotonic tick count, and to
turn ticks into nanoseconds the kernel needs the counter's frequency, which it establishes once
at boot by calibration. This page documents the counter read and the calibration chain. The code
is under `src/arch/x86_64/time/`.

## Reading the counter

`rdtsc` reads the 64-bit timestamp counter ([`src/arch/x86_64/time/timer/tsc.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arch/x86_64/time/timer/tsc.rs)), splicing the
`EDX:EAX` halves the instruction returns:

```
  rdtsc():
      asm "rdtsc" -> (hi: EDX, lo: EAX)
      (hi << 32) | lo
```

The counter increments at a fixed rate independent of the CPU's power state on modern parts, so
its difference over an interval is proportional to elapsed wall time; the constant of
proportionality is the frequency the calibration finds.

## The calibration chain

`calibrate` ([`src/arch/x86_64/time/tsc/calibration/calibrate.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arch/x86_64/time/tsc/calibration/calibrate.rs#L27)) establishes the frequency in
a fixed order of preference, recording the source and a confidence:

```
  calibrate():
      if not tsc_available:  NotAvailable
      boot_tsc = rdtsc()
      if get_cpuid_frequency() is Some(freq):
          source = Cpuid, confidence = 100     // authoritative, one sample
          return
      if calibrate_with_pit() is Ok((freq, confidence)):
          source = Pit                          // measured against the 8254 PIT
          return
      CalibrationFailed
```

The CPUID TSC-frequency leaf is tried first because it is authoritative: when the CPU reports its
own timestamp frequency, that value is exact and gets confidence 100. When CPUID does not report
it, the kernel falls back to measuring the counter against the 8254 PIT over a known interval,
which yields a frequency and a measured confidence over several samples. A HPET-based calibration
variant exists (`calibrate_with_hpet_base`) for platforms that expose one. If no method works,
calibration fails rather than guessing. The chosen source is recorded as a `CalibrationSource`
(`Cpuid`, `Pit`, ...), so the provenance of the frequency is observable.

## The stored frequency and the fallback

Calibration stores the frequency, the boot TSC, and the source. The nanosecond conversion in
`now_ns` ([`src/arch/x86_64/time/timer/time.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arch/x86_64/time/timer/time.rs#L22)) reads that stored frequency, and if it is still
zero (calibration has not run or failed) it substitutes a default of 2.5 GHz:

```
  now_ns():
      tsc_freq = TSC_FREQUENCY, or 2_500_000_000 if zero
      (( rdtsc() - boot_tsc ) * 1e9) / tsc_freq
```

The default keeps time monotonic and roughly sane on an uncalibrated boot rather than dividing by
zero or returning nothing, but a calibrated boot uses the real frequency. The subtraction is
saturating so the counter difference never underflows, which is what makes the derived time
monotonic.

## Security analysis

Calibration is a correctness step, not a boundary, but the frequency it stores is the divisor under every
duration and every uptime-based freshness check in the kernel, so its failure modes matter to anything
that reads time.

**Wrong-but-not-broken is the design.** If no method succeeds the counter is still monotonic; only the
scale is wrong. `calibrate` returns `CalibrationFailed` rather than storing a guess (`calibrate.rs:60`),
and the separate `now_ns` fallback substitutes `2_500_000_000` when the stored frequency is still zero
([`timer/time.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/timer/time.rs#L26)). The result is that an uncalibrated boot produces time that still counts up and still
orders events correctly, but whose absolute rate is a guess. Nothing here can make a mis-scaled clock read
as an error, so code that needs to know time is trustworthy must check that calibration ran, not just that
`now_ns` returns a value.

**Provenance is recorded, not just the number.** The stored `CalibrationSource` (`Cpuid`, `Pit`, `Hpet`)
and a confidence travel with the frequency, and CPUID gets confidence 100 because the CPU reporting its
own timestamp frequency is authoritative while the PIT and HPET paths carry a measured confidence over
several samples. That provenance is what lets a later reader distinguish a frequency taken as exact from
one measured against a legacy timer whose own accuracy is the floor on the result. The honest boundary is
that none of these sources is authenticated: the kernel trusts the CPUID leaf, the 8254, or the HPET as
the hardware presents them, so calibration is a measurement chain, not a trust chain.

## Debugging calibration

Calibration runs once and prints one line, so its outcome is read from that line and then confirmed by the
shape of the time it produces.

**The one marker to look for.** `timer::init` logs `[TIMER] Initialized with TSC frequency: {} Hz`
([`timer/init.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/timer/init.rs#L43)) after storing the frequency. A plausible number here (a few GHz on a modern part)
with time that tracks a wall clock means the chain worked; the `CalibrationSource` behind it tells you
whether it was the authoritative CPUID leaf or a measured fallback.

**A slow or fast clock is a frequency-scale bug, not a stopped one.** If sleeps finish early or late by a
consistent ratio and timestamps drift at a fixed rate, the stored frequency is wrong, most often because
calibration fell through to the `2_500_000_000` default (the boot ran uncalibrated) and the real part is
some other speed. The signature is a constant multiplicative error in every duration, which distinguishes
it from a stuck clock (constant, not accumulating) and from the pre-init `None` window (which returns
nothing rather than a scaled value). The fix is upstream: get CPUID or the PIT/HPET path to succeed so the
default is never used, and confirm by the printed frequency changing from a round 2.5 GHz to the part's
real rate.

## Source map

```
  src/arch/x86_64/time/timer/tsc.rs                 rdtsc
  src/arch/x86_64/time/tsc/calibration/calibrate.rs  the CPUID -> PIT -> HPET chain
  src/arch/x86_64/time/tsc/calibration/cpuid.rs      the CPUID TSC-frequency leaf
  src/arch/x86_64/time/tsc/calibration/pit.rs        the PIT measurement fallback
  src/arch/x86_64/time/tsc/calibration/hpet.rs       the HPET measurement variant
  src/arch/x86_64/time/timer/time.rs                 now_ns and the frequency fallback
  src/arch/x86_64/time/timer/init.rs                 timer::init and the [TIMER] frequency marker
```

Every reference above is verified against those trees. The frequency stored here is consumed as the
divisor in the monotonic base on the [time bases](/docs/subsystems/time-and-clock/time-bases/) page, and the consumers that ultimately
depend on the scale being right are collected on the [consumers](/docs/subsystems/time-and-clock/consumers/) page.
