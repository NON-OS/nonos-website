var NoxContribute = window.NoxContribute || {};

NoxContribute.CONFIG = {
  API_URL: 'https://nonos.software/api',
  REPO_OWNER: 'NON-OS',
  REPO_NAME: 'nonos-kernel',
  REWARDS_CONTRACT: '0xAcb70B0F83f676ef17abEA09101B9797b6bCF95f',
  REWARDS_V1: '0xBB84284EE52cCef27FCC915ecb28bDa5DBb6809A',
  NOX_TOKEN: '0x0a26c80Be4E060e688d7C23aDdB92cBb5D2C9eCA',
  CHAIN_ID: 1,
  CHAIN_NAME: 'Ethereum Mainnet',
  RPC_URL: 'https://1rpc.io/eth'
};

NoxContribute.V1_ABI = [
  'function getStats() view returns (uint256 balance, uint256 distributed, uint256 claimants, bytes32 currentRoot)'
];

NoxContribute.V2_ABI = [
  'function claimStar(uint256 nonce, bytes32 githubHash, bytes signature) external',
  'function claimIssue(uint256 issueId, uint256 nonce, bytes32 githubHash, bytes signature) external',
  'function claimPR(uint256 prId, uint256 amount, uint256 nonce, bytes32 githubHash, bytes signature) external',
  'function hasClaimedStar(bytes32 githubHash) view returns (bool)',
  'function hasClaimedIssue(bytes32 githubHash, uint256 issueId) view returns (bool)',
  'function hasClaimedPR(bytes32 githubHash, uint256 prId) view returns (bool)',
  'function getStats() view returns (uint256 poolBalance, uint256 distributed, uint256 stars, uint256 issues, uint256 prs)',
  'function getRewards() view returns (uint256 star, uint256 issue, uint256 pr)'
];

window.NoxContribute = NoxContribute;
var NoxContribute = window.NoxContribute || {};

NoxContribute.state = {
  provider: null,
  signer: null,
  walletAddress: null,
  githubToken: null,
  githubUser: null,
  dashboard: null,
  claimData: null
};

NoxContribute.el = {};

NoxContribute.resetState = function() {
  NoxContribute.state = {
    provider: null,
    signer: null,
    walletAddress: null,
    githubToken: null,
    githubUser: null,
    dashboard: null,
    claimData: null
  };
};

window.NoxContribute = NoxContribute;
var NoxContribute = window.NoxContribute || {};

NoxContribute.cacheElements = function() {
  var el = NoxContribute.el;
  el.poolBalance = document.getElementById('poolBalance');
  el.totalContributors = document.getElementById('totalContributors');
  el.totalDistributed = document.getElementById('totalDistributed');
  el.repoStars = document.getElementById('repoStars');
  el.claimsToday = document.getElementById('claimsToday');
  el.claimRate = document.getElementById('claimRate');
  el.contractStatus = document.getElementById('contractStatus');
  el.connectState = document.getElementById('connectState');
  el.connectWalletBtn = document.getElementById('connectWalletBtn');
  el.connectedState = document.getElementById('connectedState');
  el.connectedAddress = document.getElementById('connectedAddress');
  el.disconnectBtn = document.getElementById('disconnectBtn');
  el.availableRewards = document.getElementById('availableRewards');
  el.totalEarned = document.getElementById('totalEarned');
  el.contributionCount = document.getElementById('contributionCount');
  el.githubStatus = document.getElementById('githubStatus');
  el.githubConnectState = document.getElementById('githubConnectState');
  el.githubConnectedState = document.getElementById('githubConnectedState');
  el.githubUsername = document.getElementById('githubUsername');
  el.verifyGithubBtn = document.getElementById('verifyGithubBtn');
  el.githubAvatar = document.getElementById('githubAvatar');
  el.githubDisplayName = document.getElementById('githubDisplayName');
  el.githubLinkedUsername = document.getElementById('githubLinkedUsername');
  el.unlinkGithubBtn = document.getElementById('unlinkGithubBtn');
  el.checkStar = document.getElementById('checkStar');
  el.starStatus = document.getElementById('starStatus');
  el.checkIssues = document.getElementById('checkIssues');
  el.issueStatus = document.getElementById('issueStatus');
  el.issueReward = document.getElementById('issueReward');
  el.checkPRs = document.getElementById('checkPRs');
  el.prStatus = document.getElementById('prStatus');
  el.prReward = document.getElementById('prReward');
  el.claimActions = document.getElementById('claimActions');
  el.claimableAmount = document.getElementById('claimableAmount');
  el.claimRewardsBtn = document.getElementById('claimRewardsBtn');
  el.pendingSection = document.getElementById('pendingSection');
  el.pendingList = document.getElementById('pendingList');
  el.approvedSection = document.getElementById('approvedSection');
  el.approvedList = document.getElementById('approvedList');
  el.toast = document.getElementById('toast');
};

