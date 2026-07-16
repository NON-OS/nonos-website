---
title: "Run NØNOS in UTM"
linkTitle: "UTM (macOS)"
description: "Boot NØNOS on a Mac with UTM, the friendly QEMU front-end for Apple Silicon and Intel."
weight: 50
---

UTM is a QEMU front-end for macOS with a graphical interface, so it is the
easiest way to run NØNOS on a Mac without touching the command line. It works on
both Apple Silicon and Intel Macs.

Because NØNOS is x86_64, UTM emulates an x86_64 machine. On an Intel Mac this is
hardware-accelerated; on Apple Silicon it runs under emulation, which is slower
but works.

## Steps

1. Install [UTM](https://mac.getutm.app/) and download the NØNOS disk image.
2. Create a new VM, choose **Emulate**, and select **Other**.
3. Set the architecture to **x86_64** and the system to **Standard PC (Q35)**.
4. Give it **2 GB** of memory and enable **UEFI boot** in the VM settings.
5. Add the NØNOS image as a drive. If UTM asks, import the raw `.img`; it will
   store it in its own format.
6. Set the display to a virtio or standard VGA adapter and boot.

## Notes

- **UEFI must be on.** NØNOS has no legacy BIOS path; without UEFI it will not
  boot.
- On Apple Silicon, expect emulation speed. It is fine for trying the system and
  reading the desktop; for interactive work an Intel Mac or a Linux host with
  KVM is faster.
- The underlying machine is the same q35 + UEFI + virtio setup described in the
  [QEMU guide](/docs/run/qemu/), so that page is the reference if you want to see
  exactly what UTM is configuring.
