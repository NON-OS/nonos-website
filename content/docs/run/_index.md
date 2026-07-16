---
title: "Run NØNOS"
linkTitle: "Run it"
description: "Every way to boot NØNOS: in your browser, in a VM, in a container, or on real hardware. All boot the same signature-verified image."
weight: 5
---

There are many ways to run NØNOS, from zero-install to bare metal. All of them
boot the same signature-verified image, so pick whichever fits your machine.

## Zero install

- **In your browser.** The [live boot](/live/) streams a real, throwaway NØNOS
  guest to your browser. Drive it with your keyboard and mouse; it is destroyed
  with its memory when you leave.

## Virtual machines

- **[VirtualBox](/docs/run/virtualbox/)**: one script sets up the VM from the
  disk image. The friendliest local option on Windows, macOS, and Linux.
- **[QEMU](/docs/run/qemu/)**: the reference invocation the project itself uses:
  q35, UEFI, and virtio. The most faithful way to run it.
- **[UTM](/docs/run/utm/)**: a graphical QEMU front-end for macOS, on both
  Apple Silicon and Intel.

## Containers

- **[Docker or Podman](/docs/run/docker/)**: a reproducible one-command boot:
  QEMU and the image inside a container, streamed to your browser. Good for CI,
  headless servers, and shared demos.

## Real hardware

- **[Download](/download/)** the image and write it to a USB stick. NØNOS boots
  on real x86_64 laptops, not only in a VM.

## Others

NØNOS is a standard x86_64 UEFI system with virtio and AHCI, so anything that
can boot a UEFI disk image runs it:

- **VMware Workstation / Fusion**: new VM, guest type *Other 64-bit*, firmware
  UEFI, attach the image as a SATA disk.
- **Hyper-V**: a Generation 2 VM (UEFI); disable Secure Boot, since NØNOS uses
  its own signature chain rather than Microsoft's keys.
- **libvirt / virt-manager / GNOME Boxes**: these drive QEMU, so the
  [QEMU guide](/docs/run/qemu/) is the reference for the machine settings.
- **A cloud VM**: any provider that lets you boot a custom UEFI image, or that
  offers nested virtualisation so you can run QEMU inside a normal instance.

Whichever you choose, verify the image first: every release carries BLAKE3
checksums so you can confirm you booted what we published.