window.NoxContribute = NoxContribute;
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
var NoxContribute = window.NoxContribute || {};

NoxContribute.loadGitHubStats = function() {
  var CONFIG = NoxContribute.CONFIG;
  var el = NoxContribute.el;
  fetch('https://api.github.com/repos/' + CONFIG.REPO_OWNER + '/' + CONFIG.REPO_NAME)
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(d) {
      if (d && el.repoStars) el.repoStars.textContent = NoxContribute.formatNumber(d.stargazers_count);
    })
    .catch(function() {});
};

NoxContribute.loadContractStats = function() {
  var CONFIG = NoxContribute.CONFIG;
  var el = NoxContribute.el;
  fetch(CONFIG.API_URL + '/contract/stats')
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(d) {
      if (!d) return NoxContribute.loadContractStatsDirect();
      if (d.combined) {
        if (el.poolBalance) el.poolBalance.textContent = NoxContribute.formatNumber(d.contract.pool_balance);
        if (el.totalDistributed) el.totalDistributed.textContent = NoxContribute.formatNumber(d.combined.total_distributed);
        if (el.totalContributors) el.totalContributors.textContent = d.combined.total_claims || 0;
      }
      if (d.rate_limits && el.claimsToday) el.claimsToday.textContent = d.rate_limits.claims_today || 0;
      if (el.contractStatus) { el.contractStatus.textContent = 'V2 LIVE'; el.contractStatus.classList.add('status-live'); }
    })
    .catch(function() { NoxContribute.loadContractStatsDirect(); });
};

NoxContribute.loadContractStatsDirect = function() {
  var CONFIG = NoxContribute.CONFIG;
  var el = NoxContribute.el;
  try {
    var p = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
    var v1 = new ethers.Contract(CONFIG.REWARDS_V1, NoxContribute.V1_ABI, p);
    var v2 = new ethers.Contract(CONFIG.REWARDS_CONTRACT, NoxContribute.V2_ABI, p);
    Promise.all([v1.getStats(), v2.getStats()]).then(function(results) {
      var v1Stats = results[0];
      var v2Stats = results[1];
      var v1Distributed = Number(v1Stats[1] / BigInt(10**18));
      var v1Claimants = Number(v1Stats[2]);
      var v2Pool = Number(v2Stats[0] / BigInt(10**18));
      var v2Distributed = Number(v2Stats[1] / BigInt(10**18));
      var v2Claims = Number(v2Stats[2]) + Number(v2Stats[3]) + Number(v2Stats[4]);
      if (el.poolBalance) el.poolBalance.textContent = NoxContribute.formatNumber(v2Pool);
      if (el.totalDistributed) el.totalDistributed.textContent = NoxContribute.formatNumber(v1Distributed + v2Distributed);
      if (el.totalContributors) el.totalContributors.textContent = v1Claimants + v2Claims;
      if (el.contractStatus) { el.contractStatus.textContent = 'V2 LIVE'; el.contractStatus.classList.add('status-live'); }
    }).catch(function() {
      if (el.contractStatus) { el.contractStatus.textContent = 'ERROR'; el.contractStatus.classList.remove('status-live'); }
    });
  } catch (e) {}
};

window.NoxContribute = NoxContribute;
var NoxContribute = window.NoxContribute || {};

NoxContribute.handleOAuthCallback = function() {
  var p = new URLSearchParams(window.location.search);
  if (p.get('oauth') === 'callback' && p.get('code')) {
    NoxContribute.exchangeOAuthCode(p.get('code'));
    window.history.replaceState({}, '', window.location.pathname);
  }
};

