// Offpage Planner: the sheet page. Plain JS, no build step. Data lives in D1 behind /api/*.
'use strict';

// Columns: [name, width, type]. Types: text | url | status | date | long (modal editor) | num | dom (domain with icon) | prio
const STATUS = ['todo', 'doing', 'done', 'skip'];
const TABS = {
  'plan': [['Week', 70], ['Area', 120], ['Task', 640], ['Target', 120], ['Owner', 120], ['Status', 110, 'status']],
  'forum-threads': [['Domain', 210, 'dom'], ['Thread', 380, 'url'], ['Anchor', 250], ['Links to', 300, 'url'],
    ['Priority', 190, 'prio'], ['Status', 110, 'status'], ['Reply draft', 280, 'long'], ['Posted', 120, 'date']],
  'forum-limits': null,   // computed from forum-threads
  'forum-queries': [['Keyword', 240], ['Searches', 100, 'num'], ['Lang', 70], ['Google search', 480], ['Anchor', 220],
    ['Links to', 300, 'url'], ['Threads found', 280, 'long'], ['Status', 110, 'status']],
  'profiles': [['#', 50], ['Platform', 200], ['Sign-up', 230, 'url'], ['Type', 150], ['Value', 80], ['What to post', 420],
    ['Links to', 300], ['Status', 110, 'status']],
  'competitor-analysis': [['Competitor', 160], ['Website', 190, 'dom'], ['Thread / page', 360, 'url'], ['Their anchor', 200],
    ['Their target', 260, 'url'], ['My anchor', 220], ['My URL', 300, 'url'], ['Note', 300], ['Status', 110, 'status']],
  'gp-niche-edits': [['Competitor', 160], ['Website', 190, 'dom'], ['Page', 340, 'url'], ['Type', 180], ['DR', 60, 'num'], ['Traffic', 100, 'num'],
    ['Their anchor', 200], ['Their target', 240, 'url'], ['We have it?', 120], ['My anchor', 220], ['My URL', 300, 'url'], ['Note', 260], ['Status', 110, 'status']],
};
const LABELS = { 'plan': 'Plan', 'forum-threads': 'Forum threads', 'forum-limits': 'Forum limits', 'forum-queries': 'Search queries',
  'profiles': 'Profiles', 'competitor-analysis': 'Competitor threads', 'gp-niche-edits': 'GP & niche edits' };
const LIMIT_COLS = [['Forum', 260, 'dom'], ['Links posted', 120, 'num'], ['Last posted', 140], ['Next allowed', 140], ['Can post now?', 220, 'can']];
const MAX_PER_FORUM = 2, WAIT_DAYS = 15;

const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter(k => k != null)); return e; };
const S = { site: localStorage.site || '', tab: localStorage.tab || 'forum-threads', rows: [], threads: [], counts: {}, view: 'all' };

async function call(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { 'content-type': 'application/json' }, body: opts.body && JSON.stringify(opts.body) });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && !path.startsWith('/api/login') && !path.startsWith('/api/setup')) { showAuth(false); throw new Error('Please log in again.'); }
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}
function toast(msg, bad = false, action = null) {
  const t = el('div', { className: 'toast' + (bad ? ' bad' : '') }, el('span', { textContent: msg }));
  if (action) t.append(el('button', { textContent: action.label, onclick: () => { t.remove(); action.run(); } }));
  $('#toasts').append(t); setTimeout(() => t.remove(), bad ? 6000 : action ? 7000 : 3000);
}
const fail = (e) => toast(e.message || String(e), true);

