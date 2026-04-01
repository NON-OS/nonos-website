---
title: "NØNOS v0.8.3-alpha Released"
date: 2026-03-26
description: "Major release with NOSH shell, native staking, ZK wallet proofs, zkSync Era, AI agents, and marketplace"
---

## NØNOS v0.8.3-alpha

We are pleased to announce the release of NØNOS v0.8.3-alpha, a significant milestone in the development of a sovereign computing platform.

---

### NOSH Command Shell

NOSH is our custom command-line interface built specifically for NØNOS.

- Full command parsing with pipes, redirects, and argument handling
- Package management via `nox install`, `nox remove`, `nox search`
- Dependency tree visualization with `nox deps --tree`
- Environment variables and shell state persistence
- Tab completion and command history

---

### Native NOX Staking

Stake NOX tokens directly from the operating system without external applications.

- One-click stake and unstake operations
- Epoch-based reward distribution
- NFT boost multipliers for increased APY
- Pending rewards display with instant claim
- Testnet faucet integration

---

### Wallet Zero-Knowledge Proofs

The wallet now includes cryptographic proof capabilities:

- **Stealth addresses** for private receiving
- **ZK transaction proofs** for authorization without key exposure
- **Balance sufficiency proofs** for transaction coverage verification
- Multi-view architecture: Overview, Transactions, Stealth, zkSync, Staking, Settings

---

### zkSync Era Integration

Native Layer 2 support with deep integration:

- Bridge operations for L1 deposits and withdrawals
- Withdrawal handler with finalization tracking
- Batch-aware transactions for L1 settlement
- Local zkSync state management with synchronization

---

### AI Agents Framework

Local AI agents that execute entirely on-device:

- Agent registry with create, delete, and list operations
- Preset templates for common agent types
- Custom agent creation with configurable system prompts
- Context management per agent conversation
- No cloud dependencies or API keys required

---

### Application Marketplace

The application ecosystem infrastructure:

- Browse and install sandboxed capsule packages
- Dependency resolution for installations
- Developer portal for publishing applications
- Cryptographic app signing and version management

---

### Browser Engine Improvements

JavaScript runtime enhancements:

- Full Date object implementation
- RegExp support with test, exec, and toString
- Fetch API with Response and Headers
- Promise chains with then/catch/finally
- WebSocket event handling
- LocalStorage and cookie support

---

### Platform Stability

Production-ready code quality:

- Zero compiler warnings
- Proper module visibility throughout
- Rust 2024 compatibility
- Eliminated duplicate implementations
- Comprehensive error handling

---

### Download

- [nonos-0.8.3-alpha.iso](/iso/nonos-0.8.3-alpha.iso) (234 MB)
- [nonos-0.8.3-alpha.img](/iso/nonos-0.8.3-alpha.img) (301 MB)

**SHA256 Checksums:**
```
df5a9db7802ccef942e1410c50e9a140b48ca614631a55b126894e8b814690e0  nonos-0.8.3-alpha.iso
05317cb0e00681e834a824bebb64943fb5c5830e91e8909e1c69dddd692d5177  nonos-0.8.3-alpha.img
```

See the [Download](/download/) page for installation instructions.
