# Offpage Plan with Rehan

A [Claude Code](https://claude.com/claude-code) skill that builds a **safe, link-building plan for any website** and gives you your own **Offpage Planner**: a sheet-style web app on Cloudflare's free tier where you track every forum thread, profile and competitor link.

Made by Rehan Mubarak.

## What it does

Ask Claude something like *"make the offpage plan for example.com"*. The skill then:

1. **Reads your site:** every live guide becomes a link target. Drafts are flagged so nobody links a 404.
2. **Checks your backlinks** (from an Ahrefs export) for spam and footprints, and builds a `disavow.txt` when needed.
3. **Finds forum threads to answer.** It searches plain topics plus the word "forum" (no `site:` dorks), so it finds threads on forums you didn't know about. Each thread gets the guide that answers it and a natural, rotated anchor.
4. **Plans profiles and foundational links** (about 40 platforms rated 1–5) and a week-by-week plan.
5. **Analyses competitors** from Ahrefs exports:
   - **forum threads** they got links on. Old, dead or crowded ones are replaced with a fresh thread on the same forum.
   - **guest posts / niche edits.** Real sites are separated from likely PBNs (Ahrefs traffic < 500). It also checks whether you already have a link from that domain.
6. **Writes reply drafts** in the thread's language, one link each, answering the question first.

## Rules built in

- **Max 2 threads per forum.** The server enforces it, so even Claude can't add a third.
- **15-day wait:** once you post on a forum, its other thread turns yellow until 15 days pass.
- **Anchors:** about 50% brand/URL, 35% partial match, 15% generic. The exact main keyword is used rarely.
- **Targets:** each link goes to the guide that answers the question, not the homepage.
- **No impersonation:** a fan or guide site is never presented as the official product.

## The Offpage Planner app

`planner/` is a Cloudflare Worker + D1 app (free tier) with a sheet-style UI:

- **Tabs:** plan, forum threads, forum limits, search queries, profiles, competitor threads, GP & niche edits.
- **Forum limits:** a summary strip ("threads you can post today", "forums waiting", "forums maxed") and quick filters.
- **Posting:** one-click **✓ Posted** / **↺ Unpost**.
- **Undo / redo:** Ctrl+Z / Ctrl+Y, buttons, and Undo on every message.
- **Users:** email + password login, with **admin / member roles** and **per-site access** for your team.
- **CSV:** import (including Ahrefs UTF-16 files) and export on every tab.
- **Fast:** one request loads all tabs, edits show instantly, and the page paints straight from cache.

Claude sets the planner up for you the first time (needs Node.js and a free Cloudflare account). The steps are in `SKILL.md` → *Offpage Planner app*.

## Install

```bash
git clone https://github.com/SynoxiaLLC2002/offpage-plan-with-rehan ~/.claude/skills/offpage-plan-with-rehan
```

Restart Claude Code, then ask: *"make the offpage plan for mysite.com"*.

Optional extras: Python 3 with `openpyxl` (for the Excel workbook export) and a [Serper.dev](https://serper.dev) or other search access for larger thread searches.

## Layout

| Path | What |
|---|---|
| `SKILL.md` | The workflow and rules Claude follows |
| `planner/` | The Offpage Planner web app (Cloudflare Worker + D1) |
| `scripts/competitor_links.py` | Ahrefs exports → competitor threads + GP/niche-edit tables (has `--selftest`) |
| `scripts/build_workbook.py` | CSVs → styled Excel workbook |
| `scripts/gen_queries.py`, `scripts/sheet.py`, `templates/apps-script.gs` | Optional Google Sheets route |
| `templates/` | Plan, profiles and forum-limits templates |

## License

MIT. See [LICENSE](LICENSE).
