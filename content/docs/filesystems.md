---
title: "Filesystems"
description: "NØNOS filesystem architecture, VFS, RAM filesystem, and CryptoFS"
weight: 16

# NØNOS Filesystems

**Version 0.8.0** | March 2026

NØNOS implements a layered filesystem architecture designed for privacy-first operation. At its core, the system runs entirely from RAM, with optional encrypted persistent storage and support for external media.


## Filesystem Architecture Overview

| Layer | Components |
|-------|------------|
| **Applications** | User programs, shell, GUI apps |
| **Virtual Filesystem (VFS)** | Unified POSIX-like interface |
| **Filesystem Implementations** | RAM FS (volatile), CryptoFS (encrypted), ext4/FAT32 (external) |
| **Block Layer** | Abstract block device interface |
| **Drivers** | AHCI, NVMe, VirtIO, USB |

Applications never interact with filesystem implementations directly. Everything goes through the Virtual Filesystem (VFS) layer, which provides a uniform POSIX-like interface regardless of the underlying storage.


## Virtual Filesystem (VFS)

The VFS layer sits between applications and filesystem implementations, providing:

### Unified Interface

All filesystem operations use the same system calls:
- `open()`, `close()` — File handle management
- `read()`, `write()` — Data transfer
- `lseek()` — Position within file
- `stat()`, `fstat()` — File metadata
- `mkdir()`, `rmdir()` — Directory operations
- `unlink()`, `rename()` — File management
- `opendir()`, `readdir()`, `closedir()` — Directory listing

### Path Resolution

The VFS handles path resolution, translating paths like `/home/user/file.txt` into filesystem-specific operations:

1. Parse the path into components
2. Identify the mount point (e.g., `/` for root, `/mnt/usb` for mounted drives)
3. Pass the remaining path to the appropriate filesystem driver
4. Return results through the unified interface

### Mount Points

Different filesystems can be mounted at various points in the namespace:

| Path | Typical Filesystem | Purpose |
|------|-------------------|---------|
| `/` | RAM FS | Root filesystem |
| `/secure` | CryptoFS | Encrypted storage |
| `/mnt/*` | ext4/FAT32 | External media |

### Caching

The VFS implements multiple caches for performance:

| Cache | Purpose |
|-------|---------|
| Page Cache | File data in memory |
| Dentry Cache | Directory entry lookups |
| Inode Cache | File metadata structures |

Caches use LRU (Least Recently Used) eviction when memory pressure increases.


## RAM Filesystem

Under the default ZeroState policy, the root filesystem is entirely RAM-based. This is the cornerstone of NØNOS's privacy design.

### How It Works

The RAM filesystem allocates file data directly from kernel memory:

- **Inodes** — File metadata (permissions, size, timestamps) in kernel structures
- **Data Blocks** — File contents in dynamically allocated buffers
- **Directories** — Hash tables mapping names to inodes

When you create a file, memory is allocated. When you delete it, memory is freed. There's no persistent storage involved whatsoever.

### Characteristics

| Property | RAM FS |
|----------|--------|
| Persistence | None (volatile) |
| Maximum Size | Limited by RAM |
| Read Speed | Memory speed |
| Write Speed | Memory speed |
| Encryption | In-memory only |
| Mount Point | `/` (root) |

### Why This Matters for Privacy

Traditional operating systems write constantly to disk:
- Swap files
- Browser caches
- Temporary files
- Application data
- Log files
- Configuration changes

Every write is potential evidence. Forensic tools can recover deleted files from traditional filesystems for months or years after deletion.

With RAM filesystem:
- **No writes to disk** means nothing to recover
- **Power off** immediately destroys all data
- **Cold boot attacks** have a narrow window (seconds to minutes for RAM decay)
- **Forensic recovery** yields nothing—the data literally doesn't exist

### Capacity Considerations

RAM filesystem capacity equals available system memory (minus kernel and application overhead). Practical limits:

| System RAM | Usable FS Space |
|------------|-----------------|
| 4 GB | ~2-3 GB |
| 8 GB | ~5-6 GB |
| 16 GB | ~12-14 GB |
| 32 GB | ~26-28 GB |

For large files or datasets, use mounted external storage (which breaks ZeroState for those specific files).

### Commands

```bash
# Check available space
df -h /

# Usage by directory
du -sh /home/*

# Memory stats (includes FS usage)
free -m
```


## CryptoFS (Encrypted Filesystem)

CryptoFS provides an encrypted filesystem layer for sensitive data that needs additional protection beyond RAM residence.

### Encryption Details

| Property | Value |
|----------|-------|
| Cipher | ChaCha20-Poly1305 |
| Key Derivation | BLAKE3-derived keys |
| Integrity | Merkle tree verification |
| Granularity | Per-block encryption |

