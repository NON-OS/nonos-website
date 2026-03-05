---
title: "Getting Started"
description: "Quick start guide for NØNOS"
weight: 1
---

# Getting Started with NØNOS

Welcome to NØNOS. This guide will help you get the operating system running in under 15 minutes.


## What You Need

**Hardware Requirements:**

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | x86_64 with SSE2 | x86_64 with AES-NI, RDRAND |
| RAM | 512 MB | 4 GB+ |
| Boot | UEFI 2.0 | UEFI 2.0 with TPM 2.0 |
| Storage | USB drive (1 GB+) | USB 3.0 drive |

**Software Requirements:**
- A computer that can boot from USB
- Another computer to create the boot media (or use QEMU)


## Quick Start Options

### Option 1: Build from Source (Recommended)

Building from source ensures you have the exact code you'll be running:

```bash
# Clone the repository
git clone https://github.com/NON-OS/nonos-kernel
cd nonos-kernel

# Build everything
make all

# Create bootable ISO
make iso
```

**Output:** `target/nonos.iso` (~375 MB)

Then write to USB and boot. See the [Full Installation Guide](/docs/getting-started/full-installation-guide/) for detailed steps.

### Option 2: Run in QEMU (Testing)

Test NØNOS without touching your actual hardware:

```bash
# After building
make run

# Or with specific options
qemu-system-x86_64 \
  -m 2G \
  -drive format=raw,file=fat:rw:target/esp \
  -drive if=pflash,format=raw,file=firmware/OVMF.fd \
  -serial mon:stdio
```

### Option 3: Download Pre-built ISO

When releases are available, download from the [releases page](/releases/).


## First Boot

When NØNOS boots, you'll see:

1. **Boot screen** — Cryptographic verification progress
2. **Desktop** — Full graphical environment with dock and menu bar

### Using the Desktop

- **Click dock icons** to launch applications
- **Click settings gear** (menu bar) for system settings
- **Terminal** provides shell access with 100+ commands

### Using the Shell

Common commands to try:

```bash
# System information
uname -a

# List files
ls -la

# Network status
ifconfig

# Check capabilities
capabilities

# Launch built-in editor
vi filename.txt
```

For the complete command reference, see [Shell Commands](/docs/shell-commands/).


## Understanding ZeroState

NØNOS is different from other operating systems. By default:

- **Everything is in RAM** — Files exist only while power is on
- **No persistent storage** — Shutdown means data is gone
- **This is intentional** — It's a privacy feature, not a bug

### What This Means

| Action | What Happens |
|--------|--------------|
| Create a file | Stored in RAM |
| Shut down | File vanishes forever |
| Reboot | Start fresh, nothing saved |

### If You Need to Save Files

For files you want to keep:
1. Plug in a USB drive
2. Mount it: `mount /dev/sdb1 /mnt/usb`
3. Copy files: `cp file.txt /mnt/usb/`
4. Safely eject: `sync && umount /mnt/usb`

Files on external drives persist. Files in RAM don't.


## Troubleshooting

### Won't Boot

- Ensure UEFI is enabled (not Legacy/CSM)
- Disable Secure Boot initially
- Check that the USB was written correctly

### Black Screen

- Connect to serial port for diagnostics
- Try different graphics settings in UEFI
- Test in QEMU first

### Kernel Panic

- Check hardware compatibility
- Ensure all verification passed during boot
- Report issues on GitHub


## Next Steps

- [Full Installation Guide](/docs/getting-started/full-installation-guide/) — Detailed instructions
- [Shell Commands](/docs/shell-commands/) — Command reference
- [Desktop Environment](/docs/desktop-environment/) — GUI and applications
- [Technical Specification](/docs/technical-specification/) — Deep dive


## Getting Help

- **GitHub Issues:** [github.com/NON-OS/nonos-kernel/issues](https://github.com/NON-OS/nonos-kernel/issues)
- **Documentation:** This site covers everything

This is alpha software. Expect rough edges. Report bugs.
