---
title: "The Nym Capsule"
description: "netnym is the anonymity-overlay capsule: a signed ring-3 capsule that wraps an application datagram in a layered Sphinx packet, routes it through a five-hop mixnet, and carries ..."
weight: 400
---
`net_nym` is the anonymity-overlay capsule: a signed ring-3 capsule that wraps an application datagram in a
layered Sphinx packet, routes it through a five-hop mixnet, and carries the outermost packet to an entry
gateway over a WebSocket the capsule speaks itself. It runs no code in the kernel and touches no device. It
sits above `net.tcp`, which it uses purely as a byte pipe to a gateway, and it exposes a small
session-oriented op set to the applications that want a mixed path. Everything a mixnet client does that is
not a raw TCP byte stream, the layered header construction, the per-hop key agreement, the AEAD payload,
the replay window, the signed node directory, the credential check, the SURB reply path, and the cover
traffic, lives inside this capsule as ordinary userland code.

The source under `userland/capsule_net_nym/src/` is organized by concern, and this documentation mirrors
that structure one page per pillar so a page can be read beside the folder it describes. For where this
capsule sits in the whole network stack, read the [networking subsystem](/docs/subsystems/networking/);
for the AEAD, X25519, and hash primitives it calls, read the [crypto capsule](/docs/userland/crypto/).

## Reading the source README first

The capsule ships a `README.md` (`userland/capsule_net_nym/README.md`) that describes a beta scaffold: four
ops, an `IPC`-only `0x10` mask, endpoints `4500`/`4501`, wire magic `NNYM`, and every operational op
returning `E_NOTSUP` until a "live wrap pipeline" lands post-beta. That document is stale. The code in the
tree is well past it: sixteen ops, a `0x0003d` mask, endpoints `4470`/`4471`, request magic `NYM1`, and a
working encode/decode path with real crypto syscalls. Where the source README and the code disagree, this
documentation follows the code and the `Capsule.mk`, and the discrepancies are called out explicitly below
and on each page. Treat the source README as a design note that the implementation overtook.

## Identity

Everything the kernel and the service registry need to name and reach the capsule comes from its
`Capsule.mk` and its kernel-side spawn record.

