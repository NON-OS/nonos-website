---
title: "Capability System"
description: "NØNOS capability-based security model and access control"
weight: 13
---

# NØNOS Capability System

**Version 0.8.1-alpha** | March 2026

NØNOS uses a capability-based security model instead of traditional user/group permissions. Every privileged operation requires holding the appropriate capability. This document explains how capabilities work, what they control, and how they are managed.


## What Is a Capability?

A capability is a cryptographic token that grants permission to perform specific actions. Unlike traditional Unix permissions which check identity ("who are you?"), capabilities check possession ("what token are you holding?"). A process either holds a valid capability token or it does not. There is no ambient authority based on user ID.

### Why Capabilities?

Traditional permission systems have several problems:

| Traditional Model | Capability-Based Model |
|-------------------|------------------------|
| Root can do anything | Must hold specific capability |
| Ambient authority based on UID | Explicit token required for each action |
| Confused deputy attacks possible | Process knows exactly what is allowed |
| All-or-nothing privilege escalation | Fine-grained permission control |

With capabilities:
- A process that handles network traffic can be denied file system access
- A cryptographic service can be denied network access
- Compromise of one capability does not grant all privileges


## Capability Types

NØNOS defines 10 capability types, each controlling a specific domain of operations.

| Capability | Bit | Description |
|------------|-----|-------------|
| **CoreExec** | 0 | Execute code and perform basic computations |
| **IO** | 1 | Access input/output devices and ports |
| **Network** | 2 | Use network sockets and connections |
| **IPC** | 3 | Inter-process communication and messaging |
| **Memory** | 4 | Memory allocation and management beyond basic needs |
| **Crypto** | 5 | Access cryptographic operations and key material |
| **FileSystem** | 6 | Read, write, and modify files |
| **Hardware** | 7 | Direct hardware access and device control |
| **Debug** | 8 | Debug other processes and inspect system state |
| **Admin** | 9 | Administrative operations including shutdown and configuration |

### CoreExec

Required for any process to execute. This is the fundamental capability that allows code execution.

**Grants access to:**
- Basic CPU instruction execution
- Stack and heap allocation within process limits
- System calls that do not require other capabilities

### IO

Controls access to input/output operations.

**Grants access to:**
- Port I/O operations
- Device read/write through standard interfaces
- Console input and output

### Network

Controls all network-related operations.

**Grants access to:**
- Creating sockets (TCP, UDP)
- Connecting to remote hosts
- Binding to ports
- Listening for connections
- Sending and receiving data
- Raw socket access

### IPC

Controls inter-process communication.

**Grants access to:**
- Message passing between processes
- Shared memory creation and attachment
- Channel creation and communication
- Signal sending

### Memory

Controls advanced memory operations.

**Grants access to:**
- Large memory allocations
- Memory mapping operations
- DMA buffer allocation
- Memory protection changes

### Crypto

Controls cryptographic operations and key access.

**Grants access to:**
- Signing and signature verification
- Encryption and decryption
- Key generation and derivation
- Access to hardware cryptographic accelerators
- Random number generation from secure sources

### FileSystem

Controls file system operations.

**Grants access to:**
- File reading and writing
- Directory creation and traversal
- File creation and deletion
- Permission changes
- Mount operations

### Hardware

Controls direct hardware access.

**Grants access to:**
- PCI device enumeration and configuration
- MMIO region access
- Interrupt handling
- DMA operations
- TPM access

### Debug

Controls debugging operations.

**Grants access to:**
- Process inspection
- Memory reading of other processes
- Breakpoint setting
- Trace operations

### Admin

Controls administrative operations.

**Grants access to:**
- System shutdown and reboot
- Configuration changes
- Module loading
- Security policy modification


## Predefined Roles

NØNOS provides predefined capability sets for common process types.

### Kernel

All capabilities. The kernel operates with full system access.

```rust
KERNEL: [CoreExec, IO, Network, IPC, Memory, Crypto, FileSystem, Hardware, Debug, Admin]
```

### System Service

Standard system services that need file access and IPC.

```rust
SYSTEM_SERVICE: [CoreExec, IPC, Memory, FileSystem]
```

### Sandboxed Module

Minimal capabilities for isolated computation.

```rust
SANDBOXED_MOD: [CoreExec, IPC, Memory]
```

### Network Service

Services that handle network traffic.

```rust
NETWORK_SERVICE: [CoreExec, IPC, Memory, Network]
```

### User Application

Default for user-facing applications.

```rust
USER_APP: [CoreExec, IPC]
```

