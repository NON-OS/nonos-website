---
title: "Run NØNOS in VirtualBox"
linkTitle: "VirtualBox"
description: "Boot NØNOS in VirtualBox with one script, or set the VM up by hand. The friendliest local option."
weight: 20
---

VirtualBox is the easiest way to run NØNOS on your own machine without touching
your disk. There is a script that does the whole setup, and the manual steps are
below it if you would rather see exactly what happens.

NØNOS is UEFI-only and ships as a raw disk image, not an ISO. VirtualBox's EFI
has trouble booting custom ISOs, so the image is what you boot: it is a raw disk
with a proper GPT partition table and EFI system partition.

## One-command setup

Requires VirtualBox (with `VBoxManage` on your `PATH`).

```bash
git clone https://github.com/NON-OS/VirtualBox_Nonos_Setup.git
cd VirtualBox_Nonos_Setup
chmod +x setup-nonos-vm.sh
./setup-nonos-vm.sh
VBoxManage startvm NONOS
```

The script downloads the disk image, converts it to VirtualBox's native VDI
format, creates the VM with the right settings, attaches the disk, and
configures boot. On a machine with WiFi it bridges the VM to your network;
otherwise it falls back to NAT.

## What the VM settings are, and why

The settings mirror the project's QEMU configuration, so the guest sees the
hardware it expects.

| Setting | Value | Why |
|---|---|---|
| Chipset | ICH9 | the Q35 equivalent, a modern chipset |
| Firmware | EFI64 | NØNOS is UEFI only |
| RAM | 1 GB | matches the reference configuration |
| CPU | 2 cores, host profile | exposes the real CPU features |
| Graphics | VBoxSVGA, 128 MB VRAM | closest to the QEMU VGA path |
| Storage | Intel AHCI (SATA) | a modern SATA controller |
| Network | Intel e1000 (82545EM) | the same NIC the project uses |
| Virtualisation | VT-x, nested paging, long mode | required for an x86_64 guest |

## Manual setup

If you prefer to run the commands yourself, this is what the script does. Point
`nonos.vdi` at the converted image.

```bash
# convert the raw image to VirtualBox's format
VBoxManage convertfromraw nonos.img nonos.vdi --format VDI

VBoxManage createvm --name NONOS --ostype Other_64 --register
VBoxManage modifyvm NONOS --chipset ich9 --firmware efi64
VBoxManage modifyvm NONOS --memory 1024 --cpus 2
VBoxManage modifyvm NONOS --pae off --longmode on --cpu-profile host
VBoxManage modifyvm NONOS --hwvirtex on --nestedpaging on --largepages on
VBoxManage modifyvm NONOS --vram 128 --graphicscontroller vboxsvga
VBoxManage storagectl NONOS --name SATA --add sata --controller IntelAhci
VBoxManage storageattach NONOS --storagectl SATA --port 0 --device 0 \
  --type hdd --medium nonos.vdi
VBoxManage modifyvm NONOS --boot1 disk --boot2 none
VBoxManage modifyvm NONOS --nic1 nat --nictype1 82545EM
VBoxManage startvm NONOS
```

For a real IP on your LAN instead of NAT, bridge to your interface:

```bash
VBoxManage list bridgedifs                       # find your interface name
VBoxManage modifyvm NONOS --nic1 bridged --bridgeadapter1 "Wi-Fi" --nictype1 82545EM
```

Bridged gives the VM its own address on your network; NAT shares the host's
address for outbound traffic only.

## Troubleshooting

**The VM will not start, or the session is locked.**

```bash
pkill -9 VirtualBoxVM
VBoxManage startvm NONOS
```

**Boot fails.** Make sure you are booting the disk image, not an ISO. The script
handles this; if you set the VM up by hand, attach the `.vdi` converted from the
`.img`.

**No network.** Check your interface name with `VBoxManage list bridgedifs` and
use it in the bridge command; the default assumes `Wi-Fi`.

The setup script and its license are public:
[VirtualBox_Nonos_Setup](https://github.com/NON-OS/VirtualBox_Nonos_Setup).
