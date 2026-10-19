/**
 * Segari Program Makan — server side.
 * Data lives in the "Program Makmur Segari" spreadsheet; the web app runs as the
 * script owner, so employees log in with NIK + nama (no Google account needed).
 */

const SPREADSHEET_ID = '1-d3_QdcnV6YtEwx3CMkEZS60I5dtqsdajTZRWafXJW8';
const TZ = 'Asia/Jakarta';
const PRICE = 5000;
const SESSION_DAYS = 30;
const LUNCH_FB_FROM = 12 * 60;        // feedback opens 12:00 for lunch
const DINNER_FB_FROM = 18 * 60 + 30;  // and 18:30 for dinner
const FB_EDIT_DAYS = 3;
// Browser-tab icon: the Segari mark (logo/segari-mark.svg) as PNG, served from the public repo
// because HtmlService only accepts a favicon URL.
const FAVICON_URL = 'https://raw.githubusercontent.com/k-rangga/segari-makmur/main/assets/favicon.png';
const FB_TAGS = ['Porsi kurang', 'Kurang hangat', 'Terlalu asin', 'Terlalu pedas', 'Kurang variasi', 'Antre lama', 'Menu favorit'];

const SHEETS = {
  employee: ['NIK', 'Nama', 'Departemen', 'Store', 'Kategori', 'Role', 'Aktif'],
  pendaftaran: ['Tanggal', 'NIK', 'Siang', 'Malam', 'Diperbarui'],
  tutup: ['Grup', 'Tanggal', 'Waktu', 'Alasan', 'Dibuat oleh', 'Dibuat pada'],
  masukan: ['Tanggal', 'Waktu', 'NIK', 'Nilai', 'Tag', 'Catatan', 'Diperbarui'],
  menu: ['Tanggal', 'Siang', 'Malam'],
  pengaturan: ['Kunci', 'Nilai', 'Keterangan'],
  voucher: ['Kode', 'Nilai', 'Berlaku sampai', 'Dipakai oleh', 'Dipakai pada', 'Potongan', 'Rincian', 'Diunggah pada', 'Diunggah oleh']
};
// Columns kept as plain text so dates and NIKs are never auto-converted.
const TEXT_COLS = { employee: ['A'], pendaftaran: ['A', 'B'], tutup: ['B'], masukan: ['A', 'C'], menu: ['A'], pengaturan: ['B'], voucher: ['A', 'C', 'D', 'G'] };
const DEFAULT_SETTINGS = [
  ['batas_hari', '3', 'White collar: pendaftaran minggu depan ditutup N hari sebelum Senin (5 = Rabu, 3 = Jumat, 1 = Minggu, 0 = Senin, -2 = Rabu minggu makan)'],
  ['batas_jam', '23:59', 'White collar: jam batas pendaftaran (HH:MM)'],
  ['batas_hari_blue', '3', 'Blue collar: pendaftaran minggu depan ditutup N hari sebelum Senin (5 = Rabu, 3 = Jumat, 1 = Minggu, 0 = Senin, -2 = Rabu minggu makan)'],
  ['batas_jam_blue', '23:59', 'Blue collar: jam batas pendaftaran (HH:MM)'],
  ['maks_porsi', '3', 'Maksimal porsi per waktu makan']
];

// ---------------------------------------------------------------- web app

function doGet() {
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('Segari Program Makan')
    .setFaviconUrl(FAVICON_URL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/** Single entry point for google.script.run. */
function api(action, token, payload) {
  const fn = ACTIONS[action];
  if (!fn) throw new Error('Aksi tidak dikenal: ' + action);
  ensureSetup_();
  return fn(token, payload || {});
}

const ACTIONS = {
  login: (_, p) => login_(p.nik, p.name),
  bootstrap: token => bootstrap_(auth_(token)),
  saveRegistrations: (token, p) => saveRegistrations_(auth_(token), p.changes || [], p.voucher),
  checkVoucher: (token, p) => { auth_(token); return checkVoucher_(p.code); },
  adminVouchers: token => { auth_(token, true); return adminVouchers_(); },
  uploadVouchers: (token, p) => uploadVouchers_(auth_(token, true), p.rows || []),
  deleteVoucher: (token, p) => { auth_(token, true); return deleteVoucher_(p.code); },
  saveFeedback: (token, p) => saveFeedback_(auth_(token), p),
  adminDay: (token, p) => { auth_(token, true); return adminDay_(p.date); },
  adminMonth: (token, p) => { auth_(token, true); return adminMonth_(p.ym); },
  adminMonthDetail: (token, p) => { auth_(token, true); return adminMonthDetail_(p.ym); },
  adminFeedback: (token, p) => { auth_(token, true); return adminFeedback_(p); },
  adminClosures: token => { auth_(token, true); return adminClosures_(); },
  adminImpact: (token, p) => { auth_(token, true); const ds = (p.dates || []).filter(isKey_); return impactOf_(ds.length ? regsMonths_(ds.map(k => k.slice(0, 7))) : [], ds, p.meal); },
  addClosure: (token, p) => addClosure_(auth_(token, true), p),
  removeClosure: (token, p) => { auth_(token, true); return removeClosure_(p.g); },
  saveSettings: (token, p) => { auth_(token, true); return saveSettings_(p); }
};

// ---------------------------------------------------------------- setup

function ensureSetup_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('setup_v2')) return;           // bump when SHEETS gains a tab (v2: voucher)
  setupSheets();
  props.setProperty('setup_v2', '1');
}

/** Creates missing tabs and headers. Safe to run again from the editor. */
function setupSheets() {
  const ss = ss_();
  Object.keys(SHEETS).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const hdr = SHEETS[name];
    const first = sh.getRange(1, 1, 1, hdr.length).getDisplayValues()[0];
    if (first.every(v => !String(v).trim())) {
      sh.getRange(1, 1, 1, hdr.length).setValues([hdr]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
    (TEXT_COLS[name] || []).forEach(c => sh.getRange(c + ':' + c).setNumberFormat('@'));
  });
  const set = ss.getSheetByName('pengaturan');
  if (set.getLastRow() < 2) set.getRange(2, 1, DEFAULT_SETTINGS.length, 3).setValues(DEFAULT_SETTINGS);
}

