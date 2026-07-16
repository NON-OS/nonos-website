---
title: "Spawn Integration"
description: "The ELF loader is not called directly by a capsule."
weight: 4
---
The ELF loader is not called directly by a capsule. It is called by the spawn pipeline, and only
after the image has been cryptographically verified. This page documents where the load sits in
the spawn sequence. The code is under `src/kernel_core/process_spawn/capsule_spawn/`.

## Verify, then load

A capsule is spawned from a VFS artifact through `load_capsule_from_vfs`
([`.../capsule_spawn/from_vfs/load.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/.../capsule_spawn/from_vfs/load.rs)), which builds a verified spec and calls `spawn_verified`
([`.../runner/verified.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/.../runner/verified.rs#L26)):

```
  spawn_verified(spec, trust_anchor, now_ms):
      preflight::run(spec, trust_anchor, now_ms)     // manifest + certificate verification
      install(InstallParams { elf, caps, ... })
```

The ordering is the point: `preflight::run` performs the full
[verified-spawn](/docs/security/capsules-and-trust/) check, the NØNOS-ID certificate against the
baked trust anchor, then the manifest against the publisher keys, with both Ed25519 and ML-DSA-65
required, before `install` runs. The ELF loader is never reached for an image that failed
verification, so mapping only ever happens on an image whose signatures and capabilities have
already been checked.

## Installing the image

`install::run` ([`.../runner/install/install.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/.../runner/install/install.rs#L30)) creates the process and its address space,
then loads the ELF into it ([`.../runner/install/load_elf_into_pid.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/.../runner/install/load_elf_into_pid.rs#L21)):

```
  load_elf_into_pid(elf, pid, debug_tag):
      asid = lookup_asid_for_process(pid)     else AddressSpace
      load_elf_entry_into(elf, asid)          else { log err; SpawnError::ElfLoad }
```

`load_elf_entry_into` is the loader's [entry orchestration](/docs/subsystems/elf-loader/layout/) targeting the new address
space's ASID. It returns the relocated entry point, which the spawn path installs as the capsule's
initial instruction pointer, and any `ElfError` becomes a `SpawnError::ElfLoad` with the specific
variant logged. Because the loader maps into `asid` rather than the current address space, the
capsule's pages are placed directly in its own fresh page tables and are never briefly visible in
the kernel's or another capsule's mapping.

## Where it sits

```
  load_capsule_from_vfs
      -> spawn_verified
          -> preflight::run        certificate + manifest verification   (must pass first)
          -> install::run
              -> create_process    fresh PCB + address space
              -> load_elf_into_pid
                  -> load_elf_entry_into(elf, asid)   validate + map + relocate
```

The ELF loader is the last trusted step that turns verified bytes into an executable address
space. The verification that gates it is documented on the
[capsules and trust](/docs/security/capsules-and-trust/) page, the address space it maps into is
covered on the [process](/docs/subsystems/process/pcb/) and [memory](/docs/subsystems/memory/paging-manager/) pages, and
the capabilities the spawn installs are the [capability model](/docs/security/capabilities-and-tokens/).

## Security analysis

The whole security value of the ELF loader depends on one ordering property, and this page is where that
ordering is enforced. Two properties matter.

**Load happens only after attestation.** `spawn_verified`
([`.../runner/verified.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/.../runner/verified.rs#L26)) runs `preflight::run` and propagates its error with `?` before it calls
`install`, so the loader is unreachable for an image that failed verification. Preflight is the full
verified-spawn check: the NØNOS-ID certificate against the baked trust anchor, then the manifest against
the publisher keys, with both Ed25519 and ML-DSA-65 required, covered on the
[capsules and trust](/docs/security/capsules-and-trust/) page. This is the boundary that lets the loader
treat the image as hostile-but-authentic: the structural checks on the [validation](/docs/subsystems/elf-loader/validation/) and
[segment](/docs/subsystems/elf-loader/segments/) pages defend against a malformed or W^X image, and the attestation here is what
guarantees the image is one a trusted publisher actually signed. Neither layer substitutes for the other,
and the ordering, verify then install, is what keeps them composed correctly.

**Installed capabilities come from the verified manifest, not from the request.** The source comment on
`spawn_verified` records that the caps placed on the PCB come from `preflighted.install_caps`, never from
`spec.requested_caps`, which is only the upper bound the spawn site is willing to grant for optional caps.
So a capsule cannot widen its own authority through the spawn request; the manifest that preflight
verified is the authority of record. The loader itself installs no capabilities, it turns verified bytes
into an address space; the [capability model](/docs/security/capabilities-and-tokens/) is where the caps
are decided.

The honest boundary: `load_elf_into_pid` ([`.../install/load_elf_into_pid.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/.../install/load_elf_into_pid.rs#L21)) maps into the ASID
returned by `lookup_asid_for_process(pid)` for a process the install step just created, so the capsule's
pages land in its own fresh page tables and are never briefly visible in the kernel's or another
capsule's mapping. Once the loader returns the relocated entry point, that address is installed as the
capsule's initial instruction pointer; from that moment the capsule's own containment is the
[paging manager](/docs/subsystems/memory/paging-manager/)'s and the [capability model](/docs/security/capabilities-and-tokens/)'s
job, not the loader's.

## Debugging spawn integration

A spawn that fails prints one reason string on the console keyed by the `SpawnError` variant
([`.../capsule_spawn/spec.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/.../capsule_spawn/spec.rs), mapped in [`.../from_vfs/load.rs:95`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/.../from_vfs/load.rs#L95)), so the failure names which stage of
the pipeline refused the capsule:

```
  [RUNTIME-LOAD] FAILED name=<capsule> reason=...
    manifest:pub_sig / manifest:payload_hash / ...   ManifestRejected(...)   verification refused the manifest
    attestation                                       AttestationRejected     the attestation trailer check failed
    elf_load                                          ElfLoad                 the loader refused or could not map the image
    address_space                                     AddressSpace            no ASID for the new process
    process_creation                                  ProcessCreation         the PCB could not be created
    endpoint_collision                                EndpointCollision       a declared service port was taken
    feature_disabled                                  FeatureDisabled         the capsule needs a build feature that is off
```

The `manifest:*` and `attestation` reasons come from preflight, so they mean the image never reached the
loader; the specific suffix (`pub_sig`, `payload_hash`, `pub_revoked`, `caps_ceiling`, `target`, and the
rest) says which verification check refused it. `reason=elf_load` is the one that means verification
passed and the loader is what failed, and on that path `load_elf_into_pid` also prints the capsule's debug
tag followed by the `ElfError` string ([`.../load_elf_into_pid.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/.../load_elf_into_pid.rs#L27)), so an `elf_load` failure is always
accompanied by the exact structural reason from the loader. The order is diagnostic on its own: a
`manifest:*` reason is a signing or policy problem, `elf_load` is a malformed or unmappable binary that
was nonetheless correctly signed, and `address_space` or `process_creation` is resource or bookkeeping
failure downstream of a valid, verified image.

## Source map

```
  src/kernel_core/process_spawn/capsule_spawn/from_vfs/load.rs           load_capsule_from_vfs, the reason strings
  src/kernel_core/process_spawn/capsule_spawn/runner/verified.rs          spawn_verified (verify-then-install)
  src/kernel_core/process_spawn/capsule_spawn/runner/install/install.rs   process + address space + load
  src/kernel_core/process_spawn/capsule_spawn/runner/install/load_elf_into_pid.rs   the loader call and its error log
  src/kernel_core/process_spawn/capsule_spawn/spec.rs                     the SpawnError variants
```

Every reference above is verified against those trees. The verification that gates this load is on the
[capsules and trust](/docs/security/capsules-and-trust/) page, the loader stages it calls are on the
[validation](/docs/subsystems/elf-loader/validation/), [segment](/docs/subsystems/elf-loader/segments/), and [layout](/docs/subsystems/elf-loader/layout/) pages, the address space it
maps into is on the [paging manager](/docs/subsystems/memory/paging-manager/) and [process](/docs/subsystems/process/pcb/) pages,
and the capabilities the spawn installs are the [capability model](/docs/security/capabilities-and-tokens/).
