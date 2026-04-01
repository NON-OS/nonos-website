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
