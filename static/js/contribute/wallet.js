var NoxContribute = window.NoxContribute || {};

NoxContribute.connectWallet = function() {
  var state = NoxContribute.state;
  var el = NoxContribute.el;
  var CONFIG = NoxContribute.CONFIG;
  NoxContribute.showLoading(el.connectWalletBtn);
  if (!window.ethereum) {
    NoxContribute.showToast('Install MetaMask', 'error');
    NoxContribute.hideLoading(el.connectWalletBtn);
    return;
  }
  window.ethereum.request({ method: 'eth_requestAccounts' })
    .then(function(accounts) {
      state.provider = new ethers.BrowserProvider(window.ethereum);
      return state.provider.getSigner().then(function(signer) {
        state.signer = signer;
        state.walletAddress = accounts[0];
        window.ethereum.on('accountsChanged', NoxContribute.handleAccountsChanged);
        window.ethereum.on('chainChanged', function() { window.location.reload(); });
        return NoxContribute.checkChain();
      });
    })
    .then(function() {
      NoxContribute.showConnectedState();
      NoxContribute.updateClaimActions();
      NoxContribute.showToast('Wallet connected', 'success');
    })
    .catch(function(e) {
      NoxContribute.showToast(e.message || 'Failed', 'error');
    })
    .finally(function() {
      NoxContribute.hideLoading(el.connectWalletBtn);
    });
};

NoxContribute.checkChain = function() {
  var state = NoxContribute.state;
  var CONFIG = NoxContribute.CONFIG;
  return state.provider.getNetwork().then(function(n) {
    if (Number(n.chainId) !== CONFIG.CHAIN_ID) {
      return window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] })
        .catch(function() { NoxContribute.showToast('Switch to ' + CONFIG.CHAIN_NAME, 'error'); });
    }
  });
};

NoxContribute.handleAccountsChanged = function(accounts) {
  if (accounts.length === 0) NoxContribute.disconnectWallet();
  else { NoxContribute.state.walletAddress = accounts[0]; NoxContribute.updateConnectedAddress(); }
};

NoxContribute.disconnectWallet = function() {
  NoxContribute.resetState();
  NoxContribute.showDisconnectedState();
  NoxContribute.showToast('Disconnected', 'success');
};

window.NoxContribute = NoxContribute;
