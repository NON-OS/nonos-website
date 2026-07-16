---
title: "Build and Verification Workflows"
description: "This page describes the operational build and verification workflows."
weight: 4
---
This page describes the operational build and verification workflows. Read
[Toolchain](/docs/build/toolchain/) and [Signing](/docs/build/signing/) first.

The distinction matters: static checks are not runtime proof. A production
change needs the right combination of static gates, signed capsule verification,
symbol scan, and QEMU boot harnesses.

---

## 1. Workflow map

| Workflow | Target | What it proves |
|----------|--------|----------------|
| Baseline build | `nonos-mk` | Builds the microkernel capsule baseline through `nonos-mk-capsules` and prints the next packaging, run, verify, and test targets (`Makefile:162`, `Makefile:164`, `Makefile:167`, `Makefile:168`, `Makefile:169`, `Makefile:170`). |
| Toolchain bootstrap | `nonos-mk-toolchain` | Creates the toolchain stamp, installs the pinned Rust toolchain, adds UEFI target support, and installs `rust-src`, clippy, and rustfmt (`Makefile:174`, `Makefile:225`, `Makefile:228`, `Makefile:229`, `Makefile:230`). |
| Userland libc | `nonos-mk-libc` | Builds `userland/libc` for `x86_64-nonos-user` with `-Zbuild-std=core` (`Makefile:282`, `Makefile:284`, `Makefile:286`, `Makefile:287`, `Makefile:290`). |
| Capsule build and sign | `nonos-mk-<slug>`, `nonos-mk-<slug>-sign` | Builds the capsule ELF, signs the NØNOS-ID certificate, signs the manifest, and verifies the manifest against the trust policy (`nonos-mk/capsule.mk:149`, `nonos-mk/capsule.mk:151`, `nonos-mk/capsule.mk:180`, `nonos-mk/capsule.mk:201`, `nonos-mk/capsule.mk:217`, `nonos-mk/capsule.mk:222`). |
| Desktop production image | `nonos-mk-desktop-gui-prod` | Requires signed artifacts for core services, drivers, network, desktop, first-party apps, attest, and power, then builds the `microkernel-desktop-gui` profile (`Makefile:1086`, `Makefile:1088`, `Makefile:1090`, `Makefile:1092`, `Makefile:1096`, `Makefile:1098`, `Makefile:1101`, `Makefile:1105`, `Makefile:1106`, `Makefile:1111`, `Makefile:1112`). |
| ESP packaging | `nonos-mk-esp` | Builds bootloader and attested kernel, copies them into the ESP, writes `boot.cfg`, writes `startup.nsh`, and reports the ESP directory (`Makefile:1208`, `Makefile:1211`, `Makefile:1213`, `Makefile:1214`, `Makefile:1215`, `Makefile:1216`, `Makefile:1217`). |
| QEMU desktop run | `nonos-mk-run` | Builds desktop production image, packages ESP, creates block image and OVMF vars, boots QEMU with block, GPU, USB, RNG, serial, and no reboot. Network is disabled by default; `nonos-mk-run-net` enables explicit QEMU host forwarding. |
| Static lane | `nonos-mk-verify-fast` | Runs static checks only through `nonos-mk-static` (`Makefile:1366`, `Makefile:1367`). |
| Full verify lane | `nonos-mk-verify` | Runs static checks, production desktop trust verification, and microkernel symbol scan (`Makefile:1369`, `Makefile:1370`, `Makefile:1371`, `Makefile:1372`). |
| Full test lane | `nonos-mk-test` | Runs full verify plus RAMFS, keyring, and desktop GUI boot harnesses (`Makefile:1374`, `Makefile:1375`). |

```
+----------------+
| source change  |
+-------+--------+
        |
+-------+--------+
| static lane    |
+-------+--------+
        |
+-------+--------+
| signed build   |
| trust verify   |
+-------+--------+
        |
+-------+--------+
| symbol scan    |
+-------+--------+
        |
+-------+--------+
| QEMU harnesses |
+----------------+
```

## 2. Capsule artifact workflow

Each `userland/<capsule>/Capsule.mk` declares identity and includes the shared
capsule macro. The macro materializes the standard target set: build the ELF,
sign cert and manifest, check publisher keys, and expose binary, cert, manifest,
and artifact paths (`nonos-mk/capsule.mk:1`, `nonos-mk/capsule.mk:3`,
`nonos-mk/capsule.mk:7`, `nonos-mk/capsule.mk:8`,
`nonos-mk/capsule.mk:10`, `nonos-mk/capsule.mk:12`,
`nonos-mk/capsule.mk:13`, `nonos-mk/capsule.mk:14`,
`nonos-mk/capsule.mk:15`).

