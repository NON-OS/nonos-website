---
title: "Capability System"
description: "NØNOS capability-based security model and access control"
weight: 13
---

# NØNOS Capability System

**Version 0.8.0** | March 2026

NØNOS uses a capability-based security model instead of traditional user/group permissions. Every privileged operation requires holding the appropriate capability. This document explains how capabilities work, what they control, and how they're managed.


## What Is a Capability?

A capability is a cryptographic token that grants permission to perform specific actions. Think of it like a signed permission slip that says "this process is allowed to do X."

Unlike traditional Unix permissions (which check "who are you?"), capabilities check "what are you holding?" A process either has the token or it doesn't—there's no ambient authority based on user ID.

### Why Capabilities?

Traditional permission systems have problems:

| Traditional | Capability-Based |
|-------------|------------------|
| Root can do anything | Must hold specific capability |
| Ambient authority (UID 0) | Explicit token required |
| Confused deputy attacks | Process knows exactly what's allowed |
| All-or-nothing escalation | Fine-grained permission |

With capabilities:
- A process that handles network traffic can be denied filesystem access
- A cryptographic service can be denied network access
- Compromise of one capability doesn't grant all privileges


## Capability Types

NØNOS defines 17 capability types, each controlling a specific domain of operations.

### File System Capabilities

| Capability | Bit | Description |
|------------|-----|-------------|
| **FILE_READ** | 0 | Read file contents |
| **FILE_WRITE** | 1 | Write to files |
| **FILE_EXECUTE** | 2 | Execute files as programs |
| **FILE_CREATE** | 3 | Create new files |
| **FILE_DELETE** | 4 | Delete files |

**Usage Examples:**
- A text editor needs FILE_READ, FILE_WRITE, FILE_CREATE
- A log viewer needs only FILE_READ
- A cleanup utility needs FILE_READ, FILE_DELETE

### Network Capabilities

| Capability | Bit | Description |
|------------|-----|-------------|
| **NET_ACCESS** | 5 | Basic network access |
| **NET_BIND** | 6 | Bind to a port |
| **NET_LISTEN** | 7 | Listen for incoming connections |
| **NET_RAW** | 8 | Raw socket access |

**Usage Examples:**
- A web browser needs NET_ACCESS
- A web server needs NET_ACCESS, NET_BIND, NET_LISTEN
- A packet sniffer needs NET_RAW

### Process Capabilities

| Capability | Bit | Description |
|------------|-----|-------------|
| **PROC_SPAWN** | 9 | Create child processes |
| **PROC_KILL** | 10 | Terminate other processes |
| **PROC_DEBUG** | 11 | Debug/ptrace other processes |

**Usage Examples:**
- A shell needs PROC_SPAWN to run commands
- A task manager needs PROC_KILL
- A debugger needs PROC_DEBUG

### System Capabilities

| Capability | Bit | Description |
|------------|-----|-------------|
| **SYS_SHUTDOWN** | 12 | Shut down the system |
| **SYS_REBOOT** | 13 | Reboot the system |
| **SYS_CONFIG** | 14 | Modify system configuration |

**Usage Examples:**
- The Settings app needs SYS_CONFIG
- Power management needs SYS_SHUTDOWN, SYS_REBOOT

### Cryptographic Capabilities

| Capability | Bit | Description |
|------------|-----|-------------|
| **CRYPTO_SIGN** | 15 | Access signing keys |
| **CRYPTO_ENCRYPT** | 16 | Perform encryption operations |

**Usage Examples:**
- A code signing tool needs CRYPTO_SIGN
- An encrypted file handler needs CRYPTO_ENCRYPT


## Capability Tokens

Capabilities are represented as cryptographically signed tokens.

### Token Structure

| Field | Size | Description |
|-------|------|-------------|
| Module ID | 8 bytes | Who created this token |
| Capability Bits | 8 bytes | Which capabilities granted |
| Expiration | 8 bytes | When token expires (milliseconds) |
| Nonce | 32 bytes | Unique random value |
| Signature | 64 bytes | Ed25519 signature |

**Total Size:** 120 bytes per token

### Token Properties

**Non-Forgeable:**
The Ed25519 signature prevents token creation without the signing key. Only the kernel can mint valid tokens.

**Time-Limited:**
Tokens expire after a set duration (default: 24 hours). Expired tokens are rejected.

**Non-Replayable:**
The random nonce ensures each token is unique. The kernel tracks used nonces to prevent replay.

**Delegatable:**
Token holders can create child tokens with a subset of their capabilities (not more).


## Token Operations

### Token Creation

When a process is created, it receives a capability token from its parent:

```rust
// Kernel-side token creation
let token = CapabilityToken {
    module_id: parent.module_id,
    capabilities: requested & parent.capabilities,  // Cannot exceed parent's
    expiration: now + DEFAULT_EXPIRATION,
    nonce: random_bytes(32),
    signature: sign(token_data),
};
```

