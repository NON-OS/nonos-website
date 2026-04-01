var NoxContribute = window.NoxContribute || {};

NoxContribute.formatNumber = function(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toLocaleString();
};

NoxContribute.showToast = function(msg, type) {
  var el = NoxContribute.el;
  if (!el.toast) return;
  el.toast.textContent = msg;
  el.toast.className = 'toast show ' + (type || 'info');
  setTimeout(function() { el.toast.classList.remove('show'); }, 4000);
};

NoxContribute.showLoading = function(btn) {
  if (btn) { btn.classList.add('loading'); btn.disabled = true; }
};

NoxContribute.hideLoading = function(btn) {
  if (btn) { btn.classList.remove('loading'); btn.disabled = false; }
};

NoxContribute.truncateAddress = function(addr) {
  if (!addr) return '';
  return addr.slice(0, 6) + '...' + addr.slice(-4);
};

NoxContribute.showConnectedState = function() {
  var el = NoxContribute.el;
  el.connectState.style.display = 'none';
  el.connectedState.style.display = 'flex';
  NoxContribute.updateConnectedAddress();
};

NoxContribute.showDisconnectedState = function() {
  var el = NoxContribute.el;
  el.connectState.style.display = 'block';
  el.connectedState.style.display = 'none';
  el.githubConnectState.style.display = 'block';
  el.githubConnectedState.style.display = 'none';
  el.claimActions.style.display = 'none';
  el.githubStatus.textContent = 'Not Connected';
  el.githubStatus.classList.remove('connected');
};

NoxContribute.updateConnectedAddress = function() {
  var el = NoxContribute.el;
  var state = NoxContribute.state;
  if (el.connectedAddress && state.walletAddress) {
    el.connectedAddress.textContent = NoxContribute.truncateAddress(state.walletAddress);
  }
};

NoxContribute.showGitHubConnected = function() {
  var el = NoxContribute.el;
  var state = NoxContribute.state;
  el.githubConnectState.style.display = 'none';
  el.githubConnectedState.style.display = 'block';
  el.githubStatus.textContent = 'Connected';
  el.githubStatus.classList.add('connected');
  if (state.githubUser) {
    el.githubDisplayName.textContent = state.githubUser.login;
    el.githubLinkedUsername.textContent = '@' + state.githubUser.login;
  }
};

window.NoxContribute = NoxContribute;
