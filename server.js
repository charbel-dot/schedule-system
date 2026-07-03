/*
 * Worker dispatch system — Express app.
 * Serves the manager app (/) and worker app (/worker) plus a small REST API.
 *
 * The app is exported so it can run two ways:
 *   • Locally:  `node server.js`  (calls app.listen)
 *   • Vercel:   api/index.js requires this file and uses the exported app as
 *               the serverless handler (no listen).
 *
 * All persistence + session state lives in ./db (Redis in production, a local
 * JSON file in development), so every handler is async.
 */
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Behind Vercel's proxy so req.ip reflects the real client for rate limiting.
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  // API responses are always live data — never let a proxy/browser cache them
  // (the apps poll these endpoints for real-time updates).
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

/* ---- async handler wrapper (so rejections reach the error handler) ----- */
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ---- reference data ---------------------------------------------------- */
const BOOKING_STATUSES = ['pending', 'assigned', 'en_route', 'on_site', 'checked_out', 'completed', 'cancelled'];
const SITE_STATUSES = ['active', 'on_hold', 'completed'];
const AVAILABILITY = ['available', 'unavailable'];

/* ---- config (env first, data.json settings as a local-dev fallback) ---- */
function envTwilio() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (accountSid && authToken && from) return { accountSid, authToken, from };
  return null;
}

function resolveSettings(data) {
  const s = (data && data.settings) || {};
  // In production (Redis) a password MUST come from env — no insecure default.
  // In local file mode we fall back to "admin" so dev is zero-setup.
  const localPassword = db.usingRedis() ? '' : (s.managerPassword || 'admin');
  return {
    managerPassword: process.env.MANAGER_PASSWORD || localPassword,
    businessName: process.env.BUSINESS_NAME || s.businessName || 'Dispatch',
    twilio: envTwilio() || s.twilio || null
  };
}

/* ---- manager auth ------------------------------------------------------ */
async function requireManager(req, res, next) {
  const token = req.get('x-auth-token');
  if (token && (await db.hasManagerToken(token))) return next();
  return res.status(401).json({ error: 'Not authorised' });
}
const mgr = ah(requireManager);

app.post('/api/login', ah(async (req, res) => {
  const ip = req.ip || 'unknown';
  if (await db.isLoginLocked(ip)) {
    return res.status(429).json({ error: 'Too many attempts. Wait a minute and try again.' });
  }
  const { password } = req.body || {};
  const settings = resolveSettings(await db.getData());
  if (settings.managerPassword && password === settings.managerPassword) {
    await db.clearLogin(ip);
    const token = crypto.randomUUID();
    await db.addManagerToken(token);
    return res.json({ token });
  }
  await db.registerFailedLogin(ip);
  res.status(401).json({ error: 'Wrong password' });
}));

app.post('/api/logout', mgr, ah(async (req, res) => {
  await db.deleteManagerToken(req.get('x-auth-token'));
  res.json({ ok: true });
}));

/* ---- helpers ----------------------------------------------------------- */
function find(data, coll, id) {
  return data[coll].find((x) => x.id === id);
}

function enrichBooking(data, settings, b) {
  const worker = find(data, 'workers', b.workerId);
  const site = find(data, 'sites', b.siteId);
  return {
    ...b,
    workerName: worker ? worker.name : '(removed worker)',
    workerRole: worker ? worker.role : '',
    workerPhone: worker ? worker.phone : '',
    siteName: site ? site.name : '(removed site)',
    siteAddress: site ? site.address : '',
    waLink: worker && site ? whatsappLink(settings, worker, site, b) : null
  };
}

/* ---- notifications ----------------------------------------------------- */
function bookingMessage(settings, worker, site, b) {
  const biz = settings.businessName || 'Dispatch';
  const when = b.startTime ? `${b.date} at ${b.startTime}` : b.date;
  return `Hi ${worker.name}, you're booked for ${biz}.\n` +
    `Site: ${site.name}\n` +
    (site.address ? `Address: ${site.address}\n` : '') +
    `When: ${when}\n` +
    (b.notes ? `Notes: ${b.notes}\n` : '') +
    `Open your jobs to confirm.`;
}

// Free, zero-setup: a wa.me deep link that opens WhatsApp with the message
// pre-filled. The manager taps it to send. Works with no API keys.
function whatsappLink(settings, worker, site, b) {
  const phone = String(worker.phone || '').replace(/[^\d]/g, '');
  if (!phone) return null;
  return `https://wa.me/${phone}?text=${encodeURIComponent(bookingMessage(settings, worker, site, b))}`;
}

