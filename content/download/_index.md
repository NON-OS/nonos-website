---
title: "Download"
description: "Download NØNOS"
---

## Current Release

**NØNOS 0.8.0-alpha** (March 2026)

| File | Size | Description |
|------|------|-------------|
| nonos-0.8.0-alpha.iso | ~375 MB | Bootable ISO image |

[Download from GitHub Releases](https://github.com/NON-OS/nonos-kernel/releases)

## Write to USB

**Linux:**
```bash
sudo dd if=nonos-0.8.0-alpha.iso of=/dev/sdX bs=4M status=progress conv=fsync
sync
```

**macOS:**
```bash
diskutil unmountDisk /dev/diskN
sudo dd if=nonos-0.8.0-alpha.iso of=/dev/rdiskN bs=4m
diskutil eject /dev/diskN
```

**Windows:**
Use [Rufus](https://rufus.ie/) 4.0+ with GPT, UEFI, and "Write in DD Image mode".

## System Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | x86_64 with SSE2 | x86_64 with AES-NI, RDRAND |
| RAM | 512 MB | 4+ GB |
| Firmware | UEFI 2.0 | UEFI 2.0 with TPM 2.0 |
| Boot Media | USB 2.0 (1 GB+) | USB 3.0 |
| Network | Intel e1000, Realtek RTL | Intel AX200/WiFi 6 |
| Storage | Any SATA/NVMe | NVMe SSD |

See [Hardware Compatibility](/docs/hardware-drivers/) for full driver list.

## Verification

Verify the ISO after download:

```bash
sha256sum nonos-0.8.0-alpha.iso
```

Compare with the checksum published on the releases page.

## Source Code

For building from source, see the [Build Manual](/docs/development/build-manual/).

Repository: [github.com/NON-OS/nonos-kernel](https://github.com/NON-OS/nonos-kernel)
