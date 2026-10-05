/**
 * Segari · Program Makan — server side.
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
const FB_TAGS = ['Porsi kurang', 'Kurang hangat', 'Terlalu asin', 'Terlalu pedas', 'Kurang variasi', 'Antre lama', 'Menu favorit'];

const SHEETS = {
  employee: ['NIK', 'Nama', 'Departemen', 'Store', 'Kategori', 'Role', 'Aktif'],
  pendaftaran: ['Tanggal', 'NIK', 'Siang', 'Malam', 'Diperbarui'],
  tutup: ['Grup', 'Tanggal', 'Waktu', 'Alasan', 'Dibuat oleh', 'Dibuat pada'],
  masukan: ['Tanggal', 'Waktu', 'NIK', 'Nilai', 'Tag', 'Catatan', 'Diperbarui'],
  menu: ['Tanggal', 'Siang', 'Malam'],
  pengaturan: ['Kunci', 'Nilai', 'Keterangan']
};
// Columns kept as plain text so dates and NIKs are never auto-converted.
const TEXT_COLS = { employee: ['A'], pendaftaran: ['A', 'B'], tutup: ['B'], masukan: ['A', 'C'], menu: ['A'], pengaturan: ['B'] };
const DEFAULT_SETTINGS = [
  ['batas_hari', '3', 'Pendaftaran minggu depan ditutup N hari sebelum Senin (3 = Jumat, 1 = Minggu)'],
  ['batas_jam', '23:59', 'Jam batas pendaftaran (HH:MM)'],
  ['maks_porsi', '3', 'Maksimal porsi per waktu makan']
];

// ---------------------------------------------------------------- web app

function doGet() {
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('Segari · Program Makan')
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
  saveRegistrations: (token, p) => saveRegistrations_(auth_(token), p.changes || []),
  saveFeedback: (token, p) => saveFeedback_(auth_(token), p),
  adminDay: (token, p) => { auth_(token, true); return adminDay_(p.date); },
  adminMonth: (token, p) => { auth_(token, true); return adminMonth_(p.ym); },
  adminMonthDetail: (token, p) => { auth_(token, true); return adminMonthDetail_(p.ym); },
  adminFeedback: token => { auth_(token, true); return adminFeedback_(); },
  adminClosures: token => { auth_(token, true); return adminClosures_(); },
  adminImpact: (token, p) => { auth_(token, true); return impactOf_(regsAll_(), p.dates || [], p.meal); },
  addClosure: (token, p) => addClosure_(auth_(token, true), p),
  removeClosure: (token, p) => { auth_(token, true); return removeClosure_(p.g); },
  saveSettings: (token, p) => { auth_(token, true); return saveSettings_(p); }
};

// ---------------------------------------------------------------- setup

function ensureSetup_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('setup_v1')) return;
  setupSheets();
  props.setProperty('setup_v1', '1');
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

/** Reads a tab into objects keyed by lower-cased header; `_row` is the 1-based sheet row. */
function readTable_(name) {
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
  return { sheet: sh, rows };
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

function cutoff_(k, s) {
  const ws = addDays_(k, -dow_(k));
  return { key: addDays_(ws, -s.cutDays), min: hm_(s.cutTime) };
}
function locked_(k, s, now) {
  const c = cutoff_(k, s);
  return now.key > c.key || (now.key === c.key && now.min >= c.min);
}

// ---------------------------------------------------------------- data access

function settings_() {
  const m = {};
  readTable_('pengaturan').rows.forEach(r => { m[String(r.kunci).toLowerCase()] = r.nilai; });
  const int = (v, lo, hi, d) => { const n = parseInt(v, 10); return isNaN(n) ? d : Math.max(lo, Math.min(hi, n)); };
  const t = /^\d{1,2}:\d{2}$/.test(m.batas_jam || '') ? m.batas_jam.padStart(5, '0') : '23:59';
  return { cutDays: int(m.batas_hari, 1, 5, 3), cutTime: t, maxPortions: int(m.maks_porsi, 1, 10, 3) };
}

function employees_() {
  return readTable_('employee').rows.map(r => {
    const dept = r.departemen || '', kat = r.kategori || '';
    const collar = /blue/i.test(kat) ? 'blue' : /white/i.test(kat) ? 'white' : /gudang|operasional/i.test(dept) ? 'blue' : 'white';
    return {
      nik: String(r.nik).replace(/\s/g, ''), name: r.nama, dept, store: r.store || 'Tanpa store', collar,
      admin: /admin|hr/i.test(r.role || ''), active: !/^(tidak|no|false|0|n|nonaktif)$/i.test(r.aktif || '')
    };
  }).filter(e => e.nik && e.name);
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
  return readTable_('tutup').rows.filter(r => isKey_(r.tanggal)).map(r => ({
    g: r.grup || r.tanggal, date: r.tanggal, meal: mealOf_(r.waktu), reason: r.alasan || 'Kantin tutup', by: r['dibuat oleh'] || ''
  }));
}
function blockOf_(closures, k, meal) {
  return closures.find(c => c.date === k && (c.meal === 'both' || c.meal === meal)) || null;
}

function regsAll_() {
  return readTable_('pendaftaran').rows.filter(r => isKey_(r.tanggal)).map(r => ({
    _row: r._row, date: r.tanggal, nik: String(r.nik).replace(/\s/g, ''),
    l: Math.max(0, parseInt(r.siang, 10) || 0), d: Math.max(0, parseInt(r.malam, 10) || 0)
  }));
}

function menus_(from, to) {
  const out = {};
  readTable_('menu').rows.forEach(r => {
    if (isKey_(r.tanggal) && r.tanggal >= from && r.tanggal <= to) out[r.tanggal] = { lunch: r.siang || '', dinner: r.malam || '' };
  });
  return out;
}

function feedbackAll_() {
  return readTable_('masukan').rows.filter(r => isKey_(r.tanggal)).map(r => ({
    _row: r._row, date: r.tanggal, meal: mealOf_(r.waktu) === 'dinner' ? 'dinner' : 'lunch', nik: String(r.nik).replace(/\s/g, ''),
    r: String(r.nilai).toLowerCase(), tags: r.tag ? String(r.tag).split(/\s*;\s*/).filter(Boolean) : [], note: r.catatan || ''
  })).filter(f => ['enak', 'biasa', 'kurang'].indexOf(f.r) >= 0);
}

function stamp_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'); }

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
  nik = String(nik || '').replace(/\D/g, '');
  const nm = String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!nik) throw new Error('NIK wajib diisi.');
  const cache = CacheService.getScriptCache(), ck = 'fail:' + nik, fails = Number(cache.get(ck) || 0);
  if (fails >= 8) throw new Error('Terlalu banyak percobaan. Coba lagi 15 menit lagi.');
  const fail = msg => { cache.put(ck, String(fails + 1), 900); throw new Error(msg); };
  const emp = employees_().find(e => e.nik === nik);
  if (!emp) fail('NIK tidak ditemukan. Hubungi People & HR.');
  if (!emp.active) throw new Error('NIK ini tidak aktif. Hubungi People & HR.');
  if (!nm) throw new Error('Nama wajib diisi.');
  if (emp.name.trim().toLowerCase().replace(/\s+/g, ' ') !== nm) fail('Nama tidak sesuai dengan NIK ini.');
  cache.remove(ck);
  const p = nik + '|' + (Date.now() + SESSION_DAYS * 864e5);
  return { token: Utilities.base64EncodeWebSafe(p) + '.' + sign_(p) };
}

