---
name: offpage-plan-with-rehan
description: Build a complete, safe off-page / link-building plan for one website and deliver it as an Excel workbook (tabs: plan, forum-threads, forum-queries, profiles) plus one CSV per tab in "Desktop/offpage plans/<domain>/". Use when the user asks for an off-page plan, backlink plan, forum backlinks, profile / foundational backlinks, link-building sheet, or "do the offpage like crystallauncher" for a site.
---

# Off-page plan

Output, every time, in `<user's Desktop>/offpage plans/<domain>/` (create it):

| File | Tab | What it holds |
|---|---|---|
| `00-plan.csv` | plan | Week-by-week tasks, targets, owner, plus the anchor/target/quality rules |
| `01-forum-threads.csv` | forum-threads | Real, verified threads: Domain, Thread to make link on, Anchor to use, Link to, Priority, Status |
| `02-forum-queries.csv` | forum-queries | Google searches (forum x topic) to find more threads, with anchor + target guide |
| `03-profiles.csv` | profiles | ~40 profile / foundational platforms rated 1-5, what to post, where to link |
| `<domain>-offpage.xlsx` | all tabs | Built by `scripts/build_workbook.py` |

The user imports the xlsx into Google Sheets (File -> Import -> Upload) or uses CSVs one by one.

## Steps