| Field | Value | Source |
|---|---|---|
| Capsule slug | `net-nym` | `Capsule.mk:4` |
| Service handle | `net.nym` | `Capsule.mk:5`, [`src/userspace/capsule_net_nym/spawn.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_net_nym/spawn.rs#L30) |
| Namespace | `systems.nonos.net.nym` | `Capsule.mk:10` |
| Service endpoint | `service:4470:net.nym` | `Capsule.mk:11`, `spawn.rs:31` |
| Reply endpoint | `reply:4471:endpoint.net.nym.reply` | `Capsule.mk:12`, `spawn.rs:32`, `spawn.rs:33` |
| Capability mask | `0x0003d` | `Capsule.mk:13` |
| Binary name | `net_nym` | `Capsule.mk:8`, `Cargo.toml:19` |
| Feature gate | `nonos-capsule-net-nym` | `Capsule.mk:9`, [`src/userspace/capsule_net_nym/embed.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_net_nym/embed.rs#L17) |
| Request magic | `NYM1` (`0x4E594D31`) | [`src/protocol/header.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L17) |
| Wire packet magic | `NYMP` (`0x4E594D50`) | [`src/packet/header.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/packet/header.rs#L17) |
| Directory magic | `NYMD` (`b"NYMD"`) | [`src/topology/types.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/topology/types.rs#L17) |
| Kernel mirror | `src/userspace/capsule_net_nym` | `Capsule.mk:14`, [`src/userspace/capsule_net_nym/spawn.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_net_nym/spawn.rs) |

The reply endpoint has two parts the manifest and the spawn record agree on: the inbox name
`endpoint.net.nym.reply` (`spawn.rs:32`) and the reply port `4471` (`spawn.rs:33`). The capsule sends every
reply back to the sender by pid with `mk_ipc_reply` rather than to a fixed inbox ([`src/server/respond.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L31)),
so the reply endpoint is the registry-side name for its return path, not an address the capsule hardcodes.
Note the source README's `4500`/`4501` and `NNYM` do not match; the manifest and the code use `4470`/`4471`
and `NYM1`.

The mask `0x0003d` decomposes bit by bit against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

```
  0x00001  CoreExec   bit()   1   types.rs:56
  0x00004  Network    bit()   4   types.rs:58
  0x00008  IPC        bit()   8   types.rs:59
  0x00010  Memory     bit()  16   types.rs:60
  0x00020  Crypto     bit()  32   types.rs:61
  -------
  0x0003d  = 1 + 4 + 8 + 16 + 32
```

The kernel spawn path requests four of those five bits by name, `IPC | Memory | Crypto | Network`
([`src/userspace/capsule_net_nym/spawn.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_net_nym/spawn.rs#L49)), which is `0x3c`; the manifest ceiling adds `CoreExec`
(`0x1`) so the process can run, giving the full `0x3d`. The requested set is a subset of the manifest
ceiling, which is what the spawn check enforces before the ELF is mapped. What each bit buys this capsule:
`CoreExec` runs it as a process, `IPC` lets it receive on `net.nym` and call `net.tcp`, `Memory` maps its
own heap and stack, and `Crypto` reaches the `crypto_*` syscalls it uses for AEAD, X25519, HKDF, HMAC,
BLAKE3, Ed25519 verify, and random ([`src/crypto/mod.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/crypto/mod.rs#L24)). The `Network` bit is the transport-class marker
the stack uses to place it in the network fleet; the capsule reaches the wire only by IPC to `net.tcp`,
never a NIC. It holds no driver, MMIO, IRQ, DMA, PIO, filesystem, graphics, admin, or debug authority, so
compromising it yields its own session tables and the ability to speak to `net.tcp`, and nothing more. The
source README's `0x10` (`IPC` only) is wrong on two counts: the manifest is `0x3d`, and the code does call
crypto and open TCP streams, both of which that mask would forbid.

## The five pillars

The capsule reads as five concerns, and the documentation is one page each. A client op enters through the
protocol and server (the operations page), which for a data send drives the packet builder (the packet page)
whose route header is a layered Sphinx header (the mixnet page) over hops drawn from a signed directory
(the directory page), and hands the finished packet to a gateway over `net.tcp` (the transport page),
against a table of per-owner sessions, replay windows, credentials, and SURBs (the state page).

```
  app clients                                          net.tcp
      |                                                   ^
      | NYM1 op IPC                                       | NTCP byte IPC
      v                                                   |
  server/  ->  packet/ encode  ->  route/sphinx build  ->  gateway_client/ (ws or raw)
  dispatch    NYMP + AEAD + tag   5-hop layered header    handshake, frame, send
      \             |                    |                        |
       \            v                    v                        v
        `--  state/ : sessions, replay, credential, surb, timing, topology store  --'
                     ^
                     | signed NYMD directory
              directory_sync/ (http fetch)  +  topology/ (parse, verify, select)
```

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [operations.md](/docs/userland/net-nym/operations/) | `src/protocol/`, `src/server/` | The `NYM1` wire format, the receive loop, the admin authorization gate, the sixteen ops with per-op payloads, and the errno set. |
| [packet.md](/docs/userland/net-nym/packet/) | `src/packet/`, `src/crypto/` | The `NYMP` wire packet: fixed sizing, the ChaCha20-Poly1305 payload, the padded-plaintext frame, the BLAKE3 replay tag, and the crypto syscall wrappers. |
| [mixnet.md](/docs/userland/net-nym/mixnet/) | `src/route/` | The Sphinx route header: the ephemeral X25519 key, the per-hop shared secret and key schedule, the per-hop MAC block, and the reverse HKDF onion masking. |
| [directory.md](/docs/userland/net-nym/directory/) | `src/topology/`, `src/directory_sync/` | The signed `NYMD` node directory: the Ed25519 authority check, the validity window and epoch, node parsing, the layered five-hop route selection, and the HTTP fetch. |
| [transport.md](/docs/userland/net-nym/transport/) | `src/gateway_client/`, `src/tcp_client/`, [`src/setup.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs) | The gateway link: the `NTCP` client to `net.tcp`, the RFC 6455 WebSocket handshake and framing, and the raw-TCP alternative. |
| [state.md](/docs/userland/net-nym/state/) | `src/state/` | The per-owner tables: the session and its receive queue, the replay window, the trusted-authority and credential stores, the SURB store, and the cover-timing policy. |
| [contributing.md](/docs/userland/net-nym/contributing/) | the whole tree | Where each concern lives, how to add an op, the build and sign steps, and the code standards. |
| [debugging.md](/docs/userland/net-nym/debugging/) | runtime | The boot marker, the setup retry, and the runtime failure modes: no TCP, no gateway, no topology, no credential, and an empty receive queue. |

## Lifecycle

The capsule is `no_std`/`no_main`. `_start` initialises the heap, then loops `setup::run` until it succeeds,
then enters `server::run`, which loops forever ([`src/main.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L42)). If the heap init fails the process exits
with code 1 ([`src/main.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L39)); setup itself does not exit on failure, it retries after yielding sixty-four
times so a boot that races ahead of `net.tcp` recovers on its own ([`src/main.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L50)). `setup::run` looks up
`net.tcp` and stores its port; that lookup is the only thing setup does, and its failure is the single
`TcpMissing` error ([`src/setup.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L28)). The kernel spawns it through
[verified spawn](/docs/security/capsules-and-trust/) under the network spawn plan, checking its signature
and attestation and holding its requested capabilities against its manifest ceiling before its ELF is mapped
([`src/userspace/init/spawn_plan/network/spawn_nym.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/network/spawn_nym.rs#L21)). A successful spawn prints `[NET-NYM] capsule
spawned` on the boot log ([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)); the [debugging](/docs/userland/net-nym/debugging/) page
covers what that and the setup retry mean.

Once setup succeeds the capsule waits for its gateway, directory, authority, and credential to be installed
before it can carry a session. A privileged principal sets the trusted directory authority
(`OP_SET_AUTHORITY`), installs a signed node directory (`OP_SET_TOPOLOGY` or `OP_SYNC_DIRECTORY`), and points
the capsule at a gateway (`OP_SET_GATEWAY`); an application installs its own signed access credential
(`OP_SET_CREDENTIAL`), then opens a session (`OP_OPEN_SESSION`) and moves datagrams (`OP_SEND`, `OP_RECV`).
The capsule owns every byte of mixnet state; the kernel owns no session, key, packet, or timer. It is the
anonymity mechanism, not the socket policy: it holds no fd table, no name resolution, and no direct-path
fallback.

## Source map

```
  userland/capsule_net_nym/src/main.rs         _start -> heap -> setup retry -> server::run
  userland/capsule_net_nym/src/setup.rs        find net.tcp, store its port
  userland/capsule_net_nym/src/protocol/       the NYM1 wire: magic, ops, errno, limits
  userland/capsule_net_nym/src/server/         the receive loop, authz, dispatch, and one handler per op
  userland/capsule_net_nym/src/packet/         the NYMP wire packet: header, AEAD payload, replay tag
  userland/capsule_net_nym/src/route/          the Sphinx route header: seed, per-hop keys, masking
  userland/capsule_net_nym/src/crypto/         the crypto syscall wrappers: aead, x25519, hkdf, hmac, hash
  userland/capsule_net_nym/src/topology/       the signed node directory: parse, verify, select, store
  userland/capsule_net_nym/src/directory_sync/ the HTTP fetch of a directory over net.tcp
  userland/capsule_net_nym/src/gateway_client/ the gateway link: raw TCP and the WebSocket transport
  userland/capsule_net_nym/src/tcp_client/     the NTCP client to net.tcp
  userland/capsule_net_nym/src/state/          the sessions, replay, credential, authority, surb, timing
  userland/capsule_net_nym/Capsule.mk          slug, handle, ports, capability mask, feature, kernel mirror
  userland/capsule_net_nym/Cargo.toml          panic = "abort" and the binary name
  src/userspace/capsule_net_nym/               the kernel-side embed and verified spawn
  src/userspace/init/spawn_plan/network/spawn_nym.rs  the NET-NYM spawn entry and boot marker
  src/capabilities/types.rs                    the capability bit values behind the mask
```

Every reference above is verified against those trees.
