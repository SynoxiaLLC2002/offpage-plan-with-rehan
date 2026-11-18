// MCP endpoint (POST /mcp, JSON-RPC over Streamable HTTP, JSON replies only, stateless).
// Auth: "Authorization: Bearer <API_TOKEN>". Every tool goes through the normal /api/* code, so the same rules
// (max 2 threads per forum, site access) apply to Claude as to the sheet.

// Password (the column after 'Username / email') is left out on purpose: Claude never reads or writes it;
// set_cells keeps it because cells past the listed columns are carried over unchanged.
// shortcut: column names duplicated from public/app.js TABS; keep both in step when a tab changes.
const COLUMNS = {
  'plan': ['Week', 'Area', 'Task', 'Target', 'Owner', 'Status'],
  'forum-threads': ['Domain', 'Thread', 'Anchor', 'Links to', 'Priority', 'Status', 'Reply draft', 'Posted', 'Post URL', 'Login with', 'Username / email'],
  'forum-queries': ['Keyword', 'Searches', 'Lang', 'Google search', 'Anchor', 'Links to', 'Threads found', 'Status'],
  'forum-accounts': ['Forum', 'Profile URL', 'Joined', 'Warmup', 'Status', 'Note', 'Login with', 'Username / email'],
  'warmup-log': ['Forum', 'Date', 'Type', 'Thread', 'What I wrote', 'Post URL'],
  'profiles': ['#', 'Platform', 'Sign-up', 'Type', 'Value', 'What to post', 'Links to', 'Status', 'Login with', 'Username / email'],
  'competitor-analysis': ['Competitor', 'Website', 'Thread / page', 'Their anchor', 'Their target', 'My anchor', 'My URL', 'Note', 'Status'],
  'gp-niche-edits': ['Competitor', 'Website', 'Page', 'Type', 'DR', 'Traffic', 'Their anchor', 'Their target', 'We have it?', 'My anchor', 'My URL', 'Note', 'Status'],
};
const MAX_PER_FORUM = 2, WAIT_DAYS = 15, WARM_DAYS = 7, WARM_REPLIES = 7, WARM_POSTS = 2;
const TAB = { type: 'string', enum: Object.keys(COLUMNS) };
const SITE = { type: 'string', description: 'Site domain, e.g. example.com' };
const obj = (properties, required) => ({ type: 'object', properties, required });

const TOOLS = [
  { name: 'list_sites', description: 'Sites in the planner.', inputSchema: obj({}, []) },
  { name: 'get_tab', description: 'All rows of one tab, each as {id, ...column: value}.', inputSchema: obj({ site: SITE, tab: TAB }, ['site', 'tab']) },
  { name: 'next_threads', description: 'Forum threads that can get a link today: not posted yet, forum under 2 links, 15 days since its last link, and the forum account has finished its warmup (or warmup is skipped). Includes the reply draft.',
    inputSchema: obj({ site: SITE }, ['site']) },
  { name: 'warmup_today', description: 'Forum accounts still warming up and what to do on each today. Warmup: days 1-7 one helpful reply a day (warmup-log Type "reply"), from day 4 at least 2 posts with no link (Type "post"), then the forum is ready for links. Log each one with add_rows on warmup-log.',
    inputSchema: obj({ site: SITE }, ['site']) },
  { name: 'add_rows', description: 'Append rows to a tab. Each row is an object keyed by column name. Forum threads over the 2-per-forum limit are skipped and listed.',
    inputSchema: obj({ site: SITE, tab: TAB, rows: { type: 'array', items: { type: 'object' } } }, ['site', 'tab', 'rows']) },
  { name: 'set_cells', description: 'Change some cells of one row, by column name (e.g. {"Reply draft": "...", "Status": "doing"}). Other cells stay.',
    inputSchema: obj({ site: SITE, tab: TAB, id: { type: 'integer' }, values: { type: 'object' } }, ['site', 'tab', 'id', 'values']) },
  { name: 'mark_posted', description: 'Mark a forum-threads row as posted today (Posted = today, Status = done). Only after the user has really posted it.',
    inputSchema: obj({ site: SITE, id: { type: 'integer' } }, ['site', 'id']) },
  { name: 'check_links', description: 'Check posted backlinks are still live. Fetches each Post URL and looks for the target link. Max 20 per call. Returns {checked, total_posted, results: [{id, domain, post_url, target, status: "live"|"dead"|"error", detail}]}.',
    inputSchema: obj({ site: SITE }, ['site']) },
  { name: 'delete_row', description: 'Delete one row.', inputSchema: obj({ id: { type: 'integer' } }, ['id']) },
];