// Optional: real automated SMS via Twilio if credentials are configured.
// No-ops (returns false) when not configured, so the app works out of the box.
async function trySendSms(settings, worker, site, b) {
  const tw = settings.twilio;
  if (!tw || !tw.accountSid || !tw.authToken || !tw.from || !worker.phone) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${tw.accountSid}/Messages.json`;
    const body = new URLSearchParams({ To: worker.phone, From: tw.from, Body: bookingMessage(settings, worker, site, b) });
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${tw.accountSid}:${tw.authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body,
      signal: controller.signal
    });
    return res.ok;
  } catch (e) {
    console.error('SMS send failed:', e.message);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/* ---- workers ----------------------------------------------------------- */
app.get('/api/workers', mgr, ah(async (req, res) => {
  const data = await db.getData();
  res.json(data.workers);
}));

app.post('/api/workers', mgr, ah(async (req, res) => {
  const { name, phone = '', role = '', availability = 'available', pin = '' } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (!AVAILABILITY.includes(availability)) return res.status(400).json({ error: 'Bad availability' });
  const data = await db.getData();
  const worker = { id: db.newId(), name, phone, role, availability, pin };
  data.workers.push(worker);
  await db.saveData(data);
  res.status(201).json(worker);
}));

app.put('/api/workers/:id', mgr, ah(async (req, res) => {
  const data = await db.getData();
  const w = find(data, 'workers', req.params.id);
  if (!w) return res.status(404).json({ error: 'Not found' });
  const { name, phone, role, availability, pin } = req.body || {};
  if (availability && !AVAILABILITY.includes(availability)) return res.status(400).json({ error: 'Bad availability' });
  if (name !== undefined) w.name = name;
  if (phone !== undefined) w.phone = phone;
  if (role !== undefined) w.role = role;
  if (availability !== undefined) w.availability = availability;
  if (pin !== undefined) w.pin = pin;
  await db.saveData(data);
  res.json(w);
}));

app.delete('/api/workers/:id', mgr, ah(async (req, res) => {
  const data = await db.getData();
  data.workers = data.workers.filter((w) => w.id !== req.params.id);
  data.bookings = data.bookings.filter((b) => b.workerId !== req.params.id);
  await db.saveData(data);
  res.json({ ok: true });
}));

/* ---- sites ------------------------------------------------------------- */
app.get('/api/sites', mgr, ah(async (req, res) => {
  const data = await db.getData();
  res.json(data.sites);
}));

app.post('/api/sites', mgr, ah(async (req, res) => {
  const { name, address = '', lat = null, lng = null, requiredWorkers = 1, status = 'active' } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (!SITE_STATUSES.includes(status)) return res.status(400).json({ error: 'Bad status' });
  const data = await db.getData();
  const site = { id: db.newId(), name, address, lat, lng, requiredWorkers: Number(requiredWorkers) || 1, status };
  data.sites.push(site);
  await db.saveData(data);
  res.status(201).json(site);
}));

app.put('/api/sites/:id', mgr, ah(async (req, res) => {
  const data = await db.getData();
  const s = find(data, 'sites', req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const { name, address, lat, lng, requiredWorkers, status } = req.body || {};
  if (status && !SITE_STATUSES.includes(status)) return res.status(400).json({ error: 'Bad status' });
  if (name !== undefined) s.name = name;
  if (address !== undefined) s.address = address;
  if (lat !== undefined) s.lat = lat === '' ? null : Number(lat);
  if (lng !== undefined) s.lng = lng === '' ? null : Number(lng);
  if (requiredWorkers !== undefined) s.requiredWorkers = Number(requiredWorkers) || 1;
  if (status !== undefined) s.status = status;
  await db.saveData(data);
  res.json(s);
}));

app.delete('/api/sites/:id', mgr, ah(async (req, res) => {
  const data = await db.getData();
  data.sites = data.sites.filter((s) => s.id !== req.params.id);
  data.bookings = data.bookings.filter((b) => b.siteId !== req.params.id);
  await db.saveData(data);
  res.json({ ok: true });
}));

/* ---- bookings ---------------------------------------------------------- */
app.get('/api/bookings', mgr, ah(async (req, res) => {
  const data = await db.getData();
  const settings = resolveSettings(data);
  let list = data.bookings;
  if (req.query.date) list = list.filter((b) => b.date === req.query.date);
  if (req.query.from && req.query.to) list = list.filter((b) => b.date >= req.query.from && b.date <= req.query.to);
  res.json(list.map((b) => enrichBooking(data, settings, b)));
}));

app.post('/api/bookings', mgr, ah(async (req, res) => {
  const { workerId, siteId, date, startTime = '', notes = '', status = 'assigned' } = req.body || {};
  if (!workerId || !siteId || !date) return res.status(400).json({ error: 'workerId, siteId and date are required' });
  const data = await db.getData();
  const settings = resolveSettings(data);
  const worker = find(data, 'workers', workerId);
  const site = find(data, 'sites', siteId);
  if (!worker) return res.status(400).json({ error: 'Unknown worker' });
  if (!site) return res.status(400).json({ error: 'Unknown site' });
  if (!BOOKING_STATUSES.includes(status)) return res.status(400).json({ error: 'Bad status' });
  const booking = {
    id: db.newId(),
    workerId, siteId, date, startTime, notes, status,
    statusHistory: [{ status, at: new Date().toISOString() }],
    createdAt: new Date().toISOString()
  };
  data.bookings.push(booking);
  await db.saveData(data);
  const smsSent = await trySendSms(settings, worker, site, booking);
  res.status(201).json({ ...enrichBooking(data, settings, booking), smsSent });
}));

app.put('/api/bookings/:id', mgr, ah(async (req, res) => {
  const data = await db.getData();
  const settings = resolveSettings(data);
  const b = find(data, 'bookings', req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  const { workerId, siteId, date, startTime, notes } = req.body || {};
  if (workerId !== undefined) b.workerId = workerId;
  if (siteId !== undefined) b.siteId = siteId;
  if (date !== undefined) b.date = date;
  if (startTime !== undefined) b.startTime = startTime;
  if (notes !== undefined) b.notes = notes;
  await db.saveData(data);
  res.json(enrichBooking(data, settings, b));
}));

app.delete('/api/bookings/:id', mgr, ah(async (req, res) => {
  const data = await db.getData();
  data.bookings = data.bookings.filter((b) => b.id !== req.params.id);
  await db.saveData(data);
  res.json({ ok: true });
}));

app.post('/api/bookings/:id/status', mgr, ah(async (req, res) => {
  const data = await db.getData();
  const settings = resolveSettings(data);
  const b = find(data, 'bookings', req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  const { status } = req.body || {};
  if (!BOOKING_STATUSES.includes(status)) return res.status(400).json({ error: 'Bad status' });
  b.status = status;
  b.statusHistory.push({ status, at: new Date().toISOString() });
  await db.saveData(data);
  res.json(enrichBooking(data, settings, b));
}));

/* ---- dashboard (sites + their workers for a day) ----------------------- */
app.get('/api/dashboard', mgr, ah(async (req, res) => {
  const data = await db.getData();
  const settings = resolveSettings(data);
  const date = req.query.date || db.today();
  const dayBookings = data.bookings.filter((b) => b.date === date);

  const sites = data.sites.map((s) => {
    const sb = dayBookings.filter((b) => b.siteId === s.id).map((b) => enrichBooking(data, settings, b));
    return { ...s, bookings: sb };
  });

  const summary = {
    available: data.workers.filter((w) => w.availability === 'available').length,
    onSite: dayBookings.filter((b) => b.status === 'on_site').length,
    activeSites: data.sites.filter((s) => s.status === 'active').length,
    pending: dayBookings.filter((b) => b.status === 'pending' || b.status === 'assigned').length
  };

  res.json({ date, sites, summary });
}));

/* ---- reports ----------------------------------------------------------- */
app.get('/api/reports', mgr, ah(async (req, res) => {
  const data = await db.getData();
  const completed = data.bookings.filter((b) => b.status === 'completed');

  // hours per worker, from checked-in -> checked-out (or completed) timestamps
  const perWorker = data.workers.map((w) => {
    const wb = data.bookings.filter((b) => b.workerId === w.id);
    let hours = 0;
    let jobs = 0;
    for (const b of wb) {
      const inAt = b.statusHistory.find((h) => h.status === 'on_site');
      const outAt = b.statusHistory.find((h) => h.status === 'checked_out' || h.status === 'completed');
      if (inAt && outAt) {
        hours += (new Date(outAt.at) - new Date(inAt.at)) / 36e5;
        jobs += 1;
      }
    }
    return { id: w.id, name: w.name, role: w.role, jobs, hours: Math.round(hours * 10) / 10 };
  });

  const perSite = data.sites.map((s) => {
    const sb = data.bookings.filter((b) => b.siteId === s.id);
    return {
      id: s.id,
      name: s.name,
      status: s.status,
      assigned: sb.length,
      completed: sb.filter((b) => b.status === 'completed').length
    };
  });

  res.json({
    totals: {
      workers: data.workers.length,
      sites: data.sites.length,
      bookings: data.bookings.length,
      completed: completed.length
    },
    perWorker,
    perSite
  });
}));

/* ---- worker app (name + PIN login -> short-lived worker token) --------- */
// Public name picker for the login screen — id + name only, never phone/pin.
app.get('/api/worker/roster', ah(async (req, res) => {
  const data = await db.getData();
  res.json(data.workers.map((w) => ({ id: w.id, name: w.name })));
}));

app.post('/api/worker/login', ah(async (req, res) => {
  const { workerId, pin } = req.body || {};
  const lockKey = 'worker:' + (workerId || 'unknown');
  if (await db.isLoginLocked(lockKey)) {
    return res.status(429).json({ error: 'Too many attempts. Wait a minute and try again.' });
  }
  const data = await db.getData();
  const w = find(data, 'workers', workerId);
  if (!w || !w.pin || w.pin !== String(pin || '').trim()) {
    await db.registerFailedLogin(lockKey);
    return res.status(401).json({ error: 'Wrong PIN' });
  }
  await db.clearLogin(lockKey);
  const token = crypto.randomUUID();
  await db.addWorkerToken(token, w.id);
  res.json({ id: w.id, name: w.name, role: w.role, token });
}));

// Worker endpoints require the worker's own token, scoped to their id.
async function requireWorker(req, res, next) {
  const token = req.get('x-worker-token');
  const workerId = token ? await db.getWorkerIdForToken(token) : null;
  if (!workerId || workerId !== req.params.id) return res.status(401).json({ error: 'Not authorised' });
  next();
}
const wkr = ah(requireWorker);

app.get('/api/worker/:id/bookings', wkr, ah(async (req, res) => {
  const data = await db.getData();
  const settings = resolveSettings(data);
  const w = find(data, 'workers', req.params.id);
  if (!w) return res.status(404).json({ error: 'Not found' });
  const date = req.query.date || db.today();
  const list = data.bookings
    .filter((b) => b.workerId === req.params.id && b.date === date)
    .map((b) => enrichBooking(data, settings, b));
  res.json({ worker: { id: w.id, name: w.name }, bookings: list });
}));

// Workers may only advance their own booking through the allowed chain.
const WORKER_NEXT = {
  pending: 'assigned',
  assigned: 'en_route',
  en_route: 'on_site',
  on_site: 'checked_out',
  checked_out: 'completed'
};

app.post('/api/worker/:id/bookings/:bid/advance', wkr, ah(async (req, res) => {
  const data = await db.getData();
  const settings = resolveSettings(data);
  const b = find(data, 'bookings', req.params.bid);
  if (!b || b.workerId !== req.params.id) return res.status(404).json({ error: 'Not found' });
  const next = WORKER_NEXT[b.status];
  if (!next) return res.status(400).json({ error: 'Nothing further to do' });
  b.status = next;
  b.statusHistory.push({ status: next, at: new Date().toISOString() });
  await db.saveData(data);
  res.json(enrichBooking(data, settings, b));
}));

/* ---- serve worker page at a friendly url ------------------------------- */
app.get('/worker', (req, res) => res.sendFile(path.join(__dirname, 'public', 'worker.html')));

/* ---- unknown API routes + error handling (always JSON, never a stack) -- */
app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown endpoint' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Server error:', err.message);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

/* ---- local dev server (Vercel imports `app` and never reaches this) ----- */
if (require.main === module) {
  app.listen(PORT, () => {
    console.log('');
    console.log('  Worker dispatch system is running.');
    console.log('  Storage: ' + (db.usingRedis() ? 'Upstash Redis' : 'local data.json file'));
    console.log('  Manager app:  http://localhost:' + PORT);
    console.log('  Worker app:   http://localhost:' + PORT + '/worker');
    console.log('  (Workers on the same WiFi: use http://YOUR-PC-IP:' + PORT + '/worker)');
    console.log('');
  });
}

module.exports = app;
