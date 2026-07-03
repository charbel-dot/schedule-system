/* Manager app — vanilla JS SPA */

const STATUS_LABEL = {
  pending: 'Pending', assigned: 'Assigned', en_route: 'En route',
  on_site: 'On-site', checked_out: 'Checked-out', completed: 'Completed', cancelled: 'Cancelled'
};
const STATUS_ORDER = ['pending', 'assigned', 'en_route', 'on_site', 'checked_out', 'completed', 'cancelled'];
const SITE_STATUS_LABEL = { active: 'Active', on_hold: 'On hold', completed: 'Completed' };

let TOKEN = localStorage.getItem('dispatch_token') || '';
let currentView = 'board';
let selectedDate = todayStr();
let weekStart = mondayOf(new Date());

/* ---- top loading bar --------------------------------------------------- */
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

/* ---- api helper -------------------------------------------------------- */
async function api(method, url, body, opts) {
  const silent = opts && opts.silent; // background polls don't show the loading bar
  if (!silent) loadStart();
  try {
    const res = await fetch(url, {
      method,
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'x-auth-token': TOKEN },
      body: body ? JSON.stringify(body) : undefined
    });
    if (res.status === 401) { logout(); throw new Error('Not authorised'); }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || ('Request failed (' + res.status + ')'));
    }
    return res.status === 204 ? null : res.json();
  } finally {
    if (!silent) loadEnd();
  }
}

/* ---- auth -------------------------------------------------------------- */
async function doLogin() {
  const pw = document.getElementById('login-pw').value;
  try {
    const { token } = await api('POST', '/api/login', { password: pw });
    TOKEN = token;
    localStorage.setItem('dispatch_token', token);
    showApp();
  } catch (e) {
    document.getElementById('login-error').textContent = e.message;
  }
}
function logout() {
  stopAutoRefresh();
  // Best-effort server-side token revocation; the UI logs out regardless.
  if (TOKEN) fetch('/api/logout', { method: 'POST', headers: { 'x-auth-token': TOKEN } }).catch(() => {});
  TOKEN = '';
  localStorage.removeItem('dispatch_token');
  document.getElementById('app').classList.add('hidden');
  document.getElementById('login').classList.remove('hidden');
}
function showApp() {
  document.getElementById('login').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  applyCollapsed();
  go('board');
  startAutoRefresh();
}
document.getElementById('login-pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });

/* ---- navigation -------------------------------------------------------- */
function go(view) {
  currentView = view;
  document.querySelectorAll('[data-view]').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === view));
  closeSidebar();
  render();
}

/* ---- sidebar (mobile off-canvas) -------------------------------------- */
function toggleSidebar() {
  const open = document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sb-backdrop').classList.toggle('open', open);
}
function closeSidebar() {
  const sb = document.getElementById('sidebar');
  if (sb) sb.classList.remove('open');
  const bd = document.getElementById('sb-backdrop');
  if (bd) bd.classList.remove('open');
}