function ss_() {
  if (!ss_.cache) ss_.cache = SpreadsheetApp.openById(SPREADSHEET_ID);
  return ss_.cache;
}

function sheet_(name) {
  let sh = ss_().getSheetByName(name);
  if (!sh) { setupSheets(); sh = ss_().getSheetByName(name); }
  return sh;
}

/** Reads a tab into objects keyed by lower-cased header; `_row` is the 1-based sheet row. Memoized per request. */
function readTable_(name) {
  if (MEMO['t:' + name]) return MEMO['t:' + name];
  const sh = sheet_(name);
  const values = sh.getDataRange().getValues();
  const hdr = (values[0] || []).map(h => String(h).trim().toLowerCase());
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const o = { _row: i + 1 };
    let any = false;
    hdr.forEach((h, j) => { const v = norm_(values[i][j]); o[h] = v; if (v !== '') any = true; });
    if (any) rows.push(o);
  }
  return (MEMO['t:' + name] = { sheet: sh, rows });
}

function norm_(v) {
  if (v instanceof Date) {
    return v.getFullYear() < 1900 ? Utilities.formatDate(v, TZ, 'HH:mm') : Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  }
  if (typeof v === 'number') return String(v);
  return String(v == null ? '' : v).trim();
}

// ---------------------------------------------------------------- dates

function now_() {
  const d = new Date();
  return {
    key: Utilities.formatDate(d, TZ, 'yyyy-MM-dd'),
    min: Number(Utilities.formatDate(d, TZ, 'H')) * 60 + Number(Utilities.formatDate(d, TZ, 'm')),
    ms: d.getTime()
  };
}
function k2t_(k) { const p = k.split('-').map(Number); return Date.UTC(p[0], p[1] - 1, p[2]); }
function t2k_(t) { return new Date(t).toISOString().slice(0, 10); }
function addDays_(k, n) { return t2k_(k2t_(k) + n * 864e5); }
function dow_(k) { return (new Date(k2t_(k)).getUTCDay() + 6) % 7; }
function isKey_(k) { return typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k) && t2k_(k2t_(k)) === k; }
function hm_(s) { const p = String(s).split(':').map(Number); return (p[0] || 0) * 60 + (p[1] || 0); }
function monthEnd_(ym) { const p = ym.split('-').map(Number); return t2k_(Date.UTC(p[0], p[1], 0)); }
function addMonths_(ym, n) { const p = ym.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1 + n, 1)).toISOString().slice(0, 7); }

const COLLARS = ['white', 'blue'];
const CUT_KEYS = { white: ['batas_hari', 'batas_jam'], blue: ['batas_hari_blue', 'batas_jam_blue'] };
// Days before the meal week's Monday: 5 = Rabu minggu sebelumnya … 1 = Minggu, 0 = Senin … -2 = Rabu minggu makan.
const MAX_CUT_DAYS = 5, MIN_CUT_DAYS = -2;

function cutoff_(k, s, collar) {
  const ws = addDays_(k, -dow_(k)), c = s.cut[collar === 'blue' ? 'blue' : 'white'];
  return { key: addDays_(ws, -c.days), min: hm_(c.time) };
}
/** Locked once the week's cutoff passes; today and past days are always locked (matters when the cutoff falls inside the meal week). */
function locked_(k, s, now, collar) {
  const c = cutoff_(k, s, collar);
  return k <= now.key || now.key > c.key || (now.key === c.key && now.min >= c.min);
}

// ---------------------------------------------------------------- data access

function settings_() {
  return cached_('set2', () => {
    const m = {};
    readTable_('pengaturan').rows.forEach(r => { m[String(r.kunci).toLowerCase()] = r.nilai; });
    const int = (v, lo, hi, d) => { const n = parseInt(v, 10); return isNaN(n) ? d : Math.max(lo, Math.min(hi, n)); };
    const time = (v, d) => /^\d{1,2}:\d{2}$/.test(v || '') ? v.padStart(5, '0') : d;
    const white = { days: int(m.batas_hari, MIN_CUT_DAYS, MAX_CUT_DAYS, 3), time: time(m.batas_jam, '23:59') };
    // Blue collar falls back to the white-collar cutoff until its own keys are set.
    const blue = { days: int(m.batas_hari_blue, MIN_CUT_DAYS, MAX_CUT_DAYS, white.days), time: time(m.batas_jam_blue, white.time) };
    return { cut: { white, blue }, maxPortions: int(m.maks_porsi, 1, 10, 3) };
  });
}

/** `fresh` skips the cache (used when a NIK is not found, so new employees can log in at once). */
function employees_(fresh) {
  return cached_('emp1', () => readTable_('employee').rows.map(r => {
    const dept = r.departemen || '', kat = r.kategori || '';
    const collar = /blue/i.test(kat) ? 'blue' : /white/i.test(kat) ? 'white' : /gudang|operasional/i.test(dept) ? 'blue' : 'white';
    return {
      nik: String(r.nik).replace(/\s/g, ''), name: r.nama, dept, store: r.store || 'Tanpa store', collar,
      admin: /admin|hr/i.test(r.role || ''), active: !/^(tidak|no|false|0|n|nonaktif)$/i.test(r.aktif || '')
    };
  }).filter(e => e.nik && e.name), fresh);
}

function storesOf_(emps) {
  const seen = [];
  emps.forEach(e => { if (seen.indexOf(e.store) < 0) seen.push(e.store); });
  return seen;
}

