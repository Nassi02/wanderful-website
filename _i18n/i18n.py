#!/usr/bin/env python3
"""Version anglaise du site (dossier /en/).
  python3 _i18n/i18n.py extract   -> liste les textes FR sans traduction (_i18n/todo.json)
  python3 _i18n/i18n.py build     -> régénère toutes les pages /en/ depuis les pages FR
Fichiers : pages.json (FR -> EN), translations.json (texte FR -> texte EN),
overrides/<page EN>.json (remplacements propres à l'anglais : vidéos, JS...)."""
import json, os, re, sys, posixpath
from bs4 import BeautifulSoup, NavigableString, Comment, Doctype

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, "_i18n")
SITE = "https://wanderful-marketing.com"
PAGES = json.load(open(os.path.join(D, "pages.json")))
TR_PATH = os.path.join(D, "translations.json")

BLOCK = {"address","article","aside","blockquote","body","dd","details","dialog","div","dl","dt",
 "fieldset","figcaption","figure","footer","form","h1","h2","h3","h4","h5","h6","header","hr","li",
 "main","nav","ol","p","pre","section","table","tbody","thead","tfoot","tr","td","th","ul","summary",
 "select","option","textarea","button","label","video","picture","canvas","iframe","html","head","template"}
SKIP = {"script","style","svg","noscript","code","template","head"}
ATTRS = ["alt","title","aria-label","placeholder","data-label","data-text","data-title","value"]
META = {("name","description"),("property","og:title"),("property","og:description"),
        ("name","twitter:title"),("name","twitter:description"),("property","og:image:alt")}
LDKEYS = {"name","description","text","headline","alternateName","slogan","serviceType",
          "jobTitle","knowsAbout","about","disambiguatingDescription"}

def norm(s): return re.sub(r"\s+", " ", s).strip()
def has_text(s): return bool(re.search(r"[A-Za-zÀ-ÿ]", s))

def load_tr():
    return json.load(open(TR_PATH)) if os.path.exists(TR_PATH) else {}

def segments(soup):
    """yield (kind, obj, key)"""
    if soup.title and soup.title.string and has_text(soup.title.string):
        yield ("title", soup.title, norm(soup.title.string))
    for m in soup.find_all("meta"):
        for a, v in META:
            if m.get(a) == v and m.get("content") and has_text(m["content"]):
                yield ("attr", (m, "content"), norm(m["content"]))
    for el in soup.find_all(True):
        if any(p.name in ("script","style") for p in [el] + list(el.parents)): continue
        for a in ATTRS:
            v = el.get(a)
            if isinstance(v, str) and has_text(v):
                if a == "value" and el.name not in ("input","button") : continue
                if a == "value" and el.get("type") not in ("submit","button",None): continue
                yield ("attr", (el, a), norm(v))
    body = soup.body or soup
    for el in body.find_all(True):
        if el.name in SKIP or any(p.name in SKIP for p in el.parents): continue
        if any(is_leaf(p) for p in el.parents if p.name and p is not soup): continue
        if is_leaf(el):
            yield ("inner", el, key_of(el))
        else:
            for k in el.children:
                if isinstance(k, NavigableString) and not isinstance(k, (Comment, Doctype)) and has_text(k):
                    yield ("text", k, norm(k))
    for s in soup.find_all("script", type="application/ld+json"):
        try: data = json.loads(s.string)
        except Exception: continue
        for v in ld_strings(data): yield ("ld", s, v)

def is_leaf(el):
    if not getattr(el, "name", None) or el.name in SKIP or el.name in ("html","body","head"): return False
    if any(getattr(d, "name", None) in BLOCK for d in el.descendants): return False
    kids = [k for k in el.children if getattr(k, "name", None)]
    direct = any(isinstance(k, NavigableString) and not isinstance(k, Comment) and has_text(k) for k in el.children)
    if not direct and len(kids) != 1: return False
    if not direct and kids[0].name in ("img","svg","video","br"): return False
    return has_text(el.get_text())

SVG_RE = re.compile(r"<svg\b.*?</svg>", re.S)
def key_of(el):
    html = "".join(str(k) for k in el.children)
    svgs = SVG_RE.findall(html); i = [0]
    def ph(m):
        i[0] += 1; return "⟦svg%d⟧" % i[0]
    return norm(SVG_RE.sub(ph, html))
def restore_svgs(el, val):
    svgs = SVG_RE.findall("".join(str(k) for k in el.children))
    for n, s in enumerate(svgs, 1): val = val.replace("⟦svg%d⟧" % n, s)
    return val

def ld_strings(o, key=None):
    if isinstance(o, dict):
        for k, v in o.items(): yield from ld_strings(v, k)
    elif isinstance(o, list):
        for v in o: yield from ld_strings(v, key)
    elif isinstance(o, str) and key in LDKEYS and has_text(o) and not o.startswith("http"):
        yield norm(o)