// Collapse the desktop sidebar to an icon-only rail; remembered across reloads.
let SIDEBAR_COLLAPSED = localStorage.getItem('dispatch_sidebar_collapsed') === '1';
function applyCollapsed() {
  const app = document.getElementById('app');
  if (app) app.classList.toggle('collapsed', SIDEBAR_COLLAPSED);
  const btn = document.getElementById('sb-collapse');
  if (btn) {
    const label = SIDEBAR_COLLAPSED ? 'Expand sidebar' : 'Collapse sidebar';
    btn.title = label;
    btn.setAttribute('aria-label', label);
  }
}
function toggleCollapse() {
  SIDEBAR_COLLAPSED = !SIDEBAR_COLLAPSED;
  localStorage.setItem('dispatch_sidebar_collapsed', SIDEBAR_COLLAPSED ? '1' : '0');
  applyCollapsed();
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function fmtDate(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString(undefined,
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/* Date helpers — all work in LOCAL time on 'YYYY-MM-DD' strings. We never use
   toISOString() here (that converts to UTC and shifts the day in UTC+ zones). */
function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function todayStr() { return ymd(new Date()); }
function mondayOf(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - day);
  return ymd(d);
}
function addDays(s, n) {
  const [y, m, da] = s.split('-').map(Number);
  const d = new Date(y, m - 1, da);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

// Open WhatsApp (or copy the message) to notify a worker about a booking.
function notify(link) {
  if (!link) return toast('No phone number', 'Add a number under “Workers” to notify this worker.', 'error');
  window.open(link, '_blank');
}

/* ---- inline SVG icons (24x24 stroke, Lucide-style) --------------------- */
const ICON = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0Z"/><circle cx="12" cy="10" r="3"/>',
  building: '<path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  whatsapp: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z"/>',
  edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'
};
function svg(name, cls) {
  return `<svg class="${cls || ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name] || ''}</svg>`;
}

/* ---- toasts ------------------------------------------------------------ */
function toast(title, msg, type) {
  type = type || 'info';
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  const ico = type === 'success' ? 'check' : type === 'error' ? 'alert' : 'info';
  el.innerHTML = `${svg(ico)}<div class="t-body"><div class="t-title">${esc(title)}</div>${msg ? `<div class="t-msg">${esc(msg)}</div>` : ''}</div>`;
  root.appendChild(el);
  const kill = () => { el.classList.add('closing'); setTimeout(() => el.remove(), 220); };
  el.addEventListener('click', kill);
  setTimeout(kill, type === 'error' ? 6000 : 4000);
}

// Show/hide the password on the login screen.
const PW_EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
const PW_EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 0 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></svg>';

function togglePw(btn) {
  const input = document.getElementById('login-pw');
  if (!input) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  btn.innerHTML = show ? PW_EYE_OFF : PW_EYE;
}

/* ---- empty + skeleton helpers ----------------------------------------- */
function emptyState(icon, title, msg) {
  return `<div class="empty">${svg(icon)}<div class="empty-title">${esc(title)}</div><div>${esc(msg)}</div></div>`;
}
function skeletonCards(n) {
  let out = '<div class="grid">';
  for (let i = 0; i < (n || 3); i++) {
    out += `<div class="sk-card"><div class="sk sk-line" style="width:50%;height:16px"></div>
      <div class="sk sk-line" style="width:75%"></div><div class="sk sk-line" style="width:65%"></div>
      <div class="sk sk-line" style="width:80%;margin-bottom:0"></div></div>`;
  }
  return out + '</div>';
}

let _lastRenderedView = null;
const _reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// When true, the in-flight render came from a background poll: no loading bar,
// no skeleton, and the DOM is only swapped if the produced HTML actually changed.
let _silent = false;
const _viewSig = {}; // view -> last rendered HTML, for cheap change detection

async function render(opts) {
  const silent = !!(opts && opts.silent);
  _silent = silent;
  const el = document.getElementById('view');
  const viewChanged = currentView !== _lastRenderedView;
  // Show a skeleton on a real (foreground) view switch so first paint isn't blank.
  if (!silent && viewChanged && !_reduceMotion) el.innerHTML = skeletonCards(4);
  try {
    if (currentView === 'map') {
      // The map keeps a live Leaflet instance, so it manages its own DOM/diffing.
      await renderMap(el, silent);
    } else {
      const html = await buildView(currentView);
      // On a silent poll, only touch the DOM when something actually changed —
      // this prevents flicker and never disrupts an open <select> or scroll.
      if (!(silent && _viewSig[currentView] === html)) {
        el.innerHTML = html;
        _viewSig[currentView] = html;
        animateView(el, viewChanged);
      }
    }
    _lastRenderedView = currentView;
  } catch (e) {
    if (!silent) el.innerHTML = emptyState('alert', 'Something went wrong', e.message);
    // Silent poll errors are transient — ignore and try again next tick.
  }
}

async function buildView(view) {
  if (view === 'board') return renderBoard();
  if (view === 'week') return renderWeek();
  if (view === 'bookings') return renderBookings();
  if (view === 'workers') return renderWorkers();
  if (view === 'sites') return renderSites();
  if (view === 'reports') return renderReports();
  return '';
}

/* ---- live auto-refresh (polling) -------------------------------------- */
// Vercel serverless can't hold WebSocket/SSE connections, so we poll. Cheap:
// one read per tick, paused when the tab is hidden, skipped when unchanged.
const POLL_MS = 5000;
let _pollTimer = null;
let _pollBusy = false;

function startAutoRefresh() {
  if (_pollTimer) return;
  _pollTimer = setInterval(autoTick, POLL_MS);
  document.addEventListener('visibilitychange', onVisible);
}
function stopAutoRefresh() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  document.removeEventListener('visibilitychange', onVisible);
}
function onVisible() { if (!document.hidden) autoTick(); } // refresh instantly on return

async function autoTick() {
  if (!TOKEN || document.hidden || _pollBusy) return;
  // Never disrupt an open modal or an input/select the user is actively using.
  const modalRoot = document.getElementById('modal-root');
  if (modalRoot && modalRoot.children.length) return;
  const ae = document.activeElement;
  if (ae && /^(SELECT|INPUT|TEXTAREA)$/.test(ae.tagName) &&
      document.getElementById('view').contains(ae)) return;
  _pollBusy = true;
  try { await render({ silent: true }); }
  catch (_) { /* transient — ignore */ }
  finally { _pollBusy = false; }
}

// Fade the view in. On a real view switch we also stagger the cards and
// count metric numbers up; in-view refreshes (status/date changes) just fade.
function animateView(el, viewChanged) {
  if (_reduceMotion) return;
  el.classList.remove('view-enter', 'view-quick');
  void el.offsetWidth; // restart the animation
  if (!viewChanged) { el.classList.add('view-quick'); return; }
  el.classList.add('view-enter');
  el.querySelectorAll('.metric, .card, .wk-col, table').forEach((node, i) => {
    node.style.animationDelay = Math.min(i, 14) * 0.03 + 's';
    node.classList.add('rise');
  });
  countUpMetrics(el);
}

function countUpMetrics(el) {
  el.querySelectorAll('.metric .value').forEach((node) => {
    const target = parseInt(node.textContent, 10);
    if (isNaN(target)) return;
    const dur = 500, start = performance.now();
    (function tick(now) {
      const p = Math.min(1, (now - start) / dur);
      node.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(tick);
    })(start);
  });
}

/* ---- date picker bar --------------------------------------------------- */
function dateBar() {
  return `<div class="toolbar">
    <label style="color:var(--muted);font-size:13px">Date</label>
    <input type="date" style="width:auto" value="${selectedDate}" onchange="setDate(this.value)" />
    <button class="btn secondary small" onclick="setDate('${todayStr()}')">Today</button>
  </div>`;
}
function setDate(d) { selectedDate = d; render(); }

/* ---- BOARD ------------------------------------------------------------- */
async function renderBoard() {
  const data = await api('GET', '/api/dashboard?date=' + selectedDate, null, { silent: _silent });
  const s = data.summary;
  const cards = data.sites.map((site) => {
    const rows = site.bookings.map((b) => {
      const dist = b.onSiteDistanceM;
      const distBadge = dist == null ? '' : dist <= 150
        ? `<span class="tag active" title="Checked in ${dist}m from site">on-site ✓</span>`
        : `<span class="tag unavailable" title="Checked in ${dist}m from site">⚠ ${dist >= 1000 ? (dist / 1000).toFixed(1) + 'km' : dist + 'm'} away</span>`;
      return `
      <div class="row">
        <div class="who">${esc(b.workerName)}<small>${esc(b.workerRole || '')}${b.startTime ? ' · ' + esc(b.startTime) : ''}</small></div>
        <div style="display:flex;align-items:center;gap:6px">
          ${distBadge}
          <button class="btn-link" title="Notify on WhatsApp" aria-label="Notify ${esc(b.workerName)} on WhatsApp" onclick="notify(${b.waLink ? `'${b.waLink}'` : 'null'})">${svg('whatsapp')} Notify</button>
          <select class="status-select pill-select ${b.status}" style="width:auto" aria-label="Status for ${esc(b.workerName)}" onchange="changeStatus('${b.id}', this.value)">
            ${STATUS_ORDER.map((st) => `<option value="${st}" ${st === b.status ? 'selected' : ''}>${STATUS_LABEL[st]}</option>`).join('')}
          </select>
        </div>
      </div>`;
    }).join('');
    const open = Math.max(0, site.requiredWorkers - site.bookings.filter((b) => b.status !== 'cancelled').length);
    const openRow = open > 0
      ? `<div class="row"><span class="slot-open">${open} slot${open > 1 ? 's' : ''} open</span>
           <button class="btn small secondary" onclick="openBooking(null, '${site.id}')">${svg('plus')} Assign</button></div>`
      : '';
    return `<div class="card">
      <div class="card-head">
        <span class="card-title">${esc(site.name)}</span>
        <span class="tag ${site.status}">${SITE_STATUS_LABEL[site.status]}</span>
      </div>
      <div class="card-sub">${esc(site.address || '')} · ${site.bookings.length} of ${site.requiredWorkers} workers</div>
      ${rows || '<div class="card-sub" style="margin:0">No one assigned yet.</div>'}
      ${openRow}
    </div>`;
  }).join('');

  return `
    <div class="page-head">
      <div><h1>Dispatch board</h1><div class="sub">${fmtDate(selectedDate)}</div></div>
      <button class="btn" onclick="openBooking()">${svg('plus')} New booking</button>
    </div>
    ${dateBar()}
    <div class="metrics">
      <div class="metric accent-green"><div class="m-top">${svg('users', 'm-ico')}<span class="label">Workers available</span></div><div class="value">${s.available}</div></div>
      <div class="metric"><div class="m-top">${svg('pin', 'm-ico')}<span class="label">On site now</span></div><div class="value">${s.onSite}</div></div>
      <div class="metric"><div class="m-top">${svg('building', 'm-ico')}<span class="label">Active sites</span></div><div class="value">${s.activeSites}</div></div>
      <div class="metric accent-amber"><div class="m-top">${svg('clock', 'm-ico')}<span class="label">Pending / assigned</span></div><div class="value">${s.pending}</div></div>
    </div>
    <div class="grid">${cards || emptyState('building', 'No sites yet', 'Add your first site under “Sites” to start dispatching.')}</div>
    ${legend()}`;
}

function legend() {
  const colors = { pending: '#d4537e', assigned: '#378add', en_route: '#ef9f27', on_site: '#1d9e75', checked_out: '#888780', completed: '#639922' };
  return `<div class="legend">${Object.entries(colors).map(([k, c]) =>
    `<span><span class="ldot" style="background:${c}"></span>${STATUS_LABEL[k]}</span>`).join('')}</div>`;
}

async function changeStatus(id, status) {
  try { await api('POST', `/api/bookings/${id}/status`, { status }); toast('Status updated', STATUS_LABEL[status], 'success'); render(); }
  catch (e) { toast('Could not update', e.message, 'error'); }
}

/* ---- WEEK -------------------------------------------------------------- */
async function renderWeek() {
  const from = weekStart, to = addDays(weekStart, 6);
  const list = await api('GET', `/api/bookings?from=${from}&to=${to}`, null, { silent: _silent });
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const byDay = {};
  days.forEach((d) => (byDay[d] = []));
  list.forEach((b) => { if (byDay[b.date]) byDay[b.date].push(b); });

  const tToday = todayStr();
  const cols = days.map((d) => {
    const dt = new Date(d + 'T00:00:00');
    const head = dt.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    const items = byDay[d]
      .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''))
      .map((b) => `<div class="wk-item" title="${esc(b.workerName)} → ${esc(b.siteName)}">
        <div class="wk-line"><span class="pill ${b.status}">${STATUS_LABEL[b.status]}</span>${b.startTime ? `<span class="wk-time">${esc(b.startTime)}</span>` : ''}</div>
        <div class="wk-worker">${esc(b.workerName)}</div>
        <div class="wk-site">${esc(b.siteName)}</div>
      </div>`).join('');
    return `<div class="wk-col${d === tToday ? ' wk-today' : ''}">
      <div class="wk-head">${head}</div>
      <div class="wk-add" onclick="weekAdd('${d}')">${svg('plus')} add</div>
      ${items || '<div class="wk-empty">—</div>'}
    </div>`;
  }).join('');

  return `
    <div class="page-head"><div><h1>Week view</h1><div class="sub">${fmtDate(from)} – ${fmtDate(to)}</div></div>
      <button class="btn" onclick="openBooking()">${svg('plus')} New booking</button></div>
    <div class="toolbar">
      <button class="btn secondary small" onclick="shiftWeek(-7)">← Prev</button>
      <button class="btn secondary small" onclick="thisWeek()">This week</button>
      <button class="btn secondary small" onclick="shiftWeek(7)">Next →</button>
    </div>
    <div class="week-grid">${cols}</div>
    ${legend()}`;
}
function shiftWeek(n) { weekStart = addDays(weekStart, n); render(); }
function thisWeek() { weekStart = mondayOf(new Date()); render(); }
function weekAdd(d) { selectedDate = d; openBooking(); }

