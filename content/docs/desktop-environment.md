---
title: "Desktop Environment"
description: "NØNOS graphical desktop environment and built-in applications"
weight: 12

# NØNOS Desktop Environment

**Version 0.8.0** | March 2026

NØNOS ships with a complete graphical desktop environment rendered directly to the framebuffer. Unlike traditional operating systems that rely on external display servers and window managers, the NØNOS desktop is integrated into the kernel, providing a streamlined experience with minimal attack surface.


## Desktop Overview

When NØNOS boots into graphical mode, you're greeted with a modern desktop featuring:

- **Menu Bar** across the top with system status, clock, and quick settings
- **Dock** at the bottom for launching applications
- **Sidebar** on the left for file navigation and quick access
- **Window System** supporting multiple concurrent application windows

The visual design uses a premium dark glass aesthetic with cyan accent colors. Semi-transparent panels create depth without obscuring content. Every element is rendered with attention to detail—rounded corners use per-pixel distance calculations for smooth edges, shadows employ multi-layer alpha gradients.


## Menu Bar

The menu bar spans the top of the screen and contains:

| Element | Location | Function |
|---------|----------|----------|
| System Logo | Far left | NØNOS branding |
| Clock | Center-left | Current time display, updates in real time |
| Date | Center | Current date |
| Search | Center-right | Quick search icon |
| Network Status | Right | Shows connection state (connected/disconnected indicator) |
| Battery Level | Right | Power status for laptops |
| Notifications | Right | Alert bell for system notifications |
| Settings | Right | Quick access to settings panel |
| User Avatar | Far right | User status indicator |

Clicking the settings gear opens the Settings application.


## Dock

The dock sits at the bottom of the screen and provides quick access to applications. Each application icon is rendered as detailed pixel art with gradient shading and rounded plate backgrounds.

### Built-in Applications

| Icon | Application | Description |
|------|-------------|-------------|
| Terminal | **Terminal** | Full-featured command-line interface |
| Folder | **File Manager** | Browse and manage files |
| Document | **Text Editor** | Vi-like text editor |
| Calculator | **Calculator** | Basic calculations |
| Wallet | **Wallet** | Ethereum wallet with ZK privacy |
| Graph | **Process Manager** | View and manage running processes |
| Gear | **Settings** | System configuration |
| Globe | **Web Browser** | Privacy-focused web browsing |
| Info | **About** | System information dialog |

**Active Application Indicators:** When an application is running, a small indicator dot appears beneath its dock icon, letting you know at a glance what's open.

**Launching Applications:** Click any dock icon to open that application. If it's already running, clicking brings its window to the front.


## Window System

Applications run in windows that can be moved, resized, and managed. Each window includes:

- **Title Bar** with the application name
- **Close Button** to terminate the application
- **Content Area** where the application renders

### Window Operations

| Action | How |
|--------|-----|
| Move window | Click and drag the title bar |
| Close window | Click the X button in the title bar |
| Focus window | Click anywhere on the window |
| Snap to edge | Drag window to screen edge |

Windows support eight-direction resize handles for adjusting size. Scrollbars appear when content exceeds the visible area.


## Built-in Applications

### Terminal

The terminal emulator provides full command-line access to the NØNOS shell. It's not just a text display—it's a complete terminal with:

- **ANSI Color Support** for colorized output
- **Command History** accessible with up/down arrows
- **Tab Completion** for commands and file paths
- **Scrollback Buffer** to review previous output
- **Copy/Paste** for moving text in and out

The terminal renders with a monospace font (8x12 pixels per character) and supports the full extended ASCII character set. When you need to do serious system work, this is where you'll spend your time.

For a complete list of available commands, see the [Shell Commands Reference](/docs/shell-commands/).

### File Manager

The File Manager provides visual navigation of the filesystem. You can:

- **Browse directories** with a familiar tree view
- **View file details** including size, permissions, and modification time
- **Create, rename, and delete** files and folders
- **Copy and move** files between locations
- **Navigate quickly** using breadcrumb paths

