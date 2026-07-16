---
title: "Run NØNOS in QEMU"
linkTitle: "QEMU"
description: "The reference QEMU invocation the project itself uses: q35, UEFI, and virtio."
weight: 30
---

QEMU is how the project develops and tests NØNOS, so it is the most faithful
way to run it in a VM. The machine is a q35 with UEFI firmware and virtio
devices, matching what the kernel expects.

Requires `qemu-system-x86_64`, OVMF firmware, and the NØNOS ESP or disk image.

## The invocation

```bash
qemu-system-x86_64 \
  -m 2G -accel kvm -cpu host,+rdrand,+rdseed -smp 1 -machine q35 \
  -drive if=pflash,format=raw,unit=0,readonly=on,file=OVMF_CODE.fd \
  -drive if=pflash,format=raw,unit=1,file=OVMF_VARS.fd \
  -drive format=raw,file=fat:rw:esp \
  -device virtio-vga,disable-modern=on,xres=1280,yres=800 \
  -device qemu-xhci,id=xhci \
  -device virtio-rng-pci \
  -netdev user,id=n0 -device virtio-net-pci,netdev=n0 \
  -no-reboot
```

On macOS, replace `-accel kvm` with `-accel hvf`. If you have a raw disk image
rather than an ESP directory, attach it as a virtio block device instead of the
`fat:rw:esp` drive:

```bash
  -drive file=nonos.img,if=none,id=vd0,format=raw \
  -device virtio-blk-pci,drive=vd0
```

## Notes

- **UEFI is required.** NØNOS boots through OVMF; there is no legacy BIOS path.
- **virtio-vga** is the graphics path the compositor targets. The `xres`/`yres`
  set the initial resolution.
- **User networking** (`-netdev user`) gives the guest outbound access and DHCP
  with no host configuration. Bridged and host-forward modes are available if
  you need inbound access.

The kernel's `Makefile` carries the full set of run targets, including the ones
that boot the desktop, the setup wizard, and the tamper-evidence tests. See the
[build documentation](/docs/build/) for the workflow.