// shortcut: same warmup rule as public/app.js; keep both in step.
function warmup(acct, logs, today) {
  if (!acct) return { ready: false, state: 'join first: no row in forum-accounts' };
  if (acct[3] === 'skip') return { ready: true, state: 'warmup skipped' };
  const joined = dayOf(acct[2]);
  if (joined === null) return { ready: false, state: 'join first: Joined date empty' };
  const n = today - joined + 1, replies = logs.filter(l => l[2] === 'reply').length;
  const posts = logs.filter(l => l[2] === 'post' && dayOf(l[1]) >= joined + 3).length;
  const ready = n > WARM_DAYS && replies >= WARM_REPLIES && posts >= WARM_POSTS;
  return { ready, day: n, replies, posts, state: ready ? 'ready for links' : `warmup day ${Math.min(n, WARM_DAYS)}/${WARM_DAYS}`,
    done_today: logs.filter(l => dayOf(l[1]) === today).map(l => l[2]),
    todo: ready ? null : [replies < WARM_REPLIES && 'one helpful reply (no link)', n >= 4 && posts < WARM_POSTS && 'one new post or reply with no link that starts or adds to a discussion'].filter(Boolean) };
}
const dayOf = (s) => { const t = Date.parse(s); return isNaN(t) ? null : Math.floor(t / 864e5); };
const domainOf = (v) => String(v || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];

export async function handleMcp(req, env, api) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { allow: 'POST' } });
  const auth = req.headers.get('authorization') || '';
  if (!env.API_TOKEN || auth !== 'Bearer ' + env.API_TOKEN) return new Response('Unauthorized', { status: 401 });
  const msg = await req.json().catch(() => null);
  if (!msg || msg.jsonrpc !== '2.0') return rpc(null, null, { code: -32700, message: 'Parse error' });
  if (msg.id === undefined) return new Response(null, { status: 202 });   // notification
  const { id, method, params = {} } = msg;
  // remember the last call so the sheet can show "last used by Claude"
  await env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('mcp_last', ?)")
    .bind(JSON.stringify({ at: Math.floor(Date.now() / 1000), what: method === 'tools/call' ? params.name : method })).run().catch(() => {});
  if (method === 'initialize') return rpc(id, { protocolVersion: params.protocolVersion || '2025-06-18',
    capabilities: { tools: {} }, serverInfo: { name: 'offpage-planner', version: '1.0.0' },
    instructions: 'Off-page link planner. New forum accounts warm up first (warmup_today) unless their Warmup is "skip"; next_threads only lists forums that are ready. Show the user every reply before it is posted and post only after they say yes to that reply. Never mark_posted or log warmup unless the post is live.' });
  if (method === 'ping') return rpc(id, {});
  if (method === 'tools/list') return rpc(id, { tools: TOOLS });
  if (method === 'tools/call') {
    try { return rpc(id, { content: [{ type: 'text', text: JSON.stringify(await call(params.name, params.arguments || {}, req, env, api)) }] }); }
    catch (e) { return rpc(id, { content: [{ type: 'text', text: String(e.message || e) }], isError: true }); }
  }
  return rpc(id, null, { code: -32601, message: 'Method not found: ' + method });
}

