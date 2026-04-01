var NoxStaking = window.NoxStaking || {};

NoxStaking.CONFIG = {
    STAKING_ADDRESS: '0xa94d6009790ba13597a1e1b7cf4e1531ea513613',
    NOX_TOKEN_ADDRESS: '0x0a26c80Be4E060e688d7C23aDdB92cBb5D2C9eCA',
    ZEROSTATE_PASS_ADDRESS: '0x7b575DD8e8b111c52Ab1e872924d4Efd4DF403df',
    RPC_URL: 'https://ethereum-rpc.publicnode.com',
    WC_PROJECT_ID: 'f6660eeed931e1739a01b78e47a5dacd'
};

NoxStaking.STAKING_ABI = [
    'function stake(uint256 amount) external',
    'function stakeLocked(uint256 amount, uint256 lockPeriod) external',
    'function unstake(uint256 amount) external',
    'function unstakePosition(uint256 positionId) external',
    'function earlyUnlock(uint256 positionId) external',
    'function extendLock(uint256 positionId, uint256 newLockPeriod) external',
    'function claimRewards() external',
    'function refreshBoost(address user) external',
    'function getStakeInfo(address user) view returns (uint256,uint256,uint256,uint256,uint256,uint256,uint256)',
    'function pendingRewards(address user) view returns (uint256)',
    'function totalStaked() view returns (uint256)',
    'function getEmissionRate() view returns (uint256)',
    'function getUserPositions(address user) view returns (uint256[],uint256[],uint256[],uint256[],bool[],bool[])',
    'function getPosition(address user, uint256 positionId) view returns (uint256,uint256,uint256,uint256,uint256,bool,bool)',
    'function earlyUnlockPenaltyBps() view returns (uint256)',
    'function version() view returns (string)'
];

NoxStaking.ERC20_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function allowance(address,address) view returns (uint256)',
    'function approve(address,uint256) returns (bool)'
];

NoxStaking.ERC721_ABI = [
    'function balanceOf(address owner) view returns (uint256)',
    'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
    'function tokenURI(uint256 tokenId) view returns (string)',
    'function ownerOf(uint256 tokenId) view returns (address)'
];

NoxStaking.LOCK_BOOSTS = {
    '0': '',
    '2592000': '+20%',
    '5184000': '+40%',
    '7776000': '+60%',
    '15552000': '+80%',
    '31536000': '+150%'
};

window.NoxStaking = NoxStaking;
var NoxStaking = window.NoxStaking || {};

NoxStaking.UI = {
    toastTimeout: null,

    showToast: function(msg, type) {
        var t = document.getElementById('toast');
        if (!t) return;
        t.textContent = msg;
        t.className = 'toast show' + (type ? ' ' + type : '');
        clearTimeout(NoxStaking.UI.toastTimeout);
        NoxStaking.UI.toastTimeout = setTimeout(function() { t.classList.remove('show'); }, 4000);
    },

    formatNum: function(n) {
        if (n >= 1e6) return (n/1e6).toFixed(2) + 'M';
        if (n >= 1e3) return (n/1e3).toFixed(2) + 'K';
        if (n >= 1) return n.toFixed(2);
        return n > 0 ? n.toFixed(4) : '0.00';
    },

    getNftBoost: function(n) {
        return [1, 1.25, 1.5, 1.75, 2, 2.5][Math.min(n, 5)];
    },

    getLockBoost: function(p) {
        if (p >= 31536000) return 2.5;
        if (p >= 15552000) return 1.8;
        if (p >= 7776000) return 1.6;
        if (p >= 5184000) return 1.4;
        if (p >= 2592000) return 1.2;
        return 1;
    },

    getBoostForNftPosition: function(position) {
        var boosts = [25, 25, 25, 25, 50];
        if (position <= 5) return boosts[position - 1];
        return 0;
    },

    formatTimeLeft: function(seconds) {
        var d = Math.floor(seconds / 86400);
        var h = Math.floor((seconds % 86400) / 3600);
        var m = Math.floor((seconds % 3600) / 60);
        return d > 0 ? d + 'd ' + h + 'h' : (h > 0 ? h + 'h ' + m + 'm' : m + 'm');
    },

    updateElement: function(id, value) {
        var el = document.getElementById(id);
        if (el) el.textContent = value;
    },

    setDisplay: function(id, display) {
        var el = document.getElementById(id);
        if (el) el.style.display = display;
    },

    updatePenaltyBanner: function(penaltyBps) {
        var valueEl = document.getElementById('penaltyValue');
        var statusEl = document.querySelector('.penalty-status');
        if (!valueEl) return;

        var pct = (penaltyBps / 100).toFixed(1);
        valueEl.textContent = pct + '%';

        if (statusEl) {
            if (penaltyBps === 0) {
                statusEl.textContent = 'GRACE PERIOD - Exit locked positions FREE';
                statusEl.classList.remove('active');
                statusEl.classList.add('grace');
            } else {
                statusEl.textContent = 'ACTIVE - ' + pct + '% burned on early exit';
                statusEl.classList.remove('grace');
                statusEl.classList.add('active');
            }
        }
    }
};

window.NoxStaking = NoxStaking;
var NoxStaking = window.NoxStaking || {};