The file manager clearly distinguishes between:
- **RAM filesystem contents** (ephemeral—gone when you shut down)
- **Mounted external storage** (persistent—survives shutdown)

This distinction matters in NØNOS. Files in the RAM filesystem are part of your ZeroState session and will vanish on power-off. Files on mounted USB drives persist.

**Path Navigation:** Use the breadcrumb bar at the top to jump to any parent directory, or type a path directly.

### Text Editor

The built-in text editor follows Vi-style conventions, making it immediately familiar to anyone who's used Vi or Vim. It operates in multiple modes:

| Mode | Purpose | How to Enter |
|------|---------|--------------|
| Normal | Navigation and commands | Press `Esc` |
| Insert | Typing text | Press `i`, `a`, `o` |
| Visual | Selecting text | Press `v` |
| Command | Executing commands | Press `:` |

**Core Features:**

- **Multi-line editing** for any text file
- **Undo/redo stack** so mistakes aren't permanent
- **Find and replace** with highlighting
- **Line numbering** for code navigation
- **Clipboard operations** (yank, put, delete)

**Basic Commands:**

| Command | Action |
|---------|--------|
| `i` | Enter insert mode at cursor |
| `a` | Enter insert mode after cursor |
| `o` | Open new line below |
| `Esc` | Return to normal mode |
| `h`, `j`, `k`, `l` | Move left, down, up, right |
| `w`, `b` | Move forward/backward by word |
| `dd` | Delete current line |
| `yy` | Yank (copy) current line |
| `p` | Paste after cursor |
| `:w` | Save file |
| `:q` | Quit |
| `:wq` | Save and quit |
| `/pattern` | Search for pattern |

### Web Browser

The NØNOS web browser provides internet access with privacy as the default. Key features:

- **HTTP/HTTPS Support** with TLS 1.3
- **HTML Rendering** with proper entity handling
- **Navigation** with back, forward, and URL bar
- **Page Search** with highlighting
- **Link Following** via keyboard or click

**Privacy Features:**

When onion routing is enabled, all browser traffic routes through the integrated onion network. The browser doesn't store:
- Browsing history
- Cookies (beyond the current session)
- Cache files
- Form data

Because NØNOS is ZeroState, even session cookies vanish when you shut down.

**Limitations:** This is a basic browser focused on privacy, not feature parity with Chrome or Firefox. Complex JavaScript applications may not render correctly. It handles most text-based sites well.

### Calculator

A straightforward calculator for arithmetic operations. Nothing fancy—it adds, subtracts, multiplies, and divides. Input via keyboard or clicking the on-screen buttons.

### Wallet

The NØNOS Wallet is a full Ethereum-compatible wallet with integrated zero-knowledge privacy features. This isn't a toy—it handles real cryptocurrency transactions.

**Features:**

- **Multiple Accounts** — Create and manage several wallet addresses
- **Transaction History** — View past sends and receives
- **Send/Receive** — Transfer funds to any Ethereum address
- **Balance Display** — See your holdings
- **Private Key Management** — Keys stored encrypted with AES-256-GCM
- **ZK Stealth Transactions** — Send funds without revealing the recipient

**Security Model:**

Private keys never leave the wallet application unencrypted. They're encrypted at rest using your passphrase. The wallet uses the secp256k1 curve for Ethereum compatibility and supports RLP encoding for transaction serialization.

**ZK Stealth Mode:** For transactions requiring extra privacy, the wallet can generate zero-knowledge proofs that hide transaction details from blockchain observers. This uses the same Groth16 proof system that verifies the kernel at boot.

**Warning:** This is alpha software. Don't store significant funds in the NØNOS wallet until it has undergone security auditing.

### Process Manager

View and manage running processes. The process manager displays:

- **Process ID (PID)** — Unique identifier
- **Process Name** — What's running
- **CPU Usage** — Percentage of CPU time
- **Memory Usage** — RAM consumption
- **State** — Running, sleeping, stopped, etc.

You can select a process and terminate it if something goes wrong. Useful for killing hung applications or investigating what's consuming resources.

