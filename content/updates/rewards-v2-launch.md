---
title: "NOX Rewards V2 is Live"
date: 2026-04-01
type: update
---

We just deployed the new contributor rewards contract. Here's what changed.

## New Rewards

**Stars** - 5,000 NOX
Same as before. Star the repo, connect GitHub, claim your tokens.

**Issues** - 10,000 NOX
Open an issue that helps the project. Once we review and approve it, you can claim 10K NOX.

**Pull Requests** - 25,000+ NOX
Submit a merged PR. Reward amount depends on the contribution - bigger fixes and features get more.

## How It Works

1. Connect your wallet and GitHub at [nonos.software/contribute](/contribute)
2. Star the repo for instant 5K NOX
3. Open issues or submit PRs
4. We review contributions and approve rewards
5. Claim approved rewards directly to your wallet

## Technical Details

- Contract: `0xAcb70B0F83f676ef17abEA09101B9797b6bCF95f`
- UUPS upgradeable proxy for future improvements
- Transient storage reentrancy guard (EIP-1153)
- Chain-bound signatures prevent replay across networks

## V1 Stats

The original contract distributed 15,000 NOX to 3 contributors. Those claims remain on V1 - the new contract starts fresh but we're showing combined stats on the dashboard.

## What's Next

- More contribution types (documentation, testing, translations)
- Reputation multipliers for repeat contributors
- Community voting on reward amounts

Questions? Open an issue or reach out in the community channels.

---

*Contract verified on Etherscan. All rewards come from the community pool - no team allocation.*