NoxContribute.exchangeOAuthCode = function(code) {
  var CONFIG = NoxContribute.CONFIG;
  var state = NoxContribute.state;
  NoxContribute.showToast('Verifying GitHub...', 'info');
  fetch(CONFIG.API_URL + '/auth/github/callback?code=' + code)
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.access_token) {
        state.githubToken = d.access_token;
        return NoxContribute.loadDashboard();
      }
      throw new Error('Failed');
    })
    .catch(function() { NoxContribute.showToast('GitHub auth failed', 'error'); });
};

NoxContribute.startGitHubOAuth = function() {
  window.location.href = NoxContribute.CONFIG.API_URL + '/auth/github';
};

NoxContribute.loadDashboard = function() {
  var CONFIG = NoxContribute.CONFIG;
  var state = NoxContribute.state;
  if (!state.githubToken) return Promise.resolve();
  return fetch(CONFIG.API_URL + '/dashboard?github_token=' + state.githubToken)
    .then(function(r) { if (!r.ok) throw new Error('Failed'); return r.json(); })
    .then(function(d) {
      state.dashboard = d;
      state.githubUser = { login: d.username };
      NoxContribute.showGitHubConnected();
      NoxContribute.updateChecklist();
      NoxContribute.updateClaimActions();
      NoxContribute.renderApproved();
    })
    .catch(function() { NoxContribute.showToast('Failed to load dashboard', 'error'); });
};

NoxContribute.unlinkGitHub = function() {
  var state = NoxContribute.state;
  var el = NoxContribute.el;
  state.githubToken = null;
  state.githubUser = null;
  state.dashboard = null;
  el.githubConnectState.style.display = 'block';
  el.githubConnectedState.style.display = 'none';
  el.githubStatus.textContent = 'Not Connected';
  el.githubStatus.classList.remove('connected');
  el.claimActions.style.display = 'none';
};

window.NoxContribute = NoxContribute;
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
var NoxContribute = window.NoxContribute || {};

NoxContribute.claimStarReward = function() {
  var state = NoxContribute.state;
  var el = NoxContribute.el;
  var CONFIG = NoxContribute.CONFIG;
  if (!state.walletAddress || !state.dashboard || !state.dashboard.star.eligible) {
    NoxContribute.showToast('Connect wallet and verify eligibility', 'error');
    return;
  }
  NoxContribute.showLoading(el.claimRewardsBtn);
  fetch(CONFIG.API_URL + '/claim/star', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallet_address: state.walletAddress, github_token: state.githubToken })
  })
  .then(function(r) { if (!r.ok) return r.json().then(function(e) { throw new Error(e.detail || 'Failed'); }); return r.json(); })
  .then(function(data) { return NoxContribute.submitStarClaim(data); })
  .catch(function(e) { NoxContribute.showToast(e.message || 'Failed', 'error'); })
  .finally(function() { NoxContribute.hideLoading(el.claimRewardsBtn); });
};

NoxContribute.submitStarClaim = function(data) {
  var state = NoxContribute.state;
  var CONFIG = NoxContribute.CONFIG;
  if (!state.signer) throw new Error('Connect wallet');
  NoxContribute.showToast('Confirm in wallet...', 'info');
  var c = new ethers.Contract(CONFIG.REWARDS_CONTRACT, NoxContribute.V2_ABI, state.signer);
  return c.claimStar(data.nonce, data.github_hash, data.signature)
    .then(function(tx) { NoxContribute.showToast('Transaction submitted...', 'info'); return tx.wait(); })
    .then(function(receipt) {
      if (receipt.status === 1) {
        state.dashboard.star.eligible = false;
        NoxContribute.updateClaimActions();
        NoxContribute.renderApproved();
        NoxContribute.loadContractStats();
        NoxContribute.showToast('Claimed 5,000 NOX!', 'success');
      } else throw new Error('Transaction failed');
    });
};

NoxContribute.claimItem = function(type, id) {
  var state = NoxContribute.state;
  var CONFIG = NoxContribute.CONFIG;
  if (!state.walletAddress) { NoxContribute.showToast('Connect wallet first', 'error'); return; }
  NoxContribute.showToast('Claiming ' + type + ' #' + id + '...', 'info');
  fetch(CONFIG.API_URL + '/claim/' + type + '/' + id, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallet_address: state.walletAddress, github_token: state.githubToken })
  })
  .then(function(r) { if (!r.ok) return r.json().then(function(e) { throw new Error(e.detail || 'Failed'); }); return r.json(); })
  .then(function(data) { return type === 'issue' ? NoxContribute.submitIssueClaim(data, id) : NoxContribute.submitPRClaim(data, id); })
  .catch(function(e) { NoxContribute.showToast(e.message || 'Failed', 'error'); });
};

