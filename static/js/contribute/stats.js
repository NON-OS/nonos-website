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

NoxContribute.loadLeaderboard = function() {
  var CONFIG = NoxContribute.CONFIG;
  var el = document.getElementById('leaderboardList');
  if (!el) return;
  fetch(CONFIG.API_URL + '/leaderboard?limit=10')
    .then(function(r) { return r.ok ? r.json() : []; })
    .then(function(data) {
      if (!data || !data.length) {
        el.innerHTML = '<div class="leaderboard-empty">No contributors yet</div>';
        return;
      }
      el.innerHTML = data.map(function(c, i) {
        var medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1);
        var badges = [];
        if (c.star) badges.push('<span class="lb-badge lb-badge-star">★</span>');
        if (c.issues > 0) badges.push('<span class="lb-badge lb-badge-issue">' + c.issues + ' issues</span>');
        if (c.prs > 0) badges.push('<span class="lb-badge lb-badge-pr">' + c.prs + ' PRs</span>');
        return '<div class="leaderboard-row">' +
          '<span class="lb-rank">' + medal + '</span>' +
          '<span class="lb-user">@' + c.username + '</span>' +
          '<span class="lb-badges">' + badges.join('') + '</span>' +
          '<span class="lb-reward">' + NoxContribute.formatNumber(c.total_nox) + ' NOX</span>' +
        '</div>';
      }).join('');
    })
    .catch(function() {
      el.innerHTML = '<div class="leaderboard-empty">Failed to load</div>';
    });
};

window.NoxContribute = NoxContribute;
