---
title: "Shell Commands"
description: "Complete NØNOS shell command reference"
weight: 15
---

# NØNOS Shell Command Reference

**Version 0.8.0** | March 2026

The NØNOS shell provides over 100 commands for system administration, file operations, networking, cryptography, and more. This reference documents all available commands.


## Shell Features

The NØNOS shell supports:

- **Command history** with up/down arrow recall
- **Tab completion** for commands and paths
- **Aliases** for custom shortcuts
- **Pipelines** with `|` for chaining commands
- **Redirection** with `<` and `>` for input/output
- **Environment variables** with `$VAR` expansion
- **Globbing** with `*`, `?`, `[abc]`, `{a,b,c}`
- **Job control** with background (`&`) and foreground jobs


## Command Categories

### File Operations

| Command | Description |
|---------|-------------|
| `ls` | List directory contents |
| `ll` | Long listing format (alias for `ls -l`) |
| `cd` | Change directory |
| `pwd` | Print working directory |
| `mkdir` | Create directory |
| `rmdir` | Remove empty directory |
| `touch` | Create file or update timestamp |
| `rm` | Remove files |
| `cp` | Copy files |
| `mv` | Move or rename files |
| `ln` | Create links |
| `find` | Search for files |
| `file` | Determine file type |
| `stat` | Display file status |
| `chmod` | Change file permissions |
| `chown` | Change file owner |
| `du` | Disk usage |
| `df` | Disk free space |

### Text Processing

| Command | Description |
|---------|-------------|
| `cat` | Display file contents |
| `head` | Show first N lines |
| `tail` | Show last N lines |
| `wc` | Word, line, character count |
| `grep` | Search text patterns |
| `sed` | Stream editor |
| `tr` | Translate characters |
| `cut` | Extract columns |
| `sort` | Sort lines |
| `uniq` | Remove duplicate lines |
| `rev` | Reverse lines |
| `tee` | Write to file and stdout |
| `xxd` | Hex dump |
| `base64` | Base64 encode/decode |
| `md5sum` | MD5 checksum |
| `sha256sum` | SHA-256 checksum |

### System Information

| Command | Description |
|---------|-------------|
| `uname` | System information |
| `lsb_release` | Distribution info |
| `hostid` | Host identifier |
| `uptime` | System uptime |
| `whoami` | Current user |
| `hostname` | System hostname |
| `getconf` | Configuration values |
| `time` | Time command execution |
| `date` | Current date and time |
| `cal` | Calendar display |
| `timedatectl` | Time/date control |
| `dmesg` | Kernel message buffer |
| `lspci` | List PCI devices |
| `lsusb` | List USB devices |
| `lsmod` | List loaded modules |
| `lsblk` | List block devices |
| `lscpu` | CPU information |

### Process Management

| Command | Description |
|---------|-------------|
| `ps` | Process status |
| `top` | Real-time process viewer |
| `kill` | Send signal to process |
| `killall` | Kill processes by name |
| `nice` | Set process priority |
| `renice` | Change running process priority |
| `bg` | Resume job in background |
| `fg` | Bring job to foreground |
| `jobs` | List background jobs |
| `wait` | Wait for process completion |
| `exec` | Execute command |

### Networking

| Command | Description |
|---------|-------------|
| `ping` | ICMP echo test |
| `traceroute` | Trace packet route |
| `ifconfig` | Network interface config |
| `ip` | IP configuration |
| `netstat` | Network statistics |
| `netcat` / `nc` | Network utility |
| `curl` | HTTP client |
| `wget` | Download files |
| `ssh` | Secure shell client |
| `telnet` | Telnet client |
| `ftp` | FTP client |
| `nslookup` | DNS lookup |
| `dig` | DNS query tool |
| `whois` | Domain lookup |
| `arp` | ARP table |
| `route` | Routing table |

### Hardware & Drivers

| Command | Description |
|---------|-------------|
| `lspci` | List PCI devices |
| `lsusb` | List USB devices |
| `lsmod` | List kernel modules |
| `dmesg` | Kernel messages |
| `hdparm` | Hard drive parameters |
| `lsblk` | Block devices |
| `fdisk` | Disk partitioning |
| `smartctl` | S.M.A.R.T. status |
| `dmidecode` | SMBIOS/DMI info |

### Cryptography

| Command | Description |
|---------|-------------|
| `openssl` | OpenSSL utilities |
| `gpg` | GnuPG encryption |
| `ssh-keygen` | SSH key generation |
| `md5sum` | MD5 hash |
| `sha1sum` | SHA-1 hash |
| `sha256sum` | SHA-256 hash |
| `hmac` | HMAC generation |
| `genkey` | Generate cryptographic keys |
| `hash` | Hash files |
| `random` | Generate random data |
| `keyscan` | Key scanning utility |

### Vault & Security

