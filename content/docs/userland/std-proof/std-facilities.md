---
title: "What std_proof exercises"
description: "This page walks the exact standard-library facilities the stdproof capsule drives, one pillar at a time, and names the check each one runs."
weight: 4
---
This page walks the exact standard-library facilities the [std_proof](/docs/userland/std-proof/) capsule drives, one pillar
at a time, and names the check each one runs. Nothing here is aspirational: every facility listed is
touched by the thirty-odd lines of `main`, and the point of every pillar is the same one the
[std PAL](/docs/userland/std-pal/) page makes, that only the platform layer is swapped so the portable code above it
is the genuine published code running unchanged. For what the capsule is and why it exists at all, read the
[overview](/docs/userland/std-proof/); for how to read the result off the boot log, read the [debugging](/docs/userland/std-proof/debugging/) page.

## The three crates and the PAL underneath

The capsule links real upstream `std` and pulls three ordinary crates.io crates with no NØNOS-specific
edits. Each one leans on a different slice of the standard library, and every one of those slices is served
by the PAL:

| Pillar | Crate | std it leans on | PAL that serves it | Source |
|---|---|---|---|---|
| JSON parse | `serde_json` | heap `String`/`Vec`, `Result`, iterators | the global allocator backed by the Mk heap syscalls | [`src/main.rs:5`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L5), [`src/main.rs:9`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L9) |
| Regex match | `regex` | a deep dependency graph over `alloc` and `str` | the same allocator and no OS calls of its own | [`src/main.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L23) |
| Base64 encode | `base64` | trait dispatch on top of `alloc` | the allocator again, purely CPU-bound | [`src/main.rs:4`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L4), [`src/main.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L30) |
| Serial print | `println!` | the std stdout writer | the PAL stdout backend, the MDBG debug syscall over serial | [`src/main.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L31) |

The value is not the arithmetic. It is that this graph links and runs at all, which is only true if the PAL
answers every allocation and the one write the program makes.

## Pillar one: JSON parse

`main` holds one JSON literal and hands it straight to `serde_json::from_str`, binding a `serde_json::Value`
([`src/main.rs:8`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L8), [`src/main.rs:9`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L9)). That single call is already a real test of the allocator: the parser
builds an owned `Value` tree, which means `String` keys, a `Vec` for the array, and boxed nodes, all off the
heap the PAL provides. The parse is matched, not unwrapped: the `Ok` arm keeps the value and the `Err` arm
prints a diagnostic and returns, so a broken allocator or a parser fault surfaces as a message rather than a
panic ([`src/main.rs:9`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L9), [`src/main.rs:11`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L11)).

The checks it then runs against the parsed tree exercise the typed accessors and the iterator adapters:

- `v["os"].as_str()` pulls the `"nonos"` string back out, with `unwrap_or("?")` as the honest fallback
  ([`src/main.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L16)).
- `v["nums"].as_array()` walks the `[3,7,11,179]` array through `iter().filter_map(Value::as_i64).sum()`,
  which is a real iterator pipeline summing to `200` ([`src/main.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L17), [`src/main.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L19)). The
  `unwrap_or(-1)` makes a missing or non-array field visible as a sentinel rather than a crash.
- `v["ok"].as_bool()` reads the boolean, again with a fallback ([`src/main.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L21)).

Every one of those accessors is upstream `serde_json` code running over the PAL heap. If any of it were
broken, the summed field would not read `200` and the boolean or string would fall through to its sentinel.

## Pillar two: regex match

The second pillar compiles a pattern at runtime and runs it. `regex::Regex::new(r"\b[a-z_]{5,}\b")` builds
a compiled automaton, which pulls in the largest dependency subtree of the three and allocates heavily while
it does so ([`src/main.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L23)). The compile is matched the same careful way as the parse: `Ok` keeps the
`Regex`, and `Err` prints `nonos std proof: regex compile failed:` and returns ([`src/main.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L23),
[`src/main.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L26)). Compiling under std is the check here, not just running a precompiled one.

With the automaton built, `re.find_iter(hay).count()` scans a fixed haystack and counts the words of five or
more lowercase letters, which is a second real iterator pipeline over the match results ([`src/main.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L22),
[`src/main.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L24)). The count it produces is the regex hit field in the success line.

## Pillar three: base64 encode

The third pillar is deliberately small and CPU-bound: it imports the `base64::Engine` trait and calls
`base64::engine::general_purpose::STANDARD.encode(b"nonos")` ([`src/main.rs:4`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L4), [`src/main.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L30)). This is
trait-based dispatch producing an owned `String` on the heap, and it touches no OS facility beyond the
allocator, which is exactly why it is a clean isolation of `alloc` plus trait resolution from the noisier
crates above.

## Pillar four: serial print

The final facility is the one that makes the whole run observable. `main` ends in a single `println!` that
interpolates the four computed values into one line ([`src/main.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L31)). Under std that macro writes to
stdout; on NØNOS the PAL routes stdout to the MDBG debug syscall over serial, so the line lands on the boot
log. This is the only OS-visible side effect the whole program has, and it is the thing the
[debugging](/docs/userland/std-proof/debugging/) page reads to decide pass or fail. There is no exit code and no reply frame; the
print is the assertion.

## The checks, in one place

| Check | Passing value | Source |
|---|---|---|
| JSON string field | `os=nonos` | [`src/main.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L16), [`src/main.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L31) |
| JSON array summed through an iterator | `nums sum=200` (`3+7+11+179`) | [`src/main.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L17), [`src/main.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L31) |
| JSON boolean field | `ok=true` | [`src/main.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L21), [`src/main.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L31) |
| Regex compiled and run, hits counted | `regex hits=<count>` | [`src/main.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L23), [`src/main.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L24) |
| Base64 of `nonos` | `base64=bm9ub3M=` | [`src/main.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L30), [`src/main.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L31) |

All five appear in the one success line, so a single serial line proves the whole graph.

## Source map

```
  userland/capsule_std_proof/src/main.rs      the parse, sum, match, encode, and print in full
  userland/capsule_std_proof/Cargo.toml       serde_json, regex, base64 pulled unedited from crates.io
```

Every reference above is verified against those trees.
