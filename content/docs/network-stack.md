---
title: "Network Stack"
description: "NØNOS networking architecture, TCP/IP, onion routing, and DNS privacy"
weight: 17

# NØNOS Network Stack

**Version 0.8.0** | March 2026

NØNOS implements a complete network stack from device drivers through transport protocols to application interfaces. Privacy is built into every layer—onion routing is a first-class transport option, DNS queries go through encrypted channels, and MAC addresses randomize per session.


## Network Architecture

| Layer | Components |
|-------|------------|
| **Applications** | Browser, curl, netcat, wallet, etc. |
| **Socket API** | Berkeley sockets interface |
| **Transport** | TCP, UDP, QUIC + Onion Routing (3-hop encrypted circuits) |
| **Network** | IPv4, IPv6 |
| **Link** | Ethernet |
| **Drivers** | e1000, RTL8139/8168, VirtIO, WiFi |


## Layer 2: Link Layer

### Ethernet

The link layer handles Ethernet frame transmission and reception.

**Frame Structure:**

| Field | Size | Description |
|-------|------|-------------|
| Destination MAC | 6 bytes | Target hardware address |
| Source MAC | 6 bytes | Sender hardware address |
| EtherType | 2 bytes | Protocol (0x0800 = IPv4) |
| Payload | 46-1500 bytes | Network layer data |
| FCS | 4 bytes | Frame check sequence |

**MTU:** 1500 bytes (standard Ethernet)

### ARP (Address Resolution Protocol)

ARP maps IP addresses to MAC addresses on the local network.

**Process:**
1. Need MAC for IP `192.168.1.1`
2. Broadcast ARP request: "Who has 192.168.1.1?"
3. Owner responds: "192.168.1.1 is at aa:bb:cc:dd:ee:ff"
4. Cache result for future use

**Commands:**
```bash
# View ARP cache
arp -a

# Add static entry
arp -s 192.168.1.1 aa:bb:cc:dd:ee:ff
```

### MAC Address Randomization

By default, NØNOS randomizes MAC addresses to prevent device tracking.

**Modes:**

| Mode | Behavior |
|------|----------|
| Per-Session | Random MAC at each boot |
| Per-Network | Different MAC for each network |
| Static | Use hardware MAC (for networks requiring it) |

**Randomized Address Format:**
- Locally administered bit set (bit 1 of first octet = 1)
- Unicast bit clear (bit 0 of first octet = 0)
- Example: `02:xx:xx:xx:xx:xx`


## Layer 3: Network Layer

### IPv4

Full IPv4 implementation with routing and fragmentation.

**Features:**

| Feature | Support |
|---------|---------|
| Unicast | Yes |
| Broadcast | Yes |
| Multicast | Basic |
| Fragmentation | Yes |
| ICMP | Yes |
| Routing | Yes |

**Configuration:**
```bash
# View interfaces
ifconfig

# Set IP manually
ifconfig eth0 192.168.1.100 netmask 255.255.255.0

# View routing table
route
```

### IPv6

IPv6 support for dual-stack networking.

**Features:**

| Feature | Support |
|---------|---------|
| Unicast | Yes |
| Link-Local | Yes |
| Global | Yes |
| SLAAC | Basic |
| ICMPv6 | Yes |

**Status:** Experimental. Use IPv4 for production.

### ICMP

Internet Control Message Protocol for diagnostics.

**Supported Messages:**

| Type | Name | Purpose |
|------|------|---------|
| 0 | Echo Reply | Ping response |
| 3 | Destination Unreachable | Error reporting |
| 8 | Echo Request | Ping request |
| 11 | Time Exceeded | TTL expired |

**Commands:**
```bash
# Ping test
ping -c 4 example.com

# Traceroute
traceroute example.com
```

### Routing

The kernel maintains a routing table for packet forwarding.

**Table Format:**

| Destination | Gateway | Interface | Metric |
|-------------|---------|-----------|--------|
| 0.0.0.0/0 | 192.168.1.1 | eth0 | 100 |
| 192.168.1.0/24 | - | eth0 | 0 |

**Commands:**
```bash
# View routes
route -n

# Add default route
route add default gw 192.168.1.1

# Add network route
route add -net 10.0.0.0/8 gw 192.168.1.254
```


## Layer 4: Transport Layer

### TCP (Transmission Control Protocol)

Full TCP implementation for reliable stream communication.

**Features:**

| Feature | Support |
|---------|---------|
| Connection Establishment | 3-way handshake |
| Reliable Delivery | Yes |
| Flow Control | Yes |
| Congestion Control | Yes |
| Window Scaling | Yes |
| SACK | Yes |

**State Machine:**

```
CLOSED → (connect) → SYN_SENT → (recv SYN-ACK) → ESTABLISHED
LISTEN → (recv SYN) → SYN_RCVD → (recv ACK) → ESTABLISHED
ESTABLISHED → (close) → FIN_WAIT_1 → ... → TIME_WAIT → CLOSED
```

