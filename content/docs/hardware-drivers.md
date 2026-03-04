---
title: "Hardware Drivers"
description: "NØNOS device driver documentation and hardware compatibility"
weight: 18

# NØNOS Hardware Drivers

**Version 0.8.0** | March 2026

NØNOS includes drivers for essential hardware classes—storage, networking, input, graphics, audio, and security devices. This document details supported hardware, driver capabilities, and compatibility information.


## Driver Architecture

NØNOS uses a modular driver architecture where device drivers register with the kernel to handle specific hardware. Device discovery occurs during boot through:

1. **ACPI Table Parsing** — Platform devices
2. **PCI Bus Scanning** — PCI/PCIe devices
3. **USB Enumeration** — USB devices (after xHCI initializes)

Each discovered device is matched against registered drivers using vendor ID, device ID, and device class. When a match is found, the driver's probe function initializes the hardware.


## Storage Drivers

Storage drivers enable access to hard drives, SSDs, and removable media. All storage drivers operate through the kernel's block layer, providing a uniform interface regardless of the underlying technology.

### AHCI (SATA)

**Status:** Production-ready

The AHCI driver supports SATA devices connected to Advanced Host Controller Interface compliant controllers. Most modern motherboards use AHCI for SATA connectivity.

**Features:**

| Feature | Support |
|---------|---------|
| Read/Write Operations | Full |
| Native Command Queuing (NCQ) | Yes |
| Multiple Port Support | Up to 32 ports |
| Hot Plug | Partial |
| DMA Transfers | Yes |
| Error Recovery | Full |

**Supported Controllers:**

Any AHCI-compliant controller is supported. The driver identifies controllers by PCI class code `0x0106` (AHCI SATA controller).

**Boot Output Example:**

```
ahci ok ports=1 r=0 w=0
```

This shows one AHCI port detected with zero read/write operations (fresh boot).

### NVMe

**Status:** Production-ready

The NVMe driver supports NVM Express solid-state drives, which provide significantly higher performance than SATA through deeper command queues and reduced latency.

**Features:**

| Feature | Support |
|---------|---------|
| Read/Write Operations | Full |
| Queue Pairs | Multiple (configurable) |
| MSI-X Interrupts | Yes |
| Multiple Namespaces | Yes |
| Admin Commands | Full |
| Firmware Download | Read-only |

**Performance:**

NVMe drives can achieve much higher throughput than SATA drives. NØNOS's NVMe driver utilizes submission and completion queue pairs for efficient command processing.

**Boot Output Example:**

```
nvme ok ns=1 br=0 bw=0
```

One namespace detected, zero bytes read/written.

### VirtIO Block

**Status:** Production-ready

The VirtIO block driver supports paravirtualized storage in virtual machine environments (QEMU, KVM, etc.). VirtIO provides efficient virtualized I/O through shared memory rings, avoiding the overhead of emulating physical hardware.

**Features:**

| Feature | Support |
|---------|---------|
| Read/Write Operations | Full |
| Scatter-Gather I/O | Yes |
| Virtqueue Protocol | Yes |
| Interrupt Handling | MSI-X |

**When to Use:**

If you're running NØNOS in QEMU or another hypervisor, VirtIO offers better performance than emulating AHCI or NVMe hardware.

### USB Mass Storage

**Status:** Basic

USB mass storage support allows access to USB flash drives and external hard drives through the USB Mass Storage Class protocol layered over SCSI commands.

**Features:**

| Feature | Support |
|---------|---------|
| Read Operations | Yes |
| Write Operations | Yes |
| Hot Plug | Basic |
| Multiple LUNs | No |

**Supported Device Types:**

- USB flash drives
- External USB hard drives
- USB card readers (as a single LUN)


## Network Drivers

Network drivers connect NØNOS to wired and wireless networks. The drivers integrate with the kernel's TCP/IP stack for full network functionality.

### Intel e1000 / e1000e (Gigabit Ethernet)

**Status:** Production-ready

The e1000 driver family supports Intel Gigabit Ethernet controllers, commonly found in desktop PCs, laptops, and servers.

**Supported Controllers:**

| Device ID | Name |
|-----------|------|
| 0x100E | 82540EM |
| 0x100F | 82545EM |
| 0x10D3 | 82574L |
| 0x10EA | 82577LM |
| 0x1533 | I210 |
| 0x15B8 | I219-V |

**Features:**

| Feature | Support |
|---------|---------|
| 1 Gbps Link Speed | Yes |
| TX/RX Ring Buffers | Yes |
| Interrupt Handling | Yes |
| VLAN Support | Basic |
| MAC Filtering | Yes |

**Boot Output Example:**

```
console ok msgs=5 bytes=156
```

(Network driver status appears in subsequent boot messages)

### Realtek RTL8139 (Fast Ethernet)

**Status:** Production-ready

The RTL8139 driver supports the common Realtek 10/100 Mbps Ethernet controller, often found in older hardware and virtual machines.

