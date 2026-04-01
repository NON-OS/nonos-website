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