function auth_(token, needAdmin) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) throw new Error('SESI_HABIS');
  let p;
  try { p = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString(); } catch (e) { throw new Error('SESI_HABIS'); }
  if (sign_(p) !== parts[1]) throw new Error('SESI_HABIS');
  const bits = p.split('|');
  if (Date.now() > Number(bits[1])) throw new Error('SESI_HABIS');
  const emp = employees_().find(e => e.nik === bits[0] && e.active);
  if (!emp) throw new Error('SESI_HABIS');
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
  regsAll_().forEach(r => {
    if (r.nik === nik && r.date >= from && r.date <= to && (r.l || r.d)) out[r.date] = { l: r.l, d: r.d };
  });
  return out;
}

function bootstrap_(me) {
  const now = now_(), s = settings_(), rg = myRange_(now);
  const fb = {};
  const fbFrom = addDays_(now.key, -14);
  feedbackAll_().forEach(f => {
    if (f.nik === me.nik && f.date >= fbFrom) fb[f.date + '-' + f.meal] = { r: f.r, tags: f.tags, note: f.note };
  });
  return {
    user: { nik: me.nik, name: me.name, dept: me.dept, store: me.store, admin: me.admin },
    settings: s, now, price: PRICE, months: rg.months, fbTags: FB_TAGS, fbEditDays: FB_EDIT_DAYS,
    reg: myRegs_(me.nik, rg.from, rg.to),
    closures: closures_().filter(c => c.date >= rg.from),
    menus: menus_(addDays_(now.key, -14), rg.to),
    fb
  };
}

