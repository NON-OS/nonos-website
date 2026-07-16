---
title: "Debugging std_proof"
description: "This page is how you read a stdproof run. Because the capsule has no exit code and no reply frame, the whole result is a serial line, and debugging is a matter of finding that l..."
weight: 6
---
This page is how you read a std_proof run. Because the capsule has no exit code and no reply frame, the
whole result is a serial line, and debugging is a matter of finding that line, deciding whether it is the
pass line or a failure line, and knowing what each outcome points at. For what the capsule exercises see
the [what it exercises](/docs/userland/std-proof/std-facilities/) page, and for why it exists at all see the [overview](/docs/userland/std-proof/).

## The staging marker comes first

std_proof is not baked-spawned at boot like the desktop apps. The kernel init keeps a reference to the
spawn function so it is not flagged dead and logs `[STD-PROOF] staged for runtime install`, then leaves the
capsule in the VFS package store ([`src/userspace/init/entry.rs:55`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/entry.rs#L55), `entry.rs:56`). That line uses the same
`boot_log::ok` tag-and-message format every capsule marker uses, a bracketed tag and the message
([`src/sys/boot_log/output.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sys/boot_log/output.rs#L33)). Seeing it means the feature is compiled in and the capsule is present and
waiting; it does not mean the proof has run yet.

If that line is absent, the kernel was built without the `nonos-capsule-std-proof` feature and `run_std_proof`
is the empty stub, so nothing was staged ([`src/userspace/init/entry.rs:59`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/entry.rs#L59)). Build with the feature before
looking for anything else.

## Running it

With the staging line present, load the capsule at runtime with `install std_proof`. That path runs it
through [verified spawn](/docs/security/capsules-and-trust/): its embedded ELF, id cert, manifest, and
attestation trailer are checked, its three requested capabilities are held against its manifest ceiling, and
only then is its ELF mapped ([`src/userspace/capsule_std_proof/spawn.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_std_proof/spawn.rs#L34)). A failure here is a spawn error,
not a proof failure, and it reads as the usual signature, manifest, or capability rejection rather than a
line from `main`.

## The pass

A run is a pass only if one line appears, beginning `NØNOS ran crates.io serde_json+regex+base64:` and
carrying every field with its expected value ([`src/main.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L31)):

```
  NØNOS ran crates.io serde_json+regex+base64: os=nonos, nums sum=200, ok=true, regex hits=<count>, base64=bm9ub3M=
```

`os=nonos` and `ok=true` are the parsed JSON fields, `nums sum=200` is the array summed through an iterator
(`3+7+11+179`), and `base64=bm9ub3M=` is the base64 of `nonos` ([`src/main.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L16), [`src/main.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L19),
[`src/main.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L21), [`src/main.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L30)). Those exact values are the assertion; a line with a different sum or a
sentinel like `os=?` or `nums sum=-1` means the parse or an accessor misbehaved even though `main` reached
the print.

## Failure modes

### The serde_json failure line

If `serde_json::from_str` returns an error, `main` prints `nonos std proof: serde_json parse failed:` with
the error and returns before the success line ([`src/main.rs:11`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L11), [`src/main.rs:12`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L12)). Because the JSON literal
is a fixed valid string, this failing points not at bad input but at the parser or the allocator underneath
it, so the suspect is the PAL heap the [std PAL](/docs/userland/std-pal/) page describes rather than the crate.

### The regex failure line

If `Regex::new` returns an error, `main` prints `nonos std proof: regex compile failed:` and returns the
same way ([`src/main.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L26), [`src/main.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L27)). The pattern is a fixed valid one, so a compile failure again
points at the platform layer, in this case the larger allocation load the regex build places on the heap.

### No line at all

If neither the success line nor either failure line appears after `install std_proof`, `main` never reached
its own body, so the break is before the program runs: a spawn rejection during verified spawn, a missing
staging marker, or stdout not reaching serial. Check the staging line first, then the spawn path
([`src/userspace/capsule_std_proof/spawn.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_std_proof/spawn.rs#L34)), then whether the PAL stdout backend is wired, since the
print is the program's only output ([`src/main.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L31)).

### A sentinel field in the success line

The line can appear yet carry `os=?`, `nums sum=-1`, or `ok=false`. Each is the `unwrap_or` fallback for a
field that failed to read ([`src/main.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L16), [`src/main.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L20), [`src/main.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L21)). This is a softer signal
than a missing line: the graph linked and ran, but a typed accessor did not return what the fixed input
should yield, which points at the accessor or the parsed tree rather than at spawn.

## Source map

```
  userland/capsule_std_proof/src/main.rs      the success line and the two failure lines
  src/userspace/init/entry.rs                 the [STD-PROOF] staging marker and the feature stub
  src/sys/boot_log/output.rs                  the ok() bracketed tag-and-message format
  src/userspace/capsule_std_proof/spawn.rs    the verified-spawn path and requested caps
```

Every reference above is verified against those trees.
