/* Call Board — Audition Tracker
   Multi-user version: Supabase handles auth (signup/login) and data storage,
   with row-level security so each person only ever sees their own auditions. */

// ⚠️ Replace these two with your own project's values:
// Supabase dashboard → Settings → API → Project URL / anon public key.
// The anon key is meant to be public — it's safe to commit; real protection
// comes from the row-level security policies in supabase-setup.sql.
const SUPABASE_URL = "https://iqyllshomldskiixlqla.supabase.co/rest/v1/";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlxeWxsc2hvbWxkc2tpaXhscWxhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEwNDkwOTgsImV4cCI6MjEwNjYyNTA5OH0.7obhJn3f3QNwsm0sFRrENbmW3HvcOxM_fEurkArwyjc";

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const TYPES = ["Film","TV","Commercial","Theatre","Voiceover","Print","Other"];
const STATUSES = ["Submitted","Callback","Booked","Passed"];
const STATUS_ORDER = { Callback: 0, Submitted: 1, Booked: 2, Passed: 3 };

let auditions = [];
let editingId = null;
let filterType = "All";
let filterStatus = "All";
let viewMode = "board";
let sortBy = "date-asc";
let authMode = "login"; // "login" | "signup"
let currentUser = null;

/* ---------- Status line ---------- */

function showStatus(msg, kind){
  const el = document.getElementById('cb-status');
  el.textContent = msg || '';
  el.className = 'cb-status-line' + (kind ? ' ' + kind : '');
}

/* ---------- Row <-> app object mapping ---------- */

function fromRow(row){
  return {
    id: row.id,
    project: row.project,
    role: row.role || '',
    date: row.date || '',
    time: row.time || '',
    type: row.type || 'Other',
    status: row.status || 'Submitted',
    format: row.format || '',
    castingDirector: row.casting_director || '',
    notes: row.notes || '',
    createdAt: row.created_at
  };
}

function toRow(a){
  return {
    project: a.project,
    role: a.role,
    date: a.date || null,
    time: a.time,
    type: a.type,
    status: a.status,
    format: a.format,
    casting_director: a.castingDirector,
    notes: a.notes,
    user_id: currentUser.id
  };
}

/* ---------- Auth screen ---------- */

function renderAuthScreen(){
  document.getElementById('cb-app-screen').style.display = 'none';
  document.getElementById('cb-header-actions').innerHTML = '';
  const isSignup = authMode === 'signup';
  document.getElementById('cb-auth-screen').innerHTML = `
    <div class="cb-connect">
      <h2>${isSignup ? 'Create your account' : 'Log in'}</h2>
      <p>${isSignup ? 'Your own private call board — only you will see what you add.' : 'Welcome back to your call board.'}</p>
      <div id="cb-auth-error"></div>
      <div class="cb-field">
        <label>Email</label>
        <input id="a-email" type="email" placeholder="you@example.com">
      </div>
      <div class="cb-field">
        <label>Password</label>
        <input id="a-password" type="password" placeholder="${isSignup ? 'At least 6 characters' : ''}">
      </div>
      <div class="cb-modal-actions">
        <button class="cb-btn-primary" onclick="cbAuthSubmit()">${isSignup ? 'Sign Up' : 'Log In'}</button>
      </div>
      <div class="cb-auth-toggle">
        ${isSignup
          ? `Already have an account? <a onclick="cbSwitchAuthMode('login')">Log in</a>`
          : `New here? <a onclick="cbSwitchAuthMode('signup')">Create an account</a>`}
      </div>
    </div>
  `;
}

window.cbSwitchAuthMode = function(mode){
  authMode = mode;
  renderAuthScreen();
};

