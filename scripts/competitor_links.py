"""Turn Ahrefs backlink exports of competitors into two tabs:
  05-competitor-analysis.csv  forum / Q&A / community links  -> threads to reply in
  06-gp-niche-edits.csv       article links on real sites     -> guest posts / niche edits (PBN if domain traffic < 500)

Usage: python competitor_links.py config.json <site folder> export1.csv [export2.csv ...]
config.json:
  {"site": "https://mysite.tld/",
   "guides": [["keyword in competitor anchor/page/target", "my-guide-slug", "my anchor"], ...],   # first match wins
   "default": ["", "my anchor for generic links"],                                             # slug "" = homepage
   "my_export": "path to MY OWN Ahrefs backlinks export (optional)",
   "disavow": "path to my disavow.txt (optional)",
   "skip_domains": ["already-maxed-forum.tld"]}
Uses only export columns (Platform, Page type, Domain traffic, External links, HTTP code, First seen) - no page fetching.
"""
import csv, io, json, re, sys
from datetime import date
from urllib.parse import urlparse

FORUM_URL = re.compile(r"/(thread|threads|topic|topics|t|forum|forums|viewtopic|showthread|wpis|discussions?|questions?|answers?|comments|community|board|konu|foro|tema|watek)[/.?=]|quora\.com/|reddit\.com/r/", re.I)
SKIP_URL = re.compile(r"/(user|users|member|members|profile|profiles|author|u)/|/tag/|/search|\?s=|/login|/register", re.I)
PBN_TRAFFIC = 500   # user's rule: real-looking domain with < 500 Ahrefs traffic = PBN
F_COLS = ["Competitor", "Website", "Thread url / page where link is", "C anchor text", "C target link",
          "My anchor text", "My outbound url", "Note", "Status"]
G_COLS = ["Competitor", "Website", "Page url", "Type", "DR", "Domain traffic", "C anchor text", "C target link",
          "We have link from this domain?", "My anchor text", "My outbound url", "Note", "Status"]


def read_export(path):
    raw = open(path, "rb").read()
    text = raw.decode("utf-16") if raw[:2] in (b"\xff\xfe", b"\xfe\xff") else raw.decode("utf-8-sig")
    head = text.split("\n", 1)[0]
    return list(csv.DictReader(io.StringIO(text), delimiter="\t" if head.count("\t") > head.count(",") else ","))


def col(row, *names):
    low = {(k or "").strip().lower(): v for k, v in row.items()}
    for n in names:
        if low.get(n):
            return low[n].strip()
    return ""


def num(s):
    try:
        return float(str(s).replace(",", "") or 0)
    except ValueError:
        return 0.0


def dom(url):
    return urlparse(url).netloc.lower().removeprefix("www.")


def my_domains(cfg):
    have, dis = set(), set()
    if cfg.get("my_export"):
        have = {dom(col(r, "referring page url")) for r in read_export(cfg["my_export"])}
    if cfg.get("disavow"):
        for line in open(cfg["disavow"], encoding="utf-8"):
            line = line.strip()
            if line.startswith("domain:"):
                dis.add(line[7:].removeprefix("www."))
            elif line.startswith("http"):
                dis.add(dom(line))
    return have, dis