// ---------- undo / redo ----------
// Every change is recorded as { label, redo, undo }. Rows deleted and brought back get a new id; idMap follows it.
const U = { done: [], undone: [], busy: false };
const idMap = new Map();
const rid = (id) => { while (idMap.has(id)) id = idMap.get(id); return id; };
function updUndo() {
  $('#undoBtn').disabled = !U.done.length; $('#redoBtn').disabled = !U.undone.length;
  $('#undoBtn').title = U.done.length ? `Undo: ${U.done.at(-1).label} (Ctrl+Z)` : 'Nothing to undo';
  $('#redoBtn').title = U.undone.length ? `Redo: ${U.undone.at(-1).label} (Ctrl+Y)` : 'Nothing to redo';
}
async function act(label, redo, undo, msg) {   // run a change, record it, offer Undo in the toast
  await redo();
  U.done.push({ label, redo, undo }); U.undone = []; if (U.done.length > 100) U.done.shift();
  updUndo();
  toast(msg || label, false, { label: 'Undo', run: undoLast });
}
async function step(from, to, verb) {
  if (U.busy || !from.length) return;
  U.busy = true;
  const a = from.pop();
  try { await (verb === 'Undone' ? a.undo() : a.redo()); to.push(a); toast(`${verb}: ${a.label}`); }
  catch (e) { fail(e); }
  U.busy = false; updUndo();
  await load().catch(fail);
}
const undoLast = () => step(U.done, U.undone, 'Undone');
const redoLast = () => step(U.undone, U.done, 'Redone');
const putCells = (id, cells) => call(`/api/rows/${rid(id)}`, { method: 'PUT', body: { cells } });
const delRow = (id) => call(`/api/rows/${rid(id)}`, { method: 'DELETE' });
async function restoreRow(site, tab, oldId, pos, cells) {   // bring a deleted row back at its old place
  const res = await call('/api/rows', { method: 'POST', body: { site, tab, rows: [cells], pos } });
  if (res.skipped?.length) throw new Error(`Can't bring it back: ${res.rule}.`);
  idMap.set(rid(oldId), res.ids[0]);
}