NoxContribute.submitIssueClaim = function(data, issueId) {
  var state = NoxContribute.state;
  var CONFIG = NoxContribute.CONFIG;
  if (!state.signer) throw new Error('Connect wallet');
  NoxContribute.showToast('Confirm in wallet...', 'info');
  var c = new ethers.Contract(CONFIG.REWARDS_CONTRACT, NoxContribute.V2_ABI, state.signer);
  return c.claimIssue(issueId, data.nonce, data.github_hash, data.signature)
    .then(function(tx) { NoxContribute.showToast('Transaction submitted...', 'info'); return tx.wait(); })
    .then(function(receipt) {
      if (receipt.status === 1) { NoxContribute.loadDashboard(); NoxContribute.loadContractStats(); NoxContribute.showToast('Claimed issue reward!', 'success'); }
      else throw new Error('Transaction failed');
    });
};

NoxContribute.submitPRClaim = function(data, prId) {
  var state = NoxContribute.state;
  var CONFIG = NoxContribute.CONFIG;
  if (!state.signer) throw new Error('Connect wallet');
  NoxContribute.showToast('Confirm in wallet...', 'info');
  var c = new ethers.Contract(CONFIG.REWARDS_CONTRACT, NoxContribute.V2_ABI, state.signer);
  return c.claimPR(prId, data.amount, data.nonce, data.github_hash, data.signature)
    .then(function(tx) { NoxContribute.showToast('Transaction submitted...', 'info'); return tx.wait(); })
    .then(function(receipt) {
      if (receipt.status === 1) { NoxContribute.loadDashboard(); NoxContribute.loadContractStats(); NoxContribute.showToast('Claimed PR reward!', 'success'); }
      else throw new Error('Transaction failed');
    });
};

window.NoxContribute = NoxContribute;
var NoxContribute = window.NoxContribute || {};

NoxContribute.updateChecklist = function() {
  var state = NoxContribute.state;
  var el = NoxContribute.el;
  if (!state.dashboard) return;
  var d = state.dashboard;
  // Star status: claimed > eligible > not starred
  var starDone = d.star.claimed || d.star.eligible;
  var starText = d.star.claimed ? 'Claimed' : (d.star.eligible ? 'Starred' : 'Not starred');
  NoxContribute.setCheckItem(el.checkStar, starDone, starText, el.starStatus);
  NoxContribute.setCheckItem(el.checkIssues, d.issues.approved > 0, d.issues.approved + ' approved', el.issueStatus);
  NoxContribute.setCheckItem(el.checkPRs, d.prs.approved > 0, d.prs.approved + ' approved', el.prStatus);
  if (el.issueReward) el.issueReward.textContent = NoxContribute.formatNumber(d.rewards.issue) + ' NOX';
  if (el.prReward) el.prReward.textContent = NoxContribute.formatNumber(d.rewards.pr_default) + '+ NOX';
};

NoxContribute.setCheckItem = function(e, done, status, sEl) {
  if (!e) return;
  var i = e.querySelector('.checklist-icon');
  if (i) { i.textContent = done ? '\u2713' : '\u25CB'; i.classList.toggle('completed', done); i.classList.toggle('pending', !done); }
  if (sEl) sEl.textContent = status;
};