1. **Know the site.** Read its sitemap (or a CMS / Search Console connector if one is available) and list every live guide URL + its topic. Mark drafts as "NO - publish first" so nobody links a 404. Note language/country (sets which forums to use).
2. **Check the link profile first.** If the user has an Ahrefs/GSC links export, look for comment spam, bio-link farms, exact-match anchors and network footprints. Recommend a disavow file and say plainly when the site's past link building is the likely cause of a drop. Never plan more of what got the site hit.
3. **Find real threads** with WebSearch (send several searches in one turn). Three strategies:
   - **Brand / product problems** ("<brand> nie działa", "<brand> error").
   - **General niche issues** the site's guides answer, with no brand in the query (RAM, lag, install mods...).
   - **Replacement seekers + competitor problems** ("<competitor> virus", "alternative to <competitor>", "<competitor> not working").
   English threads are fine as a minority (~1 in 4) when the site is non-English; say that readers land on non-English pages.
   **Search by keyword with NO domain filter**, adding forum words (`"<brand>" forum`, `<competitor> alternative thread`, `<problem> temat/wątek/foro/diskuze`, `jaki <product> forum dyskusyjne`), in the site language + English + 1-2 other languages. Domain-filtered searches only find forums you already know and stalled at 22 domains; the goal is NEW forums (user's limits need 40+ domains). Skip domains already in the sheet. Reddit/askubuntu/superuser can't be used as allowed_domains (blocked) - leave Reddit to the user's own Google searches.
   Only list URLs the search actually returned. Priority: 1 = past 12 months, 2 = date unknown, 3 = old (reply only if still open). Reddit threads >6 months old are usually archived - mark them.
4. **Queries sheet: short, ~35 rows.** The user rejected a 442-row forum x topic grid ("would take whole days"). One broad search returns many threads across forums; that is the point. Instead:
   - **Broad rows first:** get real search volumes from whatever keyword tool is available (a keyword-volume connector, an Ahrefs/Semrush export, or Google Keyword Planner) (site language country + US for English): main brand term, download/pobierz-type terms, competitor names, "best/which X" terms.
   - **Then one row per detailed topic the site's guides answer** (shaders, mods, RAM, Java, playing with friends...), **even at 0 search volume**: the goal is threads to answer, not traffic, so never drop a topic for low volume. Mark topics whose guide is still a draft "(DRAFT - publish first)".
   - **No site: operators or forum URLs in the searches** (Rehan: dorks limit us to forums we already know). Google search = the plain keyword/topic + `forum` (e.g. `jak wgrać shadery minecraft forum`), so results come from ANY forum; then pick only threads where a link really makes sense.
   - Columns: Keyword, Monthly searches, Lang, Google search, Anchor to use, Link to, Thread found, Status. Broad rows sorted by volume, then detailed topics.
   - The user pastes every useful thread URL from a search into "Thread found" (one per line). On "check queries": move each URL to its own forum-threads row, write the reply draft, skip dead/locked/off-topic. Posting rules to repeat: rotate anchors, some replies with no link, prefer aged accounts, and the forum limits below.
   (`scripts/gen_queries.py` = old forum x topic generator; only use if the user asks for the exhaustive grid.)
5. **Profiles.** Start from `templates/profiles.csv` (generic platforms, `{SITE}`, `{TOPIC}` placeholders - fill them). Add 5-10 niche-specific platforms (communities, directories, wikis of that niche) and drop rows that don't fit (e.g. Wykop for non-PL sites). Keep company/business directories marked skip unless the site is a real business.
6. **Plan.** Start from `templates/plan.csv`; replace `{BRAND}`, `{NICHE}`, `{MAIN KEYWORD}`, adapt anchor examples to the site language.
7. **Build:** `python scripts/build_workbook.py "<user's Desktop>/offpage plans/<domain>"` (needs `openpyxl`; `pip install openpyxl` if missing). File order = tab order.
8. **Hand over** with clickable links to the folder files, the top 3-5 actions, and what was not verified.

## Competitor analysis (ask for this every time)

At the start of every off-page plan, **ask the user for Ahrefs backlink exports of 2-5 distinct competitors** ranking for the same/similar keywords (Ahrefs -> Site Explorer -> competitor -> Backlinks -> "One link per domain" -> Export CSV), plus **the user's own backlinks export** (to know which domains we already have). Suggest candidates: the top 10 for the main keyword + main competitors/alternatives in the niche. Exports may arrive one at a time; re-run with ALL exports so far.

1. Write a config (guides: keyword -> my slug -> natural anchor, first match wins; `my_export`; `disavow`; `skip_domains` = forums already MAXED in forum-threads) and run
   `python scripts/competitor_links.py config.json "<site folder>" comp1.csv [comp2.csv ...]`
   It writes two tabs from export columns only (Platform, Page type, Domain traffic, External links, HTTP code, First seen):
   - **05-competitor-analysis** (forum / Q&A / community pages): Competitor | Website | Thread url / page where link is | C anchor text | C target link | My anchor text | My outbound url | Note | Status. Max 2 per forum, highest DR first; Note flags dead (HTTP), old (first seen 2+ years), crowded (25+ external links).
   - **06-gp-niche-edits** (article pages on other sites): Competitor | Website | Page url | Type | DR | Domain traffic | C anchor text | C target link | We have link from this domain? | My anchor text | My outbound url | Note | Status. **Type = "PBN (traffic < 500)" when Ahrefs domain traffic < 500 (user's rule), else "Guest post / niche edit".** "We have link" = YES / NO / DISAVOWED from my export + disavow. Sorted: domains we lack first, real traffic first. Profile/tag/search pages and Ahrefs "is spam" rows are dropped.
2. **Every forum row flagged old / dead / crowded (or locked when checked): find a replacement thread on the SAME forum** with WebSearch (`allowed_domains=[that forum]`, topic words) - newer, relevant, where a link makes sense; parent category is fine (e.g. general gaming / PC-help for a Minecraft launcher). Replace the URL, Note = "replacement for <old url>"; nothing sensible -> "no fit - skip".
3. GP/niche-edit rows: the user does outreach (guest post or paid niche edit on that page); PBN-type rows are only for the user's own PBN decisions - never recommend buying links on sites flagged as spam.
4. Push both tabs to the sheet (`set` auto-creates tabs), then `{"type":"style"}`. competitor-analysis is research: rows the user picks get copied into forum-threads so the max-2 / 15-day limits apply.

## Rules that go into every plan

- **Forum limits (user's rule, latest):** MAX 2 threads per forum in forum-threads - keep only the 2 most relevant (brand threads > recent > topics matching the money guides: download/alternatives/TLauncher/safety > troubleshooting > the rest); put extras in `removed-threads-backup.csv`, not the sheet. Spread across many forums (the more domains, the more links per day: ~1 per forum per 15 days). After a link is posted on a forum, its other thread turns YELLOW until 15 days pass (conditional formatting on forum-threads A2:I, custom formula `=AND($A2<>"",$H2="",COUNTIFS($A$2:$A,$A2,$H$2:$H,">"&TODAY()-15)>0)`, yellow fill). forum-threads has `Posted date` (H) + `Can post here?` (I, VLOOKUP into forum-limits); tab `04-forum-limits` from `templates/forum-limits.csv` shows YES / WAIT until / MAXED (2). Only draft replies for forums that say YES.

- Anchors: ~50% brand/URL, ~35% partial/topic, ~15% generic; exact main keyword rarely.
- Link the specific guide that answers the question, never the homepage by default.
- Forums: live threads only, one link per reply, 3-5 genuine replies a week. Answer the question first; the link is the "more detail" step. The user may send rows back - then write each reply in the thread's language, matching what was actually asked.
- Profiles: 3-5 a week, unique bio each, same brand name/logo everywhere, never present a fan/guide site as the official product (impersonation). Add live profiles to the author page `sameAs`.
- Ratings to give honestly when asked: company profiles 1/10 for non-businesses, social/entity 3/10 ranking but good for brand, niche profiles 5/10, video 5/10, PDF/image/web 2.0 1-3/10. 40 good profiles beat 100 list-blasted ones.
- PBNs are the user's call: if they run them, unique hosting/registrar/theme, real content, brand/URL anchors, max ~2 a week, never interlinked. State the risk once, don't lecture.
- Don't claim dofollow/nofollow status you haven't checked.

## Live sheet (read + write)

The Google Drive connector can only read a sheet. For writes: user imports the xlsx into Google Sheets, pastes `templates/apps-script.gs` (Extensions -> Apps Script, set TOKEN + SHEET_ID), deploys as Web app (Execute as Me, Access Anyone) and sends the `/exec` URL. Save `{domain: {url, token, sheetId}}` in `~/.claude/offpage-sheets.json` (never in a repo), then:
`python scripts/sheet.py <domain> '[{"type":"read","sheet":"forum-threads","range":"A1:G30"}]'` (ops: read / set / append / style). After writing rows always send `{"type":"style"}` once: it re-applies the design (navy headers, widths, zebra rows, Status dropdown, priority/YES/WAIT/MAXED colours, yellow 15-day rule) - writing values alone leaves new columns unstyled.
Reply workflow: read forum-threads, write each reply into the "Reply draft" column (G), set Status when the user confirms it was posted.
Note: deploy dialog's email link opens Gmail - tell the user to pick "Me" from the dropdown instead.

## Offpage Planner app (preferred over Google Sheets)

A sheet-style web app on Cloudflare (Worker + D1), code in `planner/` next to this file. Tabs: plan, forum-threads, forum-limits (computed), forum-queries, profiles, competitor-analysis, gp-niche-edits. Built in: max 2 threads per forum (enforced by the server), 15-day yellow wait, YES / WAIT / MAXED, ✓ Posted / ↺ Unpost, undo/redo (Ctrl+Z / Ctrl+Y, buttons, Undo in toasts), users with admin / member roles and per-site access, CSV import (UTF-16 Ahrefs too) / export. Fast: one request loads all tabs of a site, tabs switch from memory, edits are optimistic, last copy paints instantly from localStorage, static files cached with ?v= stamping.

**Check first:** if `~/.claude/offpage-planner.json` exists, the user already has a planner (`{url, token}`): use it, don't set up a new one.

**Setup for a new user** (needs Node.js and a free Cloudflare account; run from a copy of `planner/` in the user's project, e.g. `<project>/planner`):
1. `npm install` then `npx wrangler login` (the user approves in the browser).
2. `npx wrangler d1 create offpage-planner` and put the printed `database_id` into `wrangler.toml`.
3. `npx wrangler d1 execute offpage-planner --remote --file schema.sql` (fresh installs only; `migrations/` is for upgrading older installs).
4. `npm run deploy` once (creates the Worker; prints the `https://offpage-planner.<account>.workers.dev` address). **Always deploy with `npm run deploy`**, never bare `wrangler deploy`: it stamps `?v=` on app.js / style.css, which browsers cache for a year.
5. Secrets, generated randomly (Python `secrets`): `npx wrangler secret put SETUP_CODE` (give it to the user once) and `npx wrangler secret put API_TOKEN` (never show it). Save `{"url": "<workers.dev address>", "token": "<API_TOKEN>"}` to `~/.claude/offpage-planner.json`, outside any repo.
6. The user opens the address, enters the setup code, and creates the first account (it becomes admin). They add teammates in their initial menu -> Users & access.
7. Push the plan's CSVs: `POST /api/rows {site, tab, rows, mode:"replace"}` with `Authorization: Bearer <token>`. The site appears in the site picker automatically.

API for Claude (bearer token = admin): `GET /api/boot?site=` (all tabs), `GET /api/rows?site=&tab=`, `POST /api/rows` (append/replace; returns ids; `skipped` when a forum already has 2), `PUT` / `DELETE /api/rows/<id>`, `GET/POST /api/sites`, `/api/users` (admin).

Speed depends on where the user is: Cloudflare puts the D1 database near where it was created, and the Worker uses smart placement. Expect ~0.4 s per request plus the user's own network time; the page itself paints instantly from cache.
Use the Google Sheet route above only if the user asks for a sheet.
