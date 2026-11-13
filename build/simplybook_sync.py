# -*- coding: utf-8 -*-
"""Pull live prices, durations, photos, categories and new/hidden treatments from SimplyBook.
Runs automatically on every Netlify build. If SimplyBook can't be reached, the site
builds from build/data.py unchanged."""
import json, re, urllib.request

URL = "https://theartspatulum.simplybook.me/v2/service/"
SB_CAT = {"6": "specials", "1": "massages", "7": "specialty", "2": "couples", "3": "body", "5": "facials", "4": "sauna"}

def _strip(h):
    h = re.sub(r"<br\s*/?>|</p>|</li>|</div>", "\n", h or "", flags=re.I)
    h = re.sub(r"<[^>]+>", "", h).replace("&nbsp;", " ").replace("&amp;", "&")
    return re.sub(r"[ \t]+", " ", h).strip()

def _slug(s):
    s = s.lower()
    for a, b in (("á", "a"), ("é", "e"), ("í", "i"), ("ó", "o"), ("ú", "u"), ("ñ", "n")):
        s = s.replace(a, b)
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")

def fetch():
    req = urllib.request.Request(URL, headers={"User-Agent": "TheArtSpaTulum-site-build"})
    with urllib.request.urlopen(req, timeout=15) as r:
        data = json.loads(r.read().decode("utf-8"))
    return data.get("data", data) if isinstance(data, dict) else data

def apply(services):
    """Update the SERVICES list in place. Returns a short report."""
    try:
        live = fetch()
    except Exception as e:
        return f"SimplyBook sync skipped ({e.__class__.__name__}); using build/data.py"
    by_id = {str(x["id"]): x for x in live}
    report = []
    keep = []
    for s in services:
        sb = by_id.pop(str(s["id"]), None)
        if sb is None or str(sb.get("is_visible", "1")) != "1":
            report.append(f"hidden/removed: {s['name']}")
            continue
        price = int(round(float(sb.get("price") or s["price"])))
        if price != s["price"]:
            report.append(f"price {s['name']}: {s['price']} -> {price}")
            s["price"] = price
        dur = int(sb.get("duration") or s["dur"])
        if dur != s["dur"]:
            report.append(f"duration {s['name']}: {s['dur']} -> {dur}")
            s["dur"] = dur
        pic = (sb.get("picture_path") or "").split("/")[-1]
        if pic and pic != s["img"]:
            s["img"] = pic
        cats = [SB_CAT[c] for c in (sb.get("categories") or []) if c in SB_CAT]
        if cats:
            if s["cat"] not in cats:
                s["cat"] = cats[0]
            s["also"] = [c for c in cats if c != s["cat"]]
        keep.append(s)
    # treatments that exist in SimplyBook but not yet on the website
    for sid, sb in by_id.items():
        if str(sb.get("is_visible", "1")) != "1":
            continue
        cats = [SB_CAT[c] for c in (sb.get("categories") or []) if c in SB_CAT] or ["specials"]
        name = sb["name"].strip().title()
        desc = _strip(sb.get("description"))
        first = re.split(r"(?<=[.!?])\s|\n", desc, maxsplit=1)[0] if desc else name
        lines = [l.strip() for l in desc.split("\n")[1:] if 3 < len(l.strip()) < 90][:5]
        keep.append(dict(id=int(sid), cat=cats[0], also=cats[1:], name=name, name_es=name,
                         slug=_slug(name), slug_es=_slug(name), price=int(round(float(sb.get("price") or 0))),
                         dur=int(sb.get("duration") or 60), img=(sb.get("picture_path") or "").split("/")[-1],
                         sum=first, sum_es=first, inc=lines, inc_es=lines))
        report.append(f"new treatment added: {name}")
    services[:] = keep
    return "SimplyBook sync OK: " + ("; ".join(report) if report else "no changes")