| Command | Description |
|---------|-------------|
| `vault status` | Vault status |
| `vault seal` | Seal the vault |
| `vault unseal` | Unseal the vault |
| `vault crypto` | Vault crypto operations |
| `vault keys` | Key management |
| `capabilities` | List process capabilities |
| `audit` | View audit trails |

### Module Management

| Command | Description |
|---------|-------------|
| `modload` | Load kernel module |
| `modunload` | Unload kernel module |
| `modlist` | List loaded modules |
| `modinfo` | Module information |

### Wallet Commands

| Command | Description |
|---------|-------------|
| `wallet accounts` | List wallet accounts |
| `wallet keys` | Key management |
| `wallet transactions` | Transaction history |
| `wallet send` | Send transaction |
| `wallet balance` | Check balance |
| `wallet import` | Import account |
| `wallet export` | Export account |

### Node Commands

| Command | Description |
|---------|-------------|
| `node status` | Node status |
| `node network` | Network info |
| `node staking` | Staking operations |
| `node identity` | Node identity |

### Package Management

| Command | Description |
|---------|-------------|
| `apt` / `apt-get` | APT package manager |
| `dpkg` | Debian packages |
| `rpm` | RPM packages |
| `pacman` | Arch packages |
| `yum` | YUM packages |
| `make` | Build system |
| `cargo` | Rust package manager |

### System Control

| Command | Description |
|---------|-------------|
| `shutdown` | System shutdown |
| `reboot` | System reboot |
| `poweroff` | Power off system |
| `halt` | Halt system |
| `systemctl` | System control |
| `service` | Service management |
| `init` | Init system control |

### Shell Builtins

| Command | Description |
|---------|-------------|
| `echo` | Print text |
| `printf` | Formatted print |
| `read` | Read user input |
| `export` | Export environment variable |
| `unset` | Unset variable |
| `alias` | Create command alias |
| `unalias` | Remove alias |
| `source` / `.` | Execute script in current shell |
| `eval` | Evaluate expression |
| `set` | Set shell options |
| `shopt` | Shell options |
| `help` | Display help |
| `history` | Command history |
| `clear` | Clear screen |


## Variable Expansion

The shell supports several forms of variable expansion:

```bash
$VAR          # Simple expansion
${VAR}        # Bracketed expansion
${VAR:-default}  # Default if unset
${#VAR}       # Length of variable
```

## Command Substitution

Capture command output:

```bash
$(command)    # Modern syntax
`command`     # Legacy syntax
```

## Arithmetic

Perform arithmetic operations:

```bash
$((expression))   # Arithmetic expansion
((expression))    # Arithmetic evaluation
```

## Control Flow

The shell supports conditionals and loops:

```bash
# Conditionals
if [ condition ]; then
    commands
elif [ condition ]; then
    commands
else
    commands
fi

# For loops
for item in list; do
    commands
done

# While loops
while [ condition ]; do
    commands
done
```

## Functions

Define reusable functions:

```bash
function_name() {
    commands
    return value
}

# Call function
function_name arg1 arg2
```


## Examples

### File Operations

```bash
# Create directory structure
mkdir -p projects/nønos/src

# Find all Rust files
find . -name "*.rs"

# Copy with progress
cp -v large_file.bin /mnt/usb/

# Show disk usage sorted by size
du -sh * | sort -h
```

### Text Processing

```bash
# Search for pattern in files
grep -r "TODO" src/

# Count lines in all .rs files
find . -name "*.rs" | xargs wc -l

# Extract specific columns
cat data.csv | cut -d',' -f1,3

# Sort and remove duplicates
sort file.txt | uniq
```

### Networking

```bash
# Check connectivity
ping -c 4 example.com

# Download file
wget https://example.com/file.tar.gz

# HTTP request with curl
curl -X GET https://api.example.com/data

# Show network interfaces
ifconfig -a
```

### Security

```bash
# Generate SHA-256 checksum
sha256sum kernel.bin

# Generate random 32 bytes (hex)
random 32 | xxd -p

# Check vault status
vault status

# List capabilities
capabilities
```

### Process Management

```bash
# Show all processes
ps aux

# Kill process by name
killall firefox

# Run command in background
long_running_task &

# Bring to foreground
fg %1
```


## Environment Variables

Key environment variables:

| Variable | Description |
|----------|-------------|
| `HOME` | User home directory |
| `PATH` | Command search path |
| `PWD` | Current working directory |
| `USER` | Current username |
| `SHELL` | Current shell path |
| `TERM` | Terminal type |
| `EDITOR` | Default editor |
| `LANG` | Locale setting |


## Exit Codes

Commands return exit codes:

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Misuse of command |
| 126 | Permission denied |
| 127 | Command not found |
| 128+N | Killed by signal N |

Check exit code with `$?`:

```bash
command
echo $?  # Print exit code
```


AGPL-3.0 | Copyright 2026 NØNOS Contributors
