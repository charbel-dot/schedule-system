/* Worker mobile app — PIN login, advance status through the chain */

const W_STATUS_LABEL = {
  pending: 'Pending', assigned: 'Assigned', en_route: 'En route',
  on_site: 'On-site', checked_out: 'Checked-out', completed: 'Completed', cancelled: 'Cancelled'
};
const W_CHAIN = ['assigned', 'en_route', 'on_site', 'checked_out', 'completed'];
const STEP_LABELS = ['Assigned', 'En route', 'On-site', 'Checked-out', 'Completed'];
const NEXT_LABEL = {
  pending: 'Confirm', assigned: "I'm on my way", en_route: 'I have arrived (check in)',
  on_site: 'Leaving site (check out)', checked_out: 'Mark job complete'
};

let WORKER = JSON.parse(localStorage.getItem('dispatch_worker') || 'null');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---- inline SVG icons -------------------------------------------------- */
const ICON = {
  pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0Z"/><circle cx="12" cy="10" r="3"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  note: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  alert: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  x: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>'
};
function svg(name, cls) {
  return `<svg class="${cls || ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name] || ''}</svg>`;
}

function toast(title, type) {
  type = type || 'info';
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  const ico = type === 'success' ? 'check' : type === 'error' ? 'alert' : 'check';
  el.innerHTML = `${svg(ico)}<div class="t-body"><div class="t-title">${esc(title)}</div></div>`;
  root.appendChild(el);
  const kill = () => { el.classList.add('closing'); setTimeout(() => el.remove(), 220); };
  el.addEventListener('click', kill);
  setTimeout(kill, 3500);
}

// Local 'YYYY-MM-DD' (avoids UTC day-shift from toISOString).
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* top loading bar */
let _loadCount = 0;
function loadStart() {
  _loadCount++;
  const b = document.getElementById('loadbar');
  if (b) { b.classList.add('active'); b.style.transform = 'scaleX(0.75)'; }
}
function loadEnd() {
  _loadCount = Math.max(0, _loadCount - 1);
  if (_loadCount > 0) return;
  const b = document.getElementById('loadbar');
  if (!b) return;
  b.style.transform = 'scaleX(1)';
  setTimeout(() => { if (_loadCount === 0) { b.classList.remove('active'); b.style.transform = 'scaleX(0)'; } }, 220);
}
async function wfetch(url, opts, ctl) {
  const silent = ctl && ctl.silent; // background polls don't show the loading bar
  if (!silent) loadStart();
  try { return await fetch(url, Object.assign({ cache: 'no-store' }, opts)); }
  finally { if (!silent) loadEnd(); }
}

async function loadRoster() {
  const sel = document.getElementById('wworker');
  try {
    const res = await wfetch('/api/worker/roster');
    const roster = await res.json();
    sel.innerHTML = '<option value="">Select your name…</option>' +
      roster.map((w) => `<option value="${esc(w.id)}">${esc(w.name)}</option>`).join('');
  } catch (e) {
    sel.innerHTML = '<option value="">Couldn\'t load names</option>';
  }
}

async function wlogin() {
  const workerId = document.getElementById('wworker').value;
  const pin = document.getElementById('pin').value.trim();
  const err = document.getElementById('werr');
  if (!workerId) { err.textContent = 'Pick your name first'; return; }
  try {
    const res = await wfetch('/api/worker/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workerId, pin })
    });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Wrong PIN');
    WORKER = await res.json();
    localStorage.setItem('dispatch_worker', JSON.stringify(WORKER));
    showWApp();
  } catch (e) {
    err.textContent = e.message;
  }
}
function wlogout() {
  stopWorkerRefresh();
  if (WORKER && WORKER.token) {
    wfetch('/api/worker/logout', { method: 'POST', headers: wauth() }, { silent: true }).catch(() => {});
  }
  WORKER = null;
  localStorage.removeItem('dispatch_worker');
  document.getElementById('wapp').classList.add('hidden');
  document.getElementById('wlogin').classList.remove('hidden');
  loadRoster();
}
document.getElementById('pin').addEventListener('keydown', (e) => { if (e.key === 'Enter') wlogin(); });
if (!WORKER) loadRoster();

function showWApp() {
  document.getElementById('wlogin').classList.add('hidden');
  document.getElementById('wapp').classList.remove('hidden');
  document.getElementById('wname').textContent = 'Hi, ' + WORKER.name.split(' ')[0];
  document.getElementById('wdate').textContent = new Date().toLocaleDateString(undefined,
    { weekday: 'long', day: 'numeric', month: 'long' });
  loadJobs();
  startWorkerRefresh();
}

// Headers carrying the worker's session token for authenticated calls.
function wauth(extra) {
  return Object.assign({ 'x-worker-token': (WORKER && WORKER.token) || '' }, extra || {});
}

let _wSig = null; // signature of the jobs currently shown, for change detection

