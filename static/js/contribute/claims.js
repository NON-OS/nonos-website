var NoxContribute = window.NoxContribute || {};

NoxContribute.updateChecklist = function() {
  var state = NoxContribute.state;
  var el = NoxContribute.el;
  if (!state.dashboard) return;
  var d = state.dashboard;
  NoxContribute.setCheckItem(el.checkStar, d.star.eligible, d.star.eligible ? 'Starred' : 'Not starred', el.starStatus);
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
  var total = 0;
  if (d.star.eligible) total += d.rewards.star;
  d.issues.approved_list.filter(function(i) { return !i.claimed; }).forEach(function(i) { total += (i.reward || d.rewards.issue * 1e18) / 1e18; });
  d.prs.approved_list.filter(function(p) { return !p.claimed; }).forEach(function(p) { total += (p.reward || d.rewards.pr_default * 1e18) / 1e18; });
  if (el.availableRewards) el.availableRewards.textContent = NoxContribute.formatNumber(total);
  if (total > 0 && state.walletAddress) {
    el.claimActions.style.display = 'block';
    el.claimableAmount.textContent = NoxContribute.formatNumber(total);
    el.claimRewardsBtn.disabled = false;
  } else if (total > 0) {
    el.claimActions.style.display = 'block';
    el.claimableAmount.textContent = NoxContribute.formatNumber(total);
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