def ld_translate(o, tr, key=None):
    if isinstance(o, dict): return {k: ld_translate(v, tr, k) for k, v in o.items()}
    if isinstance(o, list): return [ld_translate(v, tr, key) for v in o]
    if isinstance(o, str):
        if key in LDKEYS and norm(o) in tr: return tr[norm(o)]
        if key == "inLanguage": return "en"
        if isinstance(o,str) and o.startswith(SITE): return map_abs_url(o)
    return o

def parse(path):
    raw = open(os.path.join(ROOT, path), encoding="utf-8").read()
    raw = re.sub(r"<!-- i18n -->.*?<!-- /i18n -->\n?", "", raw, flags=re.S)
    return BeautifulSoup(raw, "html.parser")

def extract():
    tr = load_tr(); todo = {}
    for fr in PAGES:
        for kind, obj, key in segments(parse(fr)):
            if key not in tr: todo.setdefault(key, fr)
    out = {k: "" for k in todo}
    json.dump(out, open(os.path.join(D, "todo.json"), "w"), ensure_ascii=False, indent=1)
    by = {}
    for k, p in todo.items(): by[p] = by.get(p, 0) + 1
    print(f"{len(todo)} textes à traduire", json.dumps(by, indent=1))

# ---------- URL rewriting ----------
TOP = set(os.listdir(ROOT))
def site_path(url, fr_dir):
    """relative or root url -> site path without leading slash (or None if external)"""
    if re.match(r"^(https?:|mailto:|tel:|data:|javascript:|#|//)", url) or url == "": return None
    if url.startswith("/"): return url[1:]
    return posixpath.normpath(posixpath.join(fr_dir, url)) if fr_dir else posixpath.normpath(url)

def html_target(p):
    """site path (maybe dir / with query/hash) -> EN site path or None"""
    base = p
    if base in ("", "."): base = "index.html"
    if base.endswith("/"): base += "index.html"
    if base in PAGES: return PAGES[base]
    if base + "/index.html" in PAGES: return PAGES[base + "/index.html"]
    return None

def rewrite(url, fr_dir, en_dir):
    m = re.match(r"^([^?#]*)([?#].*)?$", url); path, tail = m.group(1), m.group(2) or ""
    sp = site_path(path, fr_dir) if path != "" else None
    if sp is None: return url
    root = url.startswith("/")
    tgt = html_target(sp)
    if tgt: dest = tgt
    else:
        if root: return url          # absolute asset: unchanged
        dest = sp
    if root:
        d = "/" + dest
        d = re.sub(r"index\.html$", "", d)
        return d + tail
    rel = posixpath.relpath(dest, en_dir or ".")
    return rel + tail

def map_abs_url(u):
    m = re.match(re.escape(SITE) + r"/?([^?#]*)(.*)$", u)
    if not m: return u
    t = html_target(m.group(1))
    if not t: return u
    return SITE + "/" + re.sub(r"(^|/)index\.html$", r"\1", t) + m.group(2)

def en_url(enp): return SITE + "/" + re.sub(r"(^|/)index\.html$", r"\1", enp)
def fr_url(frp): return SITE + "/" + re.sub(r"(^|/)index\.html$", r"\1", frp)

ASSET_RE = None
def fix_inline_paths(text, fr_dir, en_dir):
    names = sorted([n for n in TOP if not n.startswith(".") and n not in ("en","_i18n")], key=len, reverse=True)
    pat = re.compile(r"""(?<=[\'"(])((?:\.\./|\./)*)(""" + "|".join(re.escape(n) for n in names) + r""")(?=[/\'"?#)])""")
    def sub(m):
        whole = m.group(1) + m.group(2)
        sp = posixpath.normpath(posixpath.join(fr_dir, whole)) if fr_dir else posixpath.normpath(whole)
        if sp.startswith(".."): return whole
        return posixpath.relpath(sp, en_dir or ".")
    return pat.sub(sub, text)