NoxStaking.WalletModal = {
    render: function(wallets) {
        var html = '<div id="walletModal" style="position:fixed;inset:0;background:rgba(0,0,0,0.95);display:flex;align-items:center;justify-content:center;z-index:10000;animation:fadeIn 0.15s ease" onclick="if(event.target.id===\'walletModal\')this.remove()">' +
            '<style>@keyframes fadeIn{from{opacity:0}to{opacity:1}}@keyframes slideUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}</style>' +
            '<div style="background:linear-gradient(180deg,#111 0%,#0a0a0a 100%);border:1px solid #222;border-radius:24px;max-width:400px;width:94%;animation:slideUp 0.2s ease">' +
            '<div style="padding:20px 24px;border-bottom:1px solid #1a1a1a;display:flex;justify-content:space-between;align-items:center">' +
            '<span style="color:#fff;font-size:18px;font-weight:600">Connect Wallet</span>' +
            '<button onclick="document.getElementById(\'walletModal\').remove()" style="background:#1a1a1a;border:none;color:#888;width:32px;height:32px;border-radius:10px;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center">&times;</button>' +
            '</div><div style="padding:20px 24px">';

        if (wallets.length > 0) {
            html += '<div style="margin-bottom:20px">';
            wallets.forEach(function(w, i) {
                html += '<button onclick="document.getElementById(\'walletModal\').remove();NoxStaking.Wallet.connectByIndex(' + i + ')" style="width:100%;padding:14px 16px;margin-bottom:8px;background:#151515;border:1px solid #2a2a2a;border-radius:14px;color:#fff;cursor:pointer;display:flex;align-items:center;gap:14px;font-size:15px">' +
                    '<img src="' + w.icon + '" style="width:40px;height:40px;border-radius:10px" onerror="this.style.background=\'#333\'">' +
                    '<div style="flex:1;text-align:left"><div style="font-weight:500">' + w.name + '</div><div style="font-size:12px;color:#66ffff">Click to connect</div></div></button>';
            });
            html += '</div>';
        } else {
            html += '<div style="text-align:center;padding:30px 0;border:1px dashed #333;border-radius:16px;margin-bottom:20px">' +
                '<div style="font-size:32px;margin-bottom:12px">&#x1F98A;</div><div style="color:#888;font-size:14px">No wallet detected</div></div>';
        }

        html += NoxStaking.WalletModal.getWalletConnectSection();
        html += NoxStaking.WalletModal.getMobileLinksSection();
        html += '</div></div></div>';
        document.body.insertAdjacentHTML('beforeend', html);
    },

    getWalletConnectSection: function() {
        return '<div style="border-top:1px solid #1a1a1a;padding-top:20px;margin-bottom:20px">' +
            '<button onclick="document.getElementById(\'walletModal\').remove();NoxStaking.Wallet.openWalletConnect()" style="width:100%;padding:14px 16px;background:#151515;border:1px solid #3396ff;border-radius:14px;color:#fff;cursor:pointer;display:flex;align-items:center;gap:14px;font-size:15px">' +
            '<svg width="40" height="40" viewBox="0 0 40 40"><rect fill="#3396ff" width="40" height="40" rx="10"/><path d="M12.5 15.5c4.1-4 10.9-4 15 0l.5.5-1.8 1.8-.3-.3c-3.2-3.1-8.4-3.1-11.6 0l-.4.3-1.8-1.8.4-.5zm18.5 3.5l1.6 1.6-7.3 7.2c-2.5 2.4-6.5 2.4-9 0l-5.2-5.1 1.6-1.6 5.2 5.1c1.6 1.5 4.2 1.5 5.8 0l7.3-7.2z" fill="white"/></svg>' +
            '<div style="flex:1;text-align:left"><div style="font-weight:500">WalletConnect</div><div style="font-size:12px;color:#3396ff">Scan with mobile wallet</div></div></button></div>';
    },

    getMobileLinksSection: function() {
        return '<div style="border-top:1px solid #1a1a1a;padding-top:20px"><div style="color:#666;font-size:12px;text-align:center;margin-bottom:14px">Open on mobile</div>' +
            '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">' +
            '<a href="https://metamask.app.link/dapp/nonos.software/staking/" style="display:flex;flex-direction:column;align-items:center;gap:8px;padding:16px 8px;background:#151515;border:1px solid #222;border-radius:14px;color:#fff;text-decoration:none;font-size:11px">' +
            '<img src="https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg" width="28" height="28">MetaMask</a>' +
            '<a href="https://go.cb-w.com/dapp?cb_url=https://nonos.software/staking/" style="display:flex;flex-direction:column;align-items:center;gap:8px;padding:16px 8px;background:#151515;border:1px solid #222;border-radius:14px;color:#fff;text-decoration:none;font-size:11px">' +
            '<svg width="28" height="28" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#0052FF"/><circle cx="16" cy="16" r="6" fill="white"/></svg>Coinbase</a>' +
            '<a href="https://link.trustwallet.com/open_url?url=https://nonos.software/staking/" style="display:flex;flex-direction:column;align-items:center;gap:8px;padding:16px 8px;background:#151515;border:1px solid #222;border-radius:14px;color:#fff;text-decoration:none;font-size:11px">' +
            '<svg width="28" height="28" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#0500FF"/><path d="M16 8l6 3.5v6c0 3.5-3 6-6 7.5-3-1.5-6-4-6-7.5v-6L16 8z" stroke="white" stroke-width="1.5" fill="none"/></svg>Trust</a></div></div>';
    }
};

window.NoxStaking = NoxStaking;
var NoxStaking = window.NoxStaking || {};