/* ---- MAP (Leaflet street map, offline plot fallback) ------------------- */
let _leafletMap = null;
let _leafletLoading = null;
let _leafletMarkers = {}; // siteId -> marker, for in-place live updates
let _mapSig = null;       // signature of the data the map currently shows

// Load Leaflet from the CDN only when first needed. Resolves false (and we fall
// back to the offline plot) if there's no internet, so the app never blocks.
function ensureLeaflet() {
  if (window.L) return Promise.resolve(true);
  if (_leafletLoading) return _leafletLoading;
  _leafletLoading = new Promise((resolve) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
    setTimeout(() => resolve(!!window.L), 4000); // give up quietly when offline
  });
  return _leafletLoading;
}

function mapSignature(pts) {
  return pts.map((p) => {
    const onsite = p.bookings.filter((b) => b.status === 'on_site').length;
    return `${p.id}:${p.lat},${p.lng}:${p.status}:${onsite}:${p.bookings.length}/${p.requiredWorkers}:${esc(p.name)}`;
  }).join('|');
}

async function renderMap(el, silent) {
  const data = await api('GET', '/api/dashboard?date=' + selectedDate, null, { silent });
  const pts = data.sites.filter((s) => s.lat != null && s.lng != null);
  const sig = mapSignature(pts);

  // Background poll with a live Leaflet map: update markers in place so the
  // user's current pan/zoom is preserved. Only when something actually changed.
  if (silent && _leafletMap && window.L) {
    if (sig !== _mapSig) { updateLeafletMarkers(pts); _mapSig = sig; }
    return;
  }
  if (silent && sig === _mapSig) return; // offline plot, nothing changed

  el.innerHTML = `<div class="page-head"><div><h1>Site map</h1><div class="sub">${fmtDate(selectedDate)}</div></div></div>${dateBar()}
    <div class="map-wrap"><div id="map"></div></div>${legend()}`;
  const map = document.getElementById('map');
  _leafletMap = null; _leafletMarkers = {};
  if (!pts.length) {
    map.innerHTML = `<div class="empty" style="border:none">No sites have coordinates yet. Add lat/lng under “Sites”.</div>`;
    _mapSig = sig; return;
  }

  // Real street map when online; otherwise the offline coordinate plot.
  const haveLeaflet = await ensureLeaflet();
  if (haveLeaflet && window.L) renderLeaflet(map, pts);
  else renderOfflinePlot(map, pts);
  _mapSig = sig;
}