// ---------- forum limits (max 2 per forum, 15-day wait) ----------
const dom = (v) => String(v || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
const day = (s) => { const t = Date.parse(s); return isNaN(t) ? null : Math.floor(t / 864e5); };
const today = () => Math.floor(Date.now() / 864e5);
const iso = (d) => new Date(d * 864e5).toISOString().slice(0, 10);
const nice = (d) => new Date(d * 864e5).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
function limits(threads) {
  const by = {};
  for (const r of threads) {
    const d = dom(r.cells[0]); if (!d) continue;
    const f = by[d] || (by[d] = { posted: 0, last: null });
    const p = day(r.cells[7]);
    if (p !== null) { f.posted++; f.last = Math.max(f.last ?? p, p); }
  }
  for (const f of Object.values(by)) {
    f.next = f.last === null ? today() : f.last + WAIT_DAYS;
    f.kind = f.posted >= MAX_PER_FORUM ? 'max' : (f.posted === 0 || today() >= f.next) ? 'yes' : 'wait';
    f.label = f.kind === 'max' ? `Maxed (${MAX_PER_FORUM}/${MAX_PER_FORUM})` : f.kind === 'yes' ? 'Can post' : `Wait · ${nice(f.next)}`;
    f.waiting = f.last !== null && today() < f.last + WAIT_DAYS;
  }
  return by;
}
const canPill = (kind, label) => el('span', { className: `pill c-${kind}`, textContent: label });

// row state on forum-threads: 'posted' | 'yes' | 'wait' | 'max'
function threadState(r, L) {
  if (day(r.cells[7]) !== null) return 'posted';
  return L[dom(r.cells[0])]?.kind || 'yes';
}

// ---------- cells ----------
function favicon(d) { return el('img', { src: `https://icons.duckduckgo.com/ip3/${d}.ico`, alt: '', loading: 'lazy', onerror() { this.style.visibility = 'hidden'; } }); }
function shortUrl(u) {
  try { const x = new URL(u); const p = decodeURIComponent(x.pathname + x.search).replace(/\/$/, ''); return [x.hostname.replace(/^www\./, ''), p.length > 60 ? p.slice(0, 57) + '…' : p]; }
  catch { return [u, '']; }
}
function cellView(td, type, value) {
  td.textContent = ''; td.title = value;
  if (!value) return;
  if (type === 'url' && /^https?:\/\//i.test(value)) {
    const [host, path] = shortUrl(value);
    td.append(el('a', { href: value, target: '_blank', rel: 'noopener noreferrer', className: 'lnk' }, path ? el('small', { textContent: host }) : host, path || ''));
  } else if (type === 'dom') td.append(el('span', { className: 'dom' }, favicon(dom(value)), dom(value) || value));
  else if (type === 'status') td.append(el('span', { className: `pill s-${STATUS.includes(value) ? value : 'todo'}`, textContent: value }));
  else if (type === 'prio') {
    const n = String(value).match(/^\s*(\d)/)?.[1], rest = String(value).replace(/^\s*\d\s*/, '').replace(/^\(|\)$/g, '');
    if (n) td.append(el('span', { className: `prio p${n}`, textContent: 'P' + n }), el('span', { className: 'prio-note', textContent: rest }));
    else td.textContent = value;
  } else if (type === 'long') td.append(el('span', { className: 'reply-cell has', textContent: value.replace(/\s+/g, ' ') }));
  else if (type === 'date') { const d = day(value); td.textContent = d === null ? value : nice(d); }
  else td.textContent = value;
}

// ---------- toolbar (summary + quick filters) ----------
function drawToolbar() {
  const bar = $('#toolbar'); bar.textContent = '';
  if (S.tab !== 'forum-threads' && S.tab !== 'forum-limits') return;
  const L = limits(S.threads), forums = Object.values(L);
  const states = S.threads.map(r => threadState(r, L));
  const kpi = (n, label, cls = '') => el('div', { className: 'kpi ' + cls }, el('b', { textContent: n }), el('span', { textContent: label }));
  bar.append(
    kpi(states.filter(s => s === 'yes').length, 'threads you can post today', 'g'),
    kpi(forums.filter(f => f.kind === 'wait').length, 'forums waiting 15 days', 'a'),
    kpi(forums.filter(f => f.kind === 'max').length, 'forums maxed', 'r'),
    kpi(states.filter(s => s === 'posted').length, 'links posted'),
    kpi(forums.length, 'forums in total'));
  if (S.tab === 'forum-threads') {
    const chip = (v, label) => el('button', { className: 'chip' + (S.view === v ? ' on' : ''), textContent: label, onclick: () => { S.view = v; drawToolbar(); render(); } });
    bar.append(el('div', { className: 'chips' }, chip('all', 'All'), chip('yes', 'Can post now'), chip('wait', 'Waiting'), chip('posted', 'Posted')));
  }
}

// ---------- grid ----------
function render() {
  const isLimits = S.tab === 'forum-limits', cols = TABS[S.tab] || LIMIT_COLS, grid = $('#grid'), q = $('#filter').value.trim().toLowerCase();
  const isThreads = S.tab === 'forum-threads';
  const extra = isThreads ? [['Can post?', 150]] : [];
  const actW = isLimits ? 0 : isThreads ? 130 : 44;
  grid.textContent = '';
  const widths = [48, ...cols.map(c => c[1]), ...extra.map(c => c[1]), ...(actW ? [actW] : [])];
  grid.style.width = widths.reduce((a, b) => a + b, 0) + 'px';
  grid.append(el('colgroup', {}, ...widths.map(w => el('col', { style: `width:${w}px` }))));
  grid.append(el('thead', {}, el('tr', {}, el('th', { className: 'num', textContent: '#' }), ...[...cols, ...extra].map(c => el('th', { textContent: c[0] })), actW ? el('th') : null)));
  const body = el('tbody'); grid.append(body);
  let shown = 0;

  if (isLimits) {
    const L = limits(S.threads);
    Object.keys(L).sort((a, b) => ({ yes: 0, wait: 1, max: 2 }[L[a].kind] - { yes: 0, wait: 1, max: 2 }[L[b].kind]) || a.localeCompare(b)).forEach(d => {
      const f = L[d];
      if (q && !d.includes(q)) return;
      const tr = el('tr', {}, el('td', { className: 'num', textContent: ++shown }));
      const tds = [el('td'), el('td', { textContent: `${f.posted} / ${MAX_PER_FORUM}` }), el('td', { textContent: f.last === null ? '—' : nice(f.last) }),
        el('td', { textContent: f.kind === 'max' ? '—' : f.kind === 'yes' ? 'Now' : nice(f.next) }), el('td')];
      cellView(tds[0], 'dom', d); tds[4].append(canPill(f.kind, f.label));
      tr.append(...tds); body.append(tr);
    });
  } else {
    const L = isThreads ? limits(S.rows) : null;
    S.rows.forEach((r, i) => {
      if (q && !r.cells.join(' ').toLowerCase().includes(q)) return;
      const st = isThreads ? threadState(r, L) : null;
      if (isThreads && S.view !== 'all' && st !== S.view && !(S.view === 'wait' && st === 'max')) return;
      const statusIdx = cols.findIndex(c => c[2] === 'status'), status = r.cells[statusIdx] || '';
      const tr = el('tr', {}, el('td', { className: 'num', textContent: i + 1 }));
      if (status === 'done' || st === 'posted') tr.className = 'done';
      else if (isThreads && L[dom(r.cells[0])]?.waiting) tr.className = 'wait';   // forum used in the last 15 days -> yellow
      cols.forEach((c, ci) => {
        const td = el('td', { className: 'edit' }), type = c[2] || 'text';
        cellView(td, type, r.cells[ci] ?? '');
        td.onclick = (e) => { if (!e.target.closest('a')) edit(td, r, ci, type); };
        tr.append(td);
      });
      if (isThreads) {
        const f = L[dom(r.cells[0])];
        tr.append(el('td', {}, st === 'posted' ? canPill('posted', 'Posted') : canPill(f?.kind || 'yes', f?.label || 'Can post')));
      }
      const act = el('td', { className: 'act' });
      if (isThreads && st !== 'posted') act.append(el('button', { className: 'mini go', textContent: '✓ Posted', title: 'Mark as posted today', onclick: () => markPosted(r) }));
      if (isThreads && st === 'posted') act.append(el('button', { className: 'mini', textContent: '↺ Unpost', title: 'Not posted after all: clear the date', onclick: () => unpost(r) }));
      act.append(el('button', { className: 'del', textContent: '✕', title: 'Delete row', 'aria-label': 'Delete row', onclick: () => removeRow(r) }));
      tr.append(act);
      body.append(tr); shown++;
    });
  }
  const empty = $('#empty');
  empty.hidden = shown > 0;
  empty.textContent = '';
  if (!shown) empty.append(el('b', { textContent: !S.site ? 'Add your first site' : q || S.view !== 'all' ? 'Nothing matches' : 'This tab is empty' }),
    !S.site ? 'Use the + next to the site picker.' : q || S.view !== 'all' ? 'Try another search or filter.' : isLimits ? 'Add threads in Forum threads and they show up here.' : 'Add a row or import a CSV.');
}

async function save(r, ci, value) {
  if ((r.cells[ci] ?? '') === value) return render();
  const before = r.cells.slice(), after = r.cells.slice(), id = r.id, col = (TABS[S.tab][ci] || [''])[0];
  while (after.length <= ci) after.push('');
  after[ci] = value;
  r.cells = after; refresh();
  try { await act(`edit ${col}`, () => putCells(id, after), () => putCells(id, before), `${col} saved.`); }
  catch (e) { r.cells = before; refresh(); fail(e); }
}
async function markPosted(r) {
  const before = r.cells.slice(), cells = (r.cells.slice().concat(Array(8).fill(''))).slice(0, Math.max(8, r.cells.length)), id = r.id;
  cells[7] = iso(today()); cells[5] = 'done';
  r.cells = cells; refresh();
  try { await act(`posted on ${dom(cells[0])}`, () => putCells(id, cells), () => putCells(id, before), `Posted on ${dom(cells[0])}. Its other thread waits 15 days.`); }
  catch (e) { r.cells = before; refresh(); fail(e); }
}
async function unpost(r) {   // clicked Posted by mistake: clear the date, back to todo
  const before = r.cells.slice(), cells = r.cells.slice(), id = r.id;
  while (cells.length < 8) cells.push('');
  cells[7] = ''; if (cells[5] === 'done') cells[5] = 'todo';
  r.cells = cells; refresh();
  try { await act(`unpost ${dom(cells[0])}`, () => putCells(id, cells), () => putCells(id, before), `${dom(cells[0])} is not posted any more.`); }
  catch (e) { r.cells = before; refresh(); fail(e); }
}
async function removeRow(r) {   // no confirm needed: it can be undone
  const { site, tab } = S, id = r.id, pos = r.pos, cells = r.cells.slice();
  const at = S.rows.indexOf(r), list = S.rows;
  list.splice(at, 1); refresh();
  try { await act('delete row', () => delRow(id), () => restoreRow(site, tab, id, pos, cells), 'Row deleted.'); }
  catch (e) { list.splice(at, 0, r); refresh(); fail(e); }
}
function refresh() { if (S.tab === 'forum-threads') S.threads = S.rows; drawToolbar(); drawTabs(); render(); }

function edit(td, r, ci, type) {
  if (td.classList.contains('editing')) return;
  const v = r.cells[ci] ?? '';
  if (type === 'long') return longEditor(r, ci);
  let input;
  if (type === 'status') { input = el('select', {}, ...STATUS.map(s => el('option', { value: s, textContent: s, selected: s === v }))); input.onchange = () => input.blur(); }
  else input = el('input', { value: type === 'date' && day(v) !== null ? iso(day(v)) : v, type: type === 'date' ? 'date' : 'text' });
  if (type === 'date' && !v) input.value = iso(today());
  td.textContent = ''; td.classList.add('editing'); td.append(input); input.focus();
  if (input.select) input.select();
  let done = false;
  const finish = (keep) => { if (done) return; done = true; td.classList.remove('editing'); keep ? save(r, ci, input.value.trim()) : render(); };
  input.onkeydown = (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); };
  input.onblur = () => finish(true);
}
function longEditor(r, ci) {
  const cols = TABS[S.tab], ta = el('textarea', { value: r.cells[ci] ?? '', placeholder: 'Write here…' });
  const thread = cols.findIndex(c => c[2] === 'url'), anchor = cols.findIndex(c => /anchor/i.test(c[0]));
  const close = () => { ov.remove(); document.removeEventListener('keydown', esc); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  const count = el('span', { className: 'muted' });
  const upd = () => { count.textContent = `${ta.value.trim().split(/\s+/).filter(Boolean).length} words`; };
  ta.oninput = upd; upd();
  const ov = el('div', { className: 'overlay', onclick: (e) => { if (e.target === ov) close(); } },
    el('div', { className: 'modal', role: 'dialog', 'aria-modal': 'true' },
      el('header', {}, el('b', { textContent: cols[ci][0] + (anchor >= 0 && r.cells[anchor] ? ` · anchor: "${r.cells[anchor]}"` : '') }),
        thread >= 0 && r.cells[thread] ? el('a', { href: r.cells[thread], target: '_blank', rel: 'noopener noreferrer', textContent: r.cells[thread] }) : null),
      ta,
      el('footer', {}, count,
        el('button', { className: 'ghost', textContent: 'Copy', onclick: () => navigator.clipboard.writeText(ta.value).then(() => toast('Copied to clipboard.')) }),
        el('button', { className: 'ghost', textContent: 'Cancel', onclick: close }),
        el('button', { className: 'primary', textContent: 'Save', onclick: async () => { close(); await save(r, ci, ta.value); } }))));
  document.body.append(ov); document.addEventListener('keydown', esc); ta.focus();
}

// ---------- CSV ----------
function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split('\n', 1)[0], sep = (first.match(/\t/g) || []).length > (first.match(/,/g) || []).length ? '\t' : ',';
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}
const toCsv = (rows) => rows.map(r => r.map(c => /[",\n\r]/.test(c = String(c ?? '')) ? `"${c.replace(/"/g, '""')}"` : c).join(',')).join('\r\n');
async function readFile(file) {   // UTF-8 or UTF-16 (Ahrefs)
  const buf = new Uint8Array(await file.arrayBuffer());
  const utf16 = (buf[0] === 0xFF && buf[1] === 0xFE) || (buf[0] === 0xFE && buf[1] === 0xFF);
  return new TextDecoder(utf16 ? (buf[0] === 0xFF ? 'utf-16le' : 'utf-16be') : 'utf-8').decode(buf);
}
async function importCsv(file) {
  const cols = TABS[S.tab]; if (!cols) return toast('Forum limits is calculated. Import into Forum threads instead.', true);
  if (!S.site) return toast('Add a site first.', true);
  const rows = parseCsv(await readFile(file)); if (!rows.length) return toast('That file is empty.', true);
  const norm = (s) => String(s).trim().toLowerCase();
  const header = rows[0].map(norm), names = cols.map(c => norm(c[0]));
  const hasHeader = header.some(h => names.includes(h)) || header.some(h => /domain|url|anchor|status|keyword|platform|competitor/.test(h));
  const map = hasHeader && header.some(h => names.includes(h)) ? names.map(n => header.indexOf(n)) : names.map((_, i) => i);
  const data = (hasHeader ? rows.slice(1) : rows).map(r => map.map(i => (i >= 0 ? r[i] ?? '' : '')));
  const replace = S.rows.length && confirm(`"${LABELS[S.tab]}" already has ${S.rows.length} rows.\n\nOK = replace them\nCancel = add to the end`);
  const { site, tab } = S, old = S.rows.map(r => r.cells);
  let ids = [], res = {};
  const redo = async () => { res = await call('/api/rows', { method: 'POST', body: { site, tab, rows: data, mode: replace ? 'replace' : 'append' } }); ids = res.ids; };
  const undo = replace ? () => call('/api/rows', { method: 'POST', body: { site, tab, rows: old, mode: 'replace' } })
    : async () => { for (const id of ids) await delRow(id); };
  await act(`import ${file.name}`, redo, undo, 'Importing…');
  toast(`Imported ${res.added} rows.` + (res.skipped?.length ? ` Skipped ${res.skipped.length} (${res.rule}).` : ''), false, { label: 'Undo', run: undoLast });
  await load();
}
function exportCsv() {
  const cols = TABS[S.tab] || LIMIT_COLS;
  let rows = S.rows.map(r => r.cells);
  if (S.tab === 'forum-limits') { const L = limits(S.threads); rows = Object.keys(L).sort().map(d => [d, L[d].posted, L[d].last === null ? '' : iso(L[d].last), iso(L[d].next), L[d].label]); }
  const blob = new Blob(['﻿' + toCsv([cols.map(c => c[0]), ...rows])], { type: 'text/csv' });
  el('a', { href: URL.createObjectURL(blob), download: `${S.site}-${S.tab}.csv` }).click();
}

// ---------- loading, sites, tabs ----------
// load(true) fetches the whole site (all tabs) in one request; load() just switches tab from memory.
// The last copy is kept in localStorage so the page paints instantly, then the fresh copy replaces it.
// shortcut: an edit made in the ~1 s before the fresh copy lands is saved but may flash back until the next load.
const CACHE = 'boot:';
function applyBoot(b) { S.boot = b; S.data = b.data; S.site = b.site; drawSites(b.sites); }
function cached(site) { try { return JSON.parse(localStorage[CACHE + site] || 'null'); } catch { return null; } }
async function load(fetchIt = true) {
  if (fetchIt || !S.data) {
    const b = await call(`/api/boot?site=${encodeURIComponent(S.site || '')}`);
    if (!b.email) { S.boot = null; return showAuth(b.needsSetup); }
    applyBoot(b);
    try { localStorage[CACHE + b.site] = JSON.stringify(b); } catch {}
  }
  const tab = (t) => S.data[t] || (S.data[t] = []);
  S.threads = tab('forum-threads');
  S.rows = TABS[S.tab] ? tab(S.tab) : [];
  refresh();
}
function drawTabs() {
  const nav = $('#tabs'); nav.textContent = '';
  Object.keys(TABS).forEach(t => {
    const n = t === 'forum-limits' ? Object.keys(limits(S.threads)).length : (S.data?.[t] || []).length;
    nav.append(el('button', { className: t === S.tab ? 'active' : '', onclick: () => {
      S.tab = localStorage.tab = t; S.view = 'all'; $('#filter').value = ''; load(false).catch(fail);
    } }, LABELS[t], el('span', { className: 'count', textContent: n })));
  });
  $('#addRow').disabled = !TABS[S.tab];
}
function drawSites(sites) {
  const sel = $('#site');
  sel.textContent = '';
  sites.forEach(d => sel.append(el('option', { value: d, textContent: d })));
  if (!sites.length) sel.append(el('option', { value: '', textContent: 'No sites yet' }));
  sel.value = S.site;
}

// ---------- auth ----------
let setupMode = false;
function showAuth(needsSetup) {
  setupMode = needsSetup;
  $('#app').hidden = true; $('#auth').hidden = false;
  $('#codeRow').hidden = !needsSetup;
  $('#authHint').textContent = needsSetup ? 'Create your account. You need the setup code.' : 'Welcome back. Log in to continue.';
  $('#authBtn').textContent = needsSetup ? 'Create account' : 'Log in';
  $('#authForm [name=password]').autocomplete = needsSetup ? 'new-password' : 'current-password';
}
function showApp() {
  const me = S.boot;
  $('#auth').hidden = true; $('#app').hidden = false;
  $('#userBtn').textContent = me.email[0].toUpperCase(); $('#userEmail').textContent = me.email + (me.admin ? ' · admin' : '');
  S.admin = me.admin; $('#usersBtn').hidden = !me.admin; $('#addSite').hidden = !me.admin;
}
async function start() {
  const c = cached(localStorage.site || '');
  if (c?.email) { applyBoot(c); showApp(); load(false); }          // instant paint from the last visit
  await load(true);                                                 // then the fresh copy (one request)
  if (!S.boot?.email) return;
  localStorage.site = S.site; showApp();
}
$('#authForm').onsubmit = async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target)), btn = $('#authBtn');
  $('#authErr').textContent = ''; btn.disabled = true;
  try {
    if (setupMode) await call('/api/setup', { method: 'POST', body: f });
    await call('/api/login', { method: 'POST', body: { email: f.email, password: f.password } });
    e.target.reset(); await start();
  } catch (err) { $('#authErr').textContent = err.message; }
  btn.disabled = false;
};
$('#userBtn').onclick = (e) => { e.stopPropagation(); $('#userMenu').hidden = !$('#userMenu').hidden; };
document.addEventListener('click', () => { $('#userMenu').hidden = true; });
$('#logout').onclick = async () => {
  Object.keys(localStorage).filter(k => k.startsWith(CACHE)).forEach(k => localStorage.removeItem(k));   // no data left behind
  S.data = null; S.boot = null; U.done = []; U.undone = []; updUndo();
  await call('/api/logout', { method: 'POST' }).catch(() => {}); showAuth(false);
};
$('#site').onchange = (e) => { S.site = localStorage.site = e.target.value; load().catch(fail); };
$('#addSite').onclick = async () => {
  const d = prompt('Site domain, e.g. example.com'); if (!d) return;
  try { const r = await call('/api/sites', { method: 'POST', body: { domain: d } }); S.site = localStorage.site = r.domain; await load(); toast(`${r.domain} added.`); }
  catch (e) { fail(e); }
};
$('#addRow').onclick = async () => {
  if (!S.site) return toast('Add a site first.', true);
  try {
    const { site, tab } = S, blank = TABS[S.tab].map(c => c[2] === 'status' ? 'todo' : '');
    let id = null;
    await act('add row', async () => { const res = await call('/api/rows', { method: 'POST', body: { site, tab, rows: [blank] } }); id = res.ids[0]; },
      () => delRow(id), 'Row added.');
    S.view = 'all'; $('#filter').value = '';
    await load(); $('#gridWrap').scrollTop = 1e9;
    const last = $('#grid tbody tr:last-child td.edit'); if (last) last.click();
  } catch (e) { fail(e); }
};
$('#filter').oninput = () => render();
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !$('#app').hidden) { e.preventDefault(); $('#filter').focus(); }
});
$('#importFile').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importCsv(f).catch(fail); };
$('#exportCsv').onclick = exportCsv;
$('#undoBtn').onclick = undoLast;
$('#redoBtn').onclick = redoLast;
document.addEventListener('keydown', (e) => {   // Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z, but not while typing in a field
  if (!(e.ctrlKey || e.metaKey) || $('#app').hidden || document.querySelector('.overlay')) return;
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); undoLast(); }
  else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redoLast(); }
});

// ---------- modals: users & access, change password ----------
function modal(title, wide, ...content) {
  const close = () => { ov.remove(); document.removeEventListener('keydown', esc); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  const ov = el('div', { className: 'overlay', onclick: (e) => { if (e.target === ov) close(); } },
    el('div', { className: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' },
      el('header', {}, el('b', { textContent: title })), el('div', { className: 'body' }, ...content),
      el('footer', {}, el('button', { className: 'ghost', textContent: 'Close', onclick: close }))));
  document.body.append(ov); document.addEventListener('keydown', esc);
  return close;
}
const siteChecks = (all, chosen, name) => el('div', { className: 'site-checks' }, ...(all.length ? all.map(s => el('label', {},
  el('input', { type: 'checkbox', value: s, checked: chosen.includes(s), name }), s)) : [el('span', { className: 'muted', textContent: 'No sites yet.' })]));
const checked = (box) => [...box.querySelectorAll('input:checked')].map(i => i.value);

async function openUsers() {
  $('#userMenu').hidden = true;
  const [users, sites] = await Promise.all([call('/api/users'), call('/api/sites')]);
  const table = el('table', { className: 'users' }, el('thead', {}, el('tr', {},
    ...['User', 'Role', 'Sites they can open', ''].map(t => el('th', { textContent: t })))));
  const tb = el('tbody'); table.append(tb);
  users.forEach(u => {
    const role = el('select', {}, el('option', { value: 'member', textContent: 'Member', selected: u.role === 'member' }), el('option', { value: 'admin', textContent: 'Admin', selected: u.role === 'admin' }));
    const box = siteChecks(sites, u.sites, 'site-' + u.email);
    const syncBox = () => { box.style.opacity = role.value === 'admin' ? .4 : 1; box.title = role.value === 'admin' ? 'Admins can open every site' : ''; };
    role.onchange = syncBox; syncBox();
    tb.append(el('tr', {},
      el('td', {}, el('b', { textContent: u.email }), el('div', { className: 'muted', textContent: 'since ' + new Date(u.created * 1000).toLocaleDateString() })),
      el('td', {}, role),
      el('td', {}, box),
      el('td', {}, el('div', { className: 'form-row' },
        el('button', { className: 'primary', textContent: 'Save', onclick: async () => {
          try { await call('/api/users/' + encodeURIComponent(u.email), { method: 'PUT', body: { role: role.value, sites: checked(box) } }); toast(`${u.email} saved.`); }
          catch (e) { fail(e); } } }),
        el('button', { className: 'ghost', textContent: 'New password', onclick: async () => {
          const pw = prompt(`New password for ${u.email} (10+ characters). They will be logged out everywhere.`); if (!pw) return;
          try { await call('/api/users/' + encodeURIComponent(u.email), { method: 'PUT', body: { password: pw } }); toast('Password changed. Send it to them privately.'); }
          catch (e) { fail(e); } } }),
        el('button', { className: 'ghost', textContent: 'Remove', onclick: async () => {
          if (!confirm(`Remove ${u.email}? They lose access straight away.`)) return;
          try { await call('/api/users/' + encodeURIComponent(u.email), { method: 'DELETE' }); close(); openUsers(); toast(`${u.email} removed.`); }
          catch (e) { fail(e); } } })))));
  });
  const email = el('input', { type: 'email', placeholder: 'email@example.com' }), pw = el('input', { type: 'text', placeholder: 'Password (10+ characters)' });
  const role = el('select', {}, el('option', { value: 'member', textContent: 'Member' }), el('option', { value: 'admin', textContent: 'Admin' }));
  const box = siteChecks(sites, S.site ? [S.site] : [], 'new-sites');
  const add = el('button', { className: 'primary', textContent: 'Add user', onclick: async () => {
    try {
      await call('/api/users', { method: 'POST', body: { email: email.value, password: pw.value, role: role.value, sites: checked(box) } });
      toast(`${email.value} added. Send them the link and their password.`); close(); openUsers();
    } catch (e) { fail(e); } } });
  const close = modal('Users & access', true,
    el('p', { className: 'muted', textContent: 'Admins see every site and can manage users. Members only see the sites ticked for them.' }),
    table,
    el('p', { className: 'section-title', textContent: 'Add a user' }),
    el('div', { className: 'form-row' }, email, pw, role, add), box);
}
function openPassword() {
  $('#userMenu').hidden = true;
  const cur = el('input', { type: 'password', placeholder: 'Current password', autocomplete: 'current-password' });
  const nw = el('input', { type: 'password', placeholder: 'New password (10+ characters)', autocomplete: 'new-password' });
  const close = modal('Change password', false, el('div', { className: 'form-row' }, cur, nw,
    el('button', { className: 'primary', textContent: 'Change', onclick: async () => {
      try { await call('/api/password', { method: 'POST', body: { current: cur.value, password: nw.value } }); close(); toast('Password changed. Other devices were logged out.'); }
      catch (e) { fail(e); } } })));
}
$('#usersBtn').onclick = () => openUsers().catch(fail);
$('#pwBtn').onclick = openPassword;
start().catch(fail);