### Settings

The Settings application configures system behavior across several categories:

**Appearance:**
- Theme selection (dark mode is default)
- Accent color customization

**Network:**
- Interface configuration
- Onion routing toggle
- DNS server selection

**System:**
- Time zone
- Keyboard layout
- Display resolution (where supported)

**Privacy:**
- ZeroState mode (always on by default)
- Logging level
- Audit trail settings

**Power:**
- Shutdown
- Restart
- Suspend behavior (becomes shutdown in ZeroState)


## Graphics Architecture

The NØNOS graphics stack operates without a traditional display server. Everything renders directly to the framebuffer provided by UEFI GOP (Graphics Output Protocol).

### Rendering Pipeline

1. **Framebuffer Acquisition** — The bootloader initializes GOP and passes framebuffer info to the kernel
2. **Double Buffering** — Applications render to a back buffer
3. **Composition** — Windows are composited in correct Z-order
4. **Page Flip** — The completed frame is displayed

### Color and Drawing

The graphics subsystem implements software rendering with:

- **Alpha Blending** for transparency effects
- **Gradient Fills** for smooth color transitions
- **Anti-aliased Shapes** using per-pixel calculations
- **Font Rendering** via bitmap glyphs

**Color Depth:** 32-bit ARGB (alpha, red, green, blue)

**Default Resolution:** 1024x768, configurable via UEFI

**Color Palette:**

| Use | Color | Hex |
|-----|-------|-----|
| Background | Dark charcoal | `#101418` |
| Accent | Cyan | `#00D4FF` |
| Text | White | `#FFFFFF` |
| Error | Red | `#FF4444` |
| Success | Green | `#44FF44` |

### Font System

Text rendering uses an 8x12 pixel monospace bitmap font. The character set covers extended ASCII (256 characters). Font functions include:

- `draw_char(x, y, char, color)` — Single character
- `draw_text(x, y, text, color)` — String rendering
- `draw_text_centered(x, y, text, color)` — Centered text


## Input Handling

### Keyboard

The keyboard driver processes scan codes and translates them to character input. Supported layouts include QWERTY with modifier key support (Shift, Ctrl, Alt).

Special keys:

| Key | Function |
|-----|----------|
| `Ctrl+C` | Interrupt/cancel |
| `Ctrl+D` | End of input |
| `Ctrl+Z` | Suspend |
| `Tab` | Auto-complete |
| `Up/Down` | History navigation |
| `Alt+Tab` | Window switching (where supported) |

### Mouse

Mouse input provides:

- **Movement Tracking** — Cursor follows mouse position
- **Click Events** — Left button for selection, right for context menu
- **Scroll Wheel** — Vertical scrolling in scrollable areas

The cursor renders as a bitmap with a hotspot for precise clicking.

### Touchpad

On laptops with supported touchpads (PS/2 or I2C HID), you get:

- **Movement** — Standard cursor control
- **Click** — Tap or click for selection
- **Two-finger Scroll** — Vertical scrolling

Advanced multi-finger gestures (three/four finger) are not currently supported.


## Notifications

The notification system displays alerts for system events:

- **Info** — Blue, general information
- **Success** — Green, operation completed
- **Warning** — Yellow, attention needed
- **Error** — Red, something failed

Notifications appear briefly then fade. The notification bell in the menu bar can show pending notifications.


## Headless Mode

NØNOS can run without the graphical desktop. In headless mode:

- Only the terminal is available
- Graphics memory is not allocated
- Useful for servers or low-memory systems

Enable headless mode in the boot configuration or via kernel command line.


## Performance Considerations

The graphical desktop adds overhead to the base system:

| Component | Memory Usage |
|-----------|--------------|
| Framebuffer | ~4 MB (1024x768 @ 32bpp) |
| Window compositor | ~10-20 MB |
| Desktop chrome | ~20-30 MB |
| Each application | Varies |

On systems with limited RAM (512 MB), consider using headless mode and the command-line interface.


AGPL-3.0 | Copyright 2026 NØNOS Contributors