async function loadJobs(opts) {
  const silent = opts && opts.silent;
  const res = await wfetch(`/api/worker/${WORKER.id}/bookings?date=${todayStr()}`, { headers: wauth() }, { silent });
  if (res.status === 401) return wlogout();
  if (!res.ok) { if (!silent) wlogout(); return; } // ignore transient errors on polls
  const { bookings } = await res.json();
  // Only touch the DOM when the jobs actually changed — avoids flicker and
  // never yanks a card out from under the worker's thumb on a poll.
  const sig = JSON.stringify(bookings.map((b) => [b.id, b.status, b.startTime, b.siteName, b.siteAddress, b.notes]));
  if (silent && sig === _wSig) return;
  _wSig = sig;
  const container = document.getElementById('wjobs');
  if (!bookings.length) {
    container.innerHTML = `<div class="empty">${svg('inbox')}<div class="empty-title">Nothing scheduled today</div><div>You have no jobs assigned for today. Check back later.</div></div>`;
    return;
  }
  container.innerHTML = bookings.map(renderJob).join('');
  // gentle stagger of job cards
  container.querySelectorAll('.job').forEach((node, i) => { node.style.animationDelay = i * 0.06 + 's'; });
}

/* ---- live auto-refresh (polling) -------------------------------------- */
const W_POLL_MS = 5000;
let _wPollTimer = null;
let _wAdvancing = false; // pause polling while the worker is advancing a job

function startWorkerRefresh() {
  if (_wPollTimer) return;
  _wPollTimer = setInterval(wTick, W_POLL_MS);
  document.addEventListener('visibilitychange', wOnVisible);
}
function stopWorkerRefresh() {
  if (_wPollTimer) { clearInterval(_wPollTimer); _wPollTimer = null; }
  document.removeEventListener('visibilitychange', wOnVisible);
}
function wOnVisible() { if (!document.hidden) wTick(); }
async function wTick() {
  if (!WORKER || document.hidden || _wAdvancing) return;
  try { await loadJobs({ silent: true }); } catch (_) { /* transient — ignore */ }
}

function renderJob(b) {
  const idx = W_CHAIN.indexOf(b.status);
  const steps = W_CHAIN.map((_, i) => `<div class="step ${idx >= i ? 'done' : ''}"></div>`).join('');
  const stepLabel = idx >= 0 && idx < W_CHAIN.length - 1
    ? `Step ${idx + 1} of ${W_CHAIN.length} · ${STEP_LABELS[idx]}`
    : (b.status === 'completed' ? 'All steps complete' : STEP_LABELS[Math.max(0, idx)] || '');
  const done = b.status === 'completed' || b.status === 'cancelled';
  const nextBtn = (!done && NEXT_LABEL[b.status])
    ? `<button class="btn big" onclick="advance('${b.id}', this, '${b.status}')">${esc(NEXT_LABEL[b.status])}</button>`
    : b.status === 'completed'
      ? `<div class="done-banner">${svg('check')} Job complete — thank you!</div>`
      : `<div class="done-banner cancelled">${svg('x')} This job was cancelled.</div>`;
  return `<div class="job">
    <div class="meta"><span class="pill ${b.status}">${W_STATUS_LABEL[b.status]}</span>
      ${b.startTime ? `<span class="start">${svg('clock')} ${esc(b.startTime)}</span>` : ''}</div>
    <h3>${esc(b.siteName)}</h3>
    ${b.siteAddress ? `<div class="addr">${svg('pin')} ${esc(b.siteAddress)}</div>` : ''}
    <div class="steps">${steps}</div>
    <div class="step-label">${esc(stepLabel)}</div>
    ${b.notes ? `<div class="note">${svg('note')} <span>${esc(b.notes)}</span></div>` : ''}
    ${nextBtn}
  </div>`;
}

// Location only matters for arrival ("I have arrived") and departure
// ("Leaving site") — the transitions coming FROM these statuses.
const GEO_ON_LEAVE = ['en_route', 'on_site'];

// Resolves to {lat,lng,accuracy} or null — never rejects, and never waits
// longer than timeoutMs, so a slow/denied GPS fix never blocks the status update.
function getLocation(timeoutMs) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    let settled = false;
    const done = (loc) => { if (!settled) { settled = true; resolve(loc); } };
    const timer = setTimeout(() => done(null), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (pos) => { clearTimeout(timer); done({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) }); },
      () => { clearTimeout(timer); done(null); },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 15000 }
    );
  });
}

async function advance(bid, btn, status) {
  if (btn) { btn.disabled = true; btn.textContent = 'Updating…'; }
  _wAdvancing = true; // don't let a background poll re-render mid-update
  try {
    const loc = GEO_ON_LEAVE.includes(status) ? await getLocation(6000) : null;
    const res = await wfetch(`/api/worker/${WORKER.id}/bookings/${bid}/advance`, {
      method: 'POST',
      headers: wauth(loc ? { 'Content-Type': 'application/json' } : {}),
      body: loc ? JSON.stringify(loc) : undefined
    });
    if (res.status === 401) return wlogout();
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      if (btn) btn.disabled = false;
      return toast(e.error || 'Could not update', 'error');
    }
    const updated = await res.json().catch(() => null);
    if (updated) toast(W_STATUS_LABEL[updated.status] || 'Updated', 'success');
    await loadJobs();
  } finally {
    _wAdvancing = false;
  }
}

if (WORKER) showWApp();
