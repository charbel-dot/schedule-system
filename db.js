/*
 * Datastore for the dispatch system.
 *
 * Two interchangeable backends, chosen automatically at startup:
 *
 *   • Upstash Redis (REST) — used when UPSTASH_REDIS_REST_URL / _TOKEN
 *     (or Vercel KV's KV_REST_API_URL / _TOKEN) are present. This is what runs
 *     on Vercel, where the filesystem is read-only and process memory is not
 *     shared between invocations.
 *
 *   • Local JSON file — used for zero-setup local development when no Redis
 *     credentials are present. Data lives in data.json next to this file.
 *
 * Everything is async so both backends expose one identical interface.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const useRedis = Boolean(REDIS_URL && REDIS_TOKEN);

let redis = null;
if (useRedis) {
  const { Redis } = require('@upstash/redis');
  redis = new Redis({ url: REDIS_URL, token: REDIS_TOKEN });
}

const DATA_FILE = path.join(__dirname, 'data.json');
const DATA_KEY = 'dispatch:data';
const MGR_TOKEN_PREFIX = 'dispatch:mtok:';
const WORKER_TOKEN_PREFIX = 'dispatch:wtok:';
const LOGIN_FAIL_PREFIX = 'dispatch:loginfail:';

const SESSION_TTL_SECONDS = 60 * 60 * 12; // manager + worker sessions last 12h
const LOCK_WINDOW_SECONDS = 60;           // brute-force lockout window
const MAX_LOGIN_FAILS = 5;                // failures before lockout

function newId() {
  return crypto.randomUUID();
}

function today() {
  // Local date (not UTC) so it matches the browser's "today".
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ---- seed data (first run only) ---------------------------------------- */
function mkBooking(workerId, siteId, date, startTime, status) {
  return {
    id: newId(),
    workerId,
    siteId,
    date,
    startTime,
    notes: '',
    status,
    statusHistory: [{ status, at: new Date().toISOString() }],
    createdAt: new Date().toISOString()
  };
}

function seed() {
  const t = today();
  const workers = [
    { id: newId(), name: 'Karim Haddad', phone: '+961 70 111 222', role: 'Technician', availability: 'available', pin: '1001' },
    { id: newId(), name: 'Tony Saad',    phone: '+961 71 333 444', role: 'Technician', availability: 'available', pin: '1002' },
    { id: newId(), name: 'Rami Jabbour', phone: '+961 76 555 666', role: 'Electrician', availability: 'available', pin: '1003' },
    { id: newId(), name: 'Elie Mansour', phone: '+961 03 777 888', role: 'Foreman',    availability: 'available', pin: '1004' },
    { id: newId(), name: 'Joe Khoury',   phone: '+961 78 999 000', role: 'Helper',     availability: 'available', pin: '1005' },
    { id: newId(), name: 'Sami Daou',    phone: '+961 70 121 212', role: 'Technician', availability: 'unavailable', pin: '1006' }
  ];
  const sites = [
    { id: newId(), name: 'Marina Tower',   address: 'Dbayeh, Metn',     lat: 33.9469, lng: 35.5889, requiredWorkers: 3, status: 'active' },
    { id: newId(), name: 'Achrafieh Villa', address: 'Achrafieh, Beirut', lat: 33.8869, lng: 35.5215, requiredWorkers: 3, status: 'active' },
    { id: newId(), name: 'Jounieh Mall',   address: 'Jounieh, Keserwan', lat: 33.9808, lng: 35.6178, requiredWorkers: 2, status: 'active' },
    { id: newId(), name: 'Hamra Office',   address: 'Hamra, Beirut',     lat: 33.8959, lng: 35.4823, requiredWorkers: 2, status: 'on_hold' }
  ];
  const bookings = [
    mkBooking(workers[0].id, sites[0].id, t, '08:00', 'on_site'),
    mkBooking(workers[1].id, sites[0].id, t, '08:00', 'on_site'),
    mkBooking(workers[2].id, sites[0].id, t, '09:00', 'en_route'),
    mkBooking(workers[3].id, sites[1].id, t, '08:30', 'on_site'),
    mkBooking(workers[4].id, sites[1].id, t, '08:30', 'assigned')
  ];
  return {
    // managerPassword / twilio are kept here only as a fallback for local file
    // mode. In production set MANAGER_PASSWORD (and Twilio) as env vars instead.
    settings: { businessName: 'New Tronics', twilio: null },
    workers,
    sites,
    bookings
  };
}