function saveRegistrations_(me, changes) {
  if (!Array.isArray(changes) || changes.length > 400) throw new Error('Data pendaftaran tidak valid.');
  const s = settings_(), now = now_(), closures = closures_();
  let skipped = 0;
  const clean = {};
  changes.forEach(c => {
    if (!c || !isKey_(c.date)) return;
    if (locked_(c.date, s, now)) { skipped++; return; }
    const q = v => Math.max(0, Math.min(s.maxPortions, parseInt(v, 10) || 0));
    clean[c.date] = {
      l: blockOf_(closures, c.date, 'lunch') ? 0 : q(c.l),
      d: blockOf_(closures, c.date, 'dinner') ? 0 : q(c.d)
    };
  });
  const dates = Object.keys(clean);
  withLock_(() => {
    const sh = sheet_('pendaftaran'), existing = {};
    regsAll_().forEach(r => { if (r.nik === me.nik) existing[r.date] = r; });
    const ts = stamp_(), append = [];
    dates.forEach(k => {
      const v = clean[k], ex = existing[k];
      if (ex) {
        if (ex.l !== v.l || ex.d !== v.d) sh.getRange(ex._row, 1, 1, 5).setValues([[k, me.nik, v.l, v.d, ts]]);
      } else if (v.l || v.d) {
        append.push([k, me.nik, v.l, v.d, ts]);
      }
    });
    if (append.length) sh.getRange(sh.getLastRow() + 1, 1, append.length, 5).setValues(append);
  });
  const rg = myRange_(now);
  return { reg: myRegs_(me.nik, rg.from, rg.to), saved: dates.length, skipped };
}

function saveFeedback_(me, p) {
  const now = now_(), meal = p.meal === 'dinner' ? 'dinner' : 'lunch';
  if (!isKey_(p.date)) throw new Error('Tanggal tidak valid.');
  if (['enak', 'biasa', 'kurang'].indexOf(p.r) < 0) throw new Error('Pilih penilaian dulu.');
  const started = p.date < now.key || (p.date === now.key && now.min >= (meal === 'lunch' ? LUNCH_FB_FROM : DINNER_FB_FROM));
  if (!started) throw new Error('Penilaian dibuka setelah jam makan.');
  if (now.key > addDays_(p.date, FB_EDIT_DAYS)) throw new Error('Batas waktu penilaian sudah lewat.');
  if (blockOf_(closures_(), p.date, meal)) throw new Error('Kantin tutup pada waktu makan ini.');
  const reg = regsAll_().find(r => r.nik === me.nik && r.date === p.date);
  if (!reg || !(meal === 'lunch' ? reg.l : reg.d)) throw new Error('Kamu tidak terdaftar pada waktu makan ini.');
  const tags = (p.tags || []).filter(t => FB_TAGS.indexOf(t) >= 0);
  const note = String(p.note || '').trim().slice(0, 500);
  const row = [p.date, meal === 'lunch' ? 'Siang' : 'Malam', me.nik, p.r, tags.join('; '), note, stamp_()];
  withLock_(() => {
    const sh = sheet_('masukan');
    const ex = feedbackAll_().find(f => f.nik === me.nik && f.date === p.date && f.meal === meal);
    if (ex) sh.getRange(ex._row, 1, 1, row.length).setValues([row]);
    else sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  });
  return { key: p.date + '-' + meal, fb: { r: p.r, tags, note } };
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
  const emps = employees_(), j = joinDay_(k, regsAll_(), closures_(), empMap_(emps));
  return { date: k, rows: j.rows, lb: j.lb, db: j.db, stores: storesOf_(emps), settings: settings_(), now: now_() };
}