**Features:**

| Feature | Support |
|---------|---------|
| 10/100 Mbps | Yes |
| TX/RX FIFO | Yes |
| Interrupt Handling | Yes |

### Realtek RTL8168 / RTL8111 (Gigabit Ethernet)

**Status:** Production-ready

The RTL8168 driver supports Realtek Gigabit Ethernet controllers, commonly found on desktop motherboards.

**Supported Controllers:**

| Device ID | Name |
|-----------|------|
| 0x8168 | RTL8168/8111 |
| 0x8167 | RTL8169 |
| 0x8169 | RTL8169 |

**Features:**

| Feature | Support |
|---------|---------|
| 1 Gbps Link Speed | Yes |
| Jumbo Frames | No |
| Wake-on-LAN | No |

### VirtIO Network

**Status:** Production-ready

The VirtIO network driver supports paravirtualized networking in virtual machines, providing better performance than emulated hardware.

**Features:**

| Feature | Support |
|---------|---------|
| TX/RX Virtqueues | Yes |
| Checksum Offload | Yes |
| Scatter-Gather | Yes |

### WiFi (Intel/Realtek)

**Status:** Experimental

WiFi support enables wireless networking on select chipsets with full WPA3 security.

**Supported Intel Chipsets:**

| Device ID | Name |
|-----------|------|
| 0x2723 | AX200/201 |
| 0x2725 | AX210/211 |
| 0x34F0 | WiFi 6 |
| 0x3DF0 | WiFi 6E |
| 0x4DF0 | WiFi 6E |
| 0x2729 | WiFi 7 |
| 0x272B | WiFi 7 |

**Supported Realtek Chipsets:**

| Device ID | Name |
|-----------|------|
| 0xC821 | RTL8821CE |
| Various | Other RTL8xxx |

**Features:**

| Feature | Support |
|---------|---------|
| 802.11 a/b/g/n/ac | Yes |
| 802.11ax (WiFi 6) | Partial |
| WPA2 | Yes |
| WPA3-SAE | Yes |
| CCMP Encryption | Yes |
| Firmware Loading | Yes |
| Rate Control | Basic |

**Notes:**

WiFi is experimental. Some access points may have compatibility issues. If your WiFi doesn't work, use a wired connection for now.


## Input Drivers

Input drivers enable keyboard and mouse interaction.

### PS/2 Keyboard

**Status:** Production-ready

The PS/2 keyboard driver handles the legacy PS/2 keyboard interface present on most desktop systems and supported by many laptops.

**Features:**

| Feature | Support |
|---------|---------|
| Scan Code Translation | Full |
| Key State Tracking | Yes |
| Modifier Keys | Ctrl, Shift, Alt |
| Special Keys | Function keys, etc. |
| Keyboard Layouts | QWERTY |
| Key Repeat | Yes |

**Boot Output Example:**

```
keyboard ok
```

### PS/2 Mouse

**Status:** Production-ready

The PS/2 mouse driver handles PS/2 mouse input.

**Features:**

| Feature | Support |
|---------|---------|
| Motion Tracking | Yes |
| Left/Right Click | Yes |
| Scroll Wheel | Yes |

### I2C HID (Touchpad)

**Status:** Basic

The I2C HID driver supports touchpads on modern laptops that use the I2C bus interface.

**Features:**

| Feature | Support |
|---------|---------|
| Movement | Yes |
| Click | Yes |
| Two-Finger Scroll | Basic |
| Multi-Finger Gestures | No |

### USB HID

**Status:** Basic

USB HID (Human Interface Device) support enables USB keyboards and mice.

**Features:**

| Feature | Support |
|---------|---------|
| USB Keyboards | Yes |
| USB Mice | Yes |
| Report Parsing | Basic |


## USB Controller (xHCI)

**Status:** Basic

The xHCI driver supports USB 3.0/3.1 host controllers, enabling all USB device classes.

**Features:**

| Feature | Support |
|---------|---------|
| Control Transfers | Yes |
| Interrupt Transfers | Yes |
| Bulk Transfers | Yes |
| Isochronous Transfers | No |
| USB 3.0 Speeds | Yes |
| Hub Support | Basic |
| Hot Plug | Basic |

**Boot Output Example:**

```
xhci ok dev=0 irq=0
```

Zero devices at boot (devices detected after enumeration).


## Graphics Drivers

### UEFI GOP (Graphics Output Protocol)

**Status:** Production-ready

The UEFI GOP driver uses the framebuffer established by UEFI during boot. This provides basic graphics capability on any UEFI system without hardware-specific drivers.

**Features:**

| Feature | Support |
|---------|---------|
| Linear Framebuffer | Yes |
| Multiple Resolutions | Yes (UEFI-dependent) |
| 32-bit Color | Yes |
| VSync | No |
| Hardware Acceleration | No |

**Typical Resolutions:**

- 1024x768 (default in QEMU)
- 1280x1024
- 1920x1080
- Higher resolutions (UEFI-dependent)