const rpc = (id, result, error) => new Response(JSON.stringify(error ? { jsonrpc: '2.0', id, error } : { jsonrpc: '2.0', id, result }),
  { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

async function call(name, a, req, env, api) {
  // run the normal API as the API token, so its checks and rules apply
  const run = async (method, path, body) => {
    const r = await api(new Request(new URL(path, req.url), { method, headers: { authorization: 'Bearer ' + env.API_TOKEN, 'content-type': 'application/json' },
      body: body && JSON.stringify(body) }), env, new URL(path, req.url).pathname);
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
    return d;
  };
  const cols = (tab) => { const c = COLUMNS[tab]; if (!c) throw new Error('Unknown tab: ' + tab); return c; };
  const rowsOf = (site, tab) => run('GET', `/api/rows?site=${encodeURIComponent(site)}&tab=${encodeURIComponent(tab)}`);
  const named = (tab, r) => Object.fromEntries([['id', r.id], ...cols(tab).map((c, i) => [c, r.cells[i] ?? ''])]);

  if (name === 'list_sites') return run('GET', '/api/sites');
  if (name === 'get_tab') return (await rowsOf(a.site, a.tab)).map(r => named(a.tab, r));
  const warmups = async (site, today) => {
    const [accts, logs] = await Promise.all([rowsOf(site, 'forum-accounts'), rowsOf(site, 'warmup-log')]), by = {}, lg = {};
    for (const r of logs) (lg[domainOf(r.cells[0])] ||= []).push(r.cells);
    for (const r of accts) { const d = domainOf(r.cells[0]); if (d) by[d] = { id: r.id, profile: r.cells[1], login: r.cells[6], ...warmup(r.cells, lg[d] || [], today) }; }
    return by;
  };
  if (name === 'warmup_today') {
    const today = Math.floor(Date.now() / 864e5), W = await warmups(a.site, today);
    return Object.entries(W).filter(([, w]) => !w.ready).map(([forum, w]) => ({ forum, ...w }));
  }
  if (name === 'next_threads') {
    const rows = await rowsOf(a.site, 'forum-threads'), today = Math.floor(Date.now() / 864e5), f = {}, W = await warmups(a.site, today);
    for (const r of rows) {
      const d = domainOf(r.cells[0]), p = dayOf(r.cells[7]);
      if (!d || p === null) continue;
      f[d] = { n: (f[d]?.n || 0) + 1, last: Math.max(f[d]?.last ?? p, p) };
    }
    return rows.filter(r => {
      const d = domainOf(r.cells[0]), s = f[d];
      return d && dayOf(r.cells[7]) === null && r.cells[5] !== 'skip' && (s ? s.n < MAX_PER_FORUM && today >= s.last + WAIT_DAYS : W[d]?.ready);
    }).map(r => named('forum-threads', r));
  }
  if (name === 'add_rows') {
    const c = cols(a.tab);
    const unknown = [...new Set((a.rows || []).flatMap(o => Object.keys(o).filter(k => !c.includes(k))))];
    if (unknown.length) throw new Error(`Unknown column(s) ${unknown.join(', ')}. ${a.tab} has: ${c.join(', ')}`);
    if (a.tab === 'warmup-log') for (const o of a.rows) {
      if (/https?:\/\/|www\./i.test(o['What I wrote'] || '')) throw new Error('Warmup posts carry no links. Remove the link from "What I wrote".');
      if (!['reply', 'post'].includes(o.Type)) throw new Error('warmup-log Type must be "reply" or "post".');
      o.Date ||= new Date().toISOString().slice(0, 10);
    }
    return run('POST', '/api/rows', { site: a.site, tab: a.tab, rows: a.rows.map(o => c.map(k => o[k] ?? '')) });
  }
  if (name === 'set_cells' || name === 'mark_posted') {
    const tab = name === 'mark_posted' ? 'forum-threads' : a.tab, c = cols(tab);
    const row = (await rowsOf(a.site, tab)).find(r => r.id === a.id);
    if (!row) throw new Error(`No row ${a.id} in ${tab} of ${a.site}`);
    const cells = c.map((_, i) => row.cells[i] ?? '').concat(row.cells.slice(c.length));
    const values = name === 'mark_posted' ? { Posted: new Date().toISOString().slice(0, 10), Status: 'done' } : a.values || {};
    for (const [k, v] of Object.entries(values)) {
      const i = c.indexOf(k);
      if (i < 0) throw new Error(`Unknown column ${k}. ${tab} has: ${c.join(', ')}`);
      cells[i] = v == null ? '' : String(v);
    }
    await run('PUT', `/api/rows/${a.id}`, { cells });
    return named(tab, { id: a.id, cells });
  }
  if (name === 'check_links') {
    const rows = await rowsOf(a.site, 'forum-threads');
    const posted = rows.filter(r => dayOf(r.cells[7]) !== null && r.cells[8] && /^https?:\/\//i.test(r.cells[8]));
    const batch = posted.slice(0, 20);
    const results = await Promise.all(batch.map(async r => {
      const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 8000);
      try {
        const resp = await fetch(r.cells[8], { signal: ctrl.signal, redirect: 'follow',
          headers: { 'user-agent': 'Mozilla/5.0 (compatible; LinkChecker/1.0)' } });
        clearTimeout(timer);
        if (!resp.ok) return { id: r.id, domain: domainOf(r.cells[0]), post_url: r.cells[8], target: r.cells[3], status: 'error', detail: 'HTTP ' + resp.status };
        const html = await resp.text(), target = (r.cells[3] || '').trim().toLowerCase().replace(/\/+$/, '');
        return { id: r.id, domain: domainOf(r.cells[0]), post_url: r.cells[8], target: r.cells[3],
          status: target && html.toLowerCase().includes(target) ? 'live' : 'dead',
          detail: target && html.toLowerCase().includes(target) ? 'Target URL found' : 'Target URL not found in page' };
      } catch (e) { clearTimeout(timer); return { id: r.id, domain: domainOf(r.cells[0]), post_url: r.cells[8], target: r.cells[3], status: 'error', detail: e.message || 'Fetch failed' }; }
    }));
    return { checked: batch.length, total_posted: posted.length, results };
  }
  if (name === 'delete_row') return run('DELETE', `/api/rows/${a.id}`);
  throw new Error('Unknown tool: ' + name);
}
