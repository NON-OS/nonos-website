const API_URL = 'https://nonos.software/api';
let authKey = '';
let allIssues = [];
let allPRs = [];
let allContributors = [];
let allClaims = [];
let approvedItems = { issues: [], prs: [] };
let currentFilters = { issues: 'open', prs: 'open', claimsType: 'all', claimsStatus: 'all' };

// Auth
function authenticate() {
  authKey = document.getElementById('adminKey').value;
  if (!authKey) return showToast('Enter API key', 'error');
  document.getElementById('authSection').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');
  loadAll();
  setupTabs();
}

function logout() {
  authKey = '';
  document.getElementById('authSection').classList.remove('hidden');
  document.getElementById('dashboard').classList.add('hidden');
  document.getElementById('adminKey').value = '';
}

// API
async function api(endpoint, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 'Authorization': `Bearer ${authKey}`, 'Content-Type': 'application/json' }
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${API_URL}${endpoint}`, opts);
  if (!r.ok) throw new Error('API error');
  return r.json();
}

// Load all data
async function loadAll() {
  loadStats();
  loadContractStats();
  loadPending();
  loadActivity();
  loadConfig();
}

// Tabs
function setupTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
      tab.classList.add('active');
      const tabId = 'tab-' + tab.dataset.tab;
      document.getElementById(tabId).classList.remove('hidden');
      // Load data for tab
      if (tab.dataset.tab === 'github') { loadGitHubIssues(); loadGitHubPRs(); }
      if (tab.dataset.tab === 'contributors') loadContributors();
      if (tab.dataset.tab === 'claims') loadClaims();
    });
  });
}

// Stats
async function loadStats() {
  try {
    const s = await api('/admin/stats');
    const pending = s.pending_issues + s.pending_prs;
    document.getElementById('statsGrid').innerHTML = `
      <div class="stat-card${pending > 0 ? ' warning' : ''}">
        <div class="stat-card-value">${pending}</div>
        <div class="stat-card-label">PENDING APPROVALS</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-value">${s.approved_issues + s.approved_prs}</div>
        <div class="stat-card-label">TOTAL APPROVED</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-value">${s.claimed_issues + s.claimed_prs + s.star_claims}</div>
        <div class="stat-card-label">TOTAL CLAIMED</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-value">${s.star_claims}</div>
        <div class="stat-card-label">STAR CLAIMS</div>
      </div>
    `;
  } catch (e) { showToast('Failed to load stats', 'error'); }
}

async function loadContractStats() {
  try {
    const r = await fetch(`${API_URL}/contract/stats`);
    const d = await r.json();
    if (d.contract) {
      document.getElementById('headerPool').textContent = Number(d.contract.pool_balance).toLocaleString();
      document.getElementById('headerDistributed').textContent = Number(d.combined?.total_distributed || d.contract.total_distributed).toLocaleString();
    }
  } catch (e) {}
}

// Pending
async function loadPending() {
  try {
    const d = await api('/admin/pending');
    renderPendingIssues(d.issues);
    renderPendingPRs(d.prs);
  } catch (e) { showToast('Failed to load pending', 'error'); }
}

function renderPendingIssues(issues) {
  const el = document.getElementById('pendingIssues');
  if (!issues.length) { el.innerHTML = '<div class="empty">No pending issues</div>'; return; }
  el.innerHTML = issues.map(i => `
    <div style="display: flex; align-items: center; gap: 15px; padding: 10px 0; border-bottom: 1px solid var(--border);">
      <span class="item-user">@${i.github_username}</span>
      <span class="item-title" style="flex: 1;">#${i.issue_number}: ${i.issue_title || 'Untitled'}</span>
      <span style="color: var(--muted);">10K NOX</span>
      <button class="btn btn-success btn-sm" onclick="approve('issue', '${i.github_username}', ${i.issue_number}, '${escape(i.issue_title || '')}')">Approve</button>
      <button class="btn btn-danger btn-sm" onclick="reject('issue', '${i.github_username}', ${i.issue_number})">Reject</button>
    </div>
  `).join('');
}

function renderPendingPRs(prs) {
  const el = document.getElementById('pendingPRs');
  if (!prs.length) { el.innerHTML = '<div class="empty">No pending PRs</div>'; return; }
  el.innerHTML = prs.map(p => `
    <div style="display: flex; align-items: center; gap: 15px; padding: 10px 0; border-bottom: 1px solid var(--border);">
      <span class="item-user">@${p.github_username}</span>
      <span class="item-title" style="flex: 1;">#${p.pr_number}: ${p.pr_title || 'Untitled'}</span>
      <span style="color: var(--muted);">25K+ NOX</span>
      <button class="btn btn-success btn-sm" onclick="approve('pr', '${p.github_username}', ${p.pr_number}, '${escape(p.pr_title || '')}')">Approve</button>
      <button class="btn btn-danger btn-sm" onclick="reject('pr', '${p.github_username}', ${p.pr_number})">Reject</button>
    </div>
  `).join('');
}

// Activity
async function loadActivity() {
  try {
    const data = await api('/admin/activity?limit=10');
    const el = document.getElementById('activityList');
    if (!data.length) { el.innerHTML = '<div class="empty">No recent activity</div>'; return; }
    el.innerHTML = data.map(a => {
      const icon = a.action.includes('star') ? 'star' : a.action.includes('issue') ? 'issue' : 'pr';
      const iconText = icon === 'star' ? '★' : icon === 'issue' ? '!' : '⎇';
      const actionText = a.action.replace('_', ' ');
      const time = new Date(a.timestamp).toLocaleString();
      return `
        <div class="activity-item">
          <div class="activity-icon ${icon}">${iconText}</div>
          <div class="activity-content">
            <div class="activity-text"><span class="item-user">@${a.username}</span> - ${actionText} ${a.number ? '#' + a.number : ''}</div>
            <div class="activity-time">${time} - ${a.reward_nox.toLocaleString()} NOX</div>
          </div>
        </div>
      `;
    }).join('');
  } catch (e) {}
}

// GitHub Issues/PRs
async function loadApprovedItems() {
  try {
    const approved = await api('/admin/approved');
    approvedItems.issues = approved.issues.map(i => `${i.github_username.toLowerCase()}-${i.issue_number}`);
    approvedItems.prs = approved.prs.map(p => `${p.github_username.toLowerCase()}-${p.pr_number}`);
  } catch (e) {}
}

async function loadGitHubIssues() {
  try {
    const el = document.getElementById('githubIssues');
    el.innerHTML = '<div class="empty"><span class="loading"></span> Loading...</div>';
    await loadApprovedItems();
    allIssues = await api('/admin/issues');
    renderGitHubIssues();
  } catch (e) { showToast('Failed to load issues', 'error'); }
}

async function loadGitHubPRs() {
  try {
    const el = document.getElementById('githubPRs');
    el.innerHTML = '<div class="empty"><span class="loading"></span> Loading...</div>';
    allPRs = await api('/admin/prs');
    renderGitHubPRs();
  } catch (e) { showToast('Failed to load PRs', 'error'); }
}

function renderGitHubIssues() {
  const el = document.getElementById('githubIssues');
  const search = document.getElementById('searchIssues').value.toLowerCase();
  let filtered = allIssues;
  if (currentFilters.issues !== 'all') filtered = filtered.filter(i => i.state === currentFilters.issues);
  if (search) filtered = filtered.filter(i => i.title.toLowerCase().includes(search) || i.user.login.toLowerCase().includes(search));
  if (!filtered.length) { el.innerHTML = '<div class="empty">No issues found</div>'; return; }
  el.innerHTML = filtered.slice(0, 50).map(i => {
    const key = `${i.user.login.toLowerCase()}-${i.number}`;
    const isApproved = approvedItems.issues.includes(key);
    return `
    <div style="display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--border);">
      <span style="color: ${i.state === 'open' ? 'var(--success)' : 'var(--error)'}; width: 60px; font-size: 11px;">${i.state.toUpperCase()}</span>
      <span class="item-user" style="width: 100px;">@${i.user.login}</span>
      <span class="item-title" style="flex: 1;">#${i.number}: ${i.title}</span>
      ${isApproved
        ? '<span style="color: var(--accent); font-size: 12px;">Approved</span>'
        : `<button class="btn btn-primary btn-sm" onclick="approveFromGH('issue', '${i.user.login}', ${i.number}, '${escape(i.title)}')">Add Reward</button>`
      }
    </div>`;
  }).join('');
}

function renderGitHubPRs() {
  const el = document.getElementById('githubPRs');
  const search = document.getElementById('searchPRs').value.toLowerCase();
  let filtered = allPRs;
  if (currentFilters.prs === 'open') filtered = filtered.filter(p => p.state === 'open');
  else if (currentFilters.prs === 'merged') filtered = filtered.filter(p => p.merged_at);
  if (search) filtered = filtered.filter(p => p.title.toLowerCase().includes(search) || p.user.login.toLowerCase().includes(search));
  if (!filtered.length) { el.innerHTML = '<div class="empty">No PRs found</div>'; return; }
  el.innerHTML = filtered.slice(0, 50).map(p => {
    const key = `${p.user.login.toLowerCase()}-${p.number}`;
    const isApproved = approvedItems.prs.includes(key);
    return `
    <div style="display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--border);">
      <span style="color: ${p.merged_at ? 'var(--accent)' : p.state === 'open' ? 'var(--success)' : 'var(--error)'}; width: 60px; font-size: 11px;">${p.merged_at ? 'MERGED' : p.state.toUpperCase()}</span>
      <span class="item-user" style="width: 100px;">@${p.user.login}</span>
      <span class="item-title" style="flex: 1;">#${p.number}: ${p.title}</span>
      ${isApproved
        ? '<span style="color: var(--accent); font-size: 12px;">Approved</span>'
        : `<button class="btn btn-primary btn-sm" onclick="approveFromGH('pr', '${p.user.login}', ${p.number}, '${escape(p.title)}')">Add Reward</button>`
      }
    </div>`;
  }).join('');
}

function filterGH(btn, type) {
  btn.parentElement.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentFilters[type] = btn.dataset.filter;
  if (type === 'issues') renderGitHubIssues();
  else renderGitHubPRs();
}

function filterGHSearch(type) {
  if (type === 'issues') renderGitHubIssues();
  else renderGitHubPRs();
}

// Contributors
async function loadContributors() {
  try {
    const el = document.getElementById('contributorsTable');
    el.innerHTML = '<tr><td colspan="6" class="empty"><span class="loading"></span> Loading...</td></tr>';
    allContributors = await api('/admin/contributors');
    renderContributors();
  } catch (e) { showToast('Failed to load contributors', 'error'); }
}

function renderContributors() {
  const el = document.getElementById('contributorsTable');
  const search = document.getElementById('searchContributors').value.toLowerCase();
  let filtered = allContributors;
  if (search) filtered = filtered.filter(c => c.username.toLowerCase().includes(search));
  if (!filtered.length) { el.innerHTML = '<tr><td colspan="6" class="empty">No contributors found</td></tr>'; return; }
  el.innerHTML = filtered.map(c => `
    <tr>
      <td><span class="item-user">@${c.username}</span></td>
      <td>${c.star ? '<span style="color: gold;">★</span>' : '-'}</td>
      <td>${c.issues || '-'}</td>
      <td>${c.prs || '-'}</td>
      <td><span class="item-reward">${c.total_nox.toLocaleString()} NOX</span></td>
      <td style="color: var(--muted); font-size: 12px;">${c.last_activity ? new Date(c.last_activity).toLocaleDateString() : '-'}</td>
    </tr>
  `).join('');
}

function filterContributors() {
  renderContributors();
}

// Claims
async function loadClaims() {
  try {
    const el = document.getElementById('claimsTable');
    el.innerHTML = '<tr><td colspan="6" class="empty"><span class="loading"></span> Loading...</td></tr>';
    allClaims = await api('/admin/claims?limit=200');
    renderClaims();
  } catch (e) { showToast('Failed to load claims', 'error'); }
}

function renderClaims() {
  const el = document.getElementById('claimsTable');
  let filtered = allClaims;
  if (currentFilters.claimsType !== 'all') filtered = filtered.filter(c => c.type === currentFilters.claimsType);
  if (currentFilters.claimsStatus === 'claimed') filtered = filtered.filter(c => c.status === 'claimed');
  else if (currentFilters.claimsStatus === 'pending') filtered = filtered.filter(c => c.status !== 'claimed');
  if (!filtered.length) { el.innerHTML = '<tr><td colspan="6" class="empty">No claims found</td></tr>'; return; }
  el.innerHTML = filtered.map(c => `
    <tr>
      <td><span style="text-transform: uppercase; font-size: 11px; color: ${c.type === 'star' ? 'gold' : c.type === 'issue' ? 'var(--accent)' : 'var(--success)'};">${c.type}</span></td>
      <td><span class="item-user">@${c.username}</span></td>
      <td>${c.type === 'star' ? 'Star Reward' : '#' + c.number + ': ' + (c.title || '').substring(0, 30)}</td>
      <td><span class="item-reward">${c.reward_nox.toLocaleString()} NOX</span></td>
      <td><span class="item-status ${c.status}">${c.status}</span></td>
      <td style="color: var(--muted); font-size: 12px;">${c.approved_at ? new Date(c.approved_at).toLocaleDateString() : '-'}</td>
    </tr>
  `).join('');
}

function filterClaims(btn) {
  btn.parentElement.querySelectorAll('[data-type]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentFilters.claimsType = btn.dataset.type;
  renderClaims();
}

function filterClaimsStatus(btn) {
  btn.parentElement.querySelectorAll('[data-status]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentFilters.claimsStatus = btn.dataset.status;
  renderClaims();
}

// Config
async function loadConfig() {
  try {
    const cfg = await api('/admin/config');
    document.getElementById('contractV2Link').href = `https://etherscan.io/address/${cfg.contract_v2}`;
    document.getElementById('contractV2Link').textContent = cfg.contract_v2;
    document.getElementById('contractV1Link').href = `https://etherscan.io/address/${cfg.contract_v1}`;
    document.getElementById('contractV1Link').textContent = cfg.contract_v1;
    document.getElementById('rewardStar').textContent = cfg.rewards.star.toLocaleString();
    document.getElementById('rewardIssue').textContent = cfg.rewards.issue.toLocaleString();
    document.getElementById('rewardPR').textContent = cfg.rewards.pr.toLocaleString();
  } catch (e) {}
}