### Crypto Service

Cryptographic services and key managers.

```rust
CRYPTO_SERVICE: [CoreExec, IPC, Memory, Crypto]
```

### Driver

Device drivers requiring hardware access.

```rust
DRIVER: [CoreExec, IPC, Memory, Hardware, IO]
```

### Debugger

Debugging tools.

```rust
DEBUGGER: [CoreExec, IPC, Memory, Debug]
```


## Capability Tokens

Capabilities are represented as cryptographically signed tokens stored in a compact binary format.

### Token Structure

| Field | Size | Description |
|-------|------|-------------|
| Version | 1 byte | Token format version |
| Owner ID | 8 bytes | Module or process identifier |
| Capability Bits | 8 bytes | Bitmask of granted capabilities |
| Expiration | 8 bytes | Timestamp when token expires |
| Nonce | 8 bytes | Unique value preventing replay |
| Signature | 64 bytes | Ed25519 signature |

**Total Size:** 97 bytes per token

### Token Properties

**Non-Forgeable:**
The Ed25519 signature prevents token creation without the kernel signing key. Only the kernel can mint valid capability tokens.

**Time-Limited:**
Tokens expire after a configured duration. Expired tokens are rejected regardless of signature validity.

**Non-Replayable:**
Each token contains a unique nonce. The kernel tracks used nonces to prevent replay attacks.

**Delegatable:**
Token holders can create child tokens with a subset of their capabilities. A token cannot delegate capabilities it does not possess.


## Token Operations

### Creating Tokens

The kernel creates tokens when processes are spawned:

```rust
let token = create_token(
    owner_id,
    caps_to_bits(&[Capability::CoreExec, Capability::IPC]),
    expiration_ms,
);
```

### Verifying Tokens

Before any privileged operation, the kernel verifies the token:

```rust
if !is_token_valid(&token) {
    return Err(EPERM);
}

if !has_capability(token.capabilities, Capability::Network) {
    return Err(EPERM);
}
```

### Delegation

A process can delegate capabilities to child processes:

```rust
let child_caps = parent_caps & requested_caps;  // Intersection only
let child_token = create_delegation(parent_token, child_caps);
```

Delegation rules:
- Can only delegate capabilities the parent holds
- Cannot add capabilities not in the parent token
- Cannot extend expiration beyond parent token
- Delegation chain depth is limited

### Revocation

Tokens can be revoked before expiration:

```rust
revoke_token(token_nonce);
revoke_all_for_owner(owner_id);
```

Revocation takes effect immediately. The kernel maintains a revocation list checked on every operation.


## Capability Chains

For complex delegation scenarios, NØNOS supports capability chains where each link represents a delegation step.

### Chain Structure

```rust
struct CapabilityChain {
    tokens: [CapabilityToken; MAX_CHAIN_DEPTH],
    length: usize,
}
```

### Chain Validation

A chain is valid if:

1. Every token signature is valid
2. Every token is not expired
3. Every token is not revoked
4. Each child has capabilities subset of parent
5. Chain depth does not exceed maximum

```rust
if !verify_chain(&chain) {
    return Err(ChainError::InvalidChain);
}

let effective = effective_capabilities(&chain);
```


## Multi-Signature Tokens

For high-security operations, NØNOS supports multi-signature capability tokens requiring multiple parties to authorize.

### Structure

| Field | Size | Description |
|-------|------|-------------|
| Threshold | 1 byte | Signatures required |
| Signer Count | 1 byte | Total authorized signers |
| Signer Keys | variable | Public keys of signers |
| Signatures | variable | Collected signatures |

### Usage

```rust
let multisig = create_multisig_token(
    capabilities,
    threshold,
    &signer_public_keys,
);

add_signature(&mut multisig, signer_index, signature);

if count_valid_signatures(&multisig) >= threshold {
    // Token is now valid
}
```


## Resource Tokens

Beyond capability tokens, NØNOS supports resource tokens that track quota consumption.

### Structure

| Field | Description |
|-------|-------------|
| Operations | Number of operations allowed |
| Bytes | Amount of data allowed |
| Consumed | Current consumption |

### Usage

```rust
let resource = create_resource_token(max_ops, max_bytes);

if try_consume_ops(&mut resource, 1).is_ok() {
    // Operation allowed
}

if try_consume_bytes(&mut resource, 1024).is_ok() {
    // Transfer allowed
}
```


## Audit Trail

All capability operations are logged for security auditing.

### Audit Entry Structure

