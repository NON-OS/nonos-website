---
title: "NØNOS v0.8.3.5-alpha Released"
date: 2026-03-27
description: "Native Git client, network stack improvements, and desktop enhancements"
---

## NØNOS v0.8.3.5-alpha

This release represents a significant milestone in making NØNOS a self-sufficient operating system capable of developing itself. The highlight of this version is the introduction of a fully functional Git client that works natively within NØNOS.

---

### Native Git Implementation

NØNOS now ships with a complete Git implementation written entirely in Rust and designed specifically for the RAMFS filesystem.

**Supported Operations:**
- Clone repositories from GitHub
- Pull updates from remote
- Create commits locally
- Manage branches
- View commit history

When you clone a repository, NØNOS initializes a local Git structure and configures the remote automatically. The pull command fetches the repository tree from the GitHub API and downloads each file individually, storing them in the RAMFS filesystem where they can be edited using the built-in text editor.

**Commands:**
- `git clone <url>` - Clone a GitHub repository
- `git pull` - Fetch files from remote branch
- `git status` - Show working tree status
- `git add <file>` - Stage changes
- `git commit -m "message"` - Create a commit
- `git log` - View commit history

---

### Network Stack Improvements

The network stack has been significantly optimized to maintain system responsiveness during network operations.

**Key Improvements:**
- Cooperative yielding throughout the network code path
- TLS handshake yields periodically during connection establishment
- Mouse movement and keyboard input processed between network round trips
- TCP connection and data reception updated with strategic yield points
- Browser navigation and Git operations feel much smoother

Previous versions could experience cursor freezing and input lag while waiting for network responses. This release ensures the system remains interactive even during heavy network activity.

---

### Desktop Environment Enhancements

**Folder Navigation:**
- Double-click folders to navigate into them
- New "Go Back" option in context menu to return to parent directory
- Files and folders created in subdirectories stay in that directory

**Text Editor Fix:**
- Enter key now correctly creates new lines in all cases

---

### Technical Details

**Git Storage:**
- Repository data stored within RAMFS under current working directory
- Standard .git directory structure with configuration, refs, and objects
- Currently supports public GitHub repositories over HTTPS
- Authentication for private repositories planned for future release

**Progress Feedback:**
- Status updates displayed during large repository pulls
- System yields to event loop every few files
- Interface remains responsive during bulk downloads

---

### Download

- [nonos-0.8.3.5-alpha.iso](/iso/nonos-0.8.3.5-alpha.iso) (235 MB)
- [nonos-0.8.3.5-alpha.img](/iso/nonos-0.8.3.5-alpha.img) (302 MB)

**SHA256 Checksums:**
```
81957fb0766366ef953b7a16a589afe595e73b136edab772f65d2c242f95978f  nonos-0.8.3.5-alpha.iso
1957b108a36f6d3f48092b7ad88a7578207fa68028eb9b2d7eb36a13125dedd7  nonos-0.8.3.5-alpha.img
```

See the [Download](/download/) page for installation instructions.

---

### Looking Forward

This release lays the groundwork for a fully self-hosted development environment. Future versions will expand the Git implementation with:

- Pushing changes to remote
- Handling merge conflicts
- Private repository authentication via tokens

The goal is to make NØNOS capable of cloning its own kernel repository, making modifications, and contributing changes back upstream.

---

*NØNOS v0.8.3.5 continues the project's mission of creating a secure, privacy-focused operating system that respects user freedom. The entire codebase remains open source under the GNU Affero General Public License.*
