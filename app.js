/* Call Board — Audition Tracker
   Storage layer: GitHub Contents API (a JSON file in your own repo acts as the database) */

const TYPES = ["Film","TV","Commercial","Theatre","Voiceover","Print","Other"];
const STATUSES = ["Submitted","Callback","Booked","Passed"];
const SETTINGS_KEY = 'cb-gh-settings';

let auditions = [];
let currentSha = null;
let editingId = null;
let filterType = "All";
let filterStatus = "All";

/* ---------- Settings (stored only in this browser's localStorage, never committed) ---------- */

function getSettings(){
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch(e) { return null; }
}

function saveSettings(s){
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

function clearSettings(){
  localStorage.removeItem(SETTINGS_KEY);
}

/* ---------- Status line ---------- */

function showStatus(msg, kind){
  const el = document.getElementById('cb-status');
  el.textContent = msg || '';
  el.className = 'cb-status-line' + (kind ? ' ' + kind : '');
}

/* ---------- GitHub Contents API ---------- */

function b64EncodeUnicode(str){
  return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g,
    (_, p1) => String.fromCharCode('0x' + p1)));
}
function b64DecodeUnicode(str){
  return decodeURIComponent(atob(str).split('').map(c =>
    '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
}

function apiUrl(settings){
  return `https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${settings.filepath}`;
}

async function ghGet(settings){
  const res = await fetch(`${apiUrl(settings)}?ref=${encodeURIComponent(settings.branch)}`, {
    headers: {
      'Authorization': `Bearer ${settings.token}`,
      'Accept': 'application/vnd.github+json'
    }
  });
  return res;
}

async function ghPut(settings, contentObj, sha){
  const body = {
    message: `Update auditions — ${new Date().toISOString()}`,
    content: b64EncodeUnicode(JSON.stringify(contentObj, null, 2)),
    branch: settings.branch
  };
  if (sha) body.sha = sha;
  const res = await fetch(apiUrl(settings), {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${settings.token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  return res;
}

/* ---------- Load / Save ---------- */

async function loadAll(){
  const settings = getSettings();
  if (!settings){
    showConnectScreen();
    return;
  }
  showAppScreen();
  showStatus('Loading from GitHub…');
  try {
    const res = await ghGet(settings);
    if (res.status === 200){
      const data = await res.json();
      currentSha = data.sha;
      const decoded = b64DecodeUnicode(data.content.replace(/\n/g, ''));
      auditions = JSON.parse(decoded || '[]');
      auditions.sort((a,b) => new Date(a.date) - new Date(b.date));
      showStatus('Synced with GitHub', 'ok');
    } else if (res.status === 404){
      // File doesn't exist yet — start empty, it'll be created on first save
      auditions = [];
      currentSha = null;
      showStatus('Connected. No data file yet — add an audition to create it.', 'ok');
    } else if (res.status === 401 || res.status === 403){
      showStatus('GitHub authentication failed — check your token in Settings.', 'err');
      auditions = [];
    } else {
      showStatus(`GitHub error (${res.status}) — check your Settings.`, 'err');
      auditions = [];
    }
  } catch(e){
    showStatus('Network error loading from GitHub: ' + e.message, 'err');
  }
  render();
}

async function persistToGithub(){
  const settings = getSettings();
  if (!settings) return false;
  showStatus('Saving to GitHub…');
  try {
    const res = await ghPut(settings, auditions, currentSha);
    if (res.ok){
      const data = await res.json();
      currentSha = data.content.sha;
      showStatus('Saved ✓', 'ok');
      setTimeout(() => showStatus(''), 2000);
      return true;
    } else {
      const err = await res.json().catch(() => ({}));
      showStatus(`Save failed: ${err.message || res.status}`, 'err');
      return false;
    }
  } catch(e){
    showStatus('Network error saving to GitHub: ' + e.message, 'err');
    return false;
  }
}

/* ---------- Connect / Settings screen ---------- */

function showConnectScreen(){
  document.getElementById('cb-app-screen').style.display = 'none';
  const s = getSettings() || {};
  document.getElementById('cb-connect-screen').innerHTML = `
    <div class="cb-connect">
      <h2>Connect your GitHub repo</h2>
      <p>Your auditions will be stored as a JSON file inside a repo you control. No third-party database needed.</p>
      <ol>
        <li>Go to <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com/settings/personal-access-tokens/new</a></li>
        <li>Resource owner: your account. Repository access: <b>Only select repositories</b> → pick this repo.</li>
        <li>Permissions → Repository permissions → <b>Contents: Read and write</b></li>
        <li>Generate, then copy the token (starts with <code>github_pat_</code>) and paste it below.</li>
      </ol>
      <div class="cb-field">
        <label>GitHub username / org</label>
        <input id="s-owner" value="${s.owner || ''}" placeholder="e.g. jsmith">
      </div>
      <div class="cb-field">
        <label>Repository name</label>
        <input id="s-repo" value="${s.repo || ''}" placeholder="e.g. audition-tracker">
      </div>
      <div class="cb-field">
        <label>Branch</label>
        <input id="s-branch" value="${s.branch || 'main'}">
      </div>
      <div class="cb-field">
        <label>Data file path</label>
        <input id="s-filepath" value="${s.filepath || 'data/auditions.json'}">
      </div>
      <div class="cb-field">
        <label>Personal access token</label>
        <input id="s-token" type="password" value="${s.token || ''}" placeholder="github_pat_...">
      </div>
      <div class="cb-modal-actions">
        ${s.owner ? `<button class="cb-btn-danger" onclick="cbDisconnect()">Disconnect</button>` : ''}
        <button class="cb-btn-primary" onclick="cbConnect()">${s.owner ? 'Save & Reconnect' : 'Connect'}</button>
      </div>
    </div>
  `;
}

function showAppScreen(){
  document.getElementById('cb-connect-screen').innerHTML = '';
  document.getElementById('cb-app-screen').style.display = '';
}

window.cbConnect = async function(){
  const owner = document.getElementById('s-owner').value.trim();
  const repo = document.getElementById('s-repo').value.trim();
  const branch = document.getElementById('s-branch').value.trim() || 'main';
  const filepath = document.getElementById('s-filepath').value.trim() || 'data/auditions.json';
  const token = document.getElementById('s-token').value.trim();
  if (!owner || !repo || !token){
    showStatus('Please fill in username, repo, and token.', 'err');
    return;
  }
  saveSettings({ owner, repo, branch, filepath, token });
  await loadAll();
};

window.cbOpenSettings = function(){
  showConnectScreen();
};

window.cbDisconnect = function(){
  if (!confirm('Remove saved GitHub settings from this browser? Your data in GitHub is not deleted.')) return;
  clearSettings();
  auditions = [];
  currentSha = null;
  showConnectScreen();
};

/* ---------- Rendering ---------- */

function fmtDate(d){
  if(!d) return '';
  const dt = new Date(d + 'T00:00:00');
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString(undefined, {weekday:'short', month:'short', day:'numeric', year:'numeric'});
}

function renderTabs(){
  const typeTabs = document.getElementById('cb-type-tabs');
  const statusTabs = document.getElementById('cb-status-tabs');
  const allTypes = ["All", ...TYPES];
  const allStatuses = ["All", ...STATUSES];
  typeTabs.innerHTML = allTypes.map(t =>
    `<button class="cb-tab ${filterType===t?'active':''}" data-t="${t}">${t}</button>`
  ).join('');
  statusTabs.innerHTML = allStatuses.map(s =>
    `<button class="cb-tab ${filterStatus===s?'active':''}" data-s="${s}">${s}</button>`
  ).join('');
  typeTabs.querySelectorAll('button').forEach(b => b.onclick = () => { filterType = b.dataset.t; render(); });
  statusTabs.querySelectorAll('button').forEach(b => b.onclick = () => { filterStatus = b.dataset.s; render(); });
}

function renderStats(){
  const upcoming = auditions.filter(a => a.date && new Date(a.date) >= new Date(new Date().toDateString()) && a.status !== 'Passed').length;
  const callbacks = auditions.filter(a => a.status === 'Callback').length;
  const booked = auditions.filter(a => a.status === 'Booked').length;
  document.getElementById('cb-stats').innerHTML = `
    <div><b>${auditions.length}</b> total</div>
    <div><b>${upcoming}</b> upcoming</div>
    <div><b>${callbacks}</b> callbacks</div>
    <div><b>${booked}</b> booked</div>
  `;
}

function statusClass(s){
  return { Submitted:'submitted', Callback:'callback', Booked:'booked', Passed:'passed' }[s] || 'submitted';
}

function escapeHtml(str){
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function render(){
  renderTabs();
  renderStats();
  const grid = document.getElementById('cb-grid');
  let list = auditions.filter(a =>
    (filterType === "All" || a.type === filterType) &&
    (filterStatus === "All" || a.status === filterStatus)
  );
  if (list.length === 0){
    grid.innerHTML = `<div class="cb-empty"><span class="cb-empty-title">Nothing pinned up</span>Add your first audition to start tracking.</div>`;
    return;
  }
  grid.innerHTML = list.map(a => `
    <div class="cb-card">
      <div class="cb-card-top">
        <div>
          <div class="cb-project">${escapeHtml(a.project || 'Untitled')}</div>
          ${a.role ? `<div class="cb-role">${escapeHtml(a.role)}</div>` : ''}
        </div>
        <div class="cb-stamp ${statusClass(a.status)}">${a.status || 'Submitted'}</div>
      </div>
      <div class="cb-meta">
        <span>${fmtDate(a.date)}${a.time ? ' · ' + escapeHtml(a.time) : ''}</span>
        <span class="cb-type-pill">${escapeHtml(a.type || 'Other')}</span>
        ${a.format ? `<span class="cb-type-pill">${escapeHtml(a.format)}</span>` : ''}
      </div>
      ${a.castingDirector ? `<div class="cb-meta" style="margin-top:2px;">${escapeHtml(a.castingDirector)}</div>` : ''}
      ${a.notes ? `<div class="cb-notes">${escapeHtml(a.notes)}</div>` : ''}
      <div class="cb-card-actions">
        <button onclick="cbEdit('${a.id}')">Edit</button>
        <button onclick="cbDelete('${a.id}')">Delete</button>
      </div>
    </div>
  `).join('');
}

/* ---------- Add / Edit modal ---------- */

window.cbOpenModal = function(id){
  editingId = id || null;
  const a = id ? auditions.find(x => x.id === id) : null;
  const container = document.getElementById('cb-modal-container');
  container.innerHTML = `
    <div class="cb-overlay" id="cb-overlay">
      <div class="cb-modal">
        <h2>${a ? 'Edit Audition' : 'New Audition'}</h2>
        <div class="cb-row2">
          <div class="cb-field">
            <label>Project / Title</label>
            <input id="f-project" value="${a ? escapeHtml(a.project||'') : ''}" placeholder="e.g. Nike Spot, Silent Waters">
          </div>
          <div class="cb-field">
            <label>Role</label>
            <input id="f-role" value="${a ? escapeHtml(a.role||'') : ''}" placeholder="e.g. Lead, Featured Extra">
          </div>
        </div>
        <div class="cb-row2">
          <div class="cb-field">
            <label>Date</label>
            <input id="f-date" type="date" value="${a ? a.date||'' : ''}">
          </div>
          <div class="cb-field">
            <label>Time</label>
            <input id="f-time" type="time" value="${a ? a.time||'' : ''}">
          </div>
        </div>
        <div class="cb-row2">
          <div class="cb-field">
            <label>Type</label>
            <select id="f-type">
              ${TYPES.map(t => `<option ${a && a.type===t ? 'selected':''}>${t}</option>`).join('')}
            </select>
          </div>
          <div class="cb-field">
            <label>Status</label>
            <select id="f-status">
              ${STATUSES.map(s => `<option ${a && a.status===s ? 'selected':''}>${s}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="cb-row2">
          <div class="cb-field">
            <label>Format</label>
            <input id="f-format" value="${a ? escapeHtml(a.format||'') : ''}" placeholder="Self-tape / In person / Zoom">
          </div>
          <div class="cb-field">
            <label>Casting Director / Agency</label>
            <input id="f-cd" value="${a ? escapeHtml(a.castingDirector||'') : ''}">
          </div>
        </div>
        <div class="cb-field">
          <label>Notes</label>
          <textarea id="f-notes" placeholder="Sides, wardrobe, callback details...">${a ? escapeHtml(a.notes||'') : ''}</textarea>
        </div>
        <div class="cb-modal-actions">
          <button class="cb-btn-secondary" onclick="cbCloseModal()">Cancel</button>
          <button class="cb-btn-primary" onclick="cbSave()">${a ? 'Save Changes' : 'Add to Board'}</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('cb-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'cb-overlay') cbCloseModal();
  });
};

window.cbCloseModal = function(){
  document.getElementById('cb-modal-container').innerHTML = '';
  editingId = null;
};

window.cbSave = async function(){
  const project = document.getElementById('f-project').value.trim();
  if (!project){ document.getElementById('f-project').focus(); return; }
  const a = {
    id: editingId || (Date.now().toString(36) + Math.random().toString(36).slice(2,8)),
    project,
    role: document.getElementById('f-role').value.trim(),
    date: document.getElementById('f-date').value,
    time: document.getElementById('f-time').value,
    type: document.getElementById('f-type').value,
    status: document.getElementById('f-status').value,
    format: document.getElementById('f-format').value.trim(),
    castingDirector: document.getElementById('f-cd').value.trim(),
    notes: document.getElementById('f-notes').value.trim(),
    createdAt: editingId ? (auditions.find(x=>x.id===editingId)||{}).createdAt || Date.now() : Date.now()
  };
  const idx = auditions.findIndex(x => x.id === a.id);
  if (idx >= 0) auditions[idx] = a; else auditions.push(a);
  auditions.sort((x,y) => new Date(x.date) - new Date(y.date));
  render();
  cbCloseModal();
  await persistToGithub();
};

window.cbEdit = function(id){ cbOpenModal(id); };

window.cbDelete = async function(id){
  auditions = auditions.filter(x => x.id !== id);
  render();
  await persistToGithub();
};

/* ---------- CSV export ---------- */

function csvEscape(val){
  const s = (val === undefined || val === null) ? '' : String(val);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

window.cbExportCsv = function(){
  if (!auditions.length){
    alert('No auditions to export yet.');
    return;
  }
  const headers = ['Project','Role','Date','Time','Type','Status','Format','Casting Director / Agency','Notes'];
  const rows = auditions.map(a => [
    a.project, a.role, a.date, a.time, a.type, a.status, a.format, a.castingDirector, a.notes
  ]);
  const csv = [headers, ...rows]
    .map(row => row.map(csvEscape).join(','))
    .join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const today = new Date().toISOString().slice(0,10);
  link.href = url;
  link.download = `audition-tracker-${today}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

/* ---------- Init ---------- */

loadAll();