function mealOf_(v) {
  const s = String(v).toLowerCase();
  if (s === 'both' || (/siang/.test(s) && /malam/.test(s)) || /keduanya/.test(s)) return 'both';
  if (s === 'lunch' || /siang/.test(s)) return 'lunch';
  if (s === 'dinner' || /malam/.test(s)) return 'dinner';
  return 'both';
}
const MEAL_LABEL = { both: 'Siang & malam', lunch: 'Siang', dinner: 'Malam' };

function closures_() {
  return cached_('cls1', () => readTable_('tutup').rows.filter(r => isKey_(r.tanggal)).map(r => ({
    g: r.grup || r.tanggal, date: r.tanggal, meal: mealOf_(r.waktu), reason: r.alasan || 'Kantin tutup', by: r['dibuat oleh'] || ''
  })));
}
function blockOf_(closures, k, meal) {
  return closures.find(c => c.date === k && (c.meal === 'both' || c.meal === meal)) || null;
}

/**
 * Registrations are append-only: each save adds rows, and the newest row for a
 * (date, NIK) wins. Older rows stay as history until compactRegistrations() runs.
 */
function regsAll_() {
  const at = {}, out = [];
  readTable_('pendaftaran').rows.forEach(r => {
    if (!isKey_(r.tanggal)) return;
    const v = { date: r.tanggal, nik: String(r.nik).replace(/\s/g, ''), l: Math.max(0, parseInt(r.siang, 10) || 0), d: Math.max(0, parseInt(r.malam, 10) || 0) };
    const key = v.date + '|' + v.nik;
    if (key in at) out[at[key]] = v; else { at[key] = out.length; out.push(v); }
  });
  return out;
}

function menus_(from, to) {
  const all = cached_('menu1', () => readTable_('menu').rows.filter(r => isKey_(r.tanggal)).map(r => [r.tanggal, r.siang || '', r.malam || '']));
  const out = {};
  all.forEach(m => { if (m[0] >= from && m[0] <= to) out[m[0]] = { lunch: m[1], dinner: m[2] }; });
  return out;
}

function feedbackAll_() {
  return readTable_('masukan').rows.filter(r => isKey_(r.tanggal)).map(r => ({
    _row: r._row, date: r.tanggal, meal: mealOf_(r.waktu) === 'dinner' ? 'dinner' : 'lunch', nik: String(r.nik).replace(/\s/g, ''),
    r: String(r.nilai).toLowerCase(), tags: r.tag ? String(r.tag).split(/\s*;\s*/).filter(Boolean) : [], note: r.catatan || ''
  })).filter(f => ['enak', 'biasa', 'kurang'].indexOf(f.r) >= 0);
}

function stamp_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'); }

// ---------------------------------------------------------------- caching
// MEMO lives for one request (each google.script.run call is a fresh execution).
// CacheService holds small tables and month-chunked registrations across requests.
// Writes made through the app clear the affected keys; manual sheet edits show up
// within CACHE_TTL seconds.
const CACHE_TTL = 300;
const MEMO = {};
function cache_() { return CacheService.getScriptCache(); }

function cached_(key, build, fresh) {
  if (!fresh && MEMO[key] !== undefined) return MEMO[key];
  if (!fresh) { const hit = cache_().get(key); if (hit) return (MEMO[key] = JSON.parse(hit)); }
  const val = build(), json = JSON.stringify(val);
  if (json.length < 95000) cache_().put(key, json, CACHE_TTL);
  return (MEMO[key] = val);
}

function forget_(keys, tables) {
  keys.forEach(k => { delete MEMO[k]; });
  (tables || []).forEach(t => { delete MEMO['t:' + t]; });
  if (keys.length) cache_().removeAll(keys);
}

function monthsBetween_(from, to) {
  const out = [];
  for (let ym = from.slice(0, 7); ym <= to.slice(0, 7); ym = addMonths_(ym, 1)) out.push(ym);
  return out;
}

// Values larger than one cache entry (100 KB) are split into parts: KEY holds the part count,
// KEY:0..n the text. Stored text always starts with '#' so an empty value is still a value.
function bigGet_(key) {
  const c = cache_(), n = c.get(key);
  if (n == null) return null;
  const keys = [];
  for (let i = 0; i < Number(n); i++) keys.push(key + ':' + i);
  const parts = c.getAll(keys);
  let t = '';
  for (let i = 0; i < keys.length; i++) { if (parts[keys[i]] == null) return null; t += parts[keys[i]]; }
  return t;
}
function bigPut_(key, text) {
  const n = Math.max(1, Math.ceil(text.length / 90000)), put = {};
  for (let i = 0; i < n; i++) put[key + ':' + i] = text.slice(i * 90000, (i + 1) * 90000);
  put[key] = String(n);
  cache_().putAll(put, CACHE_TTL);
}
// A generation number per cache: writers bump it after writing the sheet, and a reader only
// stores what it read if the generation did not change meanwhile (no stale overwrite).
const bumpGen_ = key => cache_().put(key, Date.now() + '-' + Math.random(), 21600);

function cachedBig_(key, build, fresh) {
  if (!fresh && MEMO[key] !== undefined) return MEMO[key];
  if (!fresh) { const t = bigGet_(key); if (t != null) return (MEMO[key] = JSON.parse(t.slice(1))); }
  const gen = cache_().get('gen:' + key), val = build();
  if (cache_().get('gen:' + key) === gen) bigPut_(key, '#' + JSON.stringify(val));
  return (MEMO[key] = val);
}
function forgetBig_(key) { bumpGen_('gen:' + key); cache_().remove(key); delete MEMO[key]; }