/* ---- file backend (local development) ---------------------------------- */
function loadFile() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (e) {
      // Don't silently wipe real data — back up the bad file and stop clearly.
      const backup = DATA_FILE + '.corrupt-' + Date.now();
      try { fs.renameSync(DATA_FILE, backup); } catch (_) {}
      console.error('\n  data.json is corrupted and could not be read.');
      console.error('  It was moved to: ' + backup);
      console.error('  Restart to begin with fresh sample data, or restore a backup.\n');
      process.exit(1);
    }
  }
  const seeded = seed();
  saveFile(seeded);
  return seeded;
}

function saveFile(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

/* ---- in-memory token + lockout store (file/dev mode only) -------------- */
// In Redis mode these are never touched; Redis holds the state instead so it
// survives across serverless invocations.
const memTokens = new Map();       // token   -> expiresAt (ms)
const memWorkerTokens = new Map(); // token   -> { workerId, expiresAt }
const memLoginFails = new Map();   // ip      -> { count, expiresAt }
const alive = (exp) => typeof exp === 'number' && exp > Date.now();

/* ---- data -------------------------------------------------------------- */
async function getData() {
  if (useRedis) {
    const data = await redis.get(DATA_KEY);
    if (data) return data;
    const seeded = seed();
    await redis.set(DATA_KEY, seeded);
    return seeded;
  }
  return loadFile();
}

async function saveData(data) {
  if (useRedis) { await redis.set(DATA_KEY, data); return; }
  saveFile(data);
}

/* ---- manager sessions -------------------------------------------------- */
async function addManagerToken(token) {
  if (useRedis) { await redis.set(MGR_TOKEN_PREFIX + token, 1, { ex: SESSION_TTL_SECONDS }); return; }
  memTokens.set(token, Date.now() + SESSION_TTL_SECONDS * 1000);
}

async function hasManagerToken(token) {
  if (!token) return false;
  if (useRedis) return Boolean(await redis.get(MGR_TOKEN_PREFIX + token));
  const exp = memTokens.get(token);
  if (!alive(exp)) { memTokens.delete(token); return false; }
  return true;
}

async function deleteManagerToken(token) {
  if (!token) return;
  if (useRedis) { await redis.del(MGR_TOKEN_PREFIX + token); return; }
  memTokens.delete(token);
}

/* ---- worker sessions --------------------------------------------------- */
async function addWorkerToken(token, workerId) {
  if (useRedis) { await redis.set(WORKER_TOKEN_PREFIX + token, workerId, { ex: SESSION_TTL_SECONDS }); return; }
  memWorkerTokens.set(token, { workerId, expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000 });
}

async function getWorkerIdForToken(token) {
  if (!token) return null;
  if (useRedis) {
    const id = await redis.get(WORKER_TOKEN_PREFIX + token);
    return id ? String(id) : null;
  }
  const rec = memWorkerTokens.get(token);
  if (!rec || !alive(rec.expiresAt)) { memWorkerTokens.delete(token); return null; }
  return rec.workerId;
}

/* ---- login lockout ----------------------------------------------------- */
async function isLoginLocked(ip) {
  if (useRedis) {
    const n = await redis.get(LOGIN_FAIL_PREFIX + ip);
    return Number(n || 0) >= MAX_LOGIN_FAILS;
  }
  const rec = memLoginFails.get(ip);
  if (!rec || !alive(rec.expiresAt)) return false;
  return rec.count >= MAX_LOGIN_FAILS;
}

async function registerFailedLogin(ip) {
  if (useRedis) {
    const key = LOGIN_FAIL_PREFIX + ip;
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, LOCK_WINDOW_SECONDS);
    return;
  }
  const now = Date.now();
  let rec = memLoginFails.get(ip);
  if (!rec || !alive(rec.expiresAt)) rec = { count: 0, expiresAt: now + LOCK_WINDOW_SECONDS * 1000 };
  rec.count += 1;
  memLoginFails.set(ip, rec);
}

async function clearLogin(ip) {
  if (useRedis) { await redis.del(LOGIN_FAIL_PREFIX + ip); return; }
  memLoginFails.delete(ip);
}

module.exports = {
  newId,
  today,
  usingRedis: () => useRedis,
  getData,
  saveData,
  addManagerToken,
  hasManagerToken,
  deleteManagerToken,
  addWorkerToken,
  getWorkerIdForToken,
  isLoginLocked,
  registerFailedLogin,
  clearLogin
};
