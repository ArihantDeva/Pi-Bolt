#!/usr/bin/env python3
"""Builds the documentation pages of https://pi-bolt.opensec.in/docs/ into site/docs/.

Each page is an HTML fragment in docs-site/pages/<slug>.html whose first line is a comment holding its title and description as
JSON: <!-- {"title": "Installation", "description": "..."} -->. NAV below gives the order and the sidebar's groups. The script
wraps every page in the layout (header, sidebar, contents of the page, previous and next page), gives each h2 and h3 an id,
writes site/docs/search.json for the search box, and copies docs-site/assets/ next to the pages. Python 3.9 or later, no
dependencies.

Usage: scripts/build-docs.py [--check]     (--check: fail if site/docs/ is not what the sources build)
"""

import html
import json
import re
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "docs-site"
OUT = ROOT / "site" / "docs"
SITE = "https://pi-bolt.opensec.in"
REPO = "https://github.com/opensec-git/Pi-Bolt"

NAV = [
    ("Get started", ["index", "installation", "quickstart"]),
    ("Guides", ["builds", "extensions", "integrations", "configuration"]),
    ("Reference", ["benchmarks", "how-it-works", "security"]),
    ("Help", ["troubleshooting", "faq"]),
]


def slug_of(text):
    text = re.sub(r"<[^>]+>", "", html.unescape(text)).lower()
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-")


def text_of(fragment):
    fragment = re.sub(r"<(script|style)\b.*?</\1>", " ", fragment, flags=re.S)
    fragment = re.sub(r'<a class="anchor"[^>]*>#</a>', "", fragment)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", fragment))).strip()


def load(slug):
    raw = (SRC / "pages" / f"{slug}.html").read_text()
    first, _, body = raw.partition("\n")
    meta = re.fullmatch(r"<!--\s*(\{.*\})\s*-->", first.strip())
    if not meta:
        sys.exit(f"docs-site/pages/{slug}.html: the first line must be <!-- {{\"title\": ..., \"description\": ...}} -->")
    page = json.loads(meta.group(1))
    page["slug"] = slug
    page["file"] = "index.html" if slug == "index" else f"{slug}.html"
    page["body"] = body
    return page


def add_ids(body):
    """Gives every h2 and h3 without an id one from its text, and returns the body with the page's contents."""
    toc, seen = [], set()

    def heading(m):
        level, attrs, inner = m.group(1), m.group(2), m.group(3)
        found = re.search(r'\bid="([^"]+)"', attrs)
        hid = found.group(1) if found else slug_of(inner)
        base, n = hid, 2
        while hid in seen:
            hid, n = f"{base}-{n}", n + 1
        seen.add(hid)
        if not found:
            attrs = f' id="{hid}"{attrs}'
        toc.append((int(level), hid, re.sub(r"<[^>]+>", "", inner).strip()))
        anchor = f'<a class="anchor" href="#{hid}" aria-label="Link to this section">#</a>'
        return f"<h{level}{attrs}>{inner}{anchor}</h{level}>"

    body = re.sub(r"<h([23])((?:\s[^>]*)?)>(.*?)</h\1>", heading, body, flags=re.S)
    return body, toc


def sections_for_search(page, body):
    """One entry per h2 and h3 section (and the page's opening), with all of its text, for the search box. (The box matches
    against the whole text and shows a snippet around the match.)"""
    entries = []
    parts = re.split(r'(<h[23][^>]*\bid="[^"]+"[^>]*>.*?</h[23]>)', body, flags=re.S)
    entries.append({"title": page["title"], "section": "", "url": page["file"], "text": text_of(parts[0])})
    for i in range(1, len(parts), 2):
        m = re.search(r'\bid="([^"]+)"', parts[i])
        entries.append({
            "title": page["title"],
            "section": text_of(parts[i]),
            "url": f'{page["file"]}#{m.group(1)}',
            "text": text_of(parts[i + 1]),
        })
    return entries