**Congestion Control:**
NØNOS implements TCP congestion control to avoid network overload:
- Slow start
- Congestion avoidance
- Fast retransmit
- Fast recovery

### UDP (User Datagram Protocol)

Connectionless datagram delivery.

**Features:**

| Feature | Support |
|---------|---------|
| Connectionless | Yes |
| Unreliable | Yes (by design) |
| Broadcast | Yes |
| Multicast | Basic |

**Use Cases:**
- DNS queries
- Real-time applications (where latency matters more than reliability)
- Discovery protocols

### QUIC

Experimental QUIC support for HTTP/3.

**Features:**

| Feature | Support |
|---------|---------|
| Stream Multiplexing | Yes |
| TLS 1.3 | Yes |
| 0-RTT | Basic |
| Connection Migration | No |

**Status:** Experimental. Use for testing only.


## Socket API

Applications use Berkeley sockets for network I/O.

### Socket Types

| Type | Protocol | Description |
|------|----------|-------------|
| SOCK_STREAM | TCP | Reliable byte stream |
| SOCK_DGRAM | UDP | Unreliable datagrams |
| SOCK_RAW | IP/ICMP | Raw packet access |

### Basic Operations

```rust
// Create socket
let sock = socket(AF_INET, SOCK_STREAM, 0);

// Connect to server
connect(sock, &server_addr);

// Send data
send(sock, data, flags);

// Receive data
recv(sock, buffer, flags);

// Close
close(sock);
```

### Server Operations

```rust
// Create socket
let sock = socket(AF_INET, SOCK_STREAM, 0);

// Bind to port
bind(sock, &local_addr);

// Listen for connections
listen(sock, backlog);

// Accept connection
let client = accept(sock, &client_addr);
```

### Multiplexing

```rust
// Wait for multiple sockets
select(nfds, read_fds, write_fds, except_fds, timeout);

// Or using poll
poll(fds, nfds, timeout);
```


## Onion Routing

NØNOS includes a Tor-compatible onion routing implementation for network anonymity.

### How It Works

Onion routing sends traffic through three relays (hops):

**Traffic Flow:**

Client → Guard → Middle → Exit → Destination

Each hop removes one layer of encryption. Three layers total.

**What Each Node Sees:**

| Node | Knows Source? | Knows Destination? |
|------|---------------|-------------------|
| Guard | Yes (your IP) | No |
| Middle | No | No |
| Exit | No | Yes (destination) |

No single node can correlate you with your traffic.

### Circuit Construction

Circuits use the ntor handshake for key agreement:

1. **Generate ephemeral X25519 keypair** for each hop
2. **Send CREATE cell** with handshake data (84 bytes)
3. **Receive CREATED cell** with response (64 bytes)
4. **Derive forward/backward keys** using HKDF

**Cell Format:**

| Field | Size | Description |
|-------|------|-------------|
| Circuit ID | 2 bytes | Circuit identifier |
| Command | 1 byte | Cell type |
| Stream ID | 2 bytes | Stream within circuit |
| Payload | 498 bytes | Cell data |

**Cell Types:**

| Command | Name | Purpose |
|---------|------|---------|
| 0 | PADDING | Link padding |
| 1 | CREATE | Circuit creation |
| 2 | CREATED | Creation response |
| 3 | RELAY | Relayed data |
| 4 | DESTROY | Circuit teardown |

### Encryption Layers

Traffic is encrypted three times:

**Outgoing (to destination):**
1. Encrypt with exit node key
2. Encrypt with middle node key
3. Encrypt with guard node key

**Incoming (from destination):**
1. Guard decrypts one layer
2. Middle decrypts one layer
3. Exit decrypts one layer

**Cipher:** AES-128-CTR for each layer

### Directory and Consensus

The onion network uses directory authorities to maintain relay information.

**Consensus Documents:**
- List of all relays with their keys and capabilities
- Signed by multiple directory authorities
- Refreshed periodically

**Relay Flags:**

| Flag | Meaning |
|------|---------|
| Guard | Suitable for entry position |
| Exit | Allows external connections |
| Fast | Sufficient bandwidth |
| Stable | Sufficient uptime |
| Valid | Authorities consider operational |

### Using Onion Routing

```bash
# Enable onion routing (if not default)
onion enable

# Check circuit status
onion status

# Force new circuit
onion newcircuit

# Disable onion routing
onion disable
```

When onion routing is enabled, all network traffic routes through circuits by default.


## DNS Privacy

DNS queries can reveal browsing patterns. NØNOS implements encrypted DNS.

### DNS-over-HTTPS (DoH)

DNS queries encapsulated in HTTPS:

**Advantages:**
- Encrypted (TLS)
- Looks like normal HTTPS traffic
- Harder to block

