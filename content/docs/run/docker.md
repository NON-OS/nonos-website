---
title: "Run NØNOS with Docker or Podman"
linkTitle: "Docker / Podman"
description: "A reproducible one-command boot: QEMU and the NØNOS image inside a container, streamed to your browser."
weight: 40
---

NØNOS is a bare-metal UEFI operating system, so it does not run *as* a
container the way a Linux userland does. What a container gives you is a
reproducible box that carries QEMU and the NØNOS image, so `docker run` (or
`podman run`) boots the OS with no host setup beyond the container engine.
The guest's screen is served to your browser over VNC.

This works identically with Docker and Podman; use whichever you have.

## One command

```bash
docker run --rm -it \
  --device /dev/kvm \
  -p 8006:8006 \
  ghcr.io/non-os/nonos-qemu:latest
```

Then open `http://localhost:8006` and NØNOS boots in the page. With Podman:

```bash
podman run --rm -it --device /dev/kvm -p 8006:8006 ghcr.io/non-os/nonos-qemu:latest
```

`--device /dev/kvm` gives the container hardware acceleration. Without KVM it
still runs, just slower, under pure emulation; drop the flag if `/dev/kvm` is
not available.

## Build the image yourself

The container is a thin wrapper: a base with QEMU and a small VNC-over-HTTP
server, plus the NØNOS disk image. A minimal `Dockerfile`:

```dockerfile
FROM debian:stable-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    qemu-system-x86 ovmf novnc websockify curl && rm -rf /var/lib/apt/lists/*

# the signature-verified NØNOS image
RUN curl -Lo /nonos.img https://nonos.software/iso/nonos.img

COPY run.sh /run.sh
EXPOSE 8006
ENTRYPOINT ["/run.sh"]
```

`run.sh` starts QEMU headless with a VNC socket and exposes it through
websockify + noVNC on port 8006:

```bash
#!/usr/bin/env bash
set -e
qemu-system-x86_64 -m 2G \
  $( [ -e /dev/kvm ] && echo -accel kvm -cpu host ) \
  -machine q35 \
  -drive if=pflash,format=raw,unit=0,readonly=on,file=/usr/share/OVMF/OVMF_CODE.fd \
  -drive if=pflash,format=raw,unit=1,file=/tmp/vars.fd \
  -drive file=/nonos.img,if=none,id=vd0,format=raw -device virtio-blk-pci,drive=vd0 \
  -device virtio-vga -netdev user,id=n0 -device virtio-net-pci,netdev=n0 \
  -vnc :0 -no-reboot &
websockify --web /usr/share/novnc 8006 localhost:5900
```

Always verify the image against the published BLAKE3 checksum before baking it
into a container you distribute.

## When to use this

- **CI and automation.** A reproducible boot with no host QEMU install.
- **Shared demos.** One image everyone runs identically.
- **Servers without a display.** The guest streams to a browser, so a headless
  host is fine.

For an interactive desktop on your own machine, [VirtualBox](/docs/run/virtualbox/)
or [QEMU](/docs/run/qemu/) directly are simpler. For zero install, use the
[browser boot](/live/).
