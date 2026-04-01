(function() {
  'use strict';

  const CONFIG = {
    API_URL: 'https://nonos.software/api',
    REPO_OWNER: 'NON-OS',
    REPO_NAME: 'nonos-kernel',
    REWARDS_CONTRACT: '0xAcb70B0F83f676ef17abEA09101B9797b6bCF95f',
    REWARDS_V1: '0xBB84284EE52cCef27FCC915ecb28bDa5DBb6809A',
    NOX_TOKEN: '0x0a26c80Be4E060e688d7C23aDdB92cBb5D2C9eCA',
    CHAIN_ID: 1,
    CHAIN_NAME: 'Ethereum Mainnet',
    RPC_URL: 'https://eth.llamarpc.com'
  };

  const V2_ABI = [
    'function claimStar(uint256 nonce, bytes32 githubHash, bytes signature) external',
    'function claimIssue(uint256 issueId, uint256 nonce, bytes32 githubHash, bytes signature) external',
    'function claimPR(uint256 prId, uint256 amount, uint256 nonce, bytes32 githubHash, bytes signature) external',
    'function hasClaimedStar(bytes32 githubHash) view returns (bool)',
    'function hasClaimedIssue(bytes32 githubHash, uint256 issueId) view returns (bool)',
    'function hasClaimedPR(bytes32 githubHash, uint256 prId) view returns (bool)',
    'function getStats() view returns (uint256 poolBalance, uint256 distributed, uint256 stars, uint256 issues, uint256 prs)',
    'function getRewards() view returns (uint256 star, uint256 issue, uint256 pr)'
  ];

  let state = { provider: null, signer: null, walletAddress: null, githubToken: null, githubUser: null, dashboard: null, claimData: null };
  const el = {};

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    cacheElements();
    bindEvents();
    loadStats();
    handleOAuthCallback();
  }

  function cacheElements() {
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
  }

  function bindEvents() {
    if (el.connectWalletBtn) el.connectWalletBtn.addEventListener('click', connectWallet);
    if (el.disconnectBtn) el.disconnectBtn.addEventListener('click', disconnectWallet);
    if (el.verifyGithubBtn) el.verifyGithubBtn.addEventListener('click', startGitHubOAuth);
    if (el.unlinkGithubBtn) el.unlinkGithubBtn.addEventListener('click', unlinkGitHub);
    if (el.claimRewardsBtn) el.claimRewardsBtn.addEventListener('click', claimStarReward);
  }

  function loadStats() {
    loadGitHubStats();
    loadContractStats();
    setInterval(loadContractStats, 30000);
  }

  async function loadGitHubStats() {
    try {
      const r = await fetch(`https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}`);
      if (r.ok) {
        const d = await r.json();
        if (el.repoStars) el.repoStars.textContent = formatNumber(d.stargazers_count);
      }
    } catch (e) {}
  }

  async function loadContractStats() {
    try {
      const r = await fetch(`${CONFIG.API_URL}/contract/stats`);
      if (r.ok) {
        const d = await r.json();
        if (d.combined) {
          if (el.poolBalance) el.poolBalance.textContent = formatNumber(d.contract.pool_balance);
          if (el.totalDistributed) el.totalDistributed.textContent = formatNumber(d.combined.total_distributed);
          if (el.totalContributors) el.totalContributors.textContent = d.combined.total_claims || 0;
        }
        if (d.rate_limits) {
          if (el.claimsToday) el.claimsToday.textContent = d.rate_limits.claims_today || 0;
        }
        if (el.contractStatus) { el.contractStatus.textContent = 'V2 LIVE'; el.contractStatus.classList.add('status-live'); }
        return;
      }
    } catch (e) {}
    loadContractStatsDirect();
  }

  async function loadContractStatsDirect() {
    try {
      const p = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
      const c = new ethers.Contract(CONFIG.REWARDS_CONTRACT, V2_ABI, p);
      const [b, d, s, i, pr] = await c.getStats();
      if (el.poolBalance) el.poolBalance.textContent = formatNumber(Number(b / BigInt(10**18)));
      if (el.totalDistributed) el.totalDistributed.textContent = formatNumber(Number(d / BigInt(10**18)));
      if (el.totalContributors) el.totalContributors.textContent = Number(s) + Number(i) + Number(pr);
      if (el.contractStatus) { el.contractStatus.textContent = 'V2 LIVE'; el.contractStatus.classList.add('status-live'); }
    } catch (e) {
      if (el.contractStatus) { el.contractStatus.textContent = 'ERROR'; el.contractStatus.classList.remove('status-live'); }
    }
  }

  function handleOAuthCallback() {
    const p = new URLSearchParams(window.location.search);
    if (p.get('oauth') === 'callback' && p.get('code')) {
      exchangeOAuthCode(p.get('code'));
      window.history.replaceState({}, '', window.location.pathname);
    }
  }

  async function exchangeOAuthCode(code) {
    try {
      showToast('Verifying GitHub...', 'info');
      const r = await fetch(`${CONFIG.API_URL}/auth/github/callback?code=${code}`);
      const d = await r.json();
      if (d.access_token) { state.githubToken = d.access_token; await loadDashboard(); }
      else throw new Error('Failed');
    } catch (e) { showToast('GitHub auth failed', 'error'); }
  }

  function startGitHubOAuth() { window.location.href = `${CONFIG.API_URL}/auth/github`; }

  async function loadDashboard() {
    if (!state.githubToken) return;
    try {
      const r = await fetch(`${CONFIG.API_URL}/dashboard?github_token=${state.githubToken}`);
      if (!r.ok) throw new Error('Failed');
      state.dashboard = await r.json();
      state.githubUser = { login: state.dashboard.username };
      showGitHubConnected();
      updateChecklist();
      updateClaimActions();
      renderApproved();
    } catch (e) { showToast('Failed to load dashboard', 'error'); }
  }

  async function connectWallet() {
    try {
      showLoading(el.connectWalletBtn);
      if (window.ethereum) {
        const a = await window.ethereum.request({ method: 'eth_requestAccounts' });
        state.provider = new ethers.BrowserProvider(window.ethereum);
        state.signer = await state.provider.getSigner();
        state.walletAddress = a[0];
        window.ethereum.on('accountsChanged', (acc) => { if (acc.length === 0) disconnectWallet(); else { state.walletAddress = acc[0]; updateConnectedAddress(); } });
        window.ethereum.on('chainChanged', () => window.location.reload());
        await checkChain();
        showConnectedState();
        updateClaimActions();
        showToast('Wallet connected', 'success');
      } else throw new Error('Install MetaMask');
    } catch (e) { showToast(e.message || 'Failed', 'error'); }
    finally { hideLoading(el.connectWalletBtn); }
  }

  async function checkChain() {
    const n = await state.provider.getNetwork();
    if (Number(n.chainId) !== CONFIG.CHAIN_ID) {
      try { await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] }); }
      catch { showToast(`Switch to ${CONFIG.CHAIN_NAME}`, 'error'); }
    }
  }

  function disconnectWallet() {
    state = { provider: null, signer: null, walletAddress: null, githubToken: null, githubUser: null, dashboard: null, claimData: null };
    showDisconnectedState();
    showToast('Disconnected', 'success');
  }

  function showConnectedState() {
    el.connectState.style.display = 'none';
    el.connectedState.style.display = 'flex';
    updateConnectedAddress();
  }

  function showDisconnectedState() {
    el.connectState.style.display = 'block';
    el.connectedState.style.display = 'none';
    el.githubConnectState.style.display = 'block';
    el.githubConnectedState.style.display = 'none';
    el.claimActions.style.display = 'none';
    el.githubStatus.textContent = 'Not Connected';
    el.githubStatus.classList.remove('connected');
  }

  function updateConnectedAddress() {
    if (el.connectedAddress && state.walletAddress) el.connectedAddress.textContent = state.walletAddress.slice(0, 6) + '...' + state.walletAddress.slice(-4);
  }

  function showGitHubConnected() {
    el.githubConnectState.style.display = 'none';
    el.githubConnectedState.style.display = 'block';
    el.githubStatus.textContent = 'Connected';
    el.githubStatus.classList.add('connected');
    if (state.githubUser) {
      el.githubDisplayName.textContent = state.githubUser.login;
      el.githubLinkedUsername.textContent = '@' + state.githubUser.login;
    }
  }

  function unlinkGitHub() {
    state.githubToken = null;
    state.githubUser = null;
    state.dashboard = null;
    el.githubConnectState.style.display = 'block';
    el.githubConnectedState.style.display = 'none';
    el.githubStatus.textContent = 'Not Connected';
    el.githubStatus.classList.remove('connected');
    el.claimActions.style.display = 'none';
  }

  function updateChecklist() {
    if (!state.dashboard) return;
    const d = state.dashboard;
    setCheckItem(el.checkStar, d.star.eligible, d.star.eligible ? 'Starred' : 'Not starred', el.starStatus);
    setCheckItem(el.checkIssues, d.issues.approved > 0, `${d.issues.approved} approved`, el.issueStatus);
    setCheckItem(el.checkPRs, d.prs.approved > 0, `${d.prs.approved} approved`, el.prStatus);
    if (el.issueReward) el.issueReward.textContent = `${formatNumber(d.rewards.issue)} NOX`;
    if (el.prReward) el.prReward.textContent = `${formatNumber(d.rewards.pr_default)}+ NOX`;
  }

  function setCheckItem(e, done, status, sEl) {
    if (!e) return;
    const i = e.querySelector('.checklist-icon');
    if (i) { i.textContent = done ? '✓' : '○'; i.classList.toggle('completed', done); i.classList.toggle('pending', !done); }
    if (sEl) sEl.textContent = status;
  }

  function updateClaimActions() {
    if (!state.dashboard) return;
    const d = state.dashboard;
    let total = 0;
    if (d.star.eligible) total += d.rewards.star;
    d.issues.approved_list.filter(i => !i.claimed).forEach(i => total += (i.reward || d.rewards.issue * 10**18) / 10**18);
    d.prs.approved_list.filter(p => !p.claimed).forEach(p => total += (p.reward || d.rewards.pr_default * 10**18) / 10**18);
    if (el.availableRewards) el.availableRewards.textContent = formatNumber(total);
    if (total > 0 && state.walletAddress) {
      el.claimActions.style.display = 'block';
      el.claimableAmount.textContent = formatNumber(total);
      el.claimRewardsBtn.disabled = false;
    } else if (total > 0) {
      el.claimActions.style.display = 'block';
      el.claimableAmount.textContent = formatNumber(total);
      el.claimRewardsBtn.disabled = true;
    } else {
      el.claimActions.style.display = 'none';
    }
  }

  function renderApproved() {
    if (!state.dashboard || !el.approvedList) return;
    const d = state.dashboard;
    el.approvedList.innerHTML = '';
    const items = [];
    d.issues.approved_list.filter(i => !i.claimed).forEach(i => items.push({ type: 'issue', id: i.issue_number, title: i.issue_title, reward: i.reward / 10**18 }));
    d.prs.approved_list.filter(p => !p.claimed).forEach(p => items.push({ type: 'pr', id: p.pr_number, title: p.pr_title, reward: p.reward / 10**18 }));
    if (items.length === 0 && !d.star.eligible) {
      if (el.approvedSection) el.approvedSection.style.display = 'none';
      return;
    }
    if (el.approvedSection) el.approvedSection.style.display = 'block';
    if (d.star.eligible) {
      const div = document.createElement('div');
      div.className = 'approved-item';
      div.innerHTML = `<span class="item-type star">STAR</span><span class="item-title">Repository Star</span><span class="item-reward">${formatNumber(d.rewards.star)} NOX</span><button class="claim-btn" data-type="star">Claim</button>`;
      div.querySelector('.claim-btn').addEventListener('click', claimStarReward);
      el.approvedList.appendChild(div);
    }
    items.forEach(item => {
      const div = document.createElement('div');
      div.className = 'approved-item';
      div.innerHTML = `<span class="item-type ${item.type}">${item.type.toUpperCase()}</span><span class="item-title">#${item.id} ${item.title || ''}</span><span class="item-reward">${formatNumber(item.reward)} NOX</span><button class="claim-btn" data-type="${item.type}" data-id="${item.id}">Claim</button>`;
      div.querySelector('.claim-btn').addEventListener('click', (e) => claimItem(item.type, item.id));
      el.approvedList.appendChild(div);
    });
  }

  async function claimStarReward() {
    if (!state.walletAddress || !state.dashboard?.star?.eligible) { showToast('Connect wallet and verify eligibility', 'error'); return; }
    try {
      showLoading(el.claimRewardsBtn);
      const r = await fetch(`${CONFIG.API_URL}/claim/star`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet_address: state.walletAddress, github_token: state.githubToken })
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.detail || 'Failed'); }
      const data = await r.json();
      await submitStarClaim(data);
    } catch (e) { showToast(e.message || 'Failed', 'error'); }
    finally { hideLoading(el.claimRewardsBtn); }
  }

  async function submitStarClaim(data) {
    if (!state.signer) throw new Error('Connect wallet');
    const { nonce, github_hash, signature } = data;
    showToast('Confirm in wallet...', 'info');
    const c = new ethers.Contract(CONFIG.REWARDS_CONTRACT, V2_ABI, state.signer);
    const tx = await c.claimStar(nonce, github_hash, signature);
    showToast('Transaction submitted...', 'info');
    const receipt = await tx.wait();
    if (receipt.status === 1) {
      state.dashboard.star.eligible = false;
      updateClaimActions();
      renderApproved();
      loadContractStats();
      showToast('Claimed 5,000 NOX!', 'success');
    } else throw new Error('Transaction failed');
  }

  async function claimItem(type, id) {
    if (!state.walletAddress) { showToast('Connect wallet first', 'error'); return; }
    try {
      showToast(`Claiming ${type} #${id}...`, 'info');
      const r = await fetch(`${CONFIG.API_URL}/claim/${type}/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet_address: state.walletAddress, github_token: state.githubToken })
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.detail || 'Failed'); }
      const data = await r.json();
      if (type === 'issue') await submitIssueClaim(data, id);
      else await submitPRClaim(data, id);
    } catch (e) { showToast(e.message || 'Failed', 'error'); }
  }

  async function submitIssueClaim(data, issueId) {
    if (!state.signer) throw new Error('Connect wallet');
    const { nonce, github_hash, signature } = data;
    showToast('Confirm in wallet...', 'info');
    const c = new ethers.Contract(CONFIG.REWARDS_CONTRACT, V2_ABI, state.signer);
    const tx = await c.claimIssue(issueId, nonce, github_hash, signature);
    showToast('Transaction submitted...', 'info');
    const receipt = await tx.wait();
    if (receipt.status === 1) {
      await loadDashboard();
      loadContractStats();
      showToast(`Claimed issue #${issueId} reward!`, 'success');
    } else throw new Error('Transaction failed');
  }

  async function submitPRClaim(data, prId) {
    if (!state.signer) throw new Error('Connect wallet');
    const { amount, nonce, github_hash, signature } = data;
    showToast('Confirm in wallet...', 'info');
    const c = new ethers.Contract(CONFIG.REWARDS_CONTRACT, V2_ABI, state.signer);
    const tx = await c.claimPR(prId, amount, nonce, github_hash, signature);
    showToast('Transaction submitted...', 'info');
    const receipt = await tx.wait();
    if (receipt.status === 1) {
      await loadDashboard();
      loadContractStats();
      showToast(`Claimed PR #${prId} reward!`, 'success');
    } else throw new Error('Transaction failed');
  }

  function formatNumber(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toLocaleString();
  }

  function showToast(msg, type = 'info') {
    if (!el.toast) return;
    el.toast.textContent = msg;
    el.toast.className = 'toast show ' + type;
    setTimeout(() => el.toast.classList.remove('show'), 4000);
  }

  function showLoading(b) { if (b) { b.classList.add('loading'); b.disabled = true; } }
  function hideLoading(b) { if (b) { b.classList.remove('loading'); b.disabled = false; } }
})();