/** Rows for the given months from a per-month cache; months not cached are built from loadAll(). */
function monthlyRows_(prefix, genKey, yms, loadAll, enc, dec) {
  const c = cache_(), out = [], need = [];
  yms = yms.filter((y, i) => yms.indexOf(y) === i);
  const meta = c.getAll(yms.map(y => prefix + y)), keys = [];
  yms.forEach(y => { const n = meta[prefix + y]; if (n == null) need.push(y); else for (let i = 0; i < Number(n); i++) keys.push(prefix + y + ':' + i); });
  const parts = keys.length ? c.getAll(keys) : {};
  yms.forEach(y => {
    if (need.indexOf(y) >= 0) return;
    let t = '';
    for (let i = 0; i < Number(meta[prefix + y]); i++) { const v = parts[prefix + y + ':' + i]; if (v == null) { need.push(y); return; } t += v; }
    t.slice(1).split('\n').forEach(l => { if (l) out.push(dec(l)); });
  });
  if (need.length) {
    const gen = c.get(genKey), by = {};
    need.forEach(y => { by[y] = []; });
    loadAll().forEach(r => { const y = r.date.slice(0, 7); if (by[y]) { by[y].push(r); out.push(r); } });
    if (c.get(genKey) === gen) need.forEach(y => bigPut_(prefix + y, '#' + by[y].map(enc).join('\n')));
  }
  return out;
}

const REG_PREFIX = 'reg3:', FB_PREFIX = 'fb3:';
const encReg_ = r => r.date + '|' + r.nik + '|' + r.l + '|' + r.d;
const decReg_ = l => { const f = l.split('|'); return { date: f[0], nik: f.slice(1, -2).join('|'), l: Number(f[f.length - 2]), d: Number(f[f.length - 1]) }; };

/** Registrations (qty > 0) for the given months. */
function regsMonths_(yms) {
  return monthlyRows_(REG_PREFIX, 'regGen', yms, () => regsAll_().filter(r => r.l || r.d), encReg_, decReg_);
}

/** After a save (inside the lock, after the sheet write): update cached months in place. */
function patchRegs_(nik, changed) {
  const byMonth = {};
  Object.keys(changed).forEach(k => { (byMonth[k.slice(0, 7)] = byMonth[k.slice(0, 7)] || []).push(k); });
  const texts = {};
  Object.keys(byMonth).forEach(y => { texts[y] = bigGet_(REG_PREFIX + y); });
  bumpGen_('regGen');
  Object.keys(byMonth).forEach(y => {
    if (texts[y] == null) return;                 // not cached: the next read builds it from the sheet
    const ds = byMonth[y];
    const rows = texts[y].slice(1).split('\n').filter(Boolean).map(decReg_).filter(r => !(r.nik === nik && ds.indexOf(r.date) >= 0));
    ds.forEach(k => { const v = changed[k]; if (v.l || v.d) rows.push({ date: k, nik, l: v.l, d: v.d }); });
    bigPut_(REG_PREFIX + y, '#' + rows.map(encReg_).join('\n'));
  });
  delete MEMO['t:pendaftaran'];
}

const encFb_ = r => JSON.stringify([r.date, r.meal, r.nik, r.r, r.tags, r.note]);
const decFb_ = l => { const a = JSON.parse(l); return { date: a[0], meal: a[1], nik: a[2], r: a[3], tags: a[4], note: a[5] }; };
/** Feedback rows for the given months. */
function fbMonths_(yms) { return monthlyRows_(FB_PREFIX, 'fbGen', yms, feedbackAll_, encFb_, decFb_); }

function groupByDate_(regs) {
  const m = {};
  regs.forEach(r => { (m[r.date] = m[r.date] || []).push(r); });
  return m;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Server sedang sibuk. Coba lagi sebentar.');
  try { return fn(); } finally { lock.releaseLock(); }
}

// ---------------------------------------------------------------- auth

function secret_() {
  const props = PropertiesService.getScriptProperties();
  let s = props.getProperty('SESSION_SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); props.setProperty('SESSION_SECRET', s); }
  return s;
}
function sign_(s) { return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(s, secret_())); }

function login_(nik, name) {
  nik = String(nik || '').replace(/\s/g, '');            // any characters; spaces ignored
  const nm = String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!nik) throw new Error('NIK wajib diisi.');
  const cache = CacheService.getScriptCache(), ck = 'fail:' + nik.toUpperCase().slice(0, 200), fails = Number(cache.get(ck) || 0);
  if (fails >= 8) throw new Error('Terlalu banyak percobaan. Coba lagi 15 menit lagi.');
  const fail = msg => { cache.put(ck, String(fails + 1), 900); throw new Error(msg); };
  const same = e => e.nik.toUpperCase() === nik.toUpperCase();
  const emp = employees_().find(same) || employees_(true).find(same);
  if (!emp) fail('NIK tidak ditemukan. Hubungi People & HR.');
  if (!emp.active) throw new Error('NIK ini tidak aktif. Hubungi People & HR.');
  if (!nm) throw new Error('Nama wajib diisi.');
  if (emp.name.trim().toLowerCase().replace(/\s+/g, ' ') !== nm) fail('Nama tidak sesuai dengan NIK ini.');
  cache.remove(ck);
  const p = emp.nik + '|' + (Date.now() + SESSION_DAYS * 864e5);
  return { token: Utilities.base64EncodeWebSafe(p) + '.' + sign_(p), boot: bootstrap_(emp) };
}

function auth_(token, needAdmin) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) throw new Error('SESI_HABIS');
  let p;
  try { p = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString(); } catch (e) { throw new Error('SESI_HABIS'); }
  if (sign_(p) !== parts[1]) throw new Error('SESI_HABIS');
  const cut = p.lastIndexOf('|'), nik = p.slice(0, cut);      // the NIK itself may contain '|'
  if (cut < 1 || Date.now() > Number(p.slice(cut + 1))) throw new Error('SESI_HABIS');
  const find = list => list.find(e => e.nik === nik);
  const emp = find(employees_()) || find(employees_(true));
  if (!emp || !emp.active) throw new Error('SESI_HABIS');
  if (needAdmin && !emp.admin) throw new Error('Halaman ini khusus admin.');
  return emp;
}

// ---------------------------------------------------------------- employee