NoxStaking.Wallet = {
    provider: null,
    signer: null,
    userAddress: null,
    stakingContract: null,
    noxToken: null,
    detectedWallets: [],

    isConnected: function() {
        return !!NoxStaking.Wallet.userAddress;
    },

    showConnectModal: function() {
        var wallets = [];
        if (window.ethereum) {
            if (window.ethereum.providers && window.ethereum.providers.length > 0) {
                window.ethereum.providers.forEach(function(p) {
                    if (p.isMetaMask) wallets.push({ name: 'MetaMask', provider: p, icon: 'https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg' });
                    else if (p.isRabby) wallets.push({ name: 'Rabby', provider: p, icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="%238697FF"/></svg>' });
                    else if (p.isCoinbaseWallet) wallets.push({ name: 'Coinbase', provider: p, icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="%230052FF"/><circle cx="16" cy="16" r="8" fill="white"/></svg>' });
                });
            } else {
                var name = 'Browser Wallet';
                var icon = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="%2366ffff"/></svg>';
                if (window.ethereum.isMetaMask) { name = 'MetaMask'; icon = 'https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg'; }
                else if (window.ethereum.isRabby) { name = 'Rabby'; icon = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="%238697FF"/></svg>'; }
                else if (window.ethereum.isCoinbaseWallet) { name = 'Coinbase Wallet'; icon = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="%230052FF"/><circle cx="16" cy="16" r="6" fill="white"/></svg>'; }
                else if (window.ethereum.isBraveWallet) { name = 'Brave Wallet'; icon = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="%23FB542B"/></svg>'; }
                wallets.push({ name: name, provider: window.ethereum, icon: icon });
            }
        }
        NoxStaking.Wallet.detectedWallets = wallets;
        NoxStaking.WalletModal.render(wallets);
    },

    connectByIndex: function(index) {
        var w = NoxStaking.Wallet.detectedWallets[index];
        if (w && w.provider) NoxStaking.Wallet.connectWithProvider(w.provider);
    },

    openWalletConnect: function() {
        if (window.appKit && typeof window.appKit.open === 'function') {
            window.appKit.open();
        } else {
            NoxStaking.UI.showToast('Loading WalletConnect...', 'info');
            var attempts = 0;
            var checkInterval = setInterval(function() {
                attempts++;
                if (window.appKit && typeof window.appKit.open === 'function') { clearInterval(checkInterval); window.appKit.open(); }
                else if (attempts > 20) { clearInterval(checkInterval); NoxStaking.UI.showToast('WalletConnect unavailable', 'error'); }
            }, 250);
        }
    },

    connectWithProvider: async function(walletProvider) {
        try {
            NoxStaking.UI.showToast('Connecting...');
            await walletProvider.request({ method: 'eth_requestAccounts' });
            var chainId = await walletProvider.request({ method: 'eth_chainId' });
            if (chainId !== '0x1') {
                try { await walletProvider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] }); }
                catch (e) { NoxStaking.UI.showToast('Switch to Ethereum Mainnet', 'error'); return; }
            }
            NoxStaking.Wallet.provider = new ethers.BrowserProvider(walletProvider);
            NoxStaking.Wallet.signer = await NoxStaking.Wallet.provider.getSigner();
            NoxStaking.Wallet.userAddress = await NoxStaking.Wallet.signer.getAddress();
            await NoxStaking.Wallet.onConnected();
        } catch (e) { NoxStaking.UI.showToast(e.message || 'Connection failed', 'error'); }
    },

    connectInjected: async function() {
        if (!window.ethereum) { NoxStaking.UI.showToast('No wallet detected', 'error'); return; }
        await NoxStaking.Wallet.connectWithProvider(window.ethereum);
    },

    onConnected: async function() {
        try {
            var W = NoxStaking.Wallet, C = NoxStaking.CONFIG;
            W.stakingContract = new ethers.Contract(C.STAKING_ADDRESS, NoxStaking.STAKING_ABI, W.signer);
            W.noxToken = new ethers.Contract(C.NOX_TOKEN_ADDRESS, NoxStaking.ERC20_ABI, W.signer);
            NoxStaking.UI.setDisplay('connectState', 'none');
            NoxStaking.UI.setDisplay('connectedState', 'block');
            NoxStaking.UI.updateElement('connectedAddress', W.userAddress.slice(0,6) + '...' + W.userAddress.slice(-4));
            NoxStaking.UI.showToast('Connected!', 'success');
            await NoxStaking.Staking.loadUserData();
            await NoxStaking.NFT.loadUserNFTs();
            await NoxStaking.Stats.loadGlobal();
            if (!window.userDataInterval) {
                window.userDataInterval = setInterval(function() { NoxStaking.Staking.loadUserData().catch(function(e) {}); }, 5000);
            }
        } catch (e) { NoxStaking.UI.showToast('Connection error', 'error'); }
    },

    disconnect: function() {
        if (NoxStaking.Staking.lockCountdownInterval) clearInterval(NoxStaking.Staking.lockCountdownInterval);
        NoxStaking.Wallet.provider = null;
        NoxStaking.Wallet.signer = null;
        NoxStaking.Wallet.userAddress = null;
        NoxStaking.Wallet.stakingContract = null;
        NoxStaking.Wallet.noxToken = null;
        NoxStaking.UI.setDisplay('connectState', 'block');
        NoxStaking.UI.setDisplay('connectedState', 'none');
        NoxStaking.UI.showToast('Disconnected');
    }
};

window.NoxStaking = NoxStaking;
var NoxStaking = window.NoxStaking || {};

NoxStaking.Stats = {
    loadGlobal: async function() {
        try {
            var pub = new ethers.JsonRpcProvider(NoxStaking.CONFIG.RPC_URL);
            var contract = new ethers.Contract(NoxStaking.CONFIG.STAKING_ADDRESS, NoxStaking.STAKING_ABI, pub);
            var [totalStaked, emissionRate] = await Promise.all([
                contract.totalStaked(),
                contract.getEmissionRate()
            ]);
            var staked = Number(ethers.formatEther(totalStaked));
            var rate = Number(ethers.formatEther(emissionRate));
            NoxStaking.UI.updateElement('totalStaked', NoxStaking.UI.formatNum(staked));
            if (staked > 0) {
                var yearly = rate > 0 ? rate * 31536000 : 28000000;
                var apy = (yearly / staked) * 100;
                NoxStaking.UI.updateElement('baseApy', NoxStaking.UI.formatNum(Math.min(apy, 99999)));
                NoxStaking.UI.updateElement('maxApy', NoxStaking.UI.formatNum(Math.min(apy * 6.25, 99999)));
            }
            await NoxStaking.Stats.loadTotalDistributed(pub);
            await NoxStaking.Stats.loadLockStats(pub);
        } catch (e) {}
    },

    loadTotalDistributed: async function(pub) {
        try {
            var block = await pub.getBlockNumber();
            var logs = await pub.getLogs({
                address: NoxStaking.CONFIG.STAKING_ADDRESS,
                topics: ['0xfc30cddea38e2bf4d6ea7d3f9ed3b6ad7f176419f4963bd81318067a4aee73fe'],
                fromBlock: block - 45000,
                toBlock: 'latest'
            });
            var total = 0n;
            for (var i = 0; i < logs.length; i++) total += BigInt(logs[i].data);
            NoxStaking.UI.updateElement('totalDistributed', NoxStaking.UI.formatNum(Number(ethers.formatEther(total))));
        } catch (e) {}
    },

    loadLockStats: async function(pub) {
        try {
            var block = await pub.getBlockNumber();
            var stakedV2Topic = '0xc1672060a1dfbc1402fe69eeb5023b934bfcbaabb4eafabfcd875cf591b5d378';
            var lockBuckets = { 0: 0n, 2592000: 0n, 5184000: 0n, 7776000: 0n, 15552000: 0n, 31536000: 0n };
            var chunkSize = 10000;
            var totalBlocks = 50000;

            for (var offset = 0; offset < totalBlocks; offset += chunkSize) {
                try {
                    var fromBlock = block - totalBlocks + offset;
                    var toBlock = fromBlock + chunkSize - 1;
                    if (toBlock > block) toBlock = block;

                    var logs = await pub.getLogs({
                        address: NoxStaking.CONFIG.STAKING_ADDRESS,
                        topics: [stakedV2Topic],
                        fromBlock: fromBlock,
                        toBlock: toBlock
                    });

                    for (var i = 0; i < logs.length; i++) {
                        try {
                            var decoded = ethers.AbiCoder.defaultAbiCoder().decode(['uint256', 'uint256', 'uint256', 'uint256'], logs[i].data);
                            var amount = decoded[0];
                            var lockPeriod = Number(decoded[2]);
                            var lockKey = 0;
                            if (lockPeriod >= 31536000) lockKey = 31536000;
                            else if (lockPeriod >= 15552000) lockKey = 15552000;
                            else if (lockPeriod >= 7776000) lockKey = 7776000;
                            else if (lockPeriod >= 5184000) lockKey = 5184000;
                            else if (lockPeriod >= 2592000) lockKey = 2592000;
                            lockBuckets[lockKey] += amount;
                        } catch (e) {}
                    }
                } catch (e) {}
            }

            NoxStaking.UI.updateElement('lockStat0', NoxStaking.UI.formatNum(Number(ethers.formatEther(lockBuckets[0]))));
            NoxStaking.UI.updateElement('lockStat30', NoxStaking.UI.formatNum(Number(ethers.formatEther(lockBuckets[2592000]))));
            NoxStaking.UI.updateElement('lockStat60', NoxStaking.UI.formatNum(Number(ethers.formatEther(lockBuckets[5184000]))));
            NoxStaking.UI.updateElement('lockStat90', NoxStaking.UI.formatNum(Number(ethers.formatEther(lockBuckets[7776000]))));
            NoxStaking.UI.updateElement('lockStat180', NoxStaking.UI.formatNum(Number(ethers.formatEther(lockBuckets[15552000]))));
            NoxStaking.UI.updateElement('lockStat365', NoxStaking.UI.formatNum(Number(ethers.formatEther(lockBuckets[31536000]))));
        } catch (e) {}
    }
};

window.NoxStaking = NoxStaking;
var NoxStaking = window.NoxStaking || {};

NoxStaking.Staking = {
    lockCountdownInterval: null,
    userBalance: null,
    userStaked: null,
    userAllowance: null,
    userLockEnd: null,
    earlyUnlockPenaltyBps: 0,

    loadUserData: async function() {
        var W = NoxStaking.Wallet;
        if (!W.userAddress || !W.stakingContract) return;
        try {
            var [info, balance, allowance] = await Promise.all([
                W.stakingContract.getStakeInfo(W.userAddress),
                W.noxToken.balanceOf(W.userAddress),
                W.noxToken.allowance(W.userAddress, NoxStaking.CONFIG.STAKING_ADDRESS)
            ]);
            var positions = null, penaltyBps = 0n;
            try { positions = await W.stakingContract.getUserPositions(W.userAddress); } catch(e) {}
            try { penaltyBps = await W.stakingContract.earlyUnlockPenaltyBps(); } catch(e) {}

            var staked = info[0], weighted = info[1], nfts = Number(info[2]);
            var pending = info[3], boost = Number(info[4]);
            var lockPeriod = Number(info[5]), lockEnd = Number(info[6]);
            var UI = NoxStaking.UI, S = NoxStaking.Staking;

            UI.updateElement('userStake', UI.formatNum(Number(ethers.formatEther(staked))));
            UI.updateElement('userWeighted', UI.formatNum(Number(ethers.formatEther(weighted))));
            UI.updateElement('userPending', UI.formatNum(Number(ethers.formatEther(pending))));
            UI.updateElement('userBoost', (boost / 10000).toFixed(2));
            UI.updateElement('nftCount', nfts);
            UI.updateElement('boostMultiplier', UI.getNftBoost(nfts).toFixed(2));
            UI.updateElement('walletBalance', UI.formatNum(Number(ethers.formatEther(balance))));
            UI.updateElement('stakedBalance', UI.formatNum(Number(ethers.formatEther(staked))));
            UI.updateElement('claimableRewards', UI.formatNum(Number(ethers.formatEther(pending))));

            document.querySelectorAll('.boost-tier[data-tier]').forEach(function(t) { t.classList.remove('active'); });
            var tier = document.querySelector('.boost-tier[data-tier="' + Math.min(nfts, 5) + '"]');
            if (tier) tier.classList.add('active');

            S.updateLockDisplay(lockPeriod, lockEnd);
            S.userBalance = balance; S.userStaked = staked; S.userAllowance = allowance;
            S.userLockEnd = lockEnd; S.earlyUnlockPenaltyBps = Number(penaltyBps);
            UI.updatePenaltyBanner(Number(penaltyBps));

            var hasV3 = positions && positions[0] && positions[0].length > 0;
            var hasActiveV3 = false;
            if (hasV3) { for (var i = 0; i < positions[4].length; i++) { if (positions[4][i]) { hasActiveV3 = true; break; } } }
            var stakedNum = Number(ethers.formatEther(staked));

            if (hasActiveV3) NoxStaking.Positions.render(positions);
            else if (stakedNum > 0) NoxStaking.Positions.renderV2(staked, lockPeriod, lockEnd);
            else { var c = document.getElementById('positionsContainer'); if (c) c.innerHTML = '<div class="no-positions">No active positions</div>'; }
        } catch (e) {}
    },

    updateLockDisplay: function(period, endTime) {
        var now = Math.floor(Date.now() / 1000);
        var lockStatus = document.getElementById('lockStatus');
        var lockDays = document.getElementById('lockDaysDisplay');
        var lockMult = document.getElementById('lockMultiplier');
        var unstakeBtn = document.getElementById('unstakeBtn');
        var UI = NoxStaking.UI, S = NoxStaking.Staking;
        document.querySelectorAll('.boost-tier[data-lock]').forEach(function(t) { t.classList.remove('active'); });

        if (endTime > now) {
            if (lockStatus) lockStatus.style.display = 'block';
            var boost = UI.getLockBoost(period), days = Math.ceil(period / 86400);
            if (lockMult) lockMult.textContent = boost.toFixed(2);
            if (lockDays) lockDays.textContent = days + ' Days';
            var badge = document.getElementById('lockBoostBadge');
            if (badge) badge.textContent = '+' + Math.round((boost - 1) * 100) + '%';
            if (unstakeBtn) { unstakeBtn.disabled = true; unstakeBtn.textContent = 'Locked'; }
            S.startCountdown(endTime);
            var t = document.querySelector('.boost-tier[data-lock="' + days + '"]'); if (t) t.classList.add('active');
        } else {
            if (lockStatus) lockStatus.style.display = 'none';
            if (lockMult) lockMult.textContent = '1.00';
            if (lockDays) lockDays.textContent = 'No Lock';
            if (unstakeBtn) { unstakeBtn.disabled = false; unstakeBtn.textContent = 'Unstake'; }
            var t = document.querySelector('.boost-tier[data-lock="0"]'); if (t) t.classList.add('active');
            if (S.lockCountdownInterval) clearInterval(S.lockCountdownInterval);
        }
    },

    startCountdown: function(end) {
        var S = NoxStaking.Staking;
        if (S.lockCountdownInterval) clearInterval(S.lockCountdownInterval);
        var el = document.getElementById('lockCountdown');
        if (!el) return;
        function tick() {
            var left = end - Math.floor(Date.now() / 1000);
            if (left <= 0) { el.textContent = 'Unlocked!'; clearInterval(S.lockCountdownInterval); S.loadUserData(); return; }
            el.textContent = NoxStaking.UI.formatTimeLeft(left);
        }
        tick();
        S.lockCountdownInterval = setInterval(tick, 60000);
    },

    updateLockBoostPreview: function() {
        var select = document.getElementById('lockPeriod');
        var preview = document.getElementById('lockBoostPreview');
        if (!select || !preview) return;
        preview.textContent = NoxStaking.LOCK_BOOSTS[select.value] || '';
    }
};

window.NoxStaking = NoxStaking;
var NoxStaking = window.NoxStaking || {};

NoxStaking.Positions = {
    renderV2: function(staked, lockPeriod, lockEnd) {
        var container = document.getElementById('positionsContainer');
        if (!container) return;

        var UI = NoxStaking.UI;
        var amt = Number(ethers.formatEther(staked));
        var lockDays = Math.ceil(lockPeriod / 86400);
        var now = Math.floor(Date.now() / 1000);
        var isLocked = lockEnd > now;
        var penaltyPct = NoxStaking.Staking.earlyUnlockPenaltyBps ? (NoxStaking.Staking.earlyUnlockPenaltyBps / 100).toFixed(1) : '0';

        var lockLabel = lockDays > 0 ? lockDays + ' days' : 'No lock';
        var lockBoost = UI.getLockBoost(lockPeriod);
        var timeLeft = isLocked ? UI.formatTimeLeft(lockEnd - now) : '';

        var html = '<div class="position-card position-card-v2" data-position-id="0">' +
            '<div class="position-badge">Active Position</div>' +
            '<div class="position-header">' +
            '<span class="position-id">Position #1</span>' +
            '<span class="position-lock">' + lockLabel + (lockBoost > 1 ? ' (' + lockBoost.toFixed(1) + 'x)' : '') + '</span>' +
            '</div>' +
            '<div class="position-amount">' + UI.formatNum(amt) + ' NOX</div>';

        if (isLocked) {
            html += '<div class="position-countdown"><span class="lock-icon">&#128274;</span> ' + timeLeft + ' remaining</div>';
            html += '<div class="position-actions">' +
                '<button class="position-btn position-btn-early" onclick="NoxStaking.Actions.handleEarlyUnlock(0)">' +
                'Early Exit' + (penaltyPct > 0 ? ' (-' + penaltyPct + '%)' : ' (FREE)') + '</button>' +
                '</div>';
        } else {
            html += '<div class="position-unlocked">Unlocked</div>';
            html += '<div class="position-actions">' +
                '<button class="position-btn position-btn-unstake" onclick="NoxStaking.Actions.handleUnstakePosition(0)">Unstake</button>' +
                '</div>';
        }

        html += '</div>';
        container.innerHTML = html;
    },

    render: function(positions) {
        var container = document.getElementById('positionsContainer');
        if (!container) return;

        var UI = NoxStaking.UI;
        var ids = positions[0], amounts = positions[1];
        var lockPeriods = positions[2], lockEndTimes = positions[3];
        var activeFlags = positions[4];

        var activeCount = 0;
        for (var i = 0; i < ids.length; i++) {
            if (activeFlags[i]) activeCount++;
        }

        if (activeCount === 0) {
            container.innerHTML = '<div class="no-positions">No active positions</div>';
            return;
        }

        var penaltyPct = NoxStaking.Staking.earlyUnlockPenaltyBps ? (NoxStaking.Staking.earlyUnlockPenaltyBps / 100).toFixed(1) : '0';
        var now = Math.floor(Date.now() / 1000);
        var html = '';

        for (var i = 0; i < ids.length; i++) {
            if (!activeFlags[i]) continue;

            var id = Number(ids[i]);
            var amt = Number(ethers.formatEther(amounts[i]));
            var lockDays = Math.ceil(Number(lockPeriods[i]) / 86400);
            var lockEnd = Number(lockEndTimes[i]);
            var isLocked = lockEnd > now;

            var lockLabel = lockDays > 0 ? lockDays + ' days' : 'No lock';
            var lockBoost = UI.getLockBoost(Number(lockPeriods[i]));
            var timeLeft = isLocked ? UI.formatTimeLeft(lockEnd - now) : '';

            html += '<div class="position-card" data-position-id="' + id + '">' +
                '<div class="position-header">' +
                '<span class="position-id">Position #' + (id + 1) + '</span>' +
                '<span class="position-lock">' + lockLabel + (lockBoost > 1 ? ' (' + lockBoost.toFixed(1) + 'x)' : '') + '</span>' +
                '</div>' +
                '<div class="position-amount">' + UI.formatNum(amt) + ' NOX</div>';

            if (isLocked) {
                html += '<div class="position-countdown"><span class="lock-icon">&#128274;</span> ' + timeLeft + ' remaining</div>';
                html += '<div class="position-actions">' +
                    '<button class="position-btn position-btn-early" onclick="NoxStaking.Actions.handleEarlyUnlock(' + id + ')">' +
                    'Early Exit' + (penaltyPct > 0 ? ' (-' + penaltyPct + '%)' : '') + '</button>' +
                    '</div>';
            } else {
                html += '<div class="position-unlocked">Unlocked</div>';
                html += '<div class="position-actions">' +
                    '<button class="position-btn position-btn-unstake" onclick="NoxStaking.Actions.handleUnstakePosition(' + id + ')">Unstake</button>' +
                    '</div>';
            }

            html += '</div>';
        }
        container.innerHTML = html;
    }
};

window.NoxStaking = NoxStaking;
var NoxStaking = window.NoxStaking || {};

NoxStaking.Actions = {
    handleStake: async function() {
        var amt = document.getElementById('stakeAmount').value.trim();
        if (!amt || isNaN(amt) || Number(amt) <= 0) { NoxStaking.UI.showToast('Enter amount', 'error'); return; }
        var lock = parseInt(document.getElementById('lockPeriod').value) || 0;
        var btn = document.getElementById('stakeBtn');
        btn.disabled = true; btn.textContent = 'Processing...';
        try {
            var wei = ethers.parseEther(amt);
            var S = NoxStaking.Staking;
            var W = NoxStaking.Wallet;
            if (S.userBalance < wei) throw new Error('Insufficient balance');
            if (S.userAllowance < wei) {
                NoxStaking.UI.showToast('Approving...');
                var tx = await W.noxToken.approve(NoxStaking.CONFIG.STAKING_ADDRESS, ethers.MaxUint256);
                await tx.wait();
            }
            NoxStaking.UI.showToast('Staking...');
            var tx2 = lock > 0 ? await W.stakingContract.stakeLocked(wei, lock) : await W.stakingContract.stake(wei);
            await tx2.wait();
            NoxStaking.UI.showToast('Staked ' + amt + ' NOX!', 'success');
            document.getElementById('stakeAmount').value = '';
            S.loadUserData(); NoxStaking.Stats.loadGlobal();
        } catch (e) {
            NoxStaking.UI.showToast(e.reason || e.message || 'Failed', 'error');
        } finally { btn.disabled = false; btn.textContent = 'Stake'; }
    },

    handleUnstake: async function() {
        var S = NoxStaking.Staking;
        if (S.userLockEnd && S.userLockEnd > Math.floor(Date.now() / 1000)) {
            NoxStaking.UI.showToast('Stake is locked', 'error'); return;
        }
        var amt = document.getElementById('unstakeAmount').value.trim();
        if (!amt || isNaN(amt) || Number(amt) <= 0) { NoxStaking.UI.showToast('Enter amount', 'error'); return; }
        var btn = document.getElementById('unstakeBtn');
        btn.disabled = true; btn.textContent = 'Processing...';
        try {
            var wei = ethers.parseEther(amt);
            if (S.userStaked < wei) throw new Error('Insufficient staked');
            NoxStaking.UI.showToast('Unstaking...');
            var tx = await NoxStaking.Wallet.stakingContract.unstake(wei);
            await tx.wait();
            NoxStaking.UI.showToast('Unstaked!', 'success');
            document.getElementById('unstakeAmount').value = '';
            S.loadUserData(); NoxStaking.Stats.loadGlobal();
        } catch (e) {
            NoxStaking.UI.showToast(e.reason || e.message || 'Failed', 'error');
        } finally { btn.disabled = false; btn.textContent = 'Unstake'; }
    },

    handleClaim: async function() {
        var btn = document.getElementById('claimBtn');
        btn.disabled = true; btn.textContent = 'Processing...';
        try {
            var W = NoxStaking.Wallet;
            var pending = await W.stakingContract.pendingRewards(W.userAddress);
            if (pending === 0n) { NoxStaking.UI.showToast('No rewards', 'error'); return; }
            NoxStaking.UI.showToast('Claiming...');
            var tx = await W.stakingContract.claimRewards();
            await tx.wait();
            NoxStaking.UI.showToast('Claimed!', 'success');
            NoxStaking.Staking.loadUserData(); NoxStaking.Stats.loadGlobal();
        } catch (e) {
            NoxStaking.UI.showToast(e.reason || e.message || 'Failed', 'error');
        } finally { btn.disabled = false; btn.textContent = 'Claim Rewards'; }
    },

    handleUnstakePosition: async function(positionId) {
        var W = NoxStaking.Wallet;
        if (!W.stakingContract) return;
        var card = document.querySelector('.position-card[data-position-id="' + positionId + '"]');
        var btn = card ? card.querySelector('.position-btn-unstake') : null;
        if (btn) { btn.disabled = true; btn.textContent = 'Processing...'; }
        try {
            NoxStaking.UI.showToast('Unstaking position #' + (positionId + 1) + '...');
            var tx = await W.stakingContract.unstakePosition(positionId);
            await tx.wait();
            NoxStaking.UI.showToast('Unstaked!', 'success');
            NoxStaking.Staking.loadUserData(); NoxStaking.Stats.loadGlobal();
        } catch (e) {
            NoxStaking.UI.showToast(e.reason || e.message || 'Failed', 'error');
            if (btn) { btn.disabled = false; btn.textContent = 'Unstake'; }
        }
    },

    handleEarlyUnlock: async function(positionId) {
        var W = NoxStaking.Wallet;
        var UI = NoxStaking.UI;
        if (!W.stakingContract) return;
        var card = document.querySelector('.position-card[data-position-id="' + positionId + '"]');
        var btn = card ? card.querySelector('.position-btn-early') : null;

        try {
            var pos = await W.stakingContract.getPosition(W.userAddress, positionId);
            var amount = Number(ethers.formatEther(pos[0]));
            var penaltyPct = NoxStaking.Staking.earlyUnlockPenaltyBps / 100;
            var penaltyAmount = amount * (penaltyPct / 100);
            var returnAmount = amount - penaltyAmount;

            var confirmMsg = 'Early unlock position #' + (positionId + 1) + '?\n\n' +
                'Staked: ' + UI.formatNum(amount) + ' NOX\n' +
                'Penalty (' + penaltyPct.toFixed(1) + '%): -' + UI.formatNum(penaltyAmount) + ' NOX\n' +
                'You receive: ' + UI.formatNum(returnAmount) + ' NOX';

            if (!confirm(confirmMsg)) return;

            if (btn) { btn.disabled = true; btn.textContent = 'Processing...'; }
            UI.showToast('Processing early unlock...');
            var tx = await W.stakingContract.earlyUnlock(positionId);
            await tx.wait();
            UI.showToast('Unlocked! ' + (penaltyAmount > 0 ? UI.formatNum(penaltyAmount) + ' NOX burned' : ''), 'success');
            NoxStaking.Staking.loadUserData(); NoxStaking.Stats.loadGlobal();
        } catch (e) {
            UI.showToast(e.reason || e.message || 'Failed', 'error');
            if (btn) { btn.disabled = false; btn.textContent = 'Early Exit'; }
        }
    }
};

window.NoxStaking = NoxStaking;
var NoxStaking = window.NoxStaking || {};

NoxStaking.NFT = {
    loadUserNFTs: async function() {
        var W = NoxStaking.Wallet;
        var UI = NoxStaking.UI;
        if (!W.userAddress) return;

        var section = document.getElementById('nftGallerySection');
        var gallery = document.getElementById('nftGallery');
        var countEl = document.getElementById('nftGalleryCount');

        if (!section || !gallery) return;

        section.style.display = 'block';
        gallery.innerHTML = '<div class="nft-gallery-loading">Loading NFTs...</div>';

        try {
            var url = 'https://api.reservoir.tools/users/' + W.userAddress + '/tokens/v10?collection=' + NoxStaking.CONFIG.ZEROSTATE_PASS_ADDRESS + '&limit=10';
            var response = await fetch(url);
            var data = await response.json();

            if (!data.tokens || data.tokens.length === 0) {
                if (countEl) countEl.textContent = '0';
                gallery.innerHTML = '<div class="nft-empty"><div class="nft-empty-icon">&#128302;</div><p>No Zero State Pass NFTs found</p></div>';
                return;
            }

            var count = data.tokens.length;
            if (countEl) countEl.textContent = count;

            var html = '';
            for (var i = 0; i < count; i++) {
                var token = data.tokens[i].token;
                var tid = token.tokenId;
                var name = token.name || ('Zero State Pass #' + tid);
                var imageUrl = token.image || token.imageSmall || ('https://api.reservoir.tools/redirect/tokens/' + NoxStaking.CONFIG.ZEROSTATE_PASS_ADDRESS + ':' + tid + '/image/v1');

                html += '<div class="nft-card"><div class="nft-image-container">' +
                    '<img src="' + imageUrl + '" alt="' + name + '" class="nft-image" loading="lazy" onerror="this.style.display=\'none\'"></div>' +
                    '<div class="nft-info"><span class="nft-name">' + name + '</span>' +
                    '<span class="nft-boost">+' + UI.getBoostForNftPosition(i + 1) + '% boost</span></div></div>';
            }

            gallery.innerHTML = html;
        } catch (e) {
            console.log('NFT load error:', e);
            gallery.innerHTML = '<div class="nft-error">Failed to load NFTs</div>';
        }
    }
};

window.NoxStaking = NoxStaking;
var NoxStaking = window.NoxStaking || {};

NoxStaking.init = function() {
    NoxStaking.Stats.loadGlobal();
    setInterval(NoxStaking.Stats.loadGlobal, 15000);

    document.getElementById('connectBtn').onclick = NoxStaking.Wallet.showConnectModal;
    document.getElementById('disconnectBtn').onclick = NoxStaking.Wallet.disconnect;
    document.getElementById('stakeBtn').onclick = NoxStaking.Actions.handleStake;
    document.getElementById('unstakeBtn').onclick = NoxStaking.Actions.handleUnstake;
    document.getElementById('claimBtn').onclick = NoxStaking.Actions.handleClaim;

    document.getElementById('stakeMaxBtn').onclick = function() {
        if (NoxStaking.Staking.userBalance) document.getElementById('stakeAmount').value = ethers.formatEther(NoxStaking.Staking.userBalance);
    };

    document.getElementById('unstakeMaxBtn').onclick = function() {
        if (NoxStaking.Staking.userStaked) document.getElementById('unstakeAmount').value = ethers.formatEther(NoxStaking.Staking.userStaked);
    };

    var lockSelect = document.getElementById('lockPeriod');
    if (lockSelect) {
        lockSelect.onchange = NoxStaking.Staking.updateLockBoostPreview;
        NoxStaking.Staking.updateLockBoostPreview();
    }

    window.walletReady = false;
    if (window.ethereum) {
        window.ethereum.request({ method: 'eth_accounts' }).then(function(accounts) {
            if (accounts.length > 0) {
                NoxStaking.Wallet.connectInjected().then(function() { window.walletReady = true; });
            } else {
                window.walletReady = true;
            }
        });
        window.ethereum.on('accountsChanged', function(accounts) {
            if (!window.walletReady) return;
            if (accounts.length === 0) NoxStaking.Wallet.disconnect();
            else NoxStaking.Wallet.connectInjected();
        });
        window.ethereum.on('chainChanged', function() {
            if (!window.walletReady) return;
            NoxStaking.Wallet.connectInjected();
        });
    }

    window.addEventListener('walletconnect-connected', async function(e) {
        if (e.detail && e.detail.address && !NoxStaking.Wallet.userAddress) {
            try {
                var wcProvider = window.appKit.getWalletProvider();
                if (wcProvider) {
                    NoxStaking.Wallet.provider = new ethers.BrowserProvider(wcProvider);
                    NoxStaking.Wallet.signer = await NoxStaking.Wallet.provider.getSigner();
                    NoxStaking.Wallet.userAddress = e.detail.address;
                    await NoxStaking.Wallet.onConnected();
                }
            } catch (err) {}
        }
    });
};

document.addEventListener('DOMContentLoaded', NoxStaking.init);

window.NoxStaking = NoxStaking;