Every block of data is individually encrypted and authenticated. Tampering with any block is detected via the Merkle tree.

### Architecture

| Layer | Description |
|-------|-------------|
| **CryptoFS Interface** | POSIX file operations |
| **Encrypted Superblock** | Filesystem metadata |
| **Encrypted Inode Table** | File metadata structures |
| **Data Blocks** | ChaCha20-Poly1305 encrypted |
| **Merkle Tree** | Integrity verification |
| **RAM Backend** | Volatile storage |

### Features

| Feature | Description |
|---------|-------------|
| Authenticated Encryption | Every read verifies integrity |
| Per-File Keys | Derived from master key + file ID |
| Compression | Optional LZ4/Zstd/Brotli before encryption |
| Deduplication | Block-level deduplication |
| Ephemeral Delete | Secure erasure with key destruction |

### Use Cases

CryptoFS is useful when:
- You need an additional encryption layer for particularly sensitive data
- You want file-level integrity verification
- You're preparing data for eventual transfer to external storage

### Mount Point

CryptoFS mounts at `/secure` by default:

```bash
# List encrypted files
ls /secure

# Create encrypted file
echo "sensitive data" > /secure/secrets.txt

# Verify integrity on read (automatic)
cat /secure/secrets.txt
```

### Key Management

CryptoFS keys derive from the system's cryptographic vault. The key hierarchy:

1. **Master Key** — Held in vault, never exposed
2. **Filesystem Key** — Derived from master for CryptoFS
3. **File Keys** — Derived from filesystem key + file identifier

When you close a file, the file key can be immediately destroyed. When you unmount CryptoFS, the filesystem key is destroyed.


## External Filesystem Support

NØNOS can mount external storage media formatted with standard filesystems.

### ext4

Full read/write support for Linux's default filesystem.

**Supported Features:**

| Feature | Support |
|---------|---------|
| Extents | Yes |
| Large Files | Yes |
| Directory Indexing | Yes |
| Journaling | Yes |
| Extended Attributes | Basic |

**Mounting:**

```bash
# Mount ext4 drive
mount /dev/sda1 /mnt/external

# Unmount
umount /mnt/external
```

### FAT32

Read/write support for USB drives and memory cards.

**Supported Features:**

| Feature | Support |
|---------|---------|
| Long Filenames | Yes |
| Case Sensitivity | No (FAT limitation) |
| Large Files | 4 GB max (FAT limitation) |
| Directories | Yes |

**Mounting:**

```bash
# Mount USB drive
mount /dev/sdb1 /mnt/usb

# Unmount safely
sync
umount /mnt/usb
```

### NTFS

Read-only support for Windows-formatted drives.

| Feature | Support |
|---------|---------|
| Read | Yes |
| Write | No |
| Compression | No |
| Encryption | No |

### Privacy Implications

**Important:** Mounting external storage breaks ZeroState for files you access or create on that storage.

When you write to `/mnt/usb`, that data goes to a physical drive. It persists after shutdown. Forensic recovery becomes possible.

The NØNOS interface clearly indicates when you're working with persistent storage versus RAM filesystem.


## File Permissions

NØNOS uses POSIX-style permissions with 12 bits of mode information:

### Permission Bits

```
    Owner    Group    Other
    r w x    r w x    r w x
    4 2 1    4 2 1    4 2 1
```

Examples:
- `755` — Owner: read/write/execute; Others: read/execute
- `644` — Owner: read/write; Others: read
- `600` — Owner: read/write; Others: nothing

### Special Bits

| Bit | Octal | Effect |
|-----|-------|--------|
| SetUID | 4000 | Execute as file owner |
| SetGID | 2000 | Execute as group |
| Sticky | 1000 | Restricted deletion |

### Commands

```bash
# View permissions
ls -la /path/to/file

# Change permissions
chmod 755 /path/to/file

# Change owner
chown user:group /path/to/file
```


## Inodes

Each file or directory is represented by an inode containing:

| Field | Description |
|-------|-------------|
| Inode Number | Unique identifier |
| Mode | File type + permissions |
| Link Count | Hard link count |
| UID/GID | Owner and group |
| Size | File size in bytes |
| Timestamps | Access, modify, status change |
| Block Pointers | Data location |

View inode information:

```bash
stat filename
```


## File Types

The mode field encodes file types:

| Type | Code | Example |
|------|------|---------|
| Regular File | `-` | `data.txt` |
| Directory | `d` | `documents/` |
| Symbolic Link | `l` | `link -> target` |
| Block Device | `b` | `/dev/sda` |
| Character Device | `c` | `/dev/tty` |
| Named Pipe (FIFO) | `p` | `fifo_queue` |
| Socket | `s` | `/tmp/socket` |


## Symbolic and Hard Links

### Hard Links

Multiple directory entries pointing to the same inode:

```bash
# Create hard link
ln original.txt hardlink.txt

# Both point to same data
ls -li original.txt hardlink.txt
```

Hard links:
- Share inode and data
- Cannot cross filesystem boundaries
- Cannot link directories

### Symbolic Links

Special files containing a path to another file:

```bash
# Create symbolic link
ln -s /path/to/target symlink

# Follows the path
cat symlink
```

Symbolic links:
- Have their own inode
- Can cross filesystem boundaries
- Can link to directories
- Can be broken (if target deleted)


## File Operations

### Opening Files

Files are opened with mode flags:

| Flag | Meaning |
|------|---------|
| O_RDONLY | Read only |
| O_WRONLY | Write only |
| O_RDWR | Read and write |
| O_CREAT | Create if doesn't exist |
| O_TRUNC | Truncate to zero length |
| O_APPEND | Append mode |
| O_EXCL | Fail if exists (with O_CREAT) |

### File Descriptors

Each process maintains a file descriptor table:

| FD | Default Meaning |
|----|-----------------|
| 0 | Standard input |
| 1 | Standard output |
| 2 | Standard error |
| 3+ | Opened files |

### Seeking

```bash
# File position manipulation
lseek(fd, offset, SEEK_SET)  # From start
lseek(fd, offset, SEEK_CUR)  # From current
lseek(fd, offset, SEEK_END)  # From end
```


## Directory Operations

### Reading Directories

```bash
# List contents
ls /path/to/directory

# Detailed listing
ls -la /path/to/directory

# Including hidden files (starting with .)
ls -a /path/to/directory
```

### Creating and Removing

```bash
# Create directory
mkdir /path/to/new_dir

# Create nested directories
mkdir -p /path/to/deep/nested/dir

# Remove empty directory
rmdir /path/to/empty_dir

# Remove directory and contents
rm -rf /path/to/directory
```


## Temporary Files

In NØNOS, temporary files are just RAM filesystem files—they're already volatile.

The `/tmp` directory exists and behaves as expected:

```bash
# Create temp file
mktemp /tmp/prefix.XXXXXX

# Write to temp
echo "data" > /tmp/myfile
```

No special handling needed. On shutdown, `/tmp` vanishes with everything else.


## Disk Space Commands

### Checking Usage

```bash
# Filesystem usage summary
df -h

# Directory usage
du -sh /path/*

# Largest files
du -a / | sort -rn | head -20
```

### Understanding df Output

```
Filesystem      Size  Used Avail Use% Mounted on
ramfs           2.0G  512M  1.5G  25% /
cryptofs        1.0G  100M  900M  10% /secure
/dev/sda1        50G   10G   40G  20% /mnt/external
```


## Filesystem Limits

### RAM Filesystem

| Limit | Value |
|-------|-------|
| Max file size | Available RAM |
| Max filename | 255 bytes |
| Max path | 4096 bytes |
| Max open files | 65535 per process |
| Max inodes | Memory-limited |

### CryptoFS

| Limit | Value |
|-------|-------|
| Block size | 4096 bytes |
| Max file size | Available RAM |
| Max files | Memory-limited |

### ext4 (mounted)

| Limit | Value |
|-------|-------|
| Max file size | 16 TB |
| Max filesystem size | 1 EB |
| Max filename | 255 bytes |


## Sync and Data Integrity

### RAM Filesystem

For RAM filesystem, `sync` is essentially a no-op since there's no persistent storage to sync to. However, it ensures kernel buffers are consistent.

### External Storage

For mounted external storage:

```bash
# Ensure all data written to disk
sync

# Required before unplugging
sync
umount /mnt/usb
```

**Never unplug external storage without unmounting first.** Data loss and filesystem corruption can result.


## Common Patterns

### Safe File Updates

Write to temporary, then rename (atomic on same filesystem):

```bash
# Write new content
echo "new content" > /path/file.tmp

# Atomic replace
mv /path/file.tmp /path/file
```

### Checking Existence

```bash
# File exists
test -f /path/file && echo "exists"

# Directory exists
test -d /path/dir && echo "exists"

# Or using stat
stat /path/file >/dev/null 2>&1 && echo "exists"
```


## ZeroState and Filesystem Summary

| Filesystem | Persistence | Forensic Recovery |
|------------|-------------|-------------------|
| RAM FS (`/`) | None | Not possible |
| CryptoFS (`/secure`) | RAM only | Not possible |
| ext4 (mounted) | Yes | Standard forensics |
| FAT32 (mounted) | Yes | Standard forensics |

For maximum privacy:
1. Keep all work on RAM filesystem
2. Use CryptoFS for sensitive work-in-progress
3. Only mount external storage for intentional persistence
4. Always safely unmount before shutdown


AGPL-3.0 | Copyright 2026 NØNOS Contributors
