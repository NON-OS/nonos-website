document.addEventListener('DOMContentLoaded', function() {
    Staking.loadGlobalStats();
    setInterval(Staking.loadGlobalStats, 15000);

    document.getElementById('connectBtn').onclick = Wallet.showConnectModal;
    document.getElementById('disconnectBtn').onclick = Wallet.disconnect;
    document.getElementById('stakeBtn').onclick = Staking.handleStake;
    document.getElementById('unstakeBtn').onclick = Staking.handleUnstake;
    document.getElementById('claimBtn').onclick = Staking.handleClaim;

    document.getElementById('stakeMaxBtn').onclick = function() {
        if (Staking.userBalance) document.getElementById('stakeAmount').value = ethers.formatEther(Staking.userBalance);
    };

    document.getElementById('unstakeMaxBtn').onclick = function() {
        if (Staking.userStaked) document.getElementById('unstakeAmount').value = ethers.formatEther(Staking.userStaked);
    };

    var lockSelect = document.getElementById('lockPeriod');
    if (lockSelect) {
        lockSelect.onchange = Staking.updateLockBoostPreview;
        Staking.updateLockBoostPreview();
    }

    window.walletReady = false;
    if (window.ethereum) {
        window.ethereum.request({ method: 'eth_accounts' }).then(function(accounts) {
            if (accounts.length > 0) {
                Wallet.connectInjected().then(function() { window.walletReady = true; });
            } else {
                window.walletReady = true;
            }
        });
        window.ethereum.on('accountsChanged', function(accounts) {
            if (!window.walletReady) return;
            if (accounts.length === 0) Wallet.disconnect();
            else Wallet.connectInjected();
        });
        window.ethereum.on('chainChanged', function() {
            if (!window.walletReady) return;
            Wallet.connectInjected();
        });
    }

    window.addEventListener('walletconnect-connected', async function(e) {
        if (e.detail && e.detail.address && !Wallet.userAddress) {
            try {
                var wcProvider = window.appKit.getWalletProvider();
                if (wcProvider) {
                    Wallet.provider = new ethers.BrowserProvider(wcProvider);
                    Wallet.signer = await Wallet.provider.getSigner();
                    Wallet.userAddress = e.detail.address;
                    await Wallet.onConnected();
                }
            } catch (err) {}
        }
    });
});
