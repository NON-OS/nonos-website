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
    var c = new ethers.Contract(CONFIG.REWARDS_CONTRACT, NoxContribute.V2_ABI, p);
    c.getStats().then(function(r) {
      if (el.poolBalance) el.poolBalance.textContent = NoxContribute.formatNumber(Number(r[0] / BigInt(10**18)));
      if (el.totalDistributed) el.totalDistributed.textContent = NoxContribute.formatNumber(Number(r[1] / BigInt(10**18)));
      if (el.totalContributors) el.totalContributors.textContent = Number(r[2]) + Number(r[3]) + Number(r[4]);
      if (el.contractStatus) { el.contractStatus.textContent = 'V2 LIVE'; el.contractStatus.classList.add('status-live'); }
    }).catch(function() {
      if (el.contractStatus) { el.contractStatus.textContent = 'ERROR'; el.contractStatus.classList.remove('status-live'); }
    });
  } catch (e) {}
};

window.NoxContribute = NoxContribute;