function myRange_(now) {
  const ym = now.key.slice(0, 7);
  const ws = addDays_(now.key, -dow_(now.key));
  const from = ws < ym + '-01' ? ws : ym + '-01';
  return { from, to: monthEnd_(addMonths_(ym, 2)), months: [ym, addMonths_(ym, 1), addMonths_(ym, 2)] };
}

function myRegs_(nik, from, to) {
  const out = {};
  regsMonths_(monthsBetween_(from, to)).forEach(r => {
    if (r.nik === nik && r.date >= from && r.date <= to && (r.l || r.d)) out[r.date] = { l: r.l, d: r.d };
  });
  return out;
}

function bootstrap_(me) {
  const now = now_(), s = settings_(), rg = myRange_(now);
  const fb = {};
  const fbFrom = addDays_(now.key, -14);
  fbMonths_(monthsBetween_(fbFrom, now.key)).forEach(f => {
    if (f.nik === me.nik && f.date >= fbFrom) fb[f.date + '-' + f.meal] = { r: f.r, tags: f.tags, note: f.note };
  });
  return {
    user: { nik: me.nik, name: me.name, dept: me.dept, store: me.store, collar: me.collar, admin: me.admin },
    settings: s, now, price: PRICE, months: rg.months, fbTags: FB_TAGS, fbEditDays: FB_EDIT_DAYS,
    reg: myRegs_(me.nik, rg.from, rg.to),
    closures: closures_().filter(c => c.date >= rg.from),
    menus: menus_(addDays_(now.key, -14), rg.to),
    fb,
    vouchers: myVouchers_(me.nik, rg.from, rg.to)
  };
}

function saveRegistrations_(me, changes, code) {
  if (!Array.isArray(changes) || changes.length > 400) throw new Error('Data pendaftaran tidak valid.');
  const s = settings_(), now = now_(), closures = closures_();
  let skipped = 0;
  const clean = {};
  changes.forEach(c => {
    if (!c || !isKey_(c.date)) return;
    if (locked_(c.date, s, now, me.collar)) { skipped++; return; }
    const q = v => Math.max(0, Math.min(s.maxPortions, parseInt(v, 10) || 0));
    clean[c.date] = {
      l: blockOf_(closures, c.date, 'lunch') ? 0 : q(c.l),
      d: blockOf_(closures, c.date, 'dinner') ? 0 : q(c.d)
    };
  });
  const dates = Object.keys(clean).sort(), rg = myRange_(now), reg = {};
  let used = null;
  // Kept short for the Friday rush: the caller's current portions come from the month cache
  // (only this NIK writes these rows, always through this lock), changed days are appended
  // (no lookup), and the cache is updated in place so other users keep reading it warm.
  withLock_(() => {
    const existing = {};
    if (dates.length) regsMonths_(dates.map(k => k.slice(0, 7))).forEach(r => { if (r.nik === me.nik) existing[r.date] = r; });
    // Voucher: validated and priced before anything is written, so a bad code saves nothing.
    const redeem = code ? priceVoucher_(code, dates.map(k => ({ date: k, ex: existing[k], v: clean[k] }))) : null;
    const ts = stamp_(), rows = [], changed = {};
    dates.forEach(k => {
      const v = clean[k], ex = existing[k] || { l: 0, d: 0 };
      if (ex.l !== v.l || ex.d !== v.d) { rows.push([k, me.nik, v.l, v.d, ts]); changed[k] = v; }
    });
    if (rows.length) {
      const sh = sheet_('pendaftaran');
      sh.getRange(sh.getLastRow() + 1, 1, rows.length, 5).setValues(rows);
      patchRegs_(me.nik, changed);
    }
    if (redeem) {
      sheet_('voucher').getRange(redeem.v._row, 4, 1, 4).setValues([[me.nik, ts, redeem.discount, splitText_(redeem.split)]]);
      used = { code: redeem.v.code, discount: redeem.discount, split: redeem.split, at: ts };
      patchVoucher_(redeem.v.code, me.nik, used);
    }
  });
  // The caller's registrations after this save (cache is already up to date).
  regsMonths_(monthsBetween_(rg.from, rg.to)).forEach(r => {
    if (r.nik === me.nik && r.date >= rg.from && r.date <= rg.to) reg[r.date] = { l: r.l, d: r.d };
  });
  return { reg, saved: dates.length, skipped, voucher: used };
}

/**
 * Rewrites `pendaftaran` keeping only the newest non-zero row per date + NIK, sorted.
 * Run from the editor, or add a weekly time-driven trigger for it (Triggers page).
 */
function compactRegistrations() {
  return withLock_(() => {
    delete MEMO['t:pendaftaran'];
    const sh = sheet_('pendaftaran'), last = {};
    readTable_('pendaftaran').rows.forEach(r => {
      if (!isKey_(r.tanggal)) return;
      const nik = String(r.nik).replace(/\s/g, '');
      last[r.tanggal + '|' + nik] = [r.tanggal, nik, parseInt(r.siang, 10) || 0, parseInt(r.malam, 10) || 0, r.diperbarui || ''];
    });
    const keep = Object.keys(last).map(k => last[k]).filter(r => r[2] || r[3])
      .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
    const before = sh.getLastRow() - 1;
    if (before > 0) sh.getRange(2, 1, before, 5).clearContent();
    if (keep.length) sh.getRange(2, 1, keep.length, 5).setValues(keep);
    bumpGen_('regGen');
    delete MEMO['t:pendaftaran'];
    return { before: Math.max(0, before), after: keep.length };
  });
}