function adminMonth_(ym) {
  if (!/^\d{4}-\d{2}$/.test(ym || '')) throw new Error('Bulan tidak valid.');
  const emps = employees_(), em = empMap_(emps), regs = regsAll_(), closures = closures_();
  const stores = storesOf_(emps), split = {};
  stores.forEach(st => { split[st] = [0, 0, 0, 0]; });
  const days = [];
  for (let k = ym + '-01', end = monthEnd_(ym); k <= end; k = addDays_(k, 1)) {
    const j = joinDay_(k, regs, closures, em);
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
  const em = empMap_(employees_()), regs = regsAll_(), closures = closures_(), out = [];
  for (let k = ym + '-01', end = monthEnd_(ym); k <= end; k = addDays_(k, 1)) {
    joinDay_(k, regs, closures, em).rows.forEach(r => out.push([k, r.nik, r.name, r.dept, r.store, r.collar, r.l, r.d]));
  }
  return out;
}

function adminFeedback_() {
  const now = now_(), em = empMap_(employees_()), closures = closures_();
  const trendFrom = addDays_(addDays_(now.key, -dow_(now.key)), -49);
  const all = feedbackAll_().filter(f => f.date >= trendFrom && f.date <= now.key && !blockOf_(closures, f.date, f.meal));
  const sesFrom = addDays_(now.key, -13), groups = {};
  all.forEach(f => {
    if (f.date < sesFrom) return;
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
    all.forEach(f => { if (f.date >= ws && f.date <= we) { n++; if (f.r === 'enak') e++; } });
    trend.push({ ws, e, n });
  }
  return { from: sesFrom, to: now.key, sessions, trend, tags: FB_TAGS };
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
  const now = now_(), regs = regsAll_(), all = closures_(), groups = {};
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
    readTable_('tutup').rows.filter(r => dates.indexOf(r.tanggal) >= 0).map(r => r._row)
      .sort((a, b) => b - a).forEach(r => sh.deleteRow(r));
    const g = 'g' + Date.now(), ts = stamp_();
    const rows = dates.map(k => [g, k, MEAL_LABEL[meal], reason, me.name, ts]);
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
  });
  return adminClosures_();
}

function removeClosure_(g) {
  withLock_(() => {
    const sh = sheet_('tutup');
    readTable_('tutup').rows.filter(r => (r.grup || r.tanggal) === g).map(r => r._row)
      .sort((a, b) => b - a).forEach(r => sh.deleteRow(r));
  });
  return adminClosures_();
}

function saveSettings_(p) {
  const d = parseInt(p.cutDays, 10), t = String(p.cutTime || '');
  if (!(d >= 1 && d <= 5)) throw new Error('Hari batas tidak valid.');
  if (!/^\d{2}:\d{2}$/.test(t) || hm_(t) > 23 * 60 + 59) throw new Error('Jam batas tidak valid.');
  withLock_(() => {
    const sh = sheet_('pengaturan'), rows = readTable_('pengaturan').rows;
    [['batas_hari', String(d)], ['batas_jam', t]].forEach(kv => {
      const r = rows.find(x => String(x.kunci).toLowerCase() === kv[0]);
      if (r) sh.getRange(r._row, 2).setValue(kv[1]);
      else sh.appendRow([kv[0], kv[1], '']);
    });
  });
  return settings_();
}
