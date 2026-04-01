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
