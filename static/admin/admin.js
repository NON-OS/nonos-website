const API_URL = 'https://nonos.software/api';
let authKey = '';

function authenticate() {
  authKey = document.getElementById('adminKey').value;
  if (!authKey) return showToast('Enter API key', 'error');
  document.getElementById('authSection').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');
  loadStats();
  loadPending();
  loadApproved();
}

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

async function loadStats() {
  try {
    const s = await api('/admin/stats');
    document.getElementById('stats').innerHTML = `
      <div class="stat"><div class="stat-value">${s.pending_issues}</div><div class="stat-label">Pending Issues</div></div>
      <div class="stat"><div class="stat-value">${s.pending_prs}</div><div class="stat-label">Pending PRs</div></div>
      <div class="stat"><div class="stat-value">${s.approved_issues}</div><div class="stat-label">Approved Issues</div></div>
      <div class="stat"><div class="stat-value">${s.approved_prs}</div><div class="stat-label">Approved PRs</div></div>
      <div class="stat"><div class="stat-value">${s.claimed_issues}</div><div class="stat-label">Claimed Issues</div></div>
      <div class="stat"><div class="stat-value">${s.claimed_prs}</div><div class="stat-label">Claimed PRs</div></div>
    `;
  } catch (e) { showToast('Failed to load stats', 'error'); }
}

async function loadPending() {
  try {
    const d = await api('/admin/pending');
    const el = document.getElementById('pendingList');
    if (d.issues.length === 0 && d.prs.length === 0) {
      el.innerHTML = '<div class="empty">No pending approvals</div>';
      return;
    }
    el.innerHTML = '';
    d.issues.forEach(i => {
      el.innerHTML += `<div class="item">
        <span class="item-user">@${i.github_username}</span>
        <span class="item-title">Issue #${i.issue_number}: ${i.issue_title || 'No title'}</span>
        <span>10K NOX</span>
        <div class="item-actions">
          <button class="btn btn-approve" onclick="approve('issue', '${i.github_username}', ${i.issue_number}, '${i.issue_title || ''}')">Approve</button>
          <button class="btn btn-reject" onclick="reject('issue', '${i.github_username}', ${i.issue_number})">Reject</button>
        </div>
      </div>`;
    });
    d.prs.forEach(p => {
      el.innerHTML += `<div class="item">
        <span class="item-user">@${p.github_username}</span>
        <span class="item-title">PR #${p.pr_number}: ${p.pr_title || 'No title'}</span>
        <span>25K+ NOX</span>
        <div class="item-actions">
          <button class="btn btn-approve" onclick="approve('pr', '${p.github_username}', ${p.pr_number}, '${p.pr_title || ''}')">Approve</button>
          <button class="btn btn-reject" onclick="reject('pr', '${p.github_username}', ${p.pr_number})">Reject</button>
        </div>
      </div>`;
    });
  } catch (e) { showToast('Failed to load pending', 'error'); }
}

async function loadApproved() {
  try {
    const d = await api('/admin/approved');
    const el = document.getElementById('approvedList');
    const unclaimed = [...d.issues.filter(i => !i.claimed), ...d.prs.filter(p => !p.claimed)];
    if (unclaimed.length === 0) {
      el.innerHTML = '<div class="empty">No unclaimed approvals</div>';
      return;
    }
    el.innerHTML = '';
    d.issues.filter(i => !i.claimed).forEach(i => {
      el.innerHTML += `<div class="item">
        <span class="item-user">@${i.github_username}</span>
        <span class="item-title">Issue #${i.issue_number}: ${i.issue_title || ''}</span>
        <span>${(i.reward / 1e18).toLocaleString()} NOX</span>
        <span style="color: var(--warning)">Pending claim</span>
      </div>`;
    });
    d.prs.filter(p => !p.claimed).forEach(p => {
      el.innerHTML += `<div class="item">
        <span class="item-user">@${p.github_username}</span>
        <span class="item-title">PR #${p.pr_number}: ${p.pr_title || ''}</span>
        <span>${(p.reward / 1e18).toLocaleString()} NOX</span>
        <span style="color: var(--warning)">Pending claim</span>
      </div>`;
    });
  } catch (e) { showToast('Failed to load approved', 'error'); }
}

async function approve(type, username, number, title) {
  try {
    await api(`/admin/approve/${type}`, 'POST', { username, number, title });
    showToast(`${type} #${number} approved!`, 'success');
    loadStats();
    loadPending();
    loadApproved();
  } catch (e) { showToast('Approval failed', 'error'); }
}

async function reject(type, username, number) {
  try {
    await api(`/admin/reject/${type}`, 'POST', { username, number });
    showToast(`${type} #${number} rejected`, 'success');
    loadStats();
    loadPending();
  } catch (e) { showToast('Rejection failed', 'error'); }
}

async function quickApprove() {
  const type = document.getElementById('approveType').value;
  const username = document.getElementById('approveUsername').value;
  const number = parseInt(document.getElementById('approveNumber').value);
  const title = document.getElementById('approveTitle').value;
  const rewardNox = parseInt(document.getElementById('approveReward').value) || (type === 'issue' ? 10000 : 25000);
  const reward = rewardNox * 1e18;
  if (!username || !number) return showToast('Fill required fields', 'error');
  try {
    await api(`/admin/approve/${type}`, 'POST', { username, number, title, reward });
    showToast(`${type} #${number} approved for ${rewardNox.toLocaleString()} NOX!`, 'success');
    document.getElementById('approveUsername').value = '';
    document.getElementById('approveNumber').value = '';
    document.getElementById('approveTitle').value = '';
    document.getElementById('approveReward').value = '';
    loadStats();
    loadApproved();
  } catch (e) { showToast('Approval failed', 'error'); }
}

function showToast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  setTimeout(() => t.classList.remove('show'), 3000);
}
