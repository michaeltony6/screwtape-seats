/**
 * Screwtape Letters seat reservations: the backend.
 *
 * Paste this into a Google Sheet's Apps Script editor (Extensions → Apps Script)
 * and deploy it as a web app (see README).
 *
 * Two tabs, both created automatically:
 *   Roster  Paste the sign-up list here (a NetID column and a Name column, or
 *           First/Last name columns). Only people on it can pick a seat, one
 *           each. Picking stays closed while the roster is empty.
 *   Seats   One row per seat we bought. Name/NetID fill in when someone picks.
 *           Clear a row's Name and NetID to free that seat.
 *
 * A "Seats" menu in the sheet lets you sync the Roster's Seat column, seat
 * everyone who hasn't picked, and close or reopen picking.
 *
 * API (called by the website):
 *   GET  ?action=state[&token=…]      → { ok, seats: { "BAL-C-214": "Mina S.", … }, open, total, mine, picking }
 *   POST {"action":"reserve", seat, netid, last, token?, move?}
 *   POST {"action":"find",    netid, last}
 *   POST {"action":"cancel",  token}
 */

const SEATS = 'Seats', ROSTER = 'Roster';
const HEADER = ['Seat', 'Section', 'Row', 'Number', 'Name', 'NetID', 'Reserved at', 'Token'];
const COL = { SEAT: 0, SECTION: 1, ROW: 2, NUM: 3, NAME: 4, NETID: 5, AT: 6, TOKEN: 7 };
const CACHE_KEY = 'state-v2';
const CACHE_SECONDS = 10;            // hand edits in the sheet show up on the site within ~10 s

// The 100 seats on order 6922137 (The Screwtape Letters, Thu Nov 5, 2026, 7:30 PM).
const OUR_SEATS = [
  ['BAL', 'Balcony', 'C', 202, 228],
  ['BAL', 'Balcony', 'B', 213, 228],
  ['BAL', 'Balcony', 'A', 213, 228],
  ['CTR', 'Center', 'L', 106, 127],
  ['CTR', 'Center', 'K', 108, 126],
];

/* ───────────── HTTP ───────────── */

function doGet(e) {
  const p = (e && e.parameter) || {};
  if ((p.action || 'state') !== 'state') return json_({ ok: false, error: 'unknown_action' });
  return json_(stateFor_(p.token || ''));
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return json_({ ok: false, error: 'bad_request' }); }
  const lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch (err) { return json_({ ok: false, error: 'busy' }); }
  try {
    let result;
    if (body.action === 'reserve') result = reserve_(body);
    else if (body.action === 'find') result = find_(body);
    else if (body.action === 'cancel') result = cancel_(body);
    else result = { ok: false, error: 'unknown_action' };
    if (body.action !== 'find') CacheService.getScriptCache().remove(CACHE_KEY);
    result.state = stateFor_(result.token || body.token || '', body.action !== 'find');
    return json_(result);
  } finally {
    lock.releaseLock();
  }
}

/* ───────────── actions ───────────── */