function siteColor(p) {
  return p.status === 'active' ? '#1d9e75' : p.status === 'on_hold' ? '#ef9f27' : '#888780';
}
function siteIcon(p) {
  const onsite = p.bookings.filter((b) => b.status === 'on_site').length;
  return L.divIcon({
    className: '', iconSize: [26, 26], iconAnchor: [13, 13],
    html: `<div style="width:26px;height:26px;border-radius:50%;background:${siteColor(p)};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:600;font-size:13px;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3)">${onsite}</div>`
  });
}
function sitePopup(p) {
  const onsite = p.bookings.filter((b) => b.status === 'on_site').length;
  return `<b>${esc(p.name)}</b><br>${esc(p.address || '')}<br>${p.bookings.length}/${p.requiredWorkers} workers · ${onsite} on-site`;
}

function renderLeaflet(mapEl, pts) {
  if (_leafletMap) { _leafletMap.remove(); }
  _leafletMarkers = {};
  const m = L.map(mapEl);
  _leafletMap = m;
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap', maxZoom: 19
  }).addTo(m);
  const bounds = [];
  pts.forEach((p) => {
    _leafletMarkers[p.id] = L.marker([p.lat, p.lng], { icon: siteIcon(p) }).addTo(m).bindPopup(sitePopup(p));
    bounds.push([p.lat, p.lng]);
  });
  if (bounds.length === 1) m.setView(bounds[0], 13);
  else m.fitBounds(bounds, { padding: [40, 40] });
  setTimeout(() => m.invalidateSize(), 100);
}

