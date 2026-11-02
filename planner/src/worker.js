// Offpage Planner API (Cloudflare Worker + D1). The sheet UI is static (public/); everything under /api/* lands here.
// Auth: a session cookie from /api/login, or "Authorization: Bearer <API_TOKEN>" for Claude/scripts (= admin).
// Roles: admin sees and manages everything (sites, users); member only opens the sites given to them.

const DAY = 86400, SESSION_DAYS = 30, MAX_PER_FORUM = 2;
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const now = () => Math.floor(Date.now() / 1000);
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });
const bad = (msg, status = 400) => json({ error: msg }, status);

async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = Uint8Array.from(saltHex.match(/../g).map(h => parseInt(h, 16)));
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256));
}
function same(a, b) {   // constant-time string compare
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const randomHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
const cookieOf = (req) => (req.headers.get('cookie') || '').match(/(?:^|;\s*)sid=([a-f0-9]{64})/)?.[1];
const sessionCookie = (token, maxAge) => `sid=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
const domainOf = (v) => String(v || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const cleanEmail = (e) => String(e || '').trim().toLowerCase();

/** Who is calling: { email, admin, sites:Set|null (null = all) } or null. */
async function caller(req, env) {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (bearer && env.API_TOKEN && same(bearer, env.API_TOKEN)) return { email: 'api', admin: true, sites: null };
  const sid = cookieOf(req);
  if (!sid) return null;
  const u = await env.DB.prepare('SELECT u.email, u.role FROM sessions s JOIN users u ON u.email = s.email WHERE s.token = ? AND s.expires > ?')
    .bind(sid, now()).first();
  if (!u) return null;
  if (u.role === 'admin') return { email: u.email, admin: true, sites: null };
  const { results } = await env.DB.prepare('SELECT site FROM user_sites WHERE email = ?').bind(u.email).all();
  return { email: u.email, admin: false, sites: new Set(results.map(r => r.site)) };
}
const canSite = (me, site) => me.sites === null || me.sites.has(site);

// max 2 threads per forum (Rehan's rule), enforced for every writer incl. Claude
async function forumCounts(env, site) {
  const { results } = await env.DB.prepare("SELECT cells FROM rows WHERE site = ? AND tab = 'forum-threads'").bind(site).all();
  const c = {};
  for (const r of results) { const d = domainOf(JSON.parse(r.cells)[0]); if (d) c[d] = (c[d] || 0) + 1; }
  return c;
}
async function setUserSites(env, email, sites) {
  const list = [...new Set((sites || []).map(domainOf).filter(Boolean))];
  await env.DB.batch([env.DB.prepare('DELETE FROM user_sites WHERE email = ?').bind(email),
    ...list.map(s => env.DB.prepare('INSERT INTO user_sites (email, site) VALUES (?, ?)').bind(email, s))]);
}

async function api(req, env, path) {
  const method = req.method, body = method === 'GET' ? {} : await req.json().catch(() => ({}));

  if (path === '/api/setup' && method === 'POST') {   // first account only (becomes admin), guarded by the SETUP_CODE secret
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
    if (n.n > 0) return bad('An account already exists.', 403);
    if (!env.SETUP_CODE || !same(String(body.code || ''), env.SETUP_CODE)) return bad('Wrong setup code.', 403);
    const email = cleanEmail(body.email), pw = String(body.password || '');
    if (!emailOk(email) || pw.length < 10) return bad('Enter an email and a password of at least 10 characters.');
    const salt = randomHex(16);
    await env.DB.prepare("INSERT INTO users (email, salt, hash, created, role) VALUES (?, ?, ?, ?, 'admin')").bind(email, salt, await hashPassword(pw, salt), now()).run();
    return json({ ok: true });
  }
  if (path === '/api/login' && method === 'POST') {
    const email = cleanEmail(body.email), pw = String(body.password || '');
    const u = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
    if (u && u.locked_until > now()) return bad('Too many wrong passwords. Try again in 15 minutes.', 429);
    if (!u || !same(await hashPassword(pw, u.salt), u.hash)) {
      if (u) {   // 5 wrong in a row -> 15 min lock
        const fails = u.fails + 1;
        await env.DB.prepare('UPDATE users SET fails = ?, locked_until = ? WHERE email = ?')
          .bind(fails >= 5 ? 0 : fails, fails >= 5 ? now() + 900 : 0, email).run();
      }
      return bad('Wrong email or password.', 401);
    }
    const token = randomHex(32);
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET fails = 0, locked_until = 0 WHERE email = ?').bind(email),
      env.DB.prepare('DELETE FROM sessions WHERE expires < ?').bind(now()),
      env.DB.prepare('INSERT INTO sessions (token, email, expires) VALUES (?, ?, ?)').bind(token, email, now() + SESSION_DAYS * DAY),
    ]);
    return json({ ok: true, email }, 200, { 'set-cookie': sessionCookie(token, SESSION_DAYS * DAY) });
  }
  if (path === '/api/logout' && method === 'POST') {
    const sid = cookieOf(req);
    if (sid) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(sid).run();
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) });
  }

  const me = await caller(req, env);
  if (path === '/api/me') {
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
    return json({ email: me?.email || null, admin: !!me?.admin, needsSetup: n.n === 0 });
  }
  // everything the page needs in ONE round trip: who I am, my sites, and every tab of one site
  if (path === '/api/boot' && method === 'GET') {
    if (!me) return json({ email: null, needsSetup: (await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first()).n === 0 });
    const sites = (await env.DB.prepare('SELECT domain FROM sites ORDER BY domain').all()).results.map(r => r.domain).filter(d => canSite(me, d));
    const want = domainOf(new URL(req.url).searchParams.get('site'));
    const site = sites.includes(want) ? want : sites[0] || '';
    const data = {};
    if (site) {
      const { results } = await env.DB.prepare('SELECT id, tab, pos, cells FROM rows WHERE site = ? ORDER BY pos, id').bind(site).all();
      for (const r of results) (data[r.tab] ||= []).push({ id: r.id, pos: r.pos, cells: JSON.parse(r.cells) });
    }
    return json({ email: me.email, admin: me.admin, sites, site, data });
  }
  if (!me) return bad('Not logged in.', 401);
  // cookie-authenticated writes must come from our own page (CSRF guard on top of SameSite=Strict)
  if (me.email !== 'api' && method !== 'GET') {
    const origin = req.headers.get('origin');
    if (origin && origin !== new URL(req.url).origin) return bad('Bad origin.', 403);
  }

  if (path === '/api/password' && method === 'POST') {   // change my own password
    if (me.email === 'api') return bad('Not for the API token.');
    const u = await env.DB.prepare('SELECT salt, hash FROM users WHERE email = ?').bind(me.email).first();
    if (!same(await hashPassword(String(body.current || ''), u.salt), u.hash)) return bad('Current password is wrong.', 403);
    const pw = String(body.password || '');
    if (pw.length < 10) return bad('New password: at least 10 characters.');
    const salt = randomHex(16), sid = cookieOf(req);
    await env.DB.batch([env.DB.prepare('UPDATE users SET salt = ?, hash = ? WHERE email = ?').bind(salt, await hashPassword(pw, salt), me.email),
      env.DB.prepare('DELETE FROM sessions WHERE email = ? AND token != ?').bind(me.email, sid || '')]);   // log out other devices
    return json({ ok: true });
  }

  // ---- users (admin only) ----
  if (path === '/api/users' || path.startsWith('/api/users/')) {
    if (!me.admin) return bad('Only admins can manage users.', 403);
    if (path === '/api/users' && method === 'GET') {
      const { results: users } = await env.DB.prepare('SELECT email, role, created FROM users ORDER BY role, email').all();
      const { results: links } = await env.DB.prepare('SELECT email, site FROM user_sites').all();
      return json(users.map(u => ({ ...u, sites: links.filter(l => l.email === u.email).map(l => l.site) })));
    }
    if (path === '/api/users' && method === 'POST') {
      const email = cleanEmail(body.email), pw = String(body.password || ''), role = body.role === 'admin' ? 'admin' : 'member';
      if (!emailOk(email)) return bad('Enter a valid email.');
      if (pw.length < 10) return bad('Password: at least 10 characters.');
      if (await env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first()) return bad('That email already has an account.');
      const salt = randomHex(16);
      await env.DB.prepare('INSERT INTO users (email, salt, hash, created, role) VALUES (?, ?, ?, ?, ?)').bind(email, salt, await hashPassword(pw, salt), now(), role).run();
      await setUserSites(env, email, body.sites);
      return json({ ok: true });
    }
    const email = cleanEmail(decodeURIComponent(path.slice('/api/users/'.length)));
    const u = await env.DB.prepare('SELECT role FROM users WHERE email = ?').bind(email).first();
    if (!u) return bad('No such user.', 404);
    const admins = (await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").first()).n;
    if (method === 'PUT') {
      const role = body.role === 'admin' ? 'admin' : body.role === 'member' ? 'member' : u.role;
      if (u.role === 'admin' && role !== 'admin' && admins <= 1) return bad('Keep at least one admin.');
      const stmts = [env.DB.prepare('UPDATE users SET role = ? WHERE email = ?').bind(role, email)];
      if (body.password) {
        if (String(body.password).length < 10) return bad('Password: at least 10 characters.');
        const salt = randomHex(16);
        stmts.push(env.DB.prepare('UPDATE users SET salt = ?, hash = ?, fails = 0, locked_until = 0 WHERE email = ?').bind(salt, await hashPassword(String(body.password), salt), email),
          env.DB.prepare('DELETE FROM sessions WHERE email = ?').bind(email));
      }
      await env.DB.batch(stmts);
      if (Array.isArray(body.sites)) await setUserSites(env, email, body.sites);
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      if (email === me.email) return bad("You can't delete your own account.");
      if (u.role === 'admin' && admins <= 1) return bad('Keep at least one admin.');
      await env.DB.batch(['users', 'sessions', 'user_sites'].map(t => env.DB.prepare(`DELETE FROM ${t} WHERE email = ?`).bind(email)));
      return json({ ok: true });
    }
  }

  if (path === '/api/sites') {
    if (method === 'GET') {
      const all = (await env.DB.prepare('SELECT domain FROM sites ORDER BY domain').all()).results.map(r => r.domain);
      return json(all.filter(d => canSite(me, d)));
    }
    if (method === 'POST') {
      if (!me.admin) return bad('Only admins can add sites.', 403);
      const d = domainOf(body.domain);
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) return bad('Enter a domain like example.com');
      await env.DB.prepare('INSERT OR IGNORE INTO sites (domain, created) VALUES (?, ?)').bind(d, now()).run();
      return json({ ok: true, domain: d });
    }
  }

  if (path === '/api/counts' && method === 'GET') {   // rows per tab, for the tab badges
    const site = domainOf(new URL(req.url).searchParams.get('site'));
    if (!canSite(me, site)) return bad('No access to this site.', 403);
    const { results } = await env.DB.prepare('SELECT tab, COUNT(*) AS n FROM rows WHERE site = ? GROUP BY tab').bind(site).all();
    return json(Object.fromEntries(results.map(r => [r.tab, r.n])));
  }

  if (path === '/api/rows') {
    const url = new URL(req.url), site = domainOf(url.searchParams.get('site') || body.site), tab = String(url.searchParams.get('tab') || body.tab || '');
    if (!site || !tab) return bad('site and tab are required.');
    if (!canSite(me, site)) return bad('No access to this site.', 403);
    if (method === 'GET') {
      const { results } = await env.DB.prepare('SELECT id, pos, cells FROM rows WHERE site = ? AND tab = ? ORDER BY pos, id').bind(site, tab).all();
      return json(results.map(r => ({ id: r.id, pos: r.pos, cells: JSON.parse(r.cells) })));
    }
    if (method === 'POST') {
      // body.rows = [[cell, ...], ...]; body.mode = 'append' (default) | 'replace'; body.pos = position for a single restored row (undo)
      const rows = Array.isArray(body.rows) ? body.rows.filter(Array.isArray).map(r => r.map(c => c == null ? '' : String(c))) : [];
      if (rows.length > 5000) return bad('Max 5000 rows per request.');
      if (me.admin) await env.DB.prepare('INSERT OR IGNORE INTO sites (domain, created) VALUES (?, ?)').bind(site, now()).run();
      const stmts = [];
      if (body.mode === 'replace') stmts.push(env.DB.prepare('DELETE FROM rows WHERE site = ? AND tab = ?').bind(site, tab));
      const counts = tab === 'forum-threads' && body.mode !== 'replace' ? await forumCounts(env, site) : {};
      const top = body.mode === 'replace' ? 0 : ((await env.DB.prepare('SELECT MAX(pos) AS p FROM rows WHERE site = ? AND tab = ?').bind(site, tab).first()).p || 0);
      const skipped = [], ins = [];
      rows.forEach((cells, i) => {
        if (tab === 'forum-threads') {
          const d = domainOf(cells[0]);
          if (d && (counts[d] || 0) >= MAX_PER_FORUM) { skipped.push(cells[1] || d); return; }
          if (d) counts[d] = (counts[d] || 0) + 1;
        }
        const pos = rows.length === 1 && Number.isFinite(body.pos) ? body.pos : top + i + 1;
        ins.push(env.DB.prepare('INSERT INTO rows (site, tab, pos, cells, updated) VALUES (?, ?, ?, ?, ?) RETURNING id').bind(site, tab, pos, JSON.stringify(cells), now()));
      });
      const ids = [];
      const all = [...stmts, ...ins];
      for (let i = 0; i < all.length; i += 100) {
        const res = await env.DB.batch(all.slice(i, i + 100));
        res.forEach(r => r.results?.[0]?.id && ids.push(r.results[0].id));
      }
      return json({ ok: true, added: rows.length - skipped.length, ids, skipped, rule: skipped.length ? `max ${MAX_PER_FORUM} threads per forum` : undefined });
    }
  }
  const m = path.match(/^\/api\/rows\/(\d+)$/);
  if (m) {
    const id = Number(m[1]);
    const row = await env.DB.prepare('SELECT site FROM rows WHERE id = ?').bind(id).first();
    if (!row) return bad('That row no longer exists.', 404);
    if (!canSite(me, row.site)) return bad('No access to this site.', 403);
    if (method === 'PUT') {
      if (!Array.isArray(body.cells)) return bad('cells must be an array.');
      await env.DB.prepare('UPDATE rows SET cells = ?, updated = ? WHERE id = ?').bind(JSON.stringify(body.cells.map(c => c == null ? '' : String(c))), now(), id).run();
      return json({ ok: true });
    }
    if (method === 'DELETE') { await env.DB.prepare('DELETE FROM rows WHERE id = ?').bind(id).run(); return json({ ok: true }); }
  }
  return bad('Not found.', 404);
}

export default {
  async fetch(req, env) {
    const path = new URL(req.url).pathname;
    if (path.startsWith('/api/')) {
      try { return await api(req, env, path); } catch (e) { return bad('Server error: ' + e.message, 500); }
    }
    return env.ASSETS.fetch(req);
  },
};