**Configuration:**
```bash
# Set DoH server
dns server https://dns.example.com/dns-query

# Check DNS status
dns status
```

### DNS-over-TLS (DoT)

Dedicated encrypted DNS channel on port 853:

**Advantages:**
- Encrypted (TLS)
- Lower latency than DoH
- Standard port for DNS

**Note:** DoT is identifiable by port, DoH is not.

### Onion DNS

When onion routing is active, DNS can route through the onion network:

1. DNS query encrypted in onion circuit
2. Exit node makes DNS request
3. Response returns through circuit

**No correlation between your IP and DNS queries.**


## Network Security

### Connection State

All connection state is volatile:
- TCP connections in RAM
- Routing tables in RAM
- ARP cache in RAM

On shutdown, no network history remains.

### Firewall

NØNOS includes a basic firewall:

```bash
# Block incoming port
firewall block incoming 22

# Allow outgoing
firewall allow outgoing all

# View rules
firewall list
```

**Default Policy:**
- Allow all outgoing (subject to capabilities)
- Block all incoming (except established connections)

### Network Capabilities

Network access requires capabilities:

| Capability | Required For |
|------------|--------------|
| NET_ACCESS | Any network access |
| NET_BIND | Binding to ports |
| NET_LISTEN | Accepting connections |
| NET_RAW | Raw sockets |

Without NET_ACCESS, a process cannot open sockets at all.


## Network Configuration

### DHCP

Automatic IP configuration:

```bash
# Enable DHCP
dhcp eth0

# View lease
dhcp status eth0
```

### Static Configuration

Manual IP configuration:

```bash
# Set IP
ifconfig eth0 192.168.1.100 netmask 255.255.255.0

# Set gateway
route add default gw 192.168.1.1

# Set DNS
dns server 1.1.1.1
```

### WiFi

Wireless network connection:

```bash
# Scan for networks
wifi scan

# Connect to network
wifi connect "NetworkName" --password "secret"

# View status
wifi status

# Disconnect
wifi disconnect
```


## Network Commands

### Diagnostic Tools

| Command | Purpose |
|---------|---------|
| `ping` | Test connectivity |
| `traceroute` | Trace packet route |
| `netstat` | Network statistics |
| `ifconfig` | Interface configuration |
| `route` | Routing table |
| `arp` | ARP cache |
| `nslookup` | DNS lookup |
| `dig` | DNS query tool |

### Transfer Tools

| Command | Purpose |
|---------|---------|
| `curl` | HTTP client |
| `wget` | File download |
| `netcat` | Raw network I/O |
| `ftp` | FTP client |
| `ssh` | Secure shell |

### Examples

```bash
# HTTP request
curl https://example.com

# Download file
wget https://example.com/file.tar.gz

# Raw socket connection
netcat -c example.com 80
GET / HTTP/1.0
Host: example.com

```


## Network Performance

### Throughput

With standard drivers:

| Driver | Typical Speed |
|--------|---------------|
| e1000 | Up to 1 Gbps |
| VirtIO | Up to 10 Gbps |
| WiFi | Up to 600 Mbps |

### Onion Routing Overhead

Onion routing adds latency:

| Metric | Direct | Onion |
|--------|--------|-------|
| Latency | 10-50ms | 100-300ms |
| Throughput | Full speed | Reduced |
| Privacy | None | Strong |

Trade-off: Anonymity costs performance.


## Debugging

### Network Diagnostics

```bash
# Check interface status
ifconfig -a

# Check connectivity
ping -c 4 8.8.8.8

# Check DNS
nslookup example.com

# Check routing
traceroute example.com

# View connections
netstat -an
```

### Common Issues

| Symptom | Likely Cause | Solution |
|---------|--------------|----------|
| No connectivity | Driver not loaded | Check `dmesg` |
| DHCP fails | No DHCP server | Use static IP |
| DNS fails | Wrong DNS server | Check DNS config |
| Onion fails | No relay access | Check firewall |


## Protocol Support Summary

### Implemented

| Protocol | Layer | Status |
|----------|-------|--------|
| Ethernet | 2 | Production |
| ARP | 2 | Production |
| IPv4 | 3 | Production |
| IPv6 | 3 | Experimental |
| ICMP/ICMPv6 | 3 | Production |
| TCP | 4 | Production |
| UDP | 4 | Production |
| QUIC | 4 | Experimental |
| HTTP/1.1 | 7 | Production |
| HTTPS (TLS 1.3) | 7 | Production |
| DNS | 7 | Production |
| DoH/DoT | 7 | Production |
| Onion Routing | 7 | Production |

### Not Implemented

| Protocol | Reason |
|----------|--------|
| PPP | No dial-up support |
| IPsec | Future work |
| SCTP | Future work |
| Bluetooth | No driver support |


AGPL-3.0 | Copyright 2026 NØNOS Contributors
