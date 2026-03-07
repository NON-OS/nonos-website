---
title: "Download"
description: "Download NØNOS operating system images"
---

## Current Release

**NØNOS 0.8.1-alpha** (March 7, 2026)

Hardware compatibility improvements, ExitBootServices stability fixes, and virtio driver support.

| File | Size | Format |
|------|------|--------|
| [nonos-0.8.1-alpha.iso](/iso/nonos-0.8.1-alpha.iso) | 377 MB | Bootable ISO (optical/VM) |
| [nonos-0.8.1-alpha.img](/iso/nonos-0.8.1-alpha.img) | 445 MB | Raw disk image (USB) |

### Integrity Verification

**SHA256 Checksums:**
```
cf0e0dc3f05b2cc059cefa95fab13c969e52a3a3db3b5de81b36904d3327a351  nonos-0.8.1-alpha.iso
a9610a760c7660cca54290570834f250271591d59f1cdae53943d163fb1fb9ca  nonos-0.8.1-alpha.img
```

### Cryptographic Attestation

Every NØNOS release includes zero-knowledge attestation binding the kernel to its build environment.

| Parameter | Value |
|-----------|-------|
| Program Hash | `fa02d10e8804169a47233e34a6ff3566248958adff55e1248d50304aff4ab230` |
| Capsule Commitment | `2e0884e37c600272a090d1a90ffbf6e6a367fed38bd912a3dd2062f39c1eff9f` |
| Signing Key (Ed25519) | `4c5a3309bc2b13c8a85e2f780f7fd714e07e8e589084fac88e37c803634e705c` |
| Proof System | Groth16 over BLS12-381 |
| Signature Algorithm | Ed25519 |
| Integrity Hash | BLAKE3-256 |

### Build Information

| Component | Details |
|-----------|---------|
| Kernel Binary | 394,668,080 bytes |
| Signed Kernel | 394,668,144 bytes (+64 bytes Ed25519 signature) |
| Attested Kernel | 394,668,544 bytes (+400 bytes ZK proof block) |
| Toolchain | rustc nightly-2026-01-16 |
| Target | x86_64-nonos (custom freestanding) |

Download checksums: [SHA256SUMS](/iso/SHA256SUMS)

---

## Verification

**Verify on Linux/macOS:**
```bash
cd ~/Downloads
sha256sum -c SHA256SUMS
```

---

## Write to USB

### Linux
```bash
# Find your USB device
lsblk

# Write (replace sdX with your device)
sudo dd if=nonos-0.8.1-alpha.iso of=/dev/sdX bs=4M status=progress conv=fsync
sync
```

### macOS
```bash
# Find your USB device
diskutil list

# Unmount and write (replace N with disk number)
diskutil unmountDisk /dev/diskN
sudo dd if=nonos-0.8.1-alpha.iso of=/dev/rdiskN bs=4m
diskutil eject /dev/diskN
```

### Windows
Use [Rufus](https://rufus.ie/) 4.0+ or [balenaEtcher](https://etcher.balena.io/):
- Select GPT partition scheme
- Select UEFI target system
- Use "DD Image" mode (Rufus) or default (Etcher)

---

## System Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | x86_64 with SSE2 | x86_64 with AES-NI, RDRAND |
| RAM | 512 MB | 4+ GB |
| Firmware | UEFI 2.0+ | UEFI 2.0+ with Secure Boot |
| Boot Media | USB 2.0 (1 GB+) | USB 3.0+ |
| Storage | Any SATA/NVMe | NVMe SSD |

### Tested Hardware
- ThinkPad X1 Carbon (Gen 9, 10)
- HP EliteBook 840
- HP EliteDesk
- Framework Laptop
- Intel NUC 11/12
- Custom builds with Intel/AMD

See [Hardware Drivers](/docs/hardware-drivers/) for full details.

---

## Boot Instructions

1. Insert USB drive
2. Restart and enter UEFI/BIOS (usually F2, F10, F12, or Del)
3. Disable Secure Boot (if enabled)
4. Set USB as first boot device
5. Save and reboot
6. NØNOS bootloader will appear

**Common boot keys:**
- Dell: F12
- HP: F9 (boot menu), F10 (BIOS)
- Lenovo: F12 or Enter → F12
- ASUS: F8 or Esc

---

## Build from Source

```bash
git clone https://github.com/NON-OS/nonos-kernel.git
cd nonos-kernel
make
make iso
```

See [Build Manual](/docs/development/build-manual/) for full instructions.

---

## Previous Releases

### 0.8.0-alpha (March 5, 2026)

First public release with wallet security fixes.

| File | Size |
|------|------|
| [nonos-0.8.0-alpha.iso](/iso/nonos-0.8.0-alpha.iso) | 377 MB |
| [nonos-0.8.0-alpha.img](/iso/nonos-0.8.0-alpha.img) | 445 MB |

**SHA256:**
```
41c2f64ea4b268db9fab94e20f8300a0f9cc0eb8bae02a02038155aeeb849e11  nonos-0.8.0-alpha.iso
c0537130e4a11f259d47c5d3df26d8a6e7fa52707952315eb2768c5dc9707c7f  nonos-0.8.0-alpha.img
```

**ZK Attestation:**
```
Program Hash: fa02d10e8804169a47233e34a6ff3566248958adff55e1248d50304aff4ab230
Proof Hash:   6be8b4e5052dcb89daf178f94892ebc5b5d0e975a813ac9ca0d861d36b66aca4
VK Hash:      a84d203acbb1ad2b6dcaed6054b992d8d3380d677e9b36db8fa900f2a5ebd0f2
```

---

See [Release History](/releases/) for full changelog.
