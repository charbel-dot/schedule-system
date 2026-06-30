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
async function wfetch(url, opts) {
  loadStart();
  try { return await fetch(url, opts); }
  finally { loadEnd(); }
}

async function wlogin() {
  const pin = document.getElementById('pin').value.trim();
  try {
    const res = await wfetch('/api/worker/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin })
    });
    if (!res.ok) throw new Error('Wrong PIN');
    WORKER = await res.json();
    localStorage.setItem('dispatch_worker', JSON.stringify(WORKER));
    showWApp();
  } catch (e) {
    document.getElementById('werr').textContent = e.message;
  }
}
function wlogout() {
  WORKER = null;
  localStorage.removeItem('dispatch_worker');
  document.getElementById('wapp').classList.add('hidden');
  document.getElementById('wlogin').classList.remove('hidden');
}
document.getElementById('pin').addEventListener('keydown', (e) => { if (e.key === 'Enter') wlogin(); });

function showWApp() {
  document.getElementById('wlogin').classList.add('hidden');
  document.getElementById('wapp').classList.remove('hidden');
  document.getElementById('wname').textContent = 'Hi, ' + WORKER.name.split(' ')[0];
  document.getElementById('wdate').textContent = new Date().toLocaleDateString(undefined,
    { weekday: 'long', day: 'numeric', month: 'long' });
  loadJobs();
}

// Headers carrying the worker's session token for authenticated calls.
function wauth(extra) {
  return Object.assign({ 'x-worker-token': (WORKER && WORKER.token) || '' }, extra || {});
}

async function loadJobs() {
  const res = await wfetch(`/api/worker/${WORKER.id}/bookings?date=${todayStr()}`, { headers: wauth() });
  if (!res.ok) return wlogout();
  const { bookings } = await res.json();
  const container = document.getElementById('wjobs');
  if (!bookings.length) {
    container.innerHTML = `<div class="empty">${svg('inbox')}<div class="empty-title">Nothing scheduled today</div><div>You have no jobs assigned for today. Check back later.</div></div>`;
    return;
  }
  container.innerHTML = bookings.map(renderJob).join('');
  // gentle stagger of job cards
  container.querySelectorAll('.job').forEach((node, i) => { node.style.animationDelay = i * 0.06 + 's'; });
}

function renderJob(b) {
  const idx = W_CHAIN.indexOf(b.status);
  const steps = W_CHAIN.map((_, i) => `<div class="step ${idx >= i ? 'done' : ''}"></div>`).join('');
  const stepLabel = idx >= 0 && idx < W_CHAIN.length - 1
    ? `Step ${idx + 1} of ${W_CHAIN.length} · ${STEP_LABELS[idx]}`
    : (b.status === 'completed' ? 'All steps complete' : STEP_LABELS[Math.max(0, idx)] || '');
  const done = b.status === 'completed' || b.status === 'cancelled';
  const nextBtn = (!done && NEXT_LABEL[b.status])
    ? `<button class="btn big" onclick="advance('${b.id}', this)">${esc(NEXT_LABEL[b.status])}</button>`
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

async function advance(bid, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Updating…'; }
  const res = await wfetch(`/api/worker/${WORKER.id}/bookings/${bid}/advance`, { method: 'POST', headers: wauth() });
  if (res.status === 401) return wlogout();
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    if (btn) btn.disabled = false;
    return toast(e.error || 'Could not update', 'error');
  }
  const updated = await res.json().catch(() => null);
  if (updated) toast(W_STATUS_LABEL[updated.status] || 'Updated', 'success');
  loadJobs();
}

if (WORKER) showWApp();
