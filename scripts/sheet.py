"""Read/write a Google Sheet through the Apps Script web app (see SKILL.md, 'Live sheet').
Usage: python sheet.py <domain> '<ops JSON array>'   or   @ops.json for big payloads
  ops: {"type":"read","sheet":"forum-threads","range":"A1:F5"}
       {"type":"set","sheet":"forum-threads","range":"F2","values":[["done"]]}
       {"type":"append","sheet":"forum-threads","rows":[["a","b"]]}
Config: ~/.claude/offpage-sheets.json -> {domain: {url, token}}  (secret: never commit)
"""
import json, sys, pathlib, urllib.request
cfg = json.loads((pathlib.Path.home() / ".claude/offpage-sheets.json").read_text())[sys.argv[1]]
body = json.dumps({"token": cfg["token"], "ops": json.loads(open(sys.argv[2][1:], encoding="utf-8").read() if sys.argv[2].startswith("@") else sys.argv[2])}).encode()
req = urllib.request.Request(cfg["url"], body, {"Content-Type": "application/json"})
sys.stdout.reconfigure(encoding="utf-8")
print(urllib.request.urlopen(req, timeout=60).read().decode())  # urllib follows Apps Script's 302 with GET