// Live update without rebuilding the map (keeps the current pan/zoom).
function updateLeafletMarkers(pts) {
  const seen = {};
  pts.forEach((p) => {
    seen[p.id] = true;
    const mk = _leafletMarkers[p.id];
    if (mk) { mk.setIcon(siteIcon(p)); mk.setPopupContent(sitePopup(p)); }
    else { _leafletMarkers[p.id] = L.marker([p.lat, p.lng], { icon: siteIcon(p) }).addTo(_leafletMap).bindPopup(sitePopup(p)); }
  });
  Object.keys(_leafletMarkers).forEach((id) => {
    if (!seen[id]) { _leafletMap.removeLayer(_leafletMarkers[id]); delete _leafletMarkers[id]; }
  });
}

function renderOfflinePlot(map, pts) {
  const lats = pts.map((p) => p.lat), lngs = pts.map((p) => p.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const pad = 60, W = map.clientWidth || 900, H = 460;
  const sx = (lng) => maxLng === minLng ? W / 2 : pad + (lng - minLng) / (maxLng - minLng) * (W - 2 * pad);
  const sy = (lat) => maxLat === minLat ? H / 2 : pad + (maxLat - lat) / (maxLat - minLat) * (H - 2 * pad);

  const dots = pts.map((p) => {
    const onsite = p.bookings.filter((b) => b.status === 'on_site').length;
    const color = p.status === 'active' ? '#1d9e75' : p.status === 'on_hold' ? '#ef9f27' : '#888780';
    return `<g transform="translate(${sx(p.lng).toFixed(0)},${sy(p.lat).toFixed(0)})">
      <circle r="13" fill="${color}" />
      <text x="0" y="5" text-anchor="middle" fill="#fff" font-size="12" font-weight="600">${onsite}</text>
      <text x="0" y="32" text-anchor="middle" fill="#1f1e1b" font-size="13" font-weight="600">${esc(p.name)}</text>
      <text x="0" y="49" text-anchor="middle" fill="#6b6a64" font-size="11">${p.bookings.length}/${p.requiredWorkers} workers</text>
    </g>`;
  }).join('');
  map.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" style="background:#faf9f5">
    <text x="14" y="24" fill="#6b6a64" font-size="12">Numbers in circles = workers currently on-site</text>${dots}</svg>`;
}

/* ---- BOOKINGS ---------------------------------------------------------- */
async function renderBookings() {
  const list = await api('GET', '/api/bookings?date=' + selectedDate, null, { silent: _silent });
  const rows = list.map((b) => `
    <tr>
      <td>${esc(b.workerName)}</td>
      <td>${esc(b.siteName)}</td>
      <td>${esc(b.startTime || '—')}</td>
      <td><span class="pill ${b.status}">${STATUS_LABEL[b.status]}</span></td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn-link" onclick="notify(${b.waLink ? `'${b.waLink}'` : 'null'})">${svg('whatsapp')} Notify</button>
        <button class="btn-link" onclick="openBooking('${b.id}')">${svg('edit')} Edit</button>
        <button class="btn-link danger" onclick="deleteBooking('${b.id}')">${svg('trash')} Delete</button>
      </td>
    </tr>`).join('');
  return `<div class="page-head"><div><h1>Bookings</h1><div class="sub">${fmtDate(selectedDate)}</div></div>
    <button class="btn" onclick="openBooking()">${svg('plus')} New booking</button></div>${dateBar()}
    ${list.length ? `<div class="table-wrap"><table><thead><tr><th>Worker</th><th>Site</th><th>Start</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
      : emptyState('inbox', 'No bookings for this day', 'Create a booking to assign a worker to a site.')}`;
}

async function deleteBooking(id) {
  if (!confirm('Delete this booking?')) return;
  try { await api('DELETE', '/api/bookings/' + id); toast('Booking deleted', '', 'success'); render(); }
  catch (e) { toast('Could not delete', e.message, 'error'); }
}

async function openBooking(id, presetSiteId) {
  const [workers, sites, existing] = await Promise.all([
    api('GET', '/api/workers'), api('GET', '/api/sites'),
    id ? api('GET', '/api/bookings?date=' + selectedDate).then((l) => l.find((b) => b.id === id)) : Promise.resolve(null)
  ]);
  if (id && !existing) return alert('That booking could not be found (it may have moved to another day).');
  const b = existing || { workerId: '', siteId: presetSiteId || '', date: selectedDate, startTime: '', notes: '' };
  modal(`${id ? 'Edit' : 'New'} booking`, `
    <div class="field"><label>Worker</label><select id="f-worker">
      ${workers.map((w) => `<option value="${w.id}" ${w.id === b.workerId ? 'selected' : ''}>${esc(w.name)} — ${esc(w.role)}${w.availability === 'unavailable' ? ' (unavailable)' : ''}</option>`).join('')}
    </select></div>
    <div class="field"><label>Site</label><select id="f-site">
      ${sites.map((s) => `<option value="${s.id}" ${s.id === b.siteId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
    </select></div>
    <div class="form-row">
      <div class="field"><label>Date</label><input id="f-date" type="date" value="${b.date}" /></div>
      <div class="field"><label>Start time</label><input id="f-time" type="time" value="${b.startTime || ''}" /></div>
    </div>
    <div class="field"><label>Notes</label><textarea id="f-notes" rows="2">${esc(b.notes || '')}</textarea></div>
  `, async () => {
    const payload = {
      workerId: document.getElementById('f-worker').value,
      siteId: document.getElementById('f-site').value,
      date: document.getElementById('f-date').value,
      startTime: document.getElementById('f-time').value,
      notes: document.getElementById('f-notes').value
    };
    if (id) {
      await api('PUT', '/api/bookings/' + id, payload);
      closeModal(); render();
    } else {
      const created = await api('POST', '/api/bookings', payload);
      closeModal(); render();
      if (created.smsSent) {
        toast('Booking saved', 'SMS sent to ' + created.workerName + '.', 'success');
      } else if (created.waLink && confirm('Booking saved. Notify ' + created.workerName + ' on WhatsApp now?')) {
        notify(created.waLink);
      } else {
        toast('Booking saved', '', 'success');
      }
    }
  });
}

/* ---- WORKERS ----------------------------------------------------------- */
async function renderWorkers() {
  const list = await api('GET', '/api/workers', null, { silent: _silent });
  const rows = list.map((w) => `
    <tr>
      <td>${esc(w.name)}</td>
      <td>${esc(w.role || '—')}</td>
      <td>${esc(w.phone || '—')}</td>
      <td><span class="tag ${w.availability}">${w.availability === 'available' ? 'Available' : 'Unavailable'}</span></td>
      <td><code>${esc(w.pin || '—')}</code></td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn-link" onclick="openWorker('${w.id}')">${svg('edit')} Edit</button>
        <button class="btn-link danger" onclick="deleteWorker('${w.id}')">${svg('trash')} Delete</button>
      </td>
    </tr>`).join('');
  return `<div class="page-head"><div><h1>Workers</h1><div class="sub">${list.length} total</div></div>
    <button class="btn" onclick="openWorker()">${svg('plus')} Add worker</button></div>
    ${list.length ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>Phone</th><th>Availability</th><th>PIN</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
      : emptyState('users', 'No workers yet', 'Add workers and give each a login PIN for the worker app.')}`;
}

async function openWorker(id) {
  const w = id ? (await api('GET', '/api/workers')).find((x) => x.id === id) : { name: '', role: '', phone: '', availability: 'available', pin: '' };
  modal(`${id ? 'Edit' : 'Add'} worker`, `
    <div class="field"><label>Name</label><input id="w-name" value="${esc(w.name)}" /></div>
    <div class="form-row">
      <div class="field"><label>Role / skill</label><input id="w-role" value="${esc(w.role || '')}" /></div>
      <div class="field"><label>Phone</label><input id="w-phone" value="${esc(w.phone || '')}" /></div>
    </div>
    <div class="form-row">
      <div class="field"><label>Availability</label><select id="w-avail">
        <option value="available" ${w.availability === 'available' ? 'selected' : ''}>Available</option>
        <option value="unavailable" ${w.availability === 'unavailable' ? 'selected' : ''}>Unavailable</option>
      </select></div>
      <div class="field"><label>Login PIN</label><input id="w-pin" value="${esc(w.pin || '')}" placeholder="e.g. 1234" /></div>
    </div>
  `, async () => {
    const payload = {
      name: document.getElementById('w-name').value.trim(),
      role: document.getElementById('w-role').value.trim(),
      phone: document.getElementById('w-phone').value.trim(),
      availability: document.getElementById('w-avail').value,
      pin: document.getElementById('w-pin').value.trim()
    };
    if (!payload.name) return toast('Name is required', '', 'error');
    if (id) await api('PUT', '/api/workers/' + id, payload);
    else await api('POST', '/api/workers', payload);
    closeModal(); toast(id ? 'Worker updated' : 'Worker added', payload.name, 'success'); render();
  });
}
async function deleteWorker(id) {
  if (!confirm('Delete this worker and their bookings?')) return;
  try { await api('DELETE', '/api/workers/' + id); toast('Worker deleted', '', 'success'); render(); }
  catch (e) { toast('Could not delete', e.message, 'error'); }
}

/* ---- SITES ------------------------------------------------------------- */
async function renderSites() {
  const list = await api('GET', '/api/sites', null, { silent: _silent });
  const rows = list.map((s) => `
    <tr>
      <td>${esc(s.name)}</td>
      <td>${esc(s.address || '—')}</td>
      <td>${s.requiredWorkers}</td>
      <td><span class="tag ${s.status}">${SITE_STATUS_LABEL[s.status]}</span></td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn-link" onclick="openSite('${s.id}')">${svg('edit')} Edit</button>
        <button class="btn-link danger" onclick="deleteSite('${s.id}')">${svg('trash')} Delete</button>
      </td>
    </tr>`).join('');
  return `<div class="page-head"><div><h1>Sites</h1><div class="sub">${list.length} total</div></div>
    <button class="btn" onclick="openSite()">${svg('plus')} Add site</button></div>
    ${list.length ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Address</th><th>Needed</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
      : emptyState('building', 'No sites yet', 'Add job sites so you can dispatch workers to them.')}`;
}

async function openSite(id) {
  const s = id ? (await api('GET', '/api/sites')).find((x) => x.id === id) : { name: '', address: '', lat: '', lng: '', requiredWorkers: 1, status: 'active' };
  modal(`${id ? 'Edit' : 'Add'} site`, `
    <div class="field"><label>Site name</label><input id="s-name" value="${esc(s.name)}" /></div>
    <div class="field"><label>Address</label><input id="s-addr" value="${esc(s.address || '')}" /></div>
    <div class="form-row">
      <div class="field"><label>Latitude</label><input id="s-lat" value="${s.lat ?? ''}" placeholder="optional" /></div>
      <div class="field"><label>Longitude</label><input id="s-lng" value="${s.lng ?? ''}" placeholder="optional" /></div>
    </div>
    <div class="form-row">
      <div class="field"><label>Workers needed</label><input id="s-req" type="number" min="1" value="${s.requiredWorkers}" /></div>
      <div class="field"><label>Status</label><select id="s-status">
        <option value="active" ${s.status === 'active' ? 'selected' : ''}>Active</option>
        <option value="on_hold" ${s.status === 'on_hold' ? 'selected' : ''}>On hold</option>
        <option value="completed" ${s.status === 'completed' ? 'selected' : ''}>Completed</option>
      </select></div>
    </div>
  `, async () => {
    const payload = {
      name: document.getElementById('s-name').value.trim(),
      address: document.getElementById('s-addr').value.trim(),
      lat: document.getElementById('s-lat').value.trim(),
      lng: document.getElementById('s-lng').value.trim(),
      requiredWorkers: document.getElementById('s-req').value,
      status: document.getElementById('s-status').value
    };
    if (!payload.name) return toast('Name is required', '', 'error');
    if (id) await api('PUT', '/api/sites/' + id, payload);
    else await api('POST', '/api/sites', payload);
    closeModal(); toast(id ? 'Site updated' : 'Site added', payload.name, 'success'); render();
  });
}
async function deleteSite(id) {
  if (!confirm('Delete this site and its bookings?')) return;
  try { await api('DELETE', '/api/sites/' + id); toast('Site deleted', '', 'success'); render(); }
  catch (e) { toast('Could not delete', e.message, 'error'); }
}

/* ---- REPORTS ----------------------------------------------------------- */
async function renderReports() {
  const r = await api('GET', '/api/reports', null, { silent: _silent });
  const wRows = r.perWorker.map((w) => `<tr><td>${esc(w.name)}</td><td>${esc(w.role || '—')}</td><td>${w.jobs}</td><td>${w.hours}</td></tr>`).join('');
  const sRows = r.perSite.map((s) => `<tr><td>${esc(s.name)}</td><td><span class="tag ${s.status}">${SITE_STATUS_LABEL[s.status]}</span></td><td>${s.assigned}</td><td>${s.completed}</td></tr>`).join('');
  return `<div class="page-head"><div><h1>Reports</h1><div class="sub">All time</div></div></div>
    <div class="metrics">
      <div class="metric accent-green"><div class="m-top">${svg('users', 'm-ico')}<span class="label">Workers</span></div><div class="value">${r.totals.workers}</div></div>
      <div class="metric"><div class="m-top">${svg('building', 'm-ico')}<span class="label">Sites</span></div><div class="value">${r.totals.sites}</div></div>
      <div class="metric"><div class="m-top">${svg('inbox', 'm-ico')}<span class="label">Bookings</span></div><div class="value">${r.totals.bookings}</div></div>
      <div class="metric accent-amber"><div class="m-top">${svg('check', 'm-ico')}<span class="label">Completed</span></div><div class="value">${r.totals.completed}</div></div>
    </div>
    <h2 style="font-size:16px;margin-bottom:12px">Hours per worker</h2>
    <div class="table-wrap" style="margin-bottom:26px"><table><thead><tr><th>Worker</th><th>Role</th><th>Jobs done</th><th>Hours</th></tr></thead><tbody>${wRows || '<tr><td colspan="4" style="color:var(--muted-2)">No completed jobs yet.</td></tr>'}</tbody></table></div>
    <h2 style="font-size:16px;margin-bottom:12px">Coverage per site</h2>
    <div class="table-wrap"><table><thead><tr><th>Site</th><th>Status</th><th>Assigned</th><th>Completed</th></tr></thead><tbody>${sRows || '<tr><td colspan="4" style="color:var(--muted-2)">No sites yet.</td></tr>'}</tbody></table></div>`;
}

/* ---- modal ------------------------------------------------------------- */
function modal(title, bodyHtml, onSave) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal">
      <h2>${esc(title)}</h2>
      ${bodyHtml}
      <div class="modal-actions">
        <button class="btn secondary" onclick="closeModal()">Cancel</button>
        <button class="btn" id="modal-save">Save</button>
      </div>
    </div></div>`;
  const saveBtn = document.getElementById('modal-save');
  saveBtn.onclick = async () => {
    if (saveBtn.disabled) return;
    const label = saveBtn.textContent;
    saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
    try { await onSave(); }
    catch (e) { toast('Could not save', e.message, 'error'); }
    finally { saveBtn.disabled = false; saveBtn.textContent = label; }
  };
  // Submit on Enter from any text input inside the modal.
  root.querySelectorAll('input').forEach((inp) => inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveBtn.click(); }
  }));
}
function closeModal() {
  const root = document.getElementById('modal-root');
  const overlay = root.querySelector('.overlay');
  if (!overlay || _reduceMotion) { root.innerHTML = ''; return; }
  overlay.classList.add('closing');
  setTimeout(() => { root.innerHTML = ''; }, 170);
}

/* ---- boot -------------------------------------------------------------- */
if (TOKEN) {
  api('GET', '/api/workers').then(showApp).catch(() => logout());
}
