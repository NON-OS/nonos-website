var Wallet = {
    provider: null,
    signer: null,
    userAddress: null,
    stakingContract: null,
    noxToken: null,
    detectedWallets: [],

    isConnected: function() {
        return !!Wallet.userAddress;
    },

    showConnectModal: function() {
        var wallets = [];
        var hasInjected = !!(window.ethereum);

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

        Wallet.detectedWallets = wallets;
        Wallet.renderConnectModal(wallets);
    },

    renderConnectModal: function(wallets) {
        var html = '<div id="walletModal" style="position:fixed;inset:0;background:rgba(0,0,0,0.95);display:flex;align-items:center;justify-content:center;z-index:10000;animation:fadeIn 0.15s ease" onclick="if(event.target.id===\'walletModal\')this.remove()">' +
            '<style>@keyframes fadeIn{from{opacity:0}to{opacity:1}}@keyframes slideUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}</style>' +
            '<div style="background:linear-gradient(180deg,#111 0%,#0a0a0a 100%);border:1px solid #222;border-radius:24px;max-width:400px;width:94%;animation:slideUp 0.2s ease">' +
            '<div style="padding:20px 24px;border-bottom:1px solid #1a1a1a;display:flex;justify-content:space-between;align-items:center">' +
            '<span style="color:#fff;font-size:18px;font-weight:600">Connect Wallet</span>' +
            '<button onclick="document.getElementById(\'walletModal\').remove()" style="background:#1a1a1a;border:none;color:#888;width:32px;height:32px;border-radius:10px;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center">&times;</button>' +
            '</div>' +
            '<div style="padding:20px 24px">';

        if (wallets.length > 0) {
            html += '<div style="margin-bottom:20px">';
            wallets.forEach(function(w, i) {
                html += '<button onclick="document.getElementById(\'walletModal\').remove();Wallet.connectByIndex(' + i + ')" style="width:100%;padding:14px 16px;margin-bottom:8px;background:#151515;border:1px solid #2a2a2a;border-radius:14px;color:#fff;cursor:pointer;display:flex;align-items:center;gap:14px;font-size:15px">' +
                    '<img src="' + w.icon + '" style="width:40px;height:40px;border-radius:10px" onerror="this.style.background=\'#333\'">' +
                    '<div style="flex:1;text-align:left"><div style="font-weight:500">' + w.name + '</div><div style="font-size:12px;color:#66ffff">Click to connect</div></div>' +
                    '</button>';
            });
            html += '</div>';
        } else {
            html += '<div style="text-align:center;padding:30px 0;border:1px dashed #333;border-radius:16px;margin-bottom:20px">' +
                '<div style="font-size:32px;margin-bottom:12px">&#x1F98A;</div>' +
                '<div style="color:#888;font-size:14px">No wallet detected</div>' +
                '</div>';
        }

        if (window.appKit) {
            html += '<div style="border-top:1px solid #1a1a1a;padding-top:20px;margin-bottom:20px">' +
                '<button onclick="document.getElementById(\'walletModal\').remove();Wallet.openWalletConnect()" style="width:100%;padding:14px 16px;background:#151515;border:1px solid #3396ff;border-radius:14px;color:#fff;cursor:pointer;display:flex;align-items:center;gap:14px;font-size:15px">' +
                '<svg width="40" height="40" viewBox="0 0 40 40"><rect fill="#3396ff" width="40" height="40" rx="10"/><path d="M12.5 15.5c4.1-4 10.9-4 15 0l.5.5-1.8 1.8-.3-.3c-3.2-3.1-8.4-3.1-11.6 0l-.4.3-1.8-1.8.4-.5zm18.5 3.5l1.6 1.6-7.3 7.2c-2.5 2.4-6.5 2.4-9 0l-5.2-5.1 1.6-1.6 5.2 5.1c1.6 1.5 4.2 1.5 5.8 0l7.3-7.2z" fill="white"/></svg>' +
                '<div style="flex:1;text-align:left"><div style="font-weight:500">WalletConnect</div><div style="font-size:12px;color:#3396ff">Scan with mobile wallet</div></div>' +
                '</button></div>';
        }

        html += '<div style="border-top:1px solid #1a1a1a;padding-top:20px">' +
            '<div style="color:#666;font-size:12px;text-align:center;margin-bottom:14px">Open on mobile</div>' +
            '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">' +
            '<a href="https://metamask.app.link/dapp/nonos.software/staking/" style="display:flex;flex-direction:column;align-items:center;gap:8px;padding:16px 8px;background:#151515;border:1px solid #222;border-radius:14px;color:#fff;text-decoration:none;font-size:11px">' +
            '<img src="https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg" width="28" height="28">MetaMask</a>' +
            '<a href="https://go.cb-w.com/dapp?cb_url=https://nonos.software/staking/" style="display:flex;flex-direction:column;align-items:center;gap:8px;padding:16px 8px;background:#151515;border:1px solid #222;border-radius:14px;color:#fff;text-decoration:none;font-size:11px">' +
            '<svg width="28" height="28" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#0052FF"/><circle cx="16" cy="16" r="6" fill="white"/></svg>Coinbase</a>' +
            '<a href="https://link.trustwallet.com/open_url?url=https://nonos.software/staking/" style="display:flex;flex-direction:column;align-items:center;gap:8px;padding:16px 8px;background:#151515;border:1px solid #222;border-radius:14px;color:#fff;text-decoration:none;font-size:11px">' +
            '<svg width="28" height="28" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#0500FF"/><path d="M16 8l6 3.5v6c0 3.5-3 6-6 7.5-3-1.5-6-4-6-7.5v-6L16 8z" stroke="white" stroke-width="1.5" fill="none"/></svg>Trust</a>' +
            '</div></div>';

        html += '</div></div></div>';
        document.body.insertAdjacentHTML('beforeend', html);
    },

    connectByIndex: function(index) {
        var w = Wallet.detectedWallets[index];
        if (w && w.provider) {
            Wallet.connectWithProvider(w.provider);
        }
    },

    openWalletConnect: function() {
        if (window.appKit && typeof window.appKit.open === 'function') {
            window.appKit.open();
        }
    },

    connectWithProvider: async function(walletProvider) {
        try {
            UI.showToast('Connecting...');
            await walletProvider.request({ method: 'eth_requestAccounts' });
            var chainId = await walletProvider.request({ method: 'eth_chainId' });
            if (chainId !== '0x1') {
                try {
                    await walletProvider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] });
                } catch (e) {
                    UI.showToast('Switch to Ethereum Mainnet', 'error');
                    return;
                }
            }
            Wallet.provider = new ethers.BrowserProvider(walletProvider);
            Wallet.signer = await Wallet.provider.getSigner();
            Wallet.userAddress = await Wallet.signer.getAddress();
            await Wallet.onConnected();
        } catch (e) {
            UI.showToast(e.message || 'Connection failed', 'error');
        }
    },

    connectInjected: async function() {
        if (!window.ethereum) {
            UI.showToast('No wallet detected', 'error');
            return;
        }
        await Wallet.connectWithProvider(window.ethereum);
    },

    onConnected: async function() {
        try {
            Wallet.stakingContract = new ethers.Contract(CONFIG.STAKING_ADDRESS, STAKING_ABI, Wallet.signer);
            Wallet.noxToken = new ethers.Contract(CONFIG.NOX_TOKEN_ADDRESS, ERC20_ABI, Wallet.signer);

            UI.setDisplay('connectState', 'none');
            UI.setDisplay('connectedState', 'block');
            UI.updateElement('connectedAddress', Wallet.userAddress.slice(0,6) + '...' + Wallet.userAddress.slice(-4));
            UI.showToast('Connected!', 'success');

            await Staking.loadUserData();
            await NFT.loadUserNFTs();
            await Staking.loadGlobalStats();

            if (!window.userDataInterval) {
                window.userDataInterval = setInterval(function() {
                    Staking.loadUserData().catch(function(e) {});
                }, 5000);
            }
        } catch (e) {
            UI.showToast('Connection error', 'error');
        }
    },

    disconnect: function() {
        if (Staking.lockCountdownInterval) clearInterval(Staking.lockCountdownInterval);
        Wallet.provider = null;
        Wallet.signer = null;
        Wallet.userAddress = null;
        Wallet.stakingContract = null;
        Wallet.noxToken = null;
        UI.setDisplay('connectState', 'block');
        UI.setDisplay('connectedState', 'none');
        UI.showToast('Disconnected');
    }
};