window.cbAuthSubmit = async function(){
  const email = document.getElementById('a-email').value.trim();
  const password = document.getElementById('a-password').value;
  const errEl = document.getElementById('cb-auth-error');
  errEl.innerHTML = '';
  if (!email || !password){
    errEl.innerHTML = `<div class="cb-auth-error">Please fill in both fields.</div>`;
    return;
  }
  showStatus(authMode === 'signup' ? 'Creating account…' : 'Logging in…');
  const fn = authMode === 'signup'
    ? supabase.auth.signUp({ email, password })
    : supabase.auth.signInWithPassword({ email, password });
  const { data, error } = await fn;
  if (error){
    errEl.innerHTML = `<div class="cb-auth-error">${escapeHtml(error.message)}</div>`;
    showStatus('');
    return;
  }
  if (authMode === 'signup' && data.user && !data.session){
    showStatus('');
    errEl.innerHTML = `<div class="cb-auth-error" style="color: var(--booked);">Account created — check your email to confirm, then log in.</div>`;
    authMode = 'login';
    return;
  }
  showStatus('');
  // onAuthStateChange will pick up the new session and load the app
};

window.cbLogout = async function(){
  await supabase.auth.signOut();
};

/* ---------- Load / Save ---------- */

async function loadAll(){
  showStatus('Loading your auditions…');
  const { data, error } = await supabase
    .from('auditions')
    .select('*')
    .order('date', { ascending: true });
  if (error){
    showStatus('Error loading data: ' + error.message, 'err');
    auditions = [];
  } else {
    auditions = data.map(fromRow);
    showStatus('');
  }
  render();
}

async function persistCreate(a){
  const { data, error } = await supabase.from('auditions').insert(toRow(a)).select().single();
  if (error){ showStatus('Save failed: ' + error.message, 'err'); return null; }
  showStatus('Saved ✓', 'ok'); setTimeout(() => showStatus(''), 1500);
  return fromRow(data);
}
async function persistUpdate(a){
  const { error } = await supabase.from('auditions').update(toRow(a)).eq('id', a.id);
  if (error){ showStatus('Save failed: ' + error.message, 'err'); return false; }
  showStatus('Saved ✓', 'ok'); setTimeout(() => showStatus(''), 1500);
  return true;
}
async function persistDelete(id){
  const { error } = await supabase.from('auditions').delete().eq('id', id);
  if (error){ showStatus('Delete failed: ' + error.message, 'err'); return false; }
  return true;
}

/* ---------- Header / account state ---------- */

function renderHeaderActions(){
  document.getElementById('cb-header-actions').innerHTML = `
    <span class="cb-account-label">${escapeHtml(currentUser.email)}</span>
    <button class="cb-icon-btn" onclick="cbExportCsv()">Export CSV</button>
    <button class="cb-icon-btn" onclick="cbLogout()">Log Out</button>
    <button class="cb-add-btn" onclick="cbOpenModal()">+ New Audition</button>
  `;
}

/* ---------- Rendering (views, cards, week groups) ---------- */

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

function renderViewTabs(){
  const el = document.getElementById('cb-view-tabs');
  const views = [["board","Board"],["week","By Week"]];
  el.innerHTML = views.map(([v,label]) =>
    `<button class="cb-tab ${viewMode===v?'active':''}" data-v="${v}">${label}</button>`
  ).join('');
  el.querySelectorAll('button').forEach(b => b.onclick = () => { viewMode = b.dataset.v; render(); });
}

function renderSortSelect(){
  const el = document.getElementById('cb-sort-select');
  const options = [
    ["date-asc", "Soonest first"],
    ["date-desc", "Latest first"],
    ["status", "By status"]
  ];
  el.innerHTML = options.map(([v,label]) => `<option value="${v}" ${sortBy===v?'selected':''}>${label}</option>`).join('');
  el.onchange = () => { sortBy = el.value; render(); };
  el.style.display = viewMode === 'board' ? '' : 'none';
}

