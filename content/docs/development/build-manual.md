---
title: "Build Manual"
description: "Complete NØNOS developer build and release manual"
weight: 10
---

# NØNOS Developer Build & Release Manual

**Version 0.8.1** | March 2026


**Classification:** Internal Engineering Documentation

**License:** AGPL-3.0


## Contents

1. [Repository Structure](#1-repository-structure)
2. [Toolchain Requirements](#2-toolchain-requirements)
3. [Build Targets](#3-build-targets)
4. [Kernel Compilation Pipeline](#4-kernel-compilation-pipeline)
5. [Artifact Signing Pipeline](#5-artifact-signing-pipeline)
6. [Zero-Knowledge Proof Generation](#6-zero-knowledge-proof-generation)
7. [ISO Layout](#7-iso-layout)
8. [Testing](#8-testing)
9. [Reproducible Builds](#9-reproducible-builds)
10. [Release Process](#10-release-process)


## 1. Repository Structure

### 1.1 Top-Level Directory Tree

```
nonos-kernel/
├── Cargo.toml                    # Workspace manifest
├── Makefile                      # Build orchestration
├── keys/                         # Signing keys (gitignored)
│   └── signing_key_v1.bin        # Ed25519 32-byte seed
├── scripts/
│   └── sign_kernel.py            # Kernel signing
├── firmware/
│   ├── OVMF.fd                   # UEFI firmware
│   └── OVMF_VARS.fd              # UEFI variables
├── target/                       # Build output
│   ├── esp/                      # ESP staging
│   ├── x86_64-nonos/             # Kernel artifacts
│   ├── x86_64-unknown-uefi/      # Bootloader artifacts
│   ├── kernel_signed.bin
│   ├── kernel_attested.bin
│   ├── attestation_proof.bin
│   └── nonos.iso
├── zk-artifacts/                 # ZK ceremony outputs
├── nonos-bootloader/             # Bootloader source (38 dirs, 153 files)
├── src/                          # Kernel source (542 dirs, 3110 files)
└── docs/
```

### 1.2 Kernel Source Layout

The kernel comprises 542 directories and 3,110 source files:

```
nonos-kernel/
├── Cargo.toml
├── build.rs                      # PQClean, manifest signing
├── linker.ld
├── x86_64-nonos.json             # Custom target spec
├── .cargo/config.toml
├── third_party/pqclean/          # ML-KEM (Kyber)
├── nonos-bootloader/             # Bootloader (see section 1.3)
├── src/
│   ├── lib.rs
│   ├── nonos_main.rs             # Entry point (_start)
│   ├── arch/
│   │   └── x86_64/
│   │       ├── gdt.rs
│   │       ├── idt.rs
│   │       ├── apic.rs
│   │       ├── smp.rs
│   │       └── time.rs
│   ├── boot/
│   │   ├── handoff.rs            # BootHandoffV1
│   │   └── init.rs
│   ├── crypto/
│   │   ├── ed25519.rs
│   │   ├── curve25519.rs
│   │   ├── aead.rs
│   │   ├── mlkem.rs
│   │   ├── mldsa.rs
│   │   ├── sphincs.rs
│   │   └── pqclean_support/randombytes.c
│   ├── drivers/
│   │   ├── console.rs
│   │   ├── pci.rs
│   │   ├── ahci.rs
│   │   ├── nvme.rs
│   │   ├── usb/
│   │   ├── audio/
│   │   └── virtio/
│   │       ├── virtio_net.rs
│   │       └── virtio_rng.rs
│   ├── fs/
│   │   ├── vfs.rs
│   │   ├── ramfs.rs
│   │   ├── cryptofs.rs
│   │   ├── ext4.rs
│   │   └── fat32.rs
│   ├── graphics/
│   │   ├── framebuffer.rs
│   │   ├── compositor.rs
│   │   └── fonts/
│   ├── input/
│   │   ├── keyboard.rs
│   │   ├── mouse.rs
│   │   └── touchpad.rs
│   ├── interrupts/
│   ├── ipc/
│   ├── memory/
│   │   ├── heap.rs
│   │   ├── paging.rs
│   │   └── kaslr.rs
│   ├── network/
│   │   ├── stack.rs
│   │   ├── tcp.rs
│   │   ├── udp.rs
│   │   ├── dns.rs
│   │   └── onion/
│   ├── process/
│   ├── sched/
│   ├── security/
│   │   ├── capabilities.rs
│   │   └── sandbox.rs
│   ├── shell/
│   │   └── commands/              # 100+ commands
│   ├── storage/
│   ├── syscall/
│   ├── ui/
│   │   ├── desktop.rs
│   │   ├── window_manager.rs
│   │   ├── dock.rs
│   │   └── apps/
│   │       ├── terminal.rs
│   │       ├── file_manager.rs
│   │       ├── text_editor.rs
│   │       ├── browser.rs
│   │       ├── wallet.rs
│   │       ├── calculator.rs
│   │       ├── settings.rs
│   │       └── process_manager.rs
│   ├── vault/
│   └── zk_engine/
│       ├── groth16.rs
│       └── halo2.rs
└── tests/
```

### 1.3 Bootloader Source Layout

The bootloader resides within the kernel repository at `nonos-kernel/nonos-bootloader/` and comprises 38 directories and 153 source files:

```
nonos-kernel/nonos-bootloader/
├── Cargo.toml
├── build.rs                      # Key embedding
├── src/
│   ├── main.rs                   # efi_main
│   ├── crypto/
│   │   ├── ed25519.rs
│   │   ├── blake3.rs
│   │   └── keys.rs
│   ├── display/
│   │   ├── framebuffer.rs
│   │   └── log_panel.rs
│   ├── kernel_verify/
│   │   └── verify.rs
│   ├── memory/
│   │   └── map.rs
│   ├── zk/
│   │   ├── groth16.rs
│   │   ├── registry/
│   │   │   └── keys.rs
│   │   └── verifier.rs
│   └── elf/
│       └── loader.rs
└── tools/
    ├── keygen/
    ├── sign-kernel/
    ├── embed-zk-proof/
    ├── generate-keys/
    ├── nonos-attestation-circuit/
    ├── threshold-sign/
    └── zk-ceremony/
```

Source: [github.com/NON-OS/nonos-kernel/tree/main/nonos-bootloader](https://github.com/NON-OS/nonos-kernel/tree/main/nonos-bootloader)

### 1.4 Build Pipeline

All builds run from the `nonos-kernel/` root directory:

```
make bootloader        → target/x86_64-unknown-uefi/release/nonos_bootloader.efi
make kernel            → target/x86_64-nonos/release/nonos-kernel
make sign-kernel       → target/kernel_signed.bin
make generate-zk-keys  → zk-artifacts/attestation_{proving,verifying}_key.bin
make generate-zk-proof → target/attestation_proof.bin
make embed-zk-proof    → target/kernel_attested.bin
make esp               → target/esp/EFI/...
make iso               → target/nonos.iso
make usb               → target/nonos.img
```


## 2. Toolchain Requirements

### 2.1 Rust Toolchain

| Component | Version |
|-----------|---------|
| Toolchain | `nightly-2026-01-16` |
| Edition | 2021 |
| Resolver | 2 |

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup install nightly-2026-01-16
rustup default nightly-2026-01-16
rustup target add x86_64-unknown-uefi --toolchain nightly-2026-01-16
rustup component add rust-src --toolchain nightly-2026-01-16
```

### 2.2 Target Triples

| Target | Artifact |
|--------|----------|
| `x86_64-unknown-uefi` | Bootloader (PE32+) |
| `x86_64-nonos` | Kernel (ELF64) |

**Custom target (`x86_64-nonos.json`):**

```json
{
  "llvm-target": "x86_64-unknown-none-elf",
  "arch": "x86_64",
  "vendor": "nonos",
  "os": "none",
  "data-layout": "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128",
  "target-endian": "little",
  "target-pointer-width": 64,
  "target-c-int-width": 32,
  "max-atomic-width": 64,
  "executables": true,
  "panic-strategy": "abort",
  "disable-redzone": true,
  "frame-pointer": "always",
  "cpu": "x86-64",
  "features": "+sse,+sse2,-sse3,-ssse3,-sse4.1,-sse4.2,-avx,-avx2,-mmx",
  "linker-flavor": "ld.lld",
  "linker": "rust-lld",
  "pre-link-args": {
    "ld.lld": ["-nostdlib", "-pie", "--gc-sections", "-z", "max-page-size=0x1000"]
  },
  "relocation-model": "pic",
  "code-model": "small",
  "position-independent-executables": true,
  "static-position-independent-executables": true,
  "no-default-libraries": true,
  "stack-probes": { "kind": "inline" },
  "eh-frame-header": false
}
```

### 2.3 LLVM

Bundled with nightly. Verify:

```bash
rustc +nightly-2026-01-16 -vV | grep LLVM
```

### 2.4 Cargo Features

**Kernel defaults:**

```toml
default = [
  "nonos-syscall-int80", "nonos-log-serial", "nonos-log-vga",
  "nonos-heap-guard", "nonos-wx-audit", "nonos-page-zero",
  "nonos-kaslr", "nonos-pcid", "nonos-nx-stack",
  "nonos-smap-smep", "nonos-consttime", "nonos-cet",
  "nonos-apic", "nonos-smp", "arch-x86_64",
  "crypto-core", "crypto-aead", "crypto-ed25519-int", "crypto-curve25519",
  "mlkem768", "mldsa3", "zk-groth16",
  "cli", "sched", "ui",
  "fs-ram", "fs-vfs", "fs-cryptofs",
  "net-core", "net-sockets", "net-ipv4", "net-ipv6",
]
```

**Bootloader defaults:**

```toml
default = ["logging", "zk-groth16", "zk-vk-provisioned", "zk-zeroize"]
```

### 2.5 QEMU

| Platform | Minimum | Recommended |
|----------|---------|-------------|
| Linux | 7.0.0 | 8.2.0+ |
| macOS | 8.0.0 | 9.0.0+ |
| WSL2 | 7.0.0 | 8.2.0+ |

OVMF included at `firmware/OVMF.fd`. Fallbacks:
- Linux: `/usr/share/OVMF/OVMF_CODE.fd`
- macOS: `/opt/homebrew/share/qemu/edk2-x86_64-code.fd`

### 2.6 Additional Tools

| Tool | Purpose |
|------|---------|
| GDB | Kernel debugging |
| llvm-objdump | Binary inspection |
| xorriso | ISO creation |
| sgdisk | GPT partitioning |
| mtools | FAT32 operations |

### 2.7 Python

```bash
pip3 install pynacl
```


## 3. Build Targets

### 3.1 Debug

```bash
# Kernel (from nonos-kernel/)
cargo build --target x86_64-nonos.json \
  -Zbuild-std=core,alloc -Zbuild-std-features=compiler-builtins-mem

# Bootloader (from nonos-kernel/)
cd nonos-bootloader && cargo build --target x86_64-unknown-uefi
```

**Profile:**

```toml
[profile.dev]
panic = "abort"
opt-level = 0
debug = true
codegen-units = 1
overflow-checks = true
```

### 3.2 Release

```bash
make all
```

Executes: `check-deps` → `bootloader` → `kernel` → `sign-kernel` → `embed-zk-proof` → `esp`

**Profile:**

```toml
[profile.release]
panic = "abort"
opt-level = 3
lto = false
strip = "none"
codegen-units = 1
overflow-checks = false
```

### 3.3 Kernel Only

```bash
make kernel
```

Direct invocation (macOS):

```bash
# From nonos-kernel/
SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk \
AR=/Library/Developer/CommandLineTools/usr/bin/ar \
CC=/Library/Developer/CommandLineTools/usr/bin/clang \
NONOS_SIGNING_KEY=$(pwd)/keys/signing_key_v1.bin \
cargo build --release --target x86_64-nonos.json \
  -Zbuild-std=core,alloc -Zbuild-std-features=compiler-builtins-mem
```

Output: `target/x86_64-nonos/release/nonos-kernel`

### 3.4 Bootloader Only

```bash
make bootloader
```

Direct invocation:

```bash
# From nonos-kernel/
cd nonos-bootloader && \
  NONOS_SIGNING_KEY=$(pwd)/../keys/signing_key_v1.bin \
  cargo build --target x86_64-unknown-uefi --release --features zk-groth16
```

Output: `target/x86_64-unknown-uefi/release/nonos_bootloader.efi`

### 3.5 ISO

```bash
make iso
```

Uses xorriso with El Torito UEFI boot:

```bash
xorriso -as mkisofs -o target/nonos.iso -R -J -V "NONOS" \
  -e EFI/Boot/BOOTX64.EFI -no-emul-boot \
  -append_partition 2 0xef target/iso/EFI/Boot/BOOTX64.EFI \
  target/iso
```

### 3.6 USB Image

```bash
make usb
```

Output: `target/nonos.img` (GPT with ESP)

### 3.7 Clean

```bash
make clean      # Build artifacts
make distclean  # Including dependencies
```


## 4. Kernel Compilation Pipeline

### 4.1 Linker Flow

```
rustc → LLVM → rust-lld (ld.lld)
```

Arguments from target spec:

```
-nostdlib -pie --gc-sections -z max-page-size=0x1000
```

Arguments from build.rs:

```
--script=nonos-kernel/linker.ld
-nostdlib -static --gc-sections -z max-page-size=0x1000
```

### 4.2 Linker Script

**`linker.ld`:**

```ld
ENTRY(_start)
OUTPUT_ARCH(i386:x86-64)
OUTPUT_FORMAT(elf64-x86-64)

PHDRS {
    text    PT_LOAD FLAGS(5);  /* r-x */
    rodata  PT_LOAD FLAGS(4);  /* r-- */
    data    PT_LOAD FLAGS(6);  /* rw- */
    dynamic PT_DYNAMIC FLAGS(6);
}

SECTIONS {
    . = 0;

    .text ALIGN(0x1000) : {
        *(.text._start)
        *(.text .text.*)
    } :text

    .rodata ALIGN(0x1000) : {
        *(.rodata .rodata.*)
    } :rodata

    .data ALIGN(0x1000) : {
        *(.data .data.*)
    } :data

    .nonos.manifest ALIGN(0x1000) : {
        __nonos_manifest_start = .;
        KEEP(*(.nonos.manifest))
        __nonos_manifest_end = .;
    } :data

    .nonos.sig ALIGN(8) : {
        __nonos_signature_start = .;
        KEEP(*(.nonos.sig))
        __nonos_signature_end = .;
    } :data

    .bss ALIGN(0x1000) (NOLOAD) : {
        __bss_start = .;
        *(.bss .bss.*)
        *(COMMON)
        __bss_end = .;
    } :data

    . = ALIGN(0x1000);
    __stack_bottom = .;
    . += 64K;
    __stack_top = .;

    _end = .;

    .rela.dyn ALIGN(8) : { *(.rela*) } :data
    .dynamic ALIGN(8) : { *(.dynamic) } :data :dynamic
    .got ALIGN(8) : { *(.got) *(.got.plt) } :data

    /DISCARD/ : {
        *(.eh_frame*) *(.comment) *(.note*) *(.debug*) *(.plt*)
    }
}
```

### 4.3 Section Layout

| Section | Permissions | Contents |
|---------|-------------|----------|
| `.text` | R-X | Code |
| `.rodata` | R-- | Constants |
| `.data` | RW- | Initialized data |
| `.nonos.manifest` | RW- | Kernel manifest |
| `.nonos.sig` | RW- | Signature (64B) |
| `.bss` | RW- | Uninitialized (NOBITS) |
| Stack | RW- | 64 KiB |
| `.rela.dyn` | RW- | PIE relocations |
| `.got` | RW- | GOT |

### 4.4 Exported Symbols

| Symbol | Purpose |
|--------|---------|
| `_start` | Entry point |
| `__nonos_manifest_start` | Manifest begin |
| `__nonos_manifest_end` | Manifest end |
| `__nonos_signature_start` | Signature begin |
| `__bss_start` / `__bss_end` | BSS bounds |
| `__stack_top` | Initial RSP |
| `_end` | Binary end |

### 4.5 Entry Point

**`nonos_main.rs`:**

```rust
#[unsafe(naked)]
#[no_mangle]
#[link_section = ".text._start"]
pub extern "C" fn _start() -> ! {
    naked_asm!(
        "push rdi",

        // Enable SSE
        "mov rax, cr0",
        "and ax, 0xFFFB",
        "or ax, 0x2",
        "mov cr0, rax",

        "mov rax, cr4",
        "or ax, 0x600",
        "mov cr4, rax",

        "pop rdi",
        "call {rust_main}",
        "hlt",
        rust_main = sym rust_main,
    );
}
```

Bootloader passes `BootHandoffV1*` in RDI (SysV AMD64 ABI).


## 5. Artifact Signing Pipeline

### 5.1 Hash Computation

**Domain separator:** `"NONOS_CAPSULE_V1"`

```rust
let mut h = Sha512::new();
h.update(b"NONOS_CAPSULE_V1");
h.update(data);
let digest = h.finalize();
let sig = keypair.sign(&digest);
```

### 5.2 Ed25519 Signing

**`scripts/sign_kernel.py`:**

```python
from nacl.signing import SigningKey
from nacl.encoding import RawEncoder

def sign_kernel(kernel_path, key_path, output_path):
    kernel_data = Path(kernel_path).read_bytes()
    key_seed = Path(key_path).read_bytes()  # 32 bytes

    signing_key = SigningKey(key_seed)
    signed = signing_key.sign(kernel_data, encoder=RawEncoder)
    signature = signed.signature  # 64 bytes

    output_data = kernel_data + signature
    Path(output_path).write_bytes(output_data)
```

```bash
python3 scripts/sign_kernel.py \
  target/x86_64-nonos/release/nonos-kernel \
  keys/signing_key_v1.bin \
  target/kernel_signed.bin
```

### 5.3 Binary Layout

| Offset | Field | Size |
|--------|-------|------|
| 0 | ELF64 Kernel | Variable |
| Kernel End | Ed25519 Signature | 64 bytes |
| | R component | 32 bytes |
| | S component | 32 bytes |
| Sig End | ZK Proof Block | Variable |
| +0 | Magic: `4E C3 5A 50` | 4 bytes |
| +4 | Version: `00 00 00 01` | 4 bytes |
| +8 | Program Hash | 32 bytes |
| +40 | Capsule Commitment | 32 bytes |
| +72 | Public Inputs Length | 4 bytes |
| +76 | Proof Length | 4 bytes |
| +80 | Public Inputs | N bytes |
| +80+N | Groth16 Proof | 192 bytes |

### 5.4 Public Key Embedding

**`nonos-bootloader/build.rs`:**

```rust
fn generate_keys() {
    let signing_key_path = env::var("NONOS_SIGNING_KEY")
        .unwrap_or_else(|_| "../keys/signing_key_v1.bin".to_string());

    let key_data = fs::read(&signing_key_path)?;
    let seed: [u8; 32] = key_data[..32].try_into()?;
    let public_key = derive_ed25519_public_key(&seed);
    let key_id = compute_key_id(&public_key);
}

fn compute_key_id(public_key: &[u8; 32]) -> [u8; 32] {
    let mut hasher = blake3::Hasher::new_derive_key("NONOS:KEYID:ED25519:v1");
    hasher.update(public_key);
    *hasher.finalize().as_bytes()
}
```

Output (`$OUT_DIR/keys_generated.rs`):

```rust
pub const NONOS_PUBLIC_KEY: [u8; 32] = [...];
pub const NONOS_KEY_ID: [u8; 32] = [...];
pub const KEY_FINGERPRINT: &str = "a1b2c3d4e5f6a7b8";
pub const BUILD_TIMESTAMP: u64 = 1709500800;
pub const KEY_VERSION: u32 = 1;
```

### 5.5 Development Key Generation

If no key exists, `build.rs` generates one from `/dev/urandom`:

```rust
if !Path::new(default).exists() {
    let mut key = [0u8; 32];
    fs::File::open("/dev/urandom")?.read_exact(&mut key)?;
    fs::write(default, &key)?;
}
```

Release builds panic without a valid key.

### 5.6 Production Ceremony

```bash
# From nonos-kernel/
cd nonos-bootloader/tools/keygen
cargo build --release

./target/release/nonos-keygen \
  --count 1 \
  --out-dir ../../../keys \
  --allow-write-secrets \
  --operator "release@nonos.systems"
```

Output:

```
keys/
  signer1.key           # Secret (PROTECT)
  signer1.pub.raw       # Public key
  signer1.pub.hex
  generation_log.json
```

### 5.7 Key Rotation

1. Generate new key pair
2. Update `nonos-bootloader/src/crypto/keys.rs`
3. Rebuild bootloader
4. Sign kernel with new key
5. Publish revocation at `https://nonos.software/keys/revoked.txt`


## 6. Zero-Knowledge Proof Generation

### 6.1 Circuit Statement

The attestation circuit proves:

1. Program hash matches embedded constant
2. PCR preimage has sufficient entropy
3. Hardware attestation level exceeds threshold
4. Capsule commitment is non-zero

**`circuit.rs`:**

```rust
impl<F: PrimeField> ConstraintSynthesizer<F> for NonosAttestationCircuit<F> {
    fn generate_constraints(self, cs: ConstraintSystemRef<F>) -> Result<(), SynthesisError> {
        // Public inputs
        let capsule_var = UInt8::<F>::new_input_vec(cs.clone(), &capsule_commitment_bytes)?;
        let program_hash_var = UInt8::<F>::new_input_vec(cs.clone(), &program_hash_bytes)?;

        // Witnesses
        let pcr_var = UInt8::<F>::new_witness_vec(cs.clone(), &pcr_bytes)?;
        let hw_var = FpVar::<F>::new_witness(cs.clone(), || Ok(F::from(hw_level)))?;

        // program_hash == expected
        for (i, &expected) in expected_program_hash_bytes().iter().enumerate() {
            let expected_var = UInt8::<F>::new_constant(cs.clone(), expected)?;
            program_hash_var[i].enforce_equal(&expected_var)?;
        }

        // PCR entropy >= minimum
        pcr_nonzero_count.enforce_cmp(&min_entropy, Ordering::Greater, false)?;

        // hw_level >= minimum
        hw_var.enforce_cmp(&min_hw_var, Ordering::Greater, false)?;

        // capsule_commitment != 0
        cc_nonzero.enforce_equal(&Boolean::TRUE)?;

        Ok(())
    }
}
```

### 6.2 Public Inputs

| Field | Size |
|-------|------|
| `capsule_commitment` | 32B |
| `program_hash` | 32B |

### 6.3 Witnesses

| Field | Size |
|-------|------|
| `pcr_preimage` | 128B |
| `hardware_attestation` | 8B |

Private. Not revealed.

### 6.4 Proof Embedding

```bash
./embed-zk-proof \
  --input target/kernel_signed.bin \
  --output target/kernel_attested.bin \
  --proof target/attestation_proof.bin \
  --program-hash fa02d10e8804169a47233e34a6ff3566248958adff55e1248d50304aff4ab230 \
  --public-inputs target/public_inputs.bin
```

**Block format:**

```
Offset  Field
0x00    Magic: 0x4E 0xC3 0x5A 0x50
0x04    Version: 0x00000001
0x08    Program Hash (32B)
0x28    Capsule Commitment (32B)
0x48    Public Inputs Len (4B)
0x4C    Proof Len (4B)
0x50    Public Inputs
0x50+N  Groth16 Proof (192B)
```

### 6.5 Verification Flow

1. Compute BLAKE3 of kernel code
2. Verify Ed25519 signature
3. Locate ZK block via magic `0x4EC35A50`
4. Extract program hash
5. Lookup VK by program hash
6. Verify Groth16 proof (arkworks BLS12-381)

**Registry (`nonos-bootloader/src/zk/registry/keys.rs`):**

```rust
pub const PROGRAM_HASH_BOOT_AUTHORITY: [u8; 32] = [
    0xfa, 0x02, 0xd1, 0x0e, 0x88, 0x04, 0x16, 0x9a, ...
];

pub const VK_BOOT_AUTHORITY_BLS12_381_GROTH16: &[u8] = &[
    0x86, 0x2c, 0xf4, 0x4b, ...  // 576 bytes
];
```

### 6.6 Key Generation

```bash
make generate-zk-keys
```

Runs:

```bash
./generate-keys generate \
  --output generated_keys/ \
  --seed "nonos-production-attestation-v1-2026" \
  --allow-unsigned \
  --print-program-hash
```

Output:

```
attestation_proving_key.bin    # ~50 MB
attestation_verifying_key.bin  # 576 bytes
metadata.json
```

Update bootloader:

```bash
make show-vk
# Paste into nonos-bootloader/src/zk/registry/keys.rs
```


## 7. ISO Layout

### 7.1 GPT Structure

| LBA | Contents |
|-----|----------|
| 0 | Protective MBR |
| 1 | GPT Header |
| 2-33 | GPT Entries (Entry 1: ESP, GUID C12A7328-F81F-11D2-BA4B-...) |
| 2048+ | EFI System Partition (FAT32) |
| End-33 | Secondary GPT Entries |
| End | Secondary GPT Header |

### 7.2 ESP Contents

```
/EFI/Boot/BOOTX64.EFI      # Bootloader
/EFI/nonos/kernel.bin      # Signed kernel
/EFI/nonos/boot.cfg        # Configuration
/startup.nsh               # Shell fallback
```

### 7.3 Bootloader Placement

Path: `/EFI/Boot/BOOTX64.EFI`

UEFI removable media default. No boot entry needed.

| Attribute | Value |
|-----------|-------|
| Format | PE32+ |
| Subsystem | EFI_APPLICATION |
| Entry | `efi_main` |
| Size | 3-5 MB |

### 7.4 Kernel Placement

Path: `/EFI/nonos/kernel.bin`

### 7.5 FAT32 Parameters

| Parameter | Value |
|-----------|-------|
| Sector size | 512B |
| Cluster size | 4096B |
| FAT type | FAT32 |
| Reserved sectors | 32 |
| FAT count | 2 |
| Label | "EFI" |

```bash
mformat -i esp.img -F -v EFI ::
```


## 8. Testing

### 8.1 QEMU

**Graphical:**

```bash
make run
```

```bash
qemu-system-x86_64 \
  -m 1G -cpu Haswell -machine q35 \
  -drive "format=raw,file=fat:rw:target/esp" \
  -drive if=pflash,format=raw,unit=0,readonly=on,file="firmware/OVMF.fd" \
  -drive if=pflash,format=raw,unit=1,readonly=on,file="firmware/OVMF_VARS.fd" \
  -device e1000,netdev=net0 -netdev user,id=net0 \
  -serial mon:stdio -vga std -no-reboot
```

**Serial only:**

```bash
make run-serial
```

### 8.2 GDB Debugging

```bash
make debug
```

Adds `-s -S` (GDB server on :1234, pause at start).

```bash
gdb -ex 'target remote :1234'
```

```gdb
file target/x86_64-nonos/release/nonos-kernel
break _start
continue
info registers
x/16xg 0xffff800000000000
disassemble _start
stepi
```

### 8.3 Serial Output

COM1 @ 0x3F8, 115200 baud.

```bash
screen /dev/ttyUSB0 115200
```

Output:

```
K
S
[BOOT] NONOS Bootloader v1.0
[+] GOP framebuffer initialized
...
kernel online
```

### 8.4 Panic Handler

```rust
#[panic_handler]
fn panic(info: &PanicInfo) -> ! {
    serial_println!("[PANIC] {}", info);
    vga_panic(info);
    loop { unsafe { asm!("hlt"); } }
}
```

### 8.5 Hardware Testing

1. Disable Secure Boot and CSM
2. Set USB as first boot device
3. Flash: `sudo dd if=target/nonos.img of=/dev/sdX bs=4M status=progress`
4. Connect serial to COM1
5. Boot and monitor
6. Report issues at `https://github.com/NON-OS/nonos-kernel/issues`


## 9. Reproducible Builds

### 9.1 Flags

**`.cargo/config.toml`:**

```toml
[build]
rustflags = [
    "-C", "link-arg=-Bsymbolic",
    "-C", "link-arg=--build-id=none",
]

[env]
SOURCE_DATE_EPOCH = "0"
```

**Profile:**

```toml
[profile.release]
codegen-units = 1
lto = false
```

### 9.2 Timestamps

```rust
let epoch = std::env::var("SOURCE_DATE_EPOCH")
    .ok()
    .and_then(|s| s.parse().ok())
    .unwrap_or_else(|| SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs());
```

```bash
SOURCE_DATE_EPOCH=$(git log -1 --format=%ct) make all
```

### 9.3 Validation

```bash
# Machine A
SOURCE_DATE_EPOCH=0 NONOS_SIGNING_KEY=keys/test.key make all
sha256sum target/kernel_signed.bin > checksums_a.txt

# Machine B
SOURCE_DATE_EPOCH=0 NONOS_SIGNING_KEY=keys/test.key make all
sha256sum target/kernel_signed.bin > checksums_b.txt

diff checksums_a.txt checksums_b.txt
```

**Blockers:**

| Issue | Mitigation |
|-------|------------|
| Timestamps | SOURCE_DATE_EPOCH |
| __FILE__ | Relative paths |
| HashMap | BTreeMap |
| Parallelism | codegen-units = 1 |


## 10. Release Process

### 10.1 Tagging

```bash
# From nonos-kernel/
sed -i 's/version = "0.8.0"/version = "0.8.1"/' Cargo.toml
git add -A
git commit -m "Release v0.8.1"
git tag -a v0.8.1 -m "NØNOS v0.8.1"
git push origin main
git push origin v0.8.1
```

### 10.2 Checksums

```bash
NONOS_SIGNING_KEY=/secure/release.key make all
make iso
make usb

cd target
sha256sum nonos.iso nonos.img > SHA256SUMS
b3sum nonos.iso nonos.img > B3SUMS
gpg --detach-sign --armor SHA256SUMS
gpg --detach-sign --armor B3SUMS
```

### 10.3 Publication

```bash
gpg --detach-sign --armor nonos.iso
scp nonos.iso nonos.iso.asc SHA256SUMS SHA256SUMS.asc B3SUMS B3SUMS.asc \
  releases@nonos.software:/var/www/nonos.software/iso/
```

### 10.4 Key Distribution

| Location | Content |
|----------|---------|
| `https://nonos.software/keys/release-signing-key.asc` | GPG key |
| `github.com/NON-OS/nonos-kernel/KEYS.md` | Documentation |
| `keys.openpgp.org` | Keyserver |

### 10.5 Checklist

- [ ] Version bumped
- [ ] CHANGELOG updated
- [ ] CI passing
- [ ] Build completes
- [ ] SHA256SUMS generated
- [ ] B3SUMS generated
- [ ] GPG signatures created
- [ ] Artifacts uploaded
- [ ] GitHub release created
- [ ] Website updated


## Appendix A: Makefile Targets

| Target | Description |
|--------|-------------|
| `all` | Full build |
| `bootloader` | Bootloader only |
| `kernel` | Kernel only |
| `sign-kernel` | Sign with Ed25519 |
| `embed-zk-proof` | Embed ZK proof |
| `esp` | Stage ESP |
| `run` | QEMU graphical |
| `run-serial` | QEMU serial |
| `debug` | QEMU + GDB |
| `iso` | Create ISO |
| `usb` | Create USB image |
| `zk-tools` | Build ZK tools |
| `generate-zk-keys` | New VK/PK |
| `generate-zk-proof` | Generate proof |
| `show-vk` | Print VK bytes |
| `clean` | Remove artifacts |
| `distclean` | Full clean |
| `test` | Run tests |
| `fmt` | Format |
| `check` | Clippy |


## Appendix B: Environment Variables

| Variable | Default |
|----------|---------|
| `NONOS_SIGNING_KEY` | `keys/signing_key_v1.bin` |
| `RUSTUP_TOOLCHAIN` | `nightly-2026-01-16` |
| `SOURCE_DATE_EPOCH` | Current time |
| `GIT_COMMIT` | Auto |


## Appendix C: Troubleshooting

### C.1 macOS LLVM

```
error: unable to find libLLVM
```

```bash
export SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk
export AR=/Library/Developer/CommandLineTools/usr/bin/ar
export CC=/Library/Developer/CommandLineTools/usr/bin/clang
```

### C.2 Missing rust-src

```
can't find crate for 'core'
```

```bash
rustup component add rust-src --toolchain nightly-2026-01-16
```

### C.3 No Signing Key

```
NONOS_SIGNING_KEY file not found
```

```bash
mkdir -p keys
dd if=/dev/urandom of=keys/signing_key_v1.bin bs=32 count=1
```

### C.4 ZK Proof Missing

```
[FATAL] ZK proof missing
```

```bash
make generate-zk-keys
make generate-zk-proof
make embed-zk-proof
```


## Document History

| Version | Date | Author |
|---------|------|--------|
| 1.0 | 2026-03 | NØNOS Engineering |


**NØNOS: Sovereignty From Ø**

https://nonos.software


AGPL-3.0 | Copyright 2026 NØNOS Contributors