### Token Verification

Every system call checks capabilities before proceeding:

```rust
fn syscall_open(path: &str, flags: u32) -> Result<Fd> {
    let caps = current_process().capability_bits;

    if flags.contains(O_RDONLY) && !caps.contains(FILE_READ) {
        return Err(EPERM);
    }
    if flags.contains(O_WRONLY) && !caps.contains(FILE_WRITE) {
        return Err(EPERM);
    }
    if flags.contains(O_CREAT) && !caps.contains(FILE_CREATE) {
        return Err(EPERM);
    }

    // Proceed with open...
}
```

### Token Delegation

A process can delegate capabilities to another process:

```rust
// Create a child token with reduced capabilities
let child_token = parent_token.delegate([FILE_READ, NET_ACCESS]);
```

**Rules:**
- Can only delegate capabilities you hold
- Cannot add capabilities
- Cannot extend expiration
- Child tokens are signed by the kernel, not the delegator

### Token Revocation

Tokens can be revoked before expiration:

```rust
// Kernel revokes all tokens for a module
kernel.revoke_tokens(module_id);

// Or revoke specific token by nonce
kernel.revoke_token(token_nonce);
```

Revocation takes effect immediately. The kernel maintains a revocation list checked on every operation.


## Process Capabilities

### At Process Creation

New processes receive capabilities through several mechanisms:

| Method | Capability Source |
|--------|-------------------|
| Inheritance | Subset of parent's capabilities |
| Module Manifest | Capabilities declared in signed module |
| Explicit Grant | Parent grants specific capabilities |
| System Default | Minimal capabilities for basic operation |

### Default Capabilities

By default, new processes receive:

| Capability | Granted |
|------------|---------|
| FILE_READ | No |
| FILE_WRITE | No |
| NET_ACCESS | No |
| PROC_SPAWN | No |
| ... | No |

**Everything is denied by default.** Capabilities must be explicitly granted.

### Capability Checking

The kernel checks capabilities atomically—either all required capabilities are present, or the operation fails entirely.

```bash
# Check capabilities from shell
capabilities
```


## System Call Requirements

Each system call has specific capability requirements:

### File Operations

| System Call | Required Capabilities |
|-------------|----------------------|
| read() | FILE_READ |
| write() | FILE_WRITE |
| open(O_RDONLY) | FILE_READ |
| open(O_WRONLY) | FILE_WRITE |
| open(O_CREAT) | FILE_CREATE |
| unlink() | FILE_DELETE |
| chmod() | FILE_WRITE |
| execve() | FILE_EXECUTE |

### Network Operations

| System Call | Required Capabilities |
|-------------|----------------------|
| socket() | NET_ACCESS |
| connect() | NET_ACCESS |
| bind() | NET_BIND |
| listen() | NET_LISTEN |
| accept() | NET_LISTEN |
| send() | NET_ACCESS |
| recv() | NET_ACCESS |
| raw socket | NET_RAW |

### Process Operations

| System Call | Required Capabilities |
|-------------|----------------------|
| fork() | PROC_SPAWN |
| clone() | PROC_SPAWN |
| kill() | PROC_KILL |
| ptrace() | PROC_DEBUG |
| execve() | PROC_SPAWN |

### System Operations

| System Call | Required Capabilities |
|-------------|----------------------|
| shutdown() | SYS_SHUTDOWN |
| reboot() | SYS_REBOOT |
| mount() | SYS_CONFIG |
| module_load() | SYS_CONFIG |

### Cryptographic Operations

| System Call | Required Capabilities |
|-------------|----------------------|
| crypto_sign() | CRYPTO_SIGN |
| crypto_verify() | None (verification is public) |
| crypto_encrypt() | CRYPTO_ENCRYPT |
| crypto_decrypt() | CRYPTO_ENCRYPT |


## Capability in Practice

### Example: Web Browser

A web browser needs:

| Capability | Why |
|------------|-----|
| FILE_READ | Read cached files, bookmarks |
| FILE_WRITE | Write downloads, cache |
| FILE_CREATE | Create download files |
| NET_ACCESS | Connect to websites |

