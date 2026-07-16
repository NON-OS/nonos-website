---
title: "Install readiness and the store"
description: "This page mirrors src/installready/ and src/store/: the single accepted index the capsule holds, and the six-byte verdict that INSTALLREADY returns for one release."
weight: 4
---
This page mirrors `src/install_ready/` and `src/store/`: the single accepted index the capsule holds, and
the six-byte verdict that `INSTALL_READY` returns for one release. The verdict is deliberately not a bare
yes/no, so a caller can tell a signature failure from an architecture mismatch from a missing package url.
For where the verdict is requested on the wire, see `INSTALL_READY` on the [protocol](/docs/userland/market/protocol/) page;
for how the signature flags it reads were set, see the [verification](/docs/userland/market/verification/) page.

## The store

The store is a single `Option<Accepted>` ([`src/store/state/store_type.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/state/store_type.rs#L19)), where `Accepted` is the
index, the operator signature flag, and the flat per-release publisher flag vector
([`src/store/state/accepted.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/state/accepted.rs#L22)). There is exactly one accepted index at a time; a successful
`LOAD_INDEX` replaces the whole value ([`src/store/state/install.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/state/install.rs#L25), `install.rs:31`).

Three reads back it:

- `current` returns the accepted index or `None`, which every query handler turns into `E_NODATA` when it
  is `None` ([`src/store/state/current.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/state/current.rs#L20)).
- `last_serial` returns the accepted index's serial, or `0` when the store is empty
  ([`src/store/state/last_serial.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/state/last_serial.rs#L20)). The `0` is what makes the very first `LOAD_INDEX` pass the
  monotonic-serial check.
- `publisher_signature_verified` flattens an `(entry, release)` index pair into the linear vector to look
  up one release's flag, summing the release counts of the preceding entries with a saturating add and
  returning `false` for an out-of-range index ([`src/store/state/publisher_signature_verified.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/state/publisher_signature_verified.rs#L20),
  `publisher_signature_verified.rs:25`). This is the same entry-then-release order the publisher vector was
  built in.

## The readiness verdict

`evaluate` computes the verdict from the operator signature flag, the release, and the one publisher flag
([`src/install_ready/checks.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/install_ready/checks.rs#L23)). It returns an `InstallReadiness` whose six booleans the handler writes
as six bytes, in a fixed order ([`src/server/handlers/install_ready/handle.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/install_ready/handle.rs#L46),
[`install_ready/constants.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/install_ready/constants.rs#L17)):

```
  [0] install_ready               the conjunction of everything below plus the two hashes
  [1] index_signature_valid       the operator signature flag
  [2] package_url_present         url non-empty AND both hashes non-zero
  [3] publisher_signature_present the per-release publisher flag
  [4] validation_passed           validation status == Validated
  [5] arch_match                  running arch supported AND kernel-abi compatible
```

The fields are computed as follows ([`src/install_ready/checks.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/install_ready/checks.rs#L28)):

- `index_signature_valid` mirrors the stored operator signature flag (`checks.rs:28`).
- `validation_passed` requires `release.validation.status == ValidationStatus::Validated`; any other
  validation status is false (`checks.rs:29`).
- `package_url_present` in the reply folds three conditions together: the package url is non-empty, the
  package hash is non-zero, and the manifest hash is non-zero (`checks.rs:30`, `checks.rs:31`,
  `checks.rs:32`, `checks.rs:48`). A url with a zeroed hash reads as not present.
- `publisher_signature_present` is the per-release publisher flag read from the store (`checks.rs:49`).
- `arch_match` in the reply folds the running-arch match together with kernel-abi compatibility: the
  release must list the running arch triple among its supported arches, and its `kernel_abi_min` must be at
  or below the running kernel abi, which is `1` (`checks.rs:21`, `checks.rs:33`, `checks.rs:34`,
  `checks.rs:51`).

The single `install_ready` byte is the conjunction of all of those, and additionally requires the package
hash and manifest hash to be present in their own right (`checks.rs:36`). So a release can report several
green fields and still be `install_ready = 0` if any one input is missing; reading the bytes individually
is how a caller isolates which one.

## The running-arch triple

The running arch is compile-time selected, not probed at runtime. `RUNNING_ARCH` is `x86_64-nonos`,
`aarch64-nonos`, or `riscv64-nonos` depending on the build target, and a build for any other arch is a hard
`compile_error!` ([`src/install_ready/arch.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/install_ready/arch.rs#L17), `arch.rs:20`, `arch.rs:23`, `arch.rs:27`). This is what
`arch_match` compares each release's `supported_arches` against, so the readiness verdict is anchored to
the arch the capsule was built for.

## Where the fields come from

Two of the six fields, `index_signature_valid` and `publisher_signature_present`, are the signature flags
the [verification](/docs/userland/market/verification/) pillar computed at ingest and the store holds. The other four,
`validation_passed`, `package_url_present`, `arch_match`, and the two hash checks folded into
`install_ready`, are read straight off the release record in the accepted index at query time. The verdict
does not re-run any signature check; it reads the stored flags and evaluates the release fields.

## Source map

```
  userland/capsule_market/src/install_ready/checks.rs                    the readiness evaluator (six fields)
  userland/capsule_market/src/install_ready/arch.rs                      the compile-time running-arch triple
  userland/capsule_market/src/install_ready/mod.rs                       the evaluate re-export
  userland/capsule_market/src/server/handlers/install_ready/handle.rs    writing the six bytes in order
  userland/capsule_market/src/server/handlers/install_ready/constants.rs the READINESS_LEN = 6
  userland/capsule_market/src/server/handlers/install_ready/find_release.rs  the (entry, release) lookup
  userland/capsule_market/src/store/state/store_type.rs                  the single Option<Accepted>
  userland/capsule_market/src/store/state/accepted.rs                    the accepted index and its flags
  userland/capsule_market/src/store/state/current.rs                     current()
  userland/capsule_market/src/store/state/last_serial.rs                 last_serial()
  userland/capsule_market/src/store/state/install.rs                     install()
  userland/capsule_market/src/store/state/publisher_signature_verified.rs  the flat-index publisher flag lookup
  userland/marketplace_abi/                                              the CapsuleRelease and ValidationStatus types
```

Every reference above is verified against those trees.