**Boot Output Example:**

```
gpu ok 0000:0000 frames=0
```

**Notes:**

The GOP driver provides software rendering only. There's no GPU acceleration for 3D graphics or video decode. For general computing and the NØNOS desktop, this is sufficient.

### VGA Text Mode

**Status:** Production-ready

For systems without GOP or when running headless, VGA text mode provides 80x25 character output for diagnostics and the serial console.


## Audio Driver

### Intel HD Audio

**Status:** Basic

The Intel HD Audio driver supports audio playback on systems with Intel High Definition Audio controllers.

**Features:**

| Feature | Support |
|---------|---------|
| Audio Codecs | Multiple |
| PCM Playback | Basic |
| Volume Control | Basic |
| Multiple Streams | No |

**Boot Output Example:**

```
audio ok codecs=0 streams=0
```

**Notes:**

Audio support is basic. Complex audio routing and advanced features are not implemented.


## Security Hardware

### TPM 2.0

**Status:** Basic

TPM (Trusted Platform Module) 2.0 integration provides hardware-backed security features.

**Features:**

| Feature | Support |
|---------|---------|
| PCR Extension | Yes |
| Key Storage | Basic |
| Random Numbers | Yes |
| Attestation | Basic |
| Sealing/Unsealing | Planned |

**Use Cases:**

- **Measured Boot** — Extend PCRs with boot component hashes
- **Random Numbers** — Hardware entropy source
- **Remote Attestation** — Prove system integrity
- **Key Sealing** — Bind encryption keys to system state (planned)


## PCI Bus

**Status:** Production-ready

PCI bus enumeration discovers all PCI/PCIe devices during boot. The bus driver supports:

| Feature | Support |
|---------|---------|
| Configuration Space | Full |
| Memory-Mapped I/O | Yes |
| I/O Ports | Yes |
| MSI/MSI-X | Yes |
| Device Enumeration | Full |

**Boot Output Example:**

```
pci ok devices=8 msix=2
```

Eight PCI devices found, two with MSI-X capability.


## Serial Console

**Status:** Production-ready

The serial console driver outputs to COM1 (port 0x3F8) at 115200 baud. This provides diagnostic output that can be captured by external systems even during early boot or kernel panics.

**Features:**

| Feature | Support |
|---------|---------|
| COM1 (0x3F8) | Yes |
| COM2 (0x2F8) | No |
| Baud Rate | 115200 fixed |
| Flow Control | No |

**Connecting:**

```bash
# Linux/macOS
screen /dev/ttyUSB0 115200

# QEMU adds serial output to terminal
qemu-system-x86_64 ... -serial mon:stdio
```


## Adding Hardware Support

If your hardware isn't supported, NØNOS's modular driver architecture allows adding new drivers. The process involves:

1. Create a driver module matching the device class
2. Implement probe and remove functions
3. Register with the appropriate subsystem (PCI, USB, etc.)
4. Handle device-specific initialization

Drivers must be signed and can be loaded at boot time. See the [Module System](/docs/architecture/kernel-abi/#module-system) documentation.


## Checking Hardware Compatibility

Before installing NØNOS on physical hardware, verify driver support:

```bash
# In NØNOS
lspci              # List PCI devices
lsusb              # List USB devices
dmesg | grep drv   # Check driver loading

# From Linux (before installing)
lspci -nn          # Shows vendor:device IDs
lsusb -v           # Detailed USB info
```

Compare the vendor:device IDs against the supported lists above.


## Driver Statistics

Each driver maintains statistics for diagnostics:

```bash
# View driver stats in dmesg output
dmesg | grep -E "(ahci|nvme|e1000)"
```

Statistics include:
- Read/write operation counts
- Byte throughput
- Error counts
- Interrupt counts


## Known Limitations

| Hardware Type | Limitation |
|---------------|------------|
| NVMe | Firmware update read-only |
| WiFi | Some access points incompatible |
| USB | No isochronous transfers (webcams, audio) |
| Audio | Basic functionality only |
| GPU | No hardware acceleration |
| Bluetooth | Not supported |
| Fingerprint | Not supported |
| IR Receivers | Not supported |


## Hardware Recommendations

For best compatibility:

| Component | Recommendation |
|-----------|----------------|
| Storage | NVMe or SATA SSD |
| Network | Intel Gigabit Ethernet |
| WiFi | Intel AX200 (if WiFi needed) |
| Input | PS/2 or basic USB keyboard/mouse |
| Graphics | Any UEFI GOP-capable system |
| Security | TPM 2.0 (recommended, not required) |

For testing, QEMU with VirtIO devices provides excellent compatibility:

```bash
qemu-system-x86_64 \
  -drive if=virtio,format=raw,file=disk.img \
  -device virtio-net-pci,netdev=net0 \
  -netdev user,id=net0
```


AGPL-3.0 | Copyright 2026 NØNOS Contributors