function reserve_(b) {
  if (isClosed_()) return { ok: false, error: 'closed' };
  const seat = String(b.seat || '');
  const token = String(b.token || '');
  const sheet = seatsSheet_();
  const rows = sheet.getDataRange().getValues();

  // who is asking: an existing reservation's token, or NetID + last name checked against the roster
  let person = null;
  const mineByToken = token ? findRow_(rows, (r) => String(r[COL.TOKEN]) === token && filled_(r)) : -1;
  if (b.netid || b.last) {
    const v = verify_(b.netid, b.last);
    if (!v.ok) return v;
    person = v.person;
  } else if (mineByToken >= 0) {
    person = { netid: String(rows[mineByToken][COL.NETID]), name: String(rows[mineByToken][COL.NAME]).replace(/^'/, '') };
  } else {
    return { ok: false, error: 'invalid', detail: 'Enter your NetID and last name.' };
  }

  const target = findRow_(rows, (r) => String(r[COL.SEAT]) === seat);
  if (target < 0) return { ok: false, error: 'not_available' };
  const current = findRow_(rows, (r) => filled_(r) && String(r[COL.NETID]).toLowerCase() === person.netid);
  if (target === current) return { ok: true, seat: seat, token: String(rows[current][COL.TOKEN]), unchanged: true };
  if (filled_(rows[target])) return { ok: false, error: 'taken' };
  if (current >= 0 && current !== mineByToken && !b.move) {
    return { ok: false, error: 'has_seat', seat: String(rows[current][COL.SEAT]) };   // the page asks "move?" and resends with move: true
  }

  const newToken = current >= 0 && String(rows[current][COL.TOKEN]) ? String(rows[current][COL.TOKEN]) : Utilities.getUuid();
  if (current >= 0) writeRow_(sheet, current, ['', '', '', '']);
  writeRow_(sheet, target, [safe_(person.name), person.netid, new Date(), newToken]);
  setRosterSeat_(person.netid, seat);
  return { ok: true, seat: seat, token: newToken, moved: current >= 0 ? String(rows[current][COL.SEAT]) : null };
}

function find_(b) {
  const v = verify_(b.netid, b.last);
  if (!v.ok) return v;
  const rows = seatsSheet_().getDataRange().getValues();
  const i = findRow_(rows, (r) => filled_(r) && String(r[COL.NETID]).toLowerCase() === v.person.netid);
  if (i < 0) return { ok: true, seat: null, token: '' };
  let token = String(rows[i][COL.TOKEN]);
  if (!token) { token = Utilities.getUuid(); seatsSheet_().getRange(i + 1, COL.TOKEN + 1, 1, 1).setValues([[token]]); }
  return { ok: true, seat: String(rows[i][COL.SEAT]), token: token };
}

function cancel_(b) {
  if (isClosed_()) return { ok: false, error: 'closed' };
  const token = String(b.token || '');
  if (!token) return { ok: false, error: 'invalid' };
  const sheet = seatsSheet_();
  const rows = sheet.getDataRange().getValues();
  const i = findRow_(rows, (r) => String(r[COL.TOKEN]) === token && filled_(r));
  if (i < 0) return { ok: true, cancelled: null, token: '' };
  setRosterSeat_(String(rows[i][COL.NETID]).toLowerCase(), '');
  writeRow_(sheet, i, ['', '', '', '']);
  return { ok: true, cancelled: String(rows[i][COL.SEAT]), token: '' };
}

/* ───────────── roster ───────────── */

/** Reads the Roster tab: finds the NetID and name columns by their headers. */
function roster_() {
  const sh = rosterSheet_();
  const rows = sh.getDataRange().getValues();
  if (!rows.length) return { people: {}, count: 0, seatCol: -1, rowOf: {} };
  const head = rows[0].map((h) => String(h).toLowerCase().trim());
  const idx = (re) => head.findIndex((h) => re.test(h));
  let net = idx(/net\s*-?\s*id/), first = idx(/^first/), last = idx(/^last|surname/), name = idx(/name/);
  if (name === first || name === last) name = head.findIndex((h, i) => /name/.test(h) && i !== first && i !== last);
  const seatCol = idx(/^seat$/);
  if (net < 0) net = 0;
  if (name < 0 && first < 0) name = 1;
  const people = {}, rowOf = {};
  let count = 0;
  for (let i = 1; i < rows.length; i++) {
    const id = cleanNetid_(rows[i][net]);
    if (!id) continue;
    const full = first >= 0 ? (String(rows[i][first]) + ' ' + String(last >= 0 ? rows[i][last] : '')).trim() : String(rows[i][name] || '').trim();
    people[id] = { netid: id, name: full };
    rowOf[id] = i;
    count++;
  }
  return { people: people, count: count, seatCol: seatCol, rowOf: rowOf };
}

function verify_(netidIn, lastIn) {
  const netid = cleanNetid_(netidIn);
  const last = words_(lastIn);
  if (!netid || !last.length) return { ok: false, error: 'invalid', detail: 'Enter your NetID and last name.' };
  const r = roster_();
  if (!r.count) return { ok: false, error: 'not_open' };
  const p = r.people[netid];
  if (!p) return { ok: false, error: 'not_on_list' };
  const have = words_(p.name);
  if (have.length && !last.every((w) => have.indexOf(w) >= 0)) return { ok: false, error: 'not_on_list' };
  return { ok: true, person: { netid: netid, name: p.name || netid } };
}

function setRosterSeat_(netid, seat) {
  const r = roster_();
  if (r.seatCol < 0 || !(netid in r.rowOf)) return;
  rosterSheet_().getRange(r.rowOf[netid] + 1, r.seatCol + 1, 1, 1).setValues([[seat]]);
}

/* ───────────── state ───────────── */

function stateFor_(token, fresh) {
  const cache = CacheService.getScriptCache();
  let base = fresh ? null : cache.get(CACHE_KEY);
  let rows = null;
  if (!base || token) rows = seatsSheet_().getDataRange().getValues();
  if (!base) {
    const seats = {};
    let open = 0, total = 0;
    for (let i = 1; i < rows.length; i++) {
      const id = String(rows[i][COL.SEAT]);
      if (!id) continue;
      total++;
      if (filled_(rows[i])) seats[id] = shortName_(String(rows[i][COL.NAME]).replace(/^'/, '') || String(rows[i][COL.NETID])); else open++;
    }
    const picking = isClosed_() ? 'closed' : roster_().count ? 'open' : 'not_open';
    base = JSON.stringify({ seats: seats, open: open, total: total, picking: picking, updated: new Date().toISOString() });
    cache.put(CACHE_KEY, base, CACHE_SECONDS);
  }
  const state = JSON.parse(base);
  state.ok = true;
  state.mine = null;
  if (token && rows) {
    const i = findRow_(rows, (r) => String(r[COL.TOKEN]) === token && filled_(r));
    if (i >= 0) state.mine = String(rows[i][COL.SEAT]);
  }
  return state;
}

/* ───────────── sheets ───────────── */

function seatsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SEATS);
  if (!sh) {
    sh = ss.insertSheet(SEATS);
    const data = [HEADER];
    OUR_SEATS.forEach(function (s) {
      for (let n = s[3]; n <= s[4]; n++) data.push([s[0] + '-' + s[2] + '-' + n, s[1], s[2], n, '', '', '', '']);
    });
    sh.getRange(1, 1, data.length, HEADER.length).setValues(data);
    sh.setFrozenRows(1);
    sh.hideColumns(COL.TOKEN + 1);
  }
  return sh;
}

function rosterSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(ROSTER);
  if (!sh) {
    sh = ss.insertSheet(ROSTER);
    sh.getRange(1, 1, 1, 3).setValues([['NetID', 'Name', 'Seat']]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function writeRow_(sheet, rowIndex, nameNetidAtToken) {
  sheet.getRange(rowIndex + 1, COL.NAME + 1, 1, 4).setValues([nameNetidAtToken]);
}

/* ───────────── admin menu (in the Google Sheet) ───────────── */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Seats')
    .addItem('Set up tabs', 'setup')
    .addItem('Sync Roster "Seat" column', 'syncRoster')
    .addSeparator()
    .addItem('Seat everyone who hasn’t picked', 'seatRemaining')
    .addSeparator()
    .addItem('Close seat picking', 'closePicking')
    .addItem('Reopen seat picking', 'reopenPicking')
    .addToUi();
}

/** Creates the Seats and Roster tabs (also happens on the first visit to the site). */
function setup() { seatsSheet_(); rosterSheet_(); }

/** Rewrites the Roster's Seat column from the Seats tab (use after editing seats by hand). */
function syncRoster() {
  withLock_(function () {
    const r = roster_();
    if (r.seatCol < 0) return;
    const byNetid = {};
    seatsSheet_().getDataRange().getValues().slice(1).forEach((row) => { if (filled_(row)) byNetid[String(row[COL.NETID]).toLowerCase()] = String(row[COL.SEAT]); });
    const sh = rosterSheet_();
    Object.keys(r.rowOf).forEach((id) => sh.getRange(r.rowOf[id] + 1, r.seatCol + 1, 1, 1).setValues([[byNetid[id] || '']]));
  });
}

/** Gives every roster person without a seat one of the open seats, in seat order. */
function seatRemaining() {
  let placed = 0, left = 0;
  withLock_(function () {
    const r = roster_();
    const sheet = seatsSheet_();
    const rows = sheet.getDataRange().getValues();
    const seated = {};
    rows.slice(1).forEach((row) => { if (filled_(row)) seated[String(row[COL.NETID]).toLowerCase()] = true; });
    const openRows = [];
    for (let i = 1; i < rows.length; i++) if (String(rows[i][COL.SEAT]) && !filled_(rows[i])) openRows.push(i);
    Object.keys(r.people).forEach((id) => {
      if (seated[id]) return;
      const i = openRows.shift();
      if (i === undefined) { left++; return; }
      writeRow_(sheet, i, [safe_(r.people[id].name || id), id, new Date(), Utilities.getUuid()]);
      placed++;
    });
    CacheService.getScriptCache().remove(CACHE_KEY);
  });
  syncRoster();
  toast_('Seated ' + placed + ' people' + (left ? '. ' + left + ' still need a seat: no open seats left.' : '.'));
}

function closePicking() { PropertiesService.getScriptProperties().setProperty('closed', '1'); CacheService.getScriptCache().remove(CACHE_KEY); toast_('Seat picking is closed. The site shows seats read-only.'); }
function reopenPicking() { PropertiesService.getScriptProperties().deleteProperty('closed'); CacheService.getScriptCache().remove(CACHE_KEY); toast_('Seat picking is open again.'); }
function isClosed_() { return PropertiesService.getScriptProperties().getProperty('closed') === '1'; }

function withLock_(fn) { const lock = LockService.getScriptLock(); lock.waitLock(30000); try { fn(); } finally { lock.releaseLock(); } }
function toast_(msg) { try { SpreadsheetApp.getActiveSpreadsheet().toast(msg, 'Seats', 8); } catch (e) { /* not in the sheet UI */ } }

/* ───────────── helpers ───────────── */

function findRow_(rows, pred) { for (let i = 1; i < rows.length; i++) if (pred(rows[i])) return i; return -1; }
function filled_(r) { return !!(String(r[COL.NAME]) || String(r[COL.NETID])); }
function cleanNetid_(v) { return String(v == null ? '' : v).trim().toLowerCase().replace(/@.*$/, '').replace(/[^a-z0-9]/g, ''); }
function words_(v) {
  return String(v == null ? '' : v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
}
/** Stop names like "=HYPERLINK(...)" from running as formulas in the sheet. */
function safe_(s) { return /^[=+\-@]/.test(s) ? "'" + s : s; }
function shortName_(full) {
  const parts = String(full).trim().split(/\s+/);
  if (parts.length < 2) return parts[0];
  return parts[0] + ' ' + parts[parts.length - 1].charAt(0).toUpperCase() + '.';
}
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