function sortedList(list){
  const copy = [...list];
  if (sortBy === 'date-asc') copy.sort((a,b) => new Date(a.date) - new Date(b.date));
  else if (sortBy === 'date-desc') copy.sort((a,b) => new Date(b.date) - new Date(a.date));
  else if (sortBy === 'status') copy.sort((a,b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || new Date(a.date) - new Date(b.date));
  return copy;
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
  d.textContent = str == null ? '' : str;
  return d.innerHTML;
}

function weekLabel(dateStr){
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return { key: 'undated', label: 'No date set' };
  const day = d.getDay();
  const diffToMonday = (day === 0 ? -6 : 1) - day;
  const monday = new Date(d); monday.setDate(d.getDate() + diffToMonday);
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  const fmt = (dt) => dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const key = monday.toISOString().slice(0,10);
  const label = `${fmt(monday)} – ${fmt(sunday)}, ${sunday.getFullYear()}`;
  return { key, label };
}

function renderWeekView(list){
  const container = document.getElementById('cb-week-view');
  if (list.length === 0){
    container.innerHTML = `<div class="cb-empty"><span class="cb-empty-title">Nothing pinned up</span>Add your first audition to start tracking.</div>`;
    return;
  }
  const sorted = [...list].sort((a,b) => new Date(a.date) - new Date(b.date));
  const groups = new Map();
  sorted.forEach(a => {
    const { key, label } = weekLabel(a.date);
    if (!groups.has(key)) groups.set(key, { label, items: [] });
    groups.get(key).items.push(a);
  });
  container.innerHTML = [...groups.values()].map(g => `
    <div class="cb-week-group">
      <div class="cb-week-header">${g.label}<span>${g.items.length} audition${g.items.length === 1 ? '' : 's'}</span></div>
      <div class="cb-week-rows">
        ${g.items.map(a => `
          <div class="cb-week-row" onclick="cbEdit('${a.id}')">
            <div class="cb-wr-date">${a.date ? new Date(a.date+'T00:00:00').toLocaleDateString(undefined,{weekday:'short', day:'numeric'}) : '—'}${a.time ? '<br>'+escapeHtml(a.time) : ''}</div>
            <div class="cb-wr-main">
              <div class="cb-wr-project">${escapeHtml(a.project || 'Untitled')}</div>
              ${a.role ? `<div class="cb-wr-role">${escapeHtml(a.role)}</div>` : ''}
            </div>
            <div class="cb-wr-type">${escapeHtml(a.type || 'Other')}</div>
            <div class="cb-stamp ${statusClass(a.status)}">${a.status || 'Submitted'}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function render(){
  renderHeaderActions();
  renderTabs();
  renderStats();
  renderViewTabs();
  renderSortSelect();

  let list = auditions.filter(a =>
    (filterType === "All" || a.type === filterType) &&
    (filterStatus === "All" || a.status === filterStatus)
  );

  const grid = document.getElementById('cb-grid');
  const weekView = document.getElementById('cb-week-view');

  if (viewMode === 'week'){
    grid.style.display = 'none';
    weekView.style.display = '';
    renderWeekView(list);
    return;
  }
  grid.style.display = '';
  weekView.style.display = 'none';
  list = sortedList(list);

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
    id: editingId,
    project,
    role: document.getElementById('f-role').value.trim(),
    date: document.getElementById('f-date').value,
    time: document.getElementById('f-time').value,
    type: document.getElementById('f-type').value,
    status: document.getElementById('f-status').value,
    format: document.getElementById('f-format').value.trim(),
    castingDirector: document.getElementById('f-cd').value.trim(),
    notes: document.getElementById('f-notes').value.trim()
  };
  cbCloseModal();
  if (editingId){
    const idx = auditions.findIndex(x => x.id === editingId);
    if (idx >= 0) auditions[idx] = { ...auditions[idx], ...a };
    render();
    await persistUpdate(a);
  } else {
    const created = await persistCreate(a);
    if (created){
      auditions.push(created);
      auditions.sort((x,y) => new Date(x.date) - new Date(y.date));
      render();
    }
  }
};

window.cbEdit = function(id){ cbOpenModal(id); };

window.cbDelete = async function(id){
  auditions = auditions.filter(x => x.id !== id);
  render();
  await persistDelete(id);
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

/* ---------- Init & auth state wiring ---------- */

async function onSessionReady(session){
  if (session && session.user){
    currentUser = session.user;
    document.getElementById('cb-auth-screen').innerHTML = '';
    document.getElementById('cb-app-screen').style.display = '';
    await loadAll();
  } else {
    currentUser = null;
    document.getElementById('cb-app-screen').style.display = 'none';
    renderAuthScreen();
  }
}

supabase.auth.onAuthStateChange((_event, session) => {
  onSessionReady(session);
});

supabase.auth.getSession().then(({ data }) => onSessionReady(data.session));