| Field | Description |
|-------|-------------|
| Timestamp | When the operation occurred |
| Module ID | Which module performed the action |
| Capability | Which capability was involved |
| Action | Grant, check, revoke, or delegate |
| Result | Success or failure |

### Querying the Audit Log

```rust
let recent = get_recent(100);
let failures = get_failures();
let by_cap = get_by_capability(Capability::Admin);
let by_module = get_by_module(module_id);
```

### Audit Statistics

```rust
let stats = get_stats();
println!("Total checks: {}", stats.total_checks);
println!("Grants: {}", stats.grants);
println!("Denials: {}", stats.denials);
```


## Capability API

### Checking Capabilities

```rust
use crate::capabilities::{has_capability, Capability};

let caps: u64 = current_process().capability_bits;

if has_capability(caps, Capability::Network) {
    // Proceed with network operation
}
```

### Manipulating Capability Bits

```rust
use crate::capabilities::{caps_to_bits, bits_to_caps, add_capability, remove_capability};

// Convert capability list to bitmask
let bits = caps_to_bits(&[Capability::CoreExec, Capability::IPC]);

// Add a capability
let with_network = add_capability(bits, Capability::Network);

// Remove a capability
let without_network = remove_capability(with_network, Capability::Network);

// Convert back to list
let caps = bits_to_caps(bits);
```

### Counting Capabilities

```rust
use crate::capabilities::capability_count;

let count = capability_count(token.capabilities);
println!("Token has {} capabilities", count);
```


## Security Properties

### Principle of Least Privilege

Each process receives only the capabilities it needs:

- Reduces attack surface
- Limits damage from compromise
- Makes privilege escalation harder

### No Ambient Authority

Unlike traditional Unix systems:

- No root user with implicit permissions
- Every action requires an explicit capability
- Capabilities are checked, not identities

### Unforgeable Tokens

Ed25519 signatures ensure:

- Only the kernel can create valid tokens
- Token modification invalidates the signature
- Stolen signing keys can be rotated

### Timeboxed Permissions

Token expiration provides:

- Automatic cleanup of abandoned tokens
- Limited window for stolen token use
- Forced re-authorization for long-running processes


## Examples

### Web Browser

A web browser needs:

| Capability | Reason |
|------------|--------|
| CoreExec | Execute code |
| IPC | Communicate with other processes |
| Network | Connect to websites |
| FileSystem | Read/write downloads and cache |

If compromised, the attacker cannot:
- Access hardware directly (no Hardware)
- Perform cryptographic signing (no Crypto)
- Debug other processes (no Debug)
- Shut down the system (no Admin)

### Cryptographic Service

A key management service needs:

| Capability | Reason |
|------------|--------|
| CoreExec | Execute code |
| IPC | Receive signing requests |
| Memory | Secure key storage |
| Crypto | Perform cryptographic operations |

It does not need:
- Network (if purely local)
- FileSystem (if keys are in memory only)
- Hardware (unless using HSM)

### Sandboxed Computation

An untrusted computation module:

| Capability | Reason |
|------------|--------|
| CoreExec | Execute code |
| IPC | Return results |
| Memory | Working memory |

This process cannot:
- Access the network
- Read or write files
- Access cryptographic keys
- Interact with hardware


## Shell Commands

### View Current Capabilities

```bash
capabilities
```

### Verbose Capability Information

```bash
capabilities -v
```

### Check Audit Log for Denials

```bash
audit | grep DENY
```


## Troubleshooting

### Permission Denied (EPERM)

If you receive permission denied errors:

1. Check current capabilities with `capabilities`
2. Identify which capability the operation requires
3. Verify the process was granted that capability
4. Check if the token has expired

### Token Verification Failures

If token verification fails:

1. Check token expiration timestamp
2. Verify the token is not in the revocation list
3. Ensure the signing key matches
4. Check delegation chain validity

### Capability Not Taking Effect

If a granted capability seems ignored:

1. Verify the capability bit is set correctly
2. Check for additional requirements (some operations need multiple capabilities)
3. Look for resource quota exhaustion
4. Examine the audit log for details


## Implementation Notes

### Performance

Capability checks are designed to be fast:

- Bitmask operations for capability checks
- Efficient signature verification
- Cached revocation list lookups

### Memory Safety

All capability operations are implemented in safe Rust where possible:

- No raw pointer manipulation in capability logic
- Bounds checking on all arrays
- Cryptographic operations use audited libraries


AGPL-3.0 | Copyright 2026 NØNOS Contributors