It does **not** need:
- NET_BIND (it's a client, not a server)
- NET_LISTEN (it's not accepting connections)
- PROC_KILL (it shouldn't kill other processes)
- SYS_SHUTDOWN (it shouldn't shut down the system)

If the browser is compromised, the attacker cannot:
- Listen for incoming connections (no backdoor server)
- Kill other processes
- Modify system configuration
- Access signing keys

### Example: Password Manager

A password manager needs:

| Capability | Why |
|------------|-----|
| FILE_READ | Read encrypted vault |
| FILE_WRITE | Update vault |
| CRYPTO_ENCRYPT | Encrypt/decrypt vault |

It does **not** need:
- NET_ACCESS (if offline-only)
- PROC_SPAWN (no need to run other programs)
- FILE_EXECUTE (just data, no executables)

### Example: Shell

The shell needs broad capabilities:

| Capability | Why |
|------------|-----|
| FILE_READ | Read scripts, display files |
| FILE_WRITE | Output redirection |
| FILE_CREATE | Create files |
| FILE_EXECUTE | Run programs |
| PROC_SPAWN | Execute commands |
| NET_ACCESS | Network commands |

This is why the shell is a high-privilege component. Users should be careful what they run.


## Capability Audit Trail

All capability operations are logged:

```
[AUDIT] 2026-03-04 14:23:15 GRANT module=shell caps=FILE_READ|FILE_WRITE
[AUDIT] 2026-03-04 14:23:16 CHECK module=editor caps=FILE_READ result=ALLOW
[AUDIT] 2026-03-04 14:23:17 CHECK module=editor caps=NET_ACCESS result=DENY
[AUDIT] 2026-03-04 14:23:18 REVOKE module=editor reason=EXPIRED
```

The audit trail provides:
- Who requested what capability
- Whether it was granted or denied
- When capabilities expired or were revoked
- Chain of delegation


## Capability API

### Checking Capabilities

```rust
// Check if current process has capability
if kernel.has_capability(Capability::NetAccess) {
    // Proceed with network operation
}

// Check multiple capabilities
if kernel.has_all_capabilities([Capability::FileRead, Capability::FileWrite]) {
    // Proceed
}
```

### Dropping Capabilities

A process can voluntarily drop capabilities:

```rust
// Drop network access (cannot be regained)
kernel.drop_capability(Capability::NetAccess);
```

Once dropped, a capability cannot be regained without creating a new process.

### Querying Capabilities

```rust
// Get current capability set
let caps = kernel.get_capabilities();

// Check specific capability
let can_sign = caps.contains(Capability::CryptoSign);
```


## Module Capabilities

Loaded modules declare capabilities in their manifest:

```rust
ModuleManifest {
    name: "network_monitor",
    requested_capabilities: [
        Capability::NetAccess,
        Capability::NetRaw,
    ],
    ...
}
```

The kernel validates:
1. Requested capabilities are appropriate for module type
2. Module signature is valid
3. No capability escalation beyond policy

### Module Types and Allowed Capabilities

| Module Type | Maximum Capabilities |
|-------------|---------------------|
| User | FILE_*, limited NET |
| Service | Most capabilities |
| Driver | Full hardware access |
| System | All capabilities |

User modules cannot request SYS_CONFIG, PROC_DEBUG, or other dangerous capabilities.


## Security Properties

### Principle of Least Privilege

Each process receives only the capabilities it needs:

- Reduces attack surface
- Limits blast radius of compromise
- Makes privilege escalation harder

### No Ambient Authority

Unlike traditional Unix:
- Being "root" doesn't grant all permissions
- Must hold specific capability token
- Capabilities are explicit, not implicit

### Unforgeable Tokens

Ed25519 signatures prevent:
- Token creation by non-kernel code
- Token modification after creation
- Token transfer (except through delegation)

### Timeboxed Permissions

Token expiration means:
- Stolen tokens become useless after expiration
- Long-running processes must refresh tokens
- Abandoned tokens automatically clean up


## Common Patterns

### Temporary Elevation

Sometimes a process needs temporary elevated capabilities:

```rust
// Request elevated token for specific operation
let elevated = kernel.request_elevation([Capability::SysConfig]);
// Use elevated capabilities
kernel.modify_config(...);
// Token automatically expires
```

### Capability Brokering

A trusted broker can grant capabilities:

```rust
// Broker verifies request and grants capability
if broker.verify_request(requestor) {
    broker.delegate_capability(requestor, [Capability::NetAccess]);
}
```

### Sandbox Patterns

Create highly restricted processes:

```rust
// Spawn with minimal capabilities
let sandbox = spawn_with_capabilities([], []);  // Empty capability set

// Sandbox can compute but not access files or network
```


## Troubleshooting

### Permission Denied Errors

If you see `EPERM`:

1. Check current capabilities: `capabilities`
2. Identify required capability for operation
3. Verify capability in process chain
4. Check token expiration

### Capability Not Working

If a capability seems ignored:

1. Verify token signature (shouldn't fail silently)
2. Check expiration time
3. Look for revocation in audit log
4. Verify capability bit is actually set

### Debugging Capability Issues

```bash
# Show current capabilities
capabilities

# Check audit log
audit | grep DENY

# Verbose capability info
capabilities -v
```


AGPL-3.0 | Copyright 2026 NØNOS Contributors
