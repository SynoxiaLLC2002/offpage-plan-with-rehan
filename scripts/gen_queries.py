"""Write forum-search rows: every forum x every topic.
Usage: python gen_queries.py config.json out.csv
config.json: {"base": "https://site/", "forums": ["wykop.pl", ...],
              "topics": [["Strategy", "search words", "anchor", "slug"], ...]}
"""
import csv, json, sys
cfg = json.load(open(sys.argv[1], encoding="utf-8"))
rows = [[f, t[0], f"site:{f} {t[1]}", t[2], cfg["base"] + t[3], "", "todo"]
        for t in cfg["topics"] for f in cfg["forums"]]
assert len(rows) == len(cfg["forums"]) * len(cfg["topics"])
with open(sys.argv[2], "w", encoding="utf-8-sig", newline="") as fh:
    w = csv.writer(fh)
    w.writerow(["Domain", "Strategy", "Google search to find threads", "Anchor to use", "Link to", "Thread found (paste URL)", "Status"])
    w.writerows(rows)
print(len(rows), "rows ->", sys.argv[2])