Metadata is snapshotted at include time so later capsule includes cannot clobber
earlier capsule values. The snapshot covers directory, binary name, target,
binary path, cert path, manifest path, stale marker, publisher key paths, handle,
domain, namespace, service endpoint, reply endpoint, required caps, optional
caps, and cap ceiling (`nonos-mk/capsule.mk:88`, `nonos-mk/capsule.mk:91`,
`nonos-mk/capsule.mk:94`, `nonos-mk/capsule.mk:95`,
`nonos-mk/capsule.mk:96`, `nonos-mk/capsule.mk:98`,
`nonos-mk/capsule.mk:102`, `nonos-mk/capsule.mk:105`,
`nonos-mk/capsule.mk:106`, `nonos-mk/capsule.mk:107`,
`nonos-mk/capsule.mk:108`, `nonos-mk/capsule.mk:109`,
`nonos-mk/capsule.mk:110`).

The ELF rule depends on userland libc, the capsule Makefile, Cargo metadata,
capsule sources, shared userland sources, and extra deps, then builds with the
pinned toolchain and the `x86_64-nonos-user` target
(`nonos-mk/capsule.mk:151`, `nonos-mk/capsule.mk:152`,
`nonos-mk/capsule.mk:153`, `nonos-mk/capsule.mk:155`,
`nonos-mk/capsule.mk:156`, `nonos-mk/capsule.mk:157`,
`nonos-mk/capsule.mk:158`).

The cert rule recomputes the NØNOS identity from handle, domain, and recovery,
then signs with serial, namespace glob, caps ceiling, trust-anchor epoch,
validity window, publisher public keys, trust-anchor seeds, metadata, and output
path (`nonos-mk/capsule.mk:173`, `nonos-mk/capsule.mk:175`,
`nonos-mk/capsule.mk:180`, `nonos-mk/capsule.mk:184`,
`nonos-mk/capsule.mk:186`, `nonos-mk/capsule.mk:187`,
`nonos-mk/capsule.mk:188`, `nonos-mk/capsule.mk:189`,
`nonos-mk/capsule.mk:190`, `nonos-mk/capsule.mk:192`,
`nonos-mk/capsule.mk:194`, `nonos-mk/capsule.mk:196`).

The manifest rule depends on the ELF, cert, capsule Makefile, and signing tool.
It signs namespace, version, target, ELF path, required caps, optional caps,
service endpoint, reply endpoint, publisher seeds, and output path, then verifies
the manifest against cert and policy (`nonos-mk/capsule.mk:199`,
`nonos-mk/capsule.mk:201`, `nonos-mk/capsule.mk:204`,
`nonos-mk/capsule.mk:205`, `nonos-mk/capsule.mk:206`,
`nonos-mk/capsule.mk:207`, `nonos-mk/capsule.mk:208`,
`nonos-mk/capsule.mk:209`, `nonos-mk/capsule.mk:210`,
`nonos-mk/capsule.mk:211`, `nonos-mk/capsule.mk:212`,
`nonos-mk/capsule.mk:213`, `nonos-mk/capsule.mk:214`,
`nonos-mk/capsule.mk:217`, `nonos-mk/capsule.mk:220`).

## 3. Static workflow