function saveFeedback_(me, p) {
  const now = now_(), meal = p.meal === 'dinner' ? 'dinner' : 'lunch';
  if (!isKey_(p.date)) throw new Error('Tanggal tidak valid.');
  if (['enak', 'biasa', 'kurang'].indexOf(p.r) < 0) throw new Error('Pilih penilaian dulu.');
  const started = p.date < now.key || (p.date === now.key && now.min >= (meal === 'lunch' ? LUNCH_FB_FROM : DINNER_FB_FROM));
  if (!started) throw new Error('Penilaian dibuka setelah jam makan.');
  if (now.key > addDays_(p.date, FB_EDIT_DAYS)) throw new Error('Batas waktu penilaian sudah lewat.');
  if (blockOf_(closures_(), p.date, meal)) throw new Error('Kantin tutup pada waktu makan ini.');
  const reg = regsMonths_([p.date.slice(0, 7)]).find(r => r.nik === me.nik && r.date === p.date);
  if (!reg || !(meal === 'lunch' ? reg.l : reg.d)) throw new Error('Kamu tidak terdaftar pada waktu makan ini.');
  const tags = (p.tags || []).filter(t => FB_TAGS.indexOf(t) >= 0);
  const note = String(p.note || '').trim().slice(0, 500);
  const row = [p.date, meal === 'lunch' ? 'Siang' : 'Malam', me.nik, p.r, tags.join('; '), note, stamp_()];
  withLock_(() => {
    const sh = sheet_('masukan');
    forget_([], ['masukan']);
    const ex = feedbackAll_().find(f => f.nik === me.nik && f.date === p.date && f.meal === meal);
    if (ex) sh.getRange(ex._row, 1, 1, row.length).setValues([row]);
    else sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
    forget_([], ['masukan']);
    bumpGen_('fbGen');
    cache_().remove(FB_PREFIX + p.date.slice(0, 7));
  });
  return { key: p.date + '-' + meal, fb: { r: p.r, tags, note } };
}

// ---------------------------------------------------------------- vouchers
// Single-use codes with a fixed Rupiah value. A code is redeemed in one submission and takes
// that submission's newly added portions off the salary deduction, capped at their cost.
// `Rincian` records how the discount splits over months ("2026-10:5000;2026-11:5000").

const normCode_ = v => String(v || '').trim().toUpperCase().replace(/\s+/g, '');
const CODE_RE = /^[A-Z0-9_-]{3,32}$/;
const MAX_VOUCHER = 10000000;

function splitText_(m) { return Object.keys(m).sort().map(k => k + ':' + m[k]).join(';'); }
function splitParse_(t) {
  const m = {};
  String(t || '').split(';').forEach(p => { const kv = p.split(':'); if (/^\d{4}-\d{2}$/.test(kv[0]) && Number(kv[1]) > 0) m[kv[0]] = Number(kv[1]); });
  return m;
}

function vouchers_(fresh) {
  return cachedBig_('vch2', () => readTable_('voucher').rows.filter(r => r.kode).map(r => ({
    _row: r._row, code: normCode_(r.kode), value: parseInt(String(r.nilai).replace(/\D/g, ''), 10) || 0,
    until: isKey_(r['berlaku sampai']) ? r['berlaku sampai'] : '', usedBy: String(r['dipakai oleh'] || '').replace(/\s/g, ''),
    usedAt: r['dipakai pada'] || '', discount: parseInt(r.potongan, 10) || 0, split: splitParse_(r.rincian),
    uploadedAt: r['diunggah pada'] || '', uploadedBy: r['diunggah oleh'] || ''
  })), fresh);
}
/** After a redemption (inside the lock, after the sheet write): update the cached list in place. */
function patchVoucher_(code, nik, used) {
  const list = MEMO['vch2'];                       // fresh list read by priceVoucher_ in this request
  bumpGen_('gen:vch2');
  if (!list) return cache_().remove('vch2');
  list.forEach(v => { if (v.code === code) Object.assign(v, { usedBy: nik, usedAt: used.at, discount: used.discount, split: used.split }); });
  bigPut_('vch2', '#' + JSON.stringify(list));
}
function voucherState_(v, today) { return v.usedBy ? 'used' : v.until && v.until < today ? 'expired' : 'available'; }

function findVoucher_(code, fresh) {
  const c = normCode_(code);
  if (!CODE_RE.test(c)) throw new Error('Kode voucher tidak valid.');
  const v = vouchers_(fresh).find(x => x.code === c);
  if (!v) throw new Error('Kode voucher tidak ditemukan.');
  const st = voucherState_(v, now_().key);
  if (st === 'used') throw new Error('Voucher ini sudah dipakai.');
  if (st === 'expired') throw new Error('Voucher ini sudah kedaluwarsa.');
  if (v.value <= 0) throw new Error('Voucher ini tidak punya nilai.');
  return v;
}

function checkVoucher_(code) {
  const v = findVoucher_(code);
  return { code: v.code, value: v.value, until: v.until };
}

/** Prices a voucher against a submission ({date, ex, v} per changed date). Call inside the lock. */
function priceVoucher_(code, rows) {
  forgetBig_('vch2'); delete MEMO['t:voucher'];
  const v = findVoucher_(code, true), added = {};
  rows.forEach(r => {
    const ex = r.ex || { l: 0, d: 0 };
    const n = Math.max(0, r.v.l - ex.l) + Math.max(0, r.v.d - ex.d);
    if (n) added[r.date.slice(0, 7)] = (added[r.date.slice(0, 7)] || 0) + n * PRICE;
  });
  const total = Object.keys(added).reduce((a, k) => a + added[k], 0);
  if (!total) throw new Error('Voucher hanya bisa dipakai untuk pilihan baru.');
  let left = Math.min(v.value, total);
  const split = {};
  Object.keys(added).sort().forEach(m => { const take = Math.min(left, added[m]); if (take) { split[m] = take; left -= take; } });
  return { v, split, discount: Math.min(v.value, total) };
}

function myVouchers_(nik, from, to) {
  const months = monthsBetween_(from, to);
  return vouchers_().filter(v => v.usedBy === nik && Object.keys(v.split).some(m => months.indexOf(m) >= 0))
    .map(v => ({ code: v.code, discount: v.discount, split: v.split, at: v.usedAt }));
}