def main(cfg_path, folder, exports):
    cfg = json.load(open(cfg_path, encoding="utf-8"))
    skip = set(cfg.get("skip_domains", []))
    have, dis = my_domains(cfg)
    frows, grows, per_forum, seen_gp = [], [], {}, set()
    for path in exports:
        data = read_export(path)
        comp = dom(col(data[0], "target url")) if data else path
        data.sort(key=lambda r: -num(col(r, "domain rating")))
        for r in data:
            page = col(r, "referring page url")
            d = dom(page)
            if not page or SKIP_URL.search(page) or col(r, "is spam").lower() == "true":
                continue
            anchor, target = col(r, "anchor"), col(r, "target url")
            hay = f"{anchor} {page} {target} {col(r, 'referring page title')}".lower()
            slug, mine = next(((g[1], g[2]) for g in cfg["guides"] if g[0].lower() in hay), cfg["default"])
            kind = f"{col(r, 'platform')} {col(r, 'page type')}".lower()
            forum = FORUM_URL.search(page) or any(k in kind for k in ("forum", "message board", "q&a", "community"))
            first, code, ext = col(r, "first seen"), col(r, "referring page http code"), num(col(r, "external links"))
            notes = []
            if code and not code.startswith("2"):
                notes.append(f"dead (HTTP {code})")
            if first[:4].isdigit() and date.today().year - int(first[:4]) >= 2:
                notes.append(f"old ({first[:4]})")
            if forum:
                if d in skip or per_forum.get(d, 0) >= 2:
                    continue
                if ext > 25:
                    notes.append(f"crowded ({int(ext)} ext. links)")
                note = "; ".join(notes) + f" -> find a newer relevant thread on {d} (parent category OK)" if notes else "OK - reply here"
                frows.append([comp, d, page, anchor, target, mine, cfg["site"] + slug, note, "todo"])
                per_forum[d] = per_forum.get(d, 0) + 1
            else:
                if (comp, d) in seen_gp:
                    continue
                seen_gp.add((comp, d))
                traffic = num(col(r, "domain traffic"))
                typ = "PBN (traffic < 500)" if traffic < PBN_TRAFFIC else "Guest post / niche edit"
                ours = "DISAVOWED" if d in dis else ("YES" if d in have else "NO")
                note = "; ".join(notes) or ("we already have this domain - skip unless new page" if ours == "YES" else "")
                grows.append([comp, d, page, typ, int(num(col(r, "domain rating"))), int(traffic), anchor, target,
                              ours, mine, cfg["site"] + slug, note, "todo"])
    grows.sort(key=lambda r: (r[8] != "NO", r[3].startswith("PBN"), -r[5]))   # opportunities we lack first, real traffic first
    for name, cols, rows in (("05-competitor-analysis.csv", F_COLS, frows), ("06-gp-niche-edits.csv", G_COLS, grows)):
        with open(f"{folder}/{name}", "w", encoding="utf-8-sig", newline="") as f:
            csv.writer(f).writerows([cols] + rows)
    print(f"{len(frows)} forum rows, {len(grows)} GP/niche-edit rows ({sum(r[3].startswith('PBN') for r in grows)} PBN) -> {folder}")


if __name__ == "__main__":
    if sys.argv[1:] == ["--selftest"]:
        import tempfile, os
        d = tempfile.mkdtemp()
        H = "Referring page title,Referring page URL,Platform,Referring page HTTP code,Domain rating,Domain traffic,External links,Target URL,Anchor,Is spam,First seen,Page type\n"
        open(f"{d}/comp.csv", "w", encoding="utf-8").write(H +
            "a,https://forum.x.pl/topic/1-jaki-launcher,forum,200,40,9000,5,https://comp.pl/,launcher,false,2026-01-01,\n"
            "b,https://forum.x.pl/topic/2-shadery,forum,200,40,9000,40,https://comp.pl/s,shadery,false,2026-01-01,\n"
            "c,https://forum.x.pl/topic/3-third,forum,200,40,9000,5,https://comp.pl/,x,false,2026-01-01,\n"
            "d,https://blog.big.com/best-launchers,blogs,200,60,20000,10,https://comp.pl/,launcher,false,2026-01-01,\n"
            "e,https://tiny.net/minecraft-tips,blogs,200,10,40,10,https://comp.pl/,x,false,2026-01-01,\n"
            "f,https://have.com/post,blogs,200,30,3000,10,https://comp.pl/,x,false,2026-01-01,\n"
            "g,https://x.com/user/abc,,200,90,99999,1,https://comp.pl/,x,false,2026-01-01,\n")
        open(f"{d}/mine.csv", "w", encoding="utf-8").write(H + "z,https://have.com/other,blogs,200,30,3000,1,https://me.pl/,me,false,2026-01-01,\n")
        json.dump({"site": "https://me.pl/", "guides": [["shader", "shadery-guide", "jak wgrać shadery"]],
                   "default": ["", "me.pl"], "my_export": f"{d}/mine.csv"}, open(f"{d}/c.json", "w"))
        main(f"{d}/c.json", d, [f"{d}/comp.csv"])
        fr = list(csv.reader(open(f"{d}/05-competitor-analysis.csv", encoding="utf-8-sig")))
        gp = list(csv.reader(open(f"{d}/06-gp-niche-edits.csv", encoding="utf-8-sig")))
        assert len(fr) == 3 and "crowded" in fr[2][7] and fr[2][6] == "https://me.pl/shadery-guide", fr
        assert [r[1] for r in gp[1:]] == ["blog.big.com", "tiny.net", "have.com"], gp      # profile page skipped
        assert gp[2][3].startswith("PBN") and gp[3][8] == "YES" and gp[1][8] == "NO"
        print("selftest ok")
    else:
        main(sys.argv[1], sys.argv[2], sys.argv[3:])