def build():
    tr = load_tr(); missing = {}
    for fr, en in PAGES.items():
        soup = parse(fr)
        fr_dir = posixpath.dirname(fr); en_dir = posixpath.dirname(en)
        for kind, obj, key in list(segments(soup)):
            if kind == "ld": continue
            val = tr.get(key)
            if not val:
                missing.setdefault(en, []).append(key); continue
            if kind == "title": obj.string = val
            elif kind == "attr": obj[0][obj[1]] = val
            elif kind == "text": obj.replace_with(NavigableString(" " + val + " " if obj.startswith(" ") else val))
            elif kind == "inner":
                val = restore_svgs(obj, val)
                obj.clear()
                for n in list(BeautifulSoup(val, "html.parser").contents): obj.append(n)
        for s in soup.find_all("script", type="application/ld+json"):
            try: data = json.loads(s.string)
            except Exception: continue
            s.string = "\n" + json.dumps(ld_translate(data, tr), ensure_ascii=False, indent=2) + "\n"
        # urls
        for el in soup.find_all(True):
            for a in ("href","src","poster","action","data-src"):
                v = el.get(a)
                if isinstance(v, str): el[a] = rewrite(v, fr_dir, en_dir)
            if el.get("srcset"):
                el["srcset"] = ", ".join(" ".join([rewrite(p.split()[0], fr_dir, en_dir)] + p.split()[1:]) for p in el["srcset"].split(","))
            if el.get("style"): el["style"] = fix_inline_paths(el["style"], fr_dir, en_dir)
        for s in soup.find_all(["script","style"]):
            if s.string and s.get("type") != "application/ld+json":
                s.string = fix_inline_paths(s.string, fr_dir, en_dir)
        if soup.html: soup.html["lang"] = "en"
        head = soup.head
        for m in soup.find_all("meta"):
            if m.get("property") == "og:locale": m["content"] = "en_GB"
            if m.get("property") == "og:url": m["content"] = en_url(en)
        for l in soup.find_all("link", rel="canonical"): l["href"] = en_url(en)
        for l in soup.find_all("link", rel="alternate"):
            if l.get("hreflang"): l.decompose()
        if head:
            for hl, u in (("fr", fr_url(fr)), ("en", en_url(en)), ("x-default", fr_url(fr))):
                t = soup.new_tag("link", rel="alternate", hreflang=hl, href=u); head.append(t); head.append("\n")
            if not soup.find("script", src="/lang.js"):
                head.append(soup.new_tag("script", src="/lang.js", defer="")); head.append("\n")
        out = str(soup)
        if not out.lstrip().lower().startswith("<!doctype"): out = "<!DOCTYPE html>\n" + out
        ov = os.path.join(D, "overrides", en.replace("/", "__") + ".json")
        if os.path.exists(ov):
            for find, rep in json.load(open(ov)):
                if find not in out: print(f"  ! override introuvable dans {en}: {find[:60]}")
                out = out.replace(find, rep)
        dst = os.path.join(ROOT, en); os.makedirs(os.path.dirname(dst), exist_ok=True)
        open(dst, "w", encoding="utf-8").write(out)
    for en, ks in missing.items(): print(f"  {en}: {len(ks)} textes non traduits")
    print("build ok" if not missing else "build ok (avec textes FR restants)")


def sitemap():
    """Ajoute les versions /en/ + les liens hreflang dans sitemap.xml (relançable sans risque)."""
    p = os.path.join(ROOT, "sitemap.xml"); s = open(p, encoding="utf-8").read()
    s = re.sub(r'\s*<xhtml:link [^>]*/>', '', s)
    s = re.sub(r'\s*<url>\s*<loc>' + re.escape(SITE) + r'/en/.*?</url>', '', s, flags=re.S)
    if 'xmlns:xhtml' not in s:
        s = s.replace('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"', 'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml"')
    extra = []
    def alts(fr, en):
        return "".join(f'\n    <xhtml:link rel="alternate" hreflang="{h}" href="{u}"/>' for h, u in (("fr", fr_url(fr)), ("en", en_url(en)), ("x-default", fr_url(fr))))
    def repl(m):
        block = m.group(0); loc = re.search(r"<loc>(.*?)</loc>", block).group(1)
        path = loc[len(SITE)+1:] if loc.startswith(SITE) else None
        if path is None: return block
        base = path or "index.html"
        if base.endswith("/"): base += "index.html"
        fr = base if base in PAGES else None
        if not fr: return block
        en = PAGES[fr]
        enb = block.replace(f"<loc>{loc}</loc>", f"<loc>{en_url(en)}</loc>")
        extra.append(enb.replace("</url>", alts(fr, en) + "\n  </url>"))
        return block.replace("</url>", alts(fr, en) + "\n  </url>")
    s = re.sub(r"<url>.*?</url>", repl, s, flags=re.S)
    s = s.replace("</urlset>", "  " + "\n  ".join(extra) + "\n</urlset>")
    open(p, "w", encoding="utf-8").write(s)
    print(f"sitemap : {len(extra)} pages EN ajoutées")


def link_fr():
    """Ajoute dans chaque page FR : liens hreflang + /lang.js (bouton FR | EN). Modifie uniquement le <head>, relançable."""
    for fr, en in PAGES.items():
        fp = os.path.join(ROOT, fr); s = open(fp, encoding="utf-8").read()
        s = re.sub(r'\n?<!-- i18n -->.*?<!-- /i18n -->', '', s, flags=re.S)
        block = ('\n<!-- i18n -->\n'
                 f'<link rel="alternate" hreflang="fr" href="{fr_url(fr)}">\n'
                 f'<link rel="alternate" hreflang="en" href="{en_url(en)}">\n'
                 f'<link rel="alternate" hreflang="x-default" href="{fr_url(fr)}">\n'
                 '<script src="/lang.js" defer></script>\n<!-- /i18n -->\n')
        i = s.lower().find("</head>")
        if i < 0: print("  pas de </head> :", fr); continue
        s = s[:i] + block.lstrip("\n") + s[i:]
        open(fp, "w", encoding="utf-8").write(s)
    print("pages FR reliées")

if __name__ == "__main__":
    {"extract": extract, "build": build, "sitemap": sitemap, "link-fr": link_fr}[sys.argv[1]]()