function adminVouchers_() {
  const today = now_().key, em = empMap_(employees_());
  const list = vouchers_().map(v => {
    const e = em[v.usedBy];
    return { code: v.code, value: v.value, until: v.until, state: voucherState_(v, today), usedBy: v.usedBy,
      usedName: v.usedBy ? (e ? e.name : '(NIK tidak dikenal)') : '', usedAt: v.usedAt, discount: v.discount,
      split: splitText_(v.split), uploadedAt: v.uploadedAt };
  });
  return { list, now: now_() };
}

function parseValue_(v) { const n = parseInt(String(v == null ? '' : v).replace(/\D/g, ''), 10); return isNaN(n) ? 0 : n; }
function parseDate_(v) {
  const t = String(v == null ? '' : v).trim();
  if (!t) return '';
  if (isKey_(t)) return t;
  const m = t.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (m) { const k = m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0'); if (isKey_(k)) return k; }
  return null;
}

function uploadVouchers_(me, rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('Tidak ada voucher untuk diunggah.');
  if (rows.length > 2000) throw new Error('Maksimal 2.000 voucher per unggahan.');
  let added = 0;
  const skipped = [];
  withLock_(() => {
    forgetBig_('vch2'); delete MEMO['t:voucher'];
    const have = {}, seen = {}, out = [], ts = stamp_();
    vouchers_(true).forEach(v => { have[v.code] = true; });
    rows.forEach(r => {
      const code = normCode_(r && r.code), value = parseValue_(r && r.value), until = parseDate_(r && r.until);
      const bad = !CODE_RE.test(code) ? 'Kode tidak valid' : !(value > 0 && value <= MAX_VOUCHER) ? 'Nilai tidak valid' : until === null ? 'Tanggal tidak valid'
        : seen[code] ? 'Duplikat di file' : have[code] ? 'Sudah ada' : '';
      if (bad) { skipped.push({ code: code || String(r && r.code || ''), reason: bad }); return; }
      seen[code] = true;
      out.push([code, value, until, '', '', '', '', ts, me.name]);
    });
    if (out.length) {
      const sh = sheet_('voucher');
      sh.getRange(sh.getLastRow() + 1, 1, out.length, out[0].length).setValues(out);
      forgetBig_('vch2'); delete MEMO['t:voucher'];
    }
    added = out.length;
  });
  return Object.assign(adminVouchers_(), { added, skipped });
}

function deleteVoucher_(code) {
  withLock_(() => {
    forgetBig_('vch2'); delete MEMO['t:voucher'];
    const v = vouchers_(true).find(x => x.code === normCode_(code));
    if (!v) throw new Error('Kode voucher tidak ditemukan.');
    if (v.usedBy) throw new Error('Voucher yang sudah dipakai tidak bisa dihapus.');
    sheet_('voucher').deleteRow(v._row);
    forgetBig_('vch2'); delete MEMO['t:voucher'];
  });
  return adminVouchers_();
}

// ---------------------------------------------------------------- admin

function joinDay_(k, regs, closures, empMap) {
  const lb = blockOf_(closures, k, 'lunch'), db = blockOf_(closures, k, 'dinner');
  const rows = [];
  regs.forEach(r => {
    if (r.date !== k) return;
    const l = lb ? 0 : r.l, d = db ? 0 : r.d;
    if (!l && !d) return;
    const e = empMap[r.nik] || { nik: r.nik, name: '(NIK tidak dikenal)', dept: '', store: 'Tanpa store', collar: 'white' };
    rows.push({ nik: r.nik, name: e.name, dept: e.dept, store: e.store, collar: e.collar, l, d });
  });
  return { rows, lb, db };
}

function empMap_(emps) { const m = {}; emps.forEach(e => { m[e.nik] = e; }); return m; }

function adminDay_(k) {
  if (!isKey_(k)) throw new Error('Tanggal tidak valid.');
  const emps = employees_(), j = joinDay_(k, regsMonths_([k.slice(0, 7)]).filter(r => r.date === k), closures_(), empMap_(emps));
  return { date: k, rows: j.rows, lb: j.lb, db: j.db, stores: storesOf_(emps), settings: settings_(), now: now_() };
}

function adminMonth_(ym) {
  if (!/^\d{4}-\d{2}$/.test(ym || '')) throw new Error('Bulan tidak valid.');
  const emps = employees_(), em = empMap_(emps), byDate = groupByDate_(regsMonths_([ym])), closures = closures_();
  const stores = storesOf_(emps), split = {};
  stores.forEach(st => { split[st] = [0, 0, 0, 0]; });
  const days = [];
  for (let k = ym + '-01', end = monthEnd_(ym); k <= end; k = addDays_(k, 1)) {
    const j = joinDay_(k, byDate[k] || [], closures, em);
    let l = 0, d = 0, pl = 0, pd = 0;
    j.rows.forEach(r => {
      l += r.l; d += r.d; if (r.l) pl++; if (r.d) pd++;
      if (!split[r.store]) { split[r.store] = [0, 0, 0, 0]; stores.push(r.store); }
      const o = r.collar === 'white' ? 0 : 2;
      split[r.store][o] += r.l; split[r.store][o + 1] += r.d;
    });
    days.push({ date: k, l, d, pl, pd, n: j.rows.length, lb: j.lb, db: j.db });
  }
  return { ym, days, stores, split, now: now_() };
}

function adminMonthDetail_(ym) {
  if (!/^\d{4}-\d{2}$/.test(ym || '')) throw new Error('Bulan tidak valid.');
  const em = empMap_(employees_()), byDate = groupByDate_(regsMonths_([ym])), closures = closures_(), out = [];
  for (let k = ym + '-01', end = monthEnd_(ym); k <= end; k = addDays_(k, 1)) {
    joinDay_(k, byDate[k] || [], closures, em).rows.forEach(r => out.push([k, r.nik, r.name, r.dept, r.store, r.collar, r.l, r.d]));
  }
  return out;
}

/** Feedback sessions for `from`–`to` (default the last 14 days, max 92) and the 8-week trend ending at `to`. */
function adminFeedback_(p) {
  p = p || {};
  const now = now_(), em = empMap_(employees_()), closures = closures_();
  const to = isKey_(p.to) && p.to <= now.key ? p.to : now.key;
  let from = isKey_(p.from) && p.from <= to ? p.from : addDays_(to, -13);
  if (from < addDays_(to, -91)) from = addDays_(to, -91);
  const trendFrom = addDays_(addDays_(to, -dow_(to)), -49), lo = from < trendFrom ? from : trendFrom;
  const all = fbMonths_(monthsBetween_(lo, to)).filter(f => f.date >= lo && f.date <= to && !blockOf_(closures, f.date, f.meal));
  const groups = {};
  all.forEach(f => {
    if (f.date < from) return;
    const key = f.date + '-' + f.meal, e = em[f.nik];
    (groups[key] = groups[key] || { date: f.date, meal: f.meal, list: [] }).list.push({
      r: f.r, tags: f.tags, note: f.note, who: e ? e.name + (e.dept ? ' · ' + e.dept : '') : f.nik
    });
  });
  const sessions = Object.keys(groups).map(k => groups[k])
    .sort((a, b) => b.date.localeCompare(a.date) || (a.meal === 'lunch' ? -1 : 1));
  const trend = [];
  for (let w = 0; w < 8; w++) {
    const ws = addDays_(trendFrom, w * 7), we = addDays_(ws, 6);
    let e = 0, n = 0;
    all.forEach(f => { if (f.date >= ws && f.date <= we && f.date >= trendFrom) { n++; if (f.r === 'enak') e++; } });
    trend.push({ ws, e, n });
  }
  return { from, to, sessions, trend, tags: FB_TAGS };
}

function impactOf_(regs, dates, meal) {
  const set = {}, ids = {};
  dates.forEach(k => { set[k] = true; });
  let p = 0;
  regs.forEach(r => {
    if (!set[r.date]) return;
    const v = (meal !== 'dinner' ? r.l : 0) + (meal !== 'lunch' ? r.d : 0);
    if (v) { ids[r.nik] = true; p += v; }
  });
  return { people: Object.keys(ids).length, portions: p };
}

function adminClosures_() {
  const now = now_(), all = closures_(), groups = {};
  const future = all.filter(c => c.date >= now.key).map(c => c.date.slice(0, 7));
  const regs = future.length ? regsMonths_(future) : [];
  all.forEach(c => { (groups[c.g] = groups[c.g] || []).push(c); });
  const list = Object.keys(groups).map(g => {
    const cs = groups[g].sort((a, b) => a.date.localeCompare(b.date));
    return { g, dates: cs.map(c => c.date), meal: cs[0].meal, reason: cs[0].reason, impact: impactOf_(regs, cs.map(c => c.date), cs[0].meal) };
  }).filter(x => x.dates[x.dates.length - 1] >= now.key).sort((a, b) => a.dates[0].localeCompare(b.dates[0]));
  return { list, taken: all.filter(c => c.date >= now.key).map(c => c.date), now };
}

function addClosure_(me, p) {
  const now = now_(), meal = mealOf_(p.meal);
  const dates = (p.dates || []).filter(k => isKey_(k) && k >= now.key);
  if (!dates.length) throw new Error('Pilih tanggal yang belum lewat.');
  if (dates.length > 120) throw new Error('Rentang terlalu panjang.');
  const reason = String(p.reason || '').trim().slice(0, 120) || 'Kantin tidak tersedia';
  withLock_(() => {
    const sh = sheet_('tutup');
    forget_([], ['tutup']);
    readTable_('tutup').rows.filter(r => dates.indexOf(r.tanggal) >= 0).map(r => r._row)
      .sort((a, b) => b - a).forEach(r => sh.deleteRow(r));
    const g = 'g' + Date.now(), ts = stamp_();
    const rows = dates.map(k => [g, k, MEAL_LABEL[meal], reason, me.name, ts]);
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
    forget_(['cls1'], ['tutup']);
  });
  return adminClosures_();
}

function removeClosure_(g) {
  withLock_(() => {
    const sh = sheet_('tutup');
    forget_([], ['tutup']);
    readTable_('tutup').rows.filter(r => (r.grup || r.tanggal) === g).map(r => r._row)
      .sort((a, b) => b - a).forEach(r => sh.deleteRow(r));
    forget_(['cls1'], ['tutup']);
  });
  return adminClosures_();
}

/** p.cut = { white: { days, time }, blue: { days, time } }; a missing collar is left unchanged. */
function saveSettings_(p) {
  const kv = [];
  COLLARS.forEach(col => {
    const c = p.cut && p.cut[col];
    if (!c) return;
    const d = parseInt(c.days, 10), t = String(c.time || '');
    if (!(d >= MIN_CUT_DAYS && d <= MAX_CUT_DAYS)) throw new Error('Hari batas tidak valid.');
    if (!/^\d{2}:\d{2}$/.test(t) || hm_(t) > 23 * 60 + 59) throw new Error('Jam batas tidak valid.');
    kv.push([CUT_KEYS[col][0], String(d)], [CUT_KEYS[col][1], t]);
  });
  withLock_(() => {
    const sh = sheet_('pengaturan'), rows = readTable_('pengaturan').rows;
    kv.forEach(x => {
      const r = rows.find(y => String(y.kunci).toLowerCase() === x[0]);
      if (r) sh.getRange(r._row, 2).setValue(x[1]);
      else sh.appendRow([x[0], x[1], (DEFAULT_SETTINGS.find(d => d[0] === x[0]) || [])[2] || '']);
    });
    forget_(['set2'], ['pengaturan']);
  });
  return settings_();
}
