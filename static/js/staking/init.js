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