// Actions
async function approve(type, username, number, title) {
  try {
    await api(`/admin/approve/${type}`, 'POST', { username, number, title });
    showToast(`${type} #${number} approved!`, 'success');
    loadStats();
    loadPending();
    loadActivity();
  } catch (e) { showToast('Approval failed', 'error'); }
}

async function reject(type, username, number) {
  if (!confirm(`Reject ${type} #${number} from @${username}?`)) return;
  try {
    await api(`/admin/reject/${type}`, 'POST', { username, number });
    showToast(`${type} #${number} rejected`, 'success');
    loadStats();
    loadPending();
  } catch (e) { showToast('Rejection failed', 'error'); }
}

async function approveFromGH(type, username, number, title) {
  const reward = prompt(`Enter NOX reward for ${type} #${number}:`, type === 'issue' ? '10000' : '25000');
  if (!reward) return;
  try {
    await api(`/admin/approve/${type}`, 'POST', { username, number, title, reward: parseInt(reward) * 1e18 });
    showToast(`${type} #${number} approved for ${Number(reward).toLocaleString()} NOX!`, 'success');
    loadStats();
    loadActivity();
  } catch (e) { showToast('Approval failed', 'error'); }
}

async function quickApprove() {
  const type = document.getElementById('approveType').value;
  const username = document.getElementById('approveUsername').value;
  const number = parseInt(document.getElementById('approveNumber').value);
  const title = document.getElementById('approveTitle').value;
  const rewardNox = parseInt(document.getElementById('approveReward').value) || (type === 'issue' ? 10000 : 25000);
  if (!username || !number) return showToast('Fill required fields', 'error');
  try {
    await api(`/admin/approve/${type}`, 'POST', { username, number, title, reward: rewardNox * 1e18 });
    showToast(`${type} #${number} approved for ${rewardNox.toLocaleString()} NOX!`, 'success');
    document.getElementById('approveUsername').value = '';
    document.getElementById('approveNumber').value = '';
    document.getElementById('approveTitle').value = '';
    document.getElementById('approveReward').value = '';
    loadStats();
    loadActivity();
  } catch (e) { showToast('Approval failed', 'error'); }
}

async function exportCSV() {
  window.open(`${API_URL}/admin/export/csv?authorization=Bearer ${authKey}`, '_blank');
}

// Utils
function escape(str) {
  return str.replace(/'/g, "\\'").replace(/"/g, '\\"');
}

function showToast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  setTimeout(() => t.classList.remove('show'), 3000);
}

// Auto-refresh every 30s
setInterval(() => {
  if (authKey && !document.hidden) {
    loadStats();
    loadContractStats();
  }
}, 30000);