def sidebar(current, pages):
    out = []
    for group, slugs in NAV:
        out.append(f'<div class="nav-group"><h2 class="nav-title">{group}</h2><ul>')
        for slug in slugs:
            p = pages[slug]
            cur = ' aria-current="page"' if slug == current else ""
            out.append(f'<li><a href="{p["file"]}"{cur}>{html.escape(p["nav"] if "nav" in p else p["title"])}</a></li>')
        out.append("</ul></div>")
    return "\n".join(out)


def toc_html(toc):
    items = [f'<li class="l{level}"><a href="#{hid}">{html.escape(text)}</a></li>' for level, hid, text in toc]
    if not items:
        return ""
    return '<nav class="toc" aria-label="On this page"><h2>On this page</h2><ul>' + "".join(items) + "</ul></nav>"


def pager(order, i, pages):
    links = []
    if i > 0:
        p = pages[order[i - 1]]
        links.append(f'<a class="prev" href="{p["file"]}"><span>Previous</span>{html.escape(p["title"])}</a>')
    else:
        links.append("<span></span>")
    if i + 1 < len(order):
        p = pages[order[i + 1]]
        links.append(f'<a class="next" href="{p["file"]}"><span>Next</span>{html.escape(p["title"])}</a>')
    return '<nav class="pager" aria-label="Previous and next page">' + "".join(links) + "</nav>"


def render(layout, page, pages, order, i, body, toc):
    canonical = f'{SITE}/docs/{"" if page["slug"] == "index" else page["file"]}'
    full_title = "Pi-Bolt documentation" if page["slug"] == "index" else f'{page["title"]} · Pi-Bolt documentation'
    values = {
        "TITLE": html.escape(full_title),
        "DESCRIPTION": html.escape(page["description"]),
        "CANONICAL": canonical,
        "SIDEBAR": sidebar(page["slug"], pages),
        "BODY": body,
        "TOC": toc_html(toc),
        "PAGER": pager(order, i, pages),
        "EDIT": f'{REPO}/blob/pi-bolt/docs-site/pages/{page["slug"]}.html',
    }
    return re.sub(r"\{\{(\w+)\}\}", lambda m: values[m.group(1)], layout)


def build(out):
    layout = (SRC / "layout.html").read_text()
    order = [slug for _, slugs in NAV for slug in slugs]
    pages = {slug: load(slug) for slug in order}
    extra = sorted(p.stem for p in (SRC / "pages").glob("*.html") if p.stem not in pages)
    if extra:
        sys.exit(f"docs-site/pages: not in NAV: {', '.join(extra)}")
    out.mkdir(parents=True, exist_ok=True)
    index = []
    for i, slug in enumerate(order):
        page = pages[slug]
        body, toc = add_ids(page["body"])
        index.extend(sections_for_search(page, body))
        (out / page["file"]).write_text(render(layout, page, pages, order, i, body, toc))
    (out / "search.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")) + "\n")
    for asset in sorted((SRC / "assets").iterdir()):
        shutil.copyfile(asset, out / asset.name)
    return sorted(p.name for p in out.iterdir())


def main():
    if "--check" in sys.argv[1:]:
        with tempfile.TemporaryDirectory() as tmp:
            built = Path(tmp) / "docs"
            names = build(built)
            current = sorted(p.name for p in OUT.iterdir()) if OUT.is_dir() else []
            stale = [n for n in names if not (OUT / n).is_file() or (OUT / n).read_bytes() != (built / n).read_bytes()]
            stale += [n for n in current if n not in names]
            if stale:
                sys.exit(f"site/docs is out of date ({', '.join(stale)}): run scripts/build-docs.py")
        print("site/docs is up to date")
        return
    if OUT.is_dir():
        shutil.rmtree(OUT)
    names = build(OUT)
    print(f"built {len(names)} files in site/docs")


if __name__ == "__main__":
    main()