`nonos-mk-static` runs [`nonos-ci/run-static-checks.sh`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nonos-ci/run-static-checks.sh)
(`Makefile:1322`, `Makefile:1324`, `Makefile:1325`). The script is the local
and CI static gate ([`nonos-ci/run-static-checks.sh:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nonos-ci/run-static-checks.sh#L1),
[`nonos-ci/run-static-checks.sh:2`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nonos-ci/run-static-checks.sh#L2), [`nonos-ci/run-static-checks.sh:3`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nonos-ci/run-static-checks.sh#L3)).

The static script checks the active Cargo default profile, rejects an active
legacy `nonos = [...]` profile, and runs the feature-profile checker
([`nonos-ci/run-static-checks.sh:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nonos-ci/run-static-checks.sh#L19), [`nonos-ci/run-static-checks.sh:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nonos-ci/run-static-checks.sh#L20),
[`nonos-ci/run-static-checks.sh:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nonos-ci/run-static-checks.sh#L26), [`nonos-ci/run-static-checks.sh:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nonos-ci/run-static-checks.sh#L33),
[`nonos-ci/run-static-checks.sh:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nonos-ci/run-static-checks.sh#L36)). It also gates architecture leaks,
deprecated memory shims, deleted Linux-shaped syscall paths, kernel-resident
service engines, fake userspace service directories, unexpected kernel driver
trees, capsule README contract coverage, kernel service directory shape,
surface/input syscall dispatch, wire shape agreement, submodule cleanliness, and
final pass/fail exit ([`nonos-ci/run-static-checks.sh:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nonos-ci/run-static-checks.sh#L46),
[`nonos-ci/run-static-checks.sh:55`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nonos-ci/run-static-checks.sh#L55), [`nonos-ci/run-static-checks.sh:72`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nonos-ci/run-static-checks.sh#L72),
[`nonos-ci/run-static-checks.sh:78`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nonos-ci/run-static-checks.sh#L78), [`nonos-ci/run-static-checks.sh:156`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nonos-ci/run-static-checks.sh#L156),
[`nonos-ci/run-static-checks.sh:168`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nonos-ci/run-static-checks.sh#L168), [`nonos-ci/run-static-checks.sh:179`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nonos-ci/run-static-checks.sh#L179),
[`nonos-ci/run-static-checks.sh:192`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nonos-ci/run-static-checks.sh#L192), [`nonos-ci/run-static-checks.sh:351`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nonos-ci/run-static-checks.sh#L351),
[`nonos-ci/run-static-checks.sh:363`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nonos-ci/run-static-checks.sh#L363), [`nonos-ci/run-static-checks.sh:4728`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nonos-ci/run-static-checks.sh#L4728),
[`nonos-ci/run-static-checks.sh:4752`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nonos-ci/run-static-checks.sh#L4752), [`nonos-ci/run-static-checks.sh:4777`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nonos-ci/run-static-checks.sh#L4777),
[`nonos-ci/run-static-checks.sh:4801`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nonos-ci/run-static-checks.sh#L4801), [`nonos-ci/run-static-checks.sh:4807`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nonos-ci/run-static-checks.sh#L4807)).

This workflow does not boot the OS. It is necessary, but not sufficient, for a
runtime change.

## 4. Trust and symbol workflow

`nonos-mk-verify` first runs static checks, then calls `nonos-mk-verify-trust`,
then calls `nonos-mk-scan` (`Makefile:1370`, `Makefile:1371`,
`Makefile:1372`). Trust verification builds the desktop GUI production profile,
runs host trust chain tests, runs on-disk artifact tests, and verifies the baked
trust artifact SHA-256 ledger (`Makefile:310`, `Makefile:311`,
`Makefile:312`, `Makefile:313`, `Makefile:314`, `Makefile:316`,
`Makefile:317`, `Makefile:318`, `Makefile:320`, `Makefile:321`,
`Makefile:322`).

The symbol scan requires the microkernel binary, dumps symbols with `nm`, checks
for forbidden legacy symbol fragments, runs the CI scan script, and reports pass
when no legacy-tree symbols are found (`Makefile:1339`, `Makefile:1340`,
`Makefile:1341`, `Makefile:1346`, `Makefile:1350`,
`Makefile:1355`, `Makefile:1363`, `Makefile:1364`). Forbidden fragments include
old filesystem, storage, desktop, graphics, shell, app service, agent service,
and network service module path fragments (`Makefile:1327`,
`Makefile:1329`, `Makefile:1334`, `Makefile:1335`,
`Makefile:1336`, `Makefile:1337`).

## 5. QEMU run workflow

The normal interactive run target depends on desktop GUI production build, ESP
packaging, a QEMU block image, and writable OVMF vars (`Makefile:1230`). The
target boots QEMU with 2 GiB default memory, HVF when available through the
recipe, Q35, FAT-backed ESP, OVMF code, writable OVMF vars, virtio block,
virtio GPU, user-mode networking, XHCI keyboard and mouse, virtio RNG, serial,
no VGA display, and no reboot (`Makefile:1235`, `Makefile:1236`,
`Makefile:1237`, `Makefile:1238`, `Makefile:1239`, `Makefile:1240`,
`Makefile:150`, `Makefile:152`, `Makefile:154`,
`Makefile:155`, `Makefile:156`, `Makefile:157`, `Makefile:158`).

The serial run target uses the same desktop GUI production build and ESP, but
runs with serial output and no display (`Makefile:1252`,
`Makefile:1253`, `Makefile:1254`, `Makefile:1255`,
`Makefile:1256`, `Makefile:1257`). The debug target builds the same desktop GUI
production image and starts QEMU with GDB listen on port `1234`
(`Makefile:1259`, `Makefile:1260`, `Makefile:1261`,
`Makefile:1265`).

## 6. Runtime evidence workflow

Runtime evidence must come from the production boot path, not from retired
harness-only profiles. A release claim needs a bounded serial capture, capsule
attestation receipt, hardware inventory where relevant, and an explicit statement
of which writable surfaces were present.

## 7. Required workflow by change type

| Change type | Minimum local workflow |
|-------------|------------------------|
| Documentation only | Citation/style checks for the edited docs. |
| Capsule source only | `make nonos-mk-<slug>` and `make nonos-mk-<slug>-sign`, then the relevant profile build. |
| Capsule identity, caps, endpoint, or signing metadata | Capsule signing plus trust-manifest verification. |
| Desktop GUI, input, WM, compositor, app skeleton | Production desktop GUI boot evidence and input-device transcript. |
| Storage capsule path | Source audit of mount, encryption, block I/O, flush, cleanup, and recovery paths. |
| Security, entropy, crypto, keyring | Trust verification plus source audit of key lifetime, entropy source, and capability gates. |
| Release candidate | Production boot evidence, hardware dossier, attestation receipts, and closed blockers from this page. |

## 8. Troubleshooting

The lanes above fail in a few characteristic ways, and the message tells you which
lane caught the problem.

**The static lane fails on an arch leak.** `nonos-mk-static` runs the CI static
script (`Makefile:1428`), which counts `cfg(target_arch)` and `crate::arch::x86_64::`
uses outside `src/arch/` and fails if they grow. A build that fails here has
generic code naming an architecture directly, the thing the
[architecture boundary](/docs/arch/boundary/) exists to prevent. The fix is to
route through `Arch::` or the appropriate seam, not to raise the baseline.

**The symbol scan fails on a forbidden symbol.** `nonos-mk-scan` dumps the
microkernel image with `nm` and fails if it finds a legacy module-path fragment
(old filesystem, storage, desktop, graphics, shell, or service-engine symbols),
`Makefile:1442`. A failure means a kernel-resident implementation of something
that should be a capsule leaked back into the image. The scan also fails outright
if the microkernel binary does not exist, printing the build-first hint
(`Makefile:1444`); that is an ordering problem, not a leak, so build the baseline
first.

**Trust verification fails.** `nonos-mk-verify-trust` builds the desktop GUI
production profile and then runs the host trust-chain tests, the on-disk artifact
tests, and the baked-artifact SHA-256 ledger check (`Makefile:588`). A failure
here is a mismatch between what was signed and what the kernel would verify: a
stale or unsigned capsule artifact, a manifest that no longer verifies against its
certificate, or a baked trust file whose hash does not match the ledger. This is
the same class of failure the [signing](/docs/build/signing/) page's troubleshooting covers,
surfaced by the verify lane rather than at capsule sign time.

**A lane passed but the OS still misbehaves at runtime.** This is the point
section 1 opens with: static checks are not runtime proof. `nonos-mk-verify` green
means the static gates, trust, and symbol scan all passed, but it does not boot
the OS. Only the QEMU harnesses in `nonos-mk-test` (`Makefile:1478`) and the
interactive run lanes exercise the running system. A change that compiles, signs,
and scans clean can still fault at boot; the runtime-evidence workflow in section
6 exists for exactly that gap.

**The run lane never reaches the desktop.** `nonos-mk-run` depends on the
production desktop build, ESP packaging, a block image, and writable OVMF vars
(`Makefile:1282`). A boot that stalls before the desktop is usually a runtime
fault in a capsule or a driver that did not claim its device, not a build failure;
the serial log (`QEMU_SERIAL_LOG`, default `target/qemu-serial.log`) is the first
place to look, and the debug run lane with GDB on port 1234 is the second. A
desktop that comes up but ignores a laptop's built-in input is the profile
problem from the [toolchain](/docs/build/toolchain/) page: `microkernel-desktop-gui` has no
i2c input drivers, `microkernel-full-gui` does.

## 9. Source map

```
  Makefile
    :588   nonos-mk-verify-trust    build desktop-gui-prod, then host + on-disk + ledger trust checks
    :1282  nonos-mk-run             production build, ESP, block image, OVMF vars, then QEMU
    :1427  nonos-mk-static          runs nonos-ci/run-static-checks.sh
    :1442  nonos-mk-scan            nm symbol dump and forbidden-fragment scan
    :1470  nonos-mk-verify-fast     static gates only
    :1473  nonos-mk-verify          static + trust + scan
    :1478  nonos-mk-test            verify + the required QEMU boot harnesses
  nonos-ci/run-static-checks.sh     the arch-leak, shape, and contract static gates
  nonos-mk/capsule.mk               the per-capsule sign and verify rules (see signing.md)
```

The capsule sign and verify rules these lanes depend on are on the
[signing](/docs/build/signing/) page, the target files and build ordering are on the
[toolchain](/docs/build/toolchain/) page, and the arch-leak gate enforces the boundary
documented under [arch/](/docs/arch/boundary/). The anchors in this map are
verified against the current `Makefile`; a few `file:line` citations in the older
sections above predate small Makefile edits.
