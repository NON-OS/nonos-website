---
title: "Capsule Catalog"
description: "Every userland capsule, one by one, with a verified spec."
weight: 500
---
Every userland capsule, one by one, with a verified spec. NØNOS runs everything above the kernel as a
signed capsule, and there are 66 of them: the core services, the desktop fleet, the applications and
proofs, the hardware drivers, and the network stack. This catalog gives each a dedicated entry;
the [inventory](/docs/userland/capsules/) is the flat table of handles, ports, and capabilities, and this catalog
is the per-capsule prose with purpose, protocol ops, behavior, and honest gaps.

## The pages

| Page | Capsules |
|------|----------|
| [core-services.md](/docs/userland/core-services/) | ramfs, vfs, keyring, entropy, crypto, policy, attest, installer, payment, power, market, process_manager |
| [desktop.md](/docs/userland/desktop/) | compositor, wm, input_router, desktop_shell, wallpaper, wallpaper_catalog, image_codec, clipboard, login, toolkit, boot_splash, setup_wizard |
| [apps-and-proofs.md](/docs/userland/apps-and-proofs/) | about, calculator, file_manager, hello, settings, text_editor, snake, ripgrep, wallet_nonos, gui_proof, std_proof, input_proof, input_probe, proof_io |
| [terminal/](/docs/userland/terminal/) | terminal (the reference app, documented as a folder that mirrors its code: input, commands, emulation, rendering) |
| [../drivers.md](/docs/userland/drivers/) | the 18 hardware driver capsules (ahci, bga, e1000, hda, i2c_hid, i2c_pci, iwlwifi, nvme, ps2_input, rtl8139, rtl8169, usb_hid, usb_msc, virtio_blk, virtio_gpu, virtio_net, virtio_rng, xhci) |
| [../network-capsules.md](/docs/userland/network-capsules/) | the network capsules (net_core, net_l2, net_ip, net_udp, net_tcp, net_dhcp, net_dns, net_sockets, net_nym) |

The drivers and the network capsules already have dedicated one-by-one coverage on their own pages (the
[drivers](/docs/userland/drivers/) contract table and the [networking subsystem](https://github.com/NON-OS/nonos-micro-kernel/blob/main/subsystems/networking/README.md)),
so this catalog links to them rather than repeating; the core, desktop, app, and proof capsules are
specified here.

## What every capsule shares

Every entry follows the same shape because every capsule follows the same model: a `userland/<name>/`
source tree, a kernel mirror under `src/userspace/capsule_<name>/` that embeds the signed ELF,
certificate, and manifest, a named service endpoint with a reply inbox, and a capability mask its
manifest declared. A capsule is spawned through [verified spawn](https://github.com/NON-OS/nonos-micro-kernel/blob/main/security/capsules-and-trust.md),
so it runs only if its signatures check and its requested capabilities are in policy, and it reaches
other capsules only through [IPC](https://github.com/NON-OS/nonos-micro-kernel/blob/main/subsystems/ipc/README.md) to their named endpoints. Reading an
entry, the capability mask tells you what the capsule is allowed to touch, the ops tell you its
protocol surface, and the behavior tells you what it does with them.

## Honest labels

The catalog distinguishes finished capsules from demonstrations and stubs, and says which is which:

- **Proof capsules** (gui_proof, std_proof, input_proof, input_probe, proof_io) are runtime self-tests
  that assert a specific guarantee; they are labeled as proofs, not applications.
- **capsule_ripgrep** is a defined contract with no implementation yet, stated as such.
- **installer** and **market** run a real cryptographic verifier normally, but their `offline-verify`
  feature substitutes a reject-all stub for development; noted on each.

This is the same verify-against-source discipline as the rest of the wiki: a capsule is described as
what its code does, and where the code is a demo or unbuilt, the entry says so.
