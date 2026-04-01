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