NoxContribute.updateClaimActions = function() {
  var state = NoxContribute.state;
  var el = NoxContribute.el;
  if (!state.dashboard) return;
  var d = state.dashboard;

  // Calculate available to claim (unclaimed rewards)
  var available = 0;
  if (d.star.eligible) available += d.rewards.star;
  d.issues.approved_list.filter(function(i) { return !i.claimed; }).forEach(function(i) { available += (i.reward || d.rewards.issue * 1e18) / 1e18; });
  d.prs.approved_list.filter(function(p) { return !p.claimed; }).forEach(function(p) { available += (p.reward || d.rewards.pr_default * 1e18) / 1e18; });

  // Calculate total earned (claimed rewards)
  var earned = 0;
  var contributions = 0;
  if (d.star.claimed) { earned += d.rewards.star; contributions++; }
  d.issues.approved_list.filter(function(i) { return i.claimed; }).forEach(function(i) { earned += (i.reward || d.rewards.issue * 1e18) / 1e18; contributions++; });
  d.prs.approved_list.filter(function(p) { return p.claimed; }).forEach(function(p) { earned += (p.reward || d.rewards.pr_default * 1e18) / 1e18; contributions++; });

  // Update UI
  if (el.availableRewards) el.availableRewards.textContent = NoxContribute.formatNumber(available);
  if (el.totalEarned) el.totalEarned.textContent = NoxContribute.formatNumber(earned);
  if (el.contributionCount) el.contributionCount.textContent = contributions;

  if (available > 0 && state.walletAddress) {
    el.claimActions.style.display = 'block';
    el.claimableAmount.textContent = NoxContribute.formatNumber(available);
    el.claimRewardsBtn.disabled = false;
  } else if (available > 0) {
    el.claimActions.style.display = 'block';
    el.claimableAmount.textContent = NoxContribute.formatNumber(available);
    el.claimRewardsBtn.disabled = true;
  } else {
    el.claimActions.style.display = 'none';
  }
};

NoxContribute.renderApproved = function() {
  var state = NoxContribute.state;
  var el = NoxContribute.el;
  if (!state.dashboard || !el.approvedList) return;
  var d = state.dashboard;
  el.approvedList.innerHTML = '';
  var items = [];
  d.issues.approved_list.filter(function(i) { return !i.claimed; }).forEach(function(i) { items.push({ type: 'issue', id: i.issue_number, title: i.issue_title, reward: i.reward / 1e18 }); });
  d.prs.approved_list.filter(function(p) { return !p.claimed; }).forEach(function(p) { items.push({ type: 'pr', id: p.pr_number, title: p.pr_title, reward: p.reward / 1e18 }); });
  if (items.length === 0 && !d.star.eligible) { if (el.approvedSection) el.approvedSection.style.display = 'none'; return; }
  if (el.approvedSection) el.approvedSection.style.display = 'block';
  if (d.star.eligible) {
    var div = document.createElement('div');
    div.className = 'approved-item';
    div.innerHTML = '<span class="item-type star">STAR</span><span class="item-title">Repository Star</span><span class="item-reward">' + NoxContribute.formatNumber(d.rewards.star) + ' NOX</span><button class="claim-btn" data-type="star">Claim</button>';
    div.querySelector('.claim-btn').addEventListener('click', NoxContribute.claimStarReward);
    el.approvedList.appendChild(div);
  }
  items.forEach(function(item) {
    var div = document.createElement('div');
    div.className = 'approved-item';
    div.innerHTML = '<span class="item-type ' + item.type + '">' + item.type.toUpperCase() + '</span><span class="item-title">#' + item.id + ' ' + (item.title || '') + '</span><span class="item-reward">' + NoxContribute.formatNumber(item.reward) + ' NOX</span><button class="claim-btn" data-type="' + item.type + '" data-id="' + item.id + '">Claim</button>';
    div.querySelector('.claim-btn').addEventListener('click', function() { NoxContribute.claimItem(item.type, item.id); });
    el.approvedList.appendChild(div);
  });
};

window.NoxContribute = NoxContribute;
var NoxContribute = window.NoxContribute || {};

NoxContribute.init = function() {
  NoxContribute.cacheElements();
  NoxContribute.bindEvents();
  NoxContribute.loadStats();
  NoxContribute.handleOAuthCallback();
};

NoxContribute.bindEvents = function() {
  var el = NoxContribute.el;
  if (el.connectWalletBtn) el.connectWalletBtn.addEventListener('click', NoxContribute.connectWallet);
  if (el.disconnectBtn) el.disconnectBtn.addEventListener('click', NoxContribute.disconnectWallet);
  if (el.verifyGithubBtn) el.verifyGithubBtn.addEventListener('click', NoxContribute.startGitHubOAuth);
  if (el.unlinkGithubBtn) el.unlinkGithubBtn.addEventListener('click', NoxContribute.unlinkGitHub);
  if (el.claimRewardsBtn) el.claimRewardsBtn.addEventListener('click', NoxContribute.claimStarReward);
};

NoxContribute.loadStats = function() {
  NoxContribute.loadGitHubStats();
  NoxContribute.loadContractStats();
  setInterval(NoxContribute.loadContractStats, 30000);
};

document.addEventListener('DOMContentLoaded', NoxContribute.init);

window.NoxContribute = NoxContribute;
