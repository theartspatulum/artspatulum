# -*- coding: utf-8 -*-
"""Static site generator for The Art Spa Tulum. Run: python3 build/build.py"""
import json, os, shutil, html, datetime
from data import SITE, CATEGORIES, SERVICES, FAQ
import simplybook_sync
SYNC_REPORT = simplybook_sync.apply(SERVICES) if os.environ.get("NO_SYNC") != "1" else "sync disabled"
print(SYNC_REPORT)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "site")
D = SITE["domain"]
TODAY = datetime.date.today().isoformat()
import hashlib
def _v():
    h = hashlib.md5()
    for f in ("assets/css/style.css", "assets/js/main.js"):
        h.update(open(os.path.join(OUT, f), "rb").read())
    return h.hexdigest()[:10]
ASSET_V = _v()
e = html.escape

def _min_massage():
    m = [s['price'] for s in SERVICES if s['cat'] == 'massages' or 'massages' in s.get('also', [])]
    return f"${min(m):,}" if m else "$1,250"
def _price(i, default):
    x = next((s for s in SERVICES if s["id"] == i), None)
    return f"${x['price']:,}" if x else default
_PV = {"{MINM}": None, "{RESET}": _price(26, "$1,249"), "{COUPLE}": _price(27, "$2,599"), "{SAUNA}": _price(18, "$600")}
def _fill(t):
    for k, v in _PV.items(): t = t.replace(k, v if v else _min_massage())
    return t
FAQ[:] = [tuple(_fill(x) for x in row) for row in FAQ]
CAT = {c[0]: dict(key=c[0], en=c[1], es=c[2], slug=c[3], slug_es=c[4], intro=c[5], intro_es=c[6]) for c in CATEGORIES}

# ---------------------------------------------------------------- URLs
def u(page, lang, obj=None):
    en = lang == "en"
    if page == "home": return "/" if en else "/es/"
    if page == "treatments": return "/treatments/" if en else "/es/tratamientos/"
    if page == "cat": return f"/treatments/{obj['slug']}/" if en else f"/es/tratamientos/{obj['slug_es']}/"
    if page == "svc": return f"/treatments/{obj['slug']}/" if en else f"/es/tratamientos/{obj['slug_es']}/"
    if page == "space": return "/the-space/" if en else "/es/el-espacio/"
    if page == "book": return "/book/" if en else "/es/reservar/"
    if page == "faq": return "/faq/" if en else "/es/preguntas-frecuentes/"
    if page == "contact": return "/contact/" if en else "/es/contacto/"
    raise KeyError(page)

T = {  # UI strings
    "en": dict(treatments="Treatments", couples="Couples", specials="Specials", space="The Space", faq="FAQ", contact="Contact",
               book="Book now", book_this="Book this treatment", view="View", from_="from", min="min",
               included="What's included", related="You may also like", all="All treatments",
               whatsapp="WhatsApp us", open="Open daily 10:00–19:00", hours="Hours", address="Address",
               switch="ES", switch_label="Español", menu="Menu", explore="Explore the menu",
               advance="Reserve at least {h} hr before start time.", price_label="Price", dur_label="Duration",
               cat_label="Collection", directions="Get directions", skip="Skip to content",
               wa_text="Hi! I'd like to book a treatment at The Art Spa Tulum.", plate="No."),
    "es": dict(treatments="Tratamientos", couples="Parejas", specials="Especiales", space="El Espacio", faq="Preguntas", contact="Contacto",
               book="Reservar", book_this="Reservar este tratamiento", view="Ver", from_="desde", min="min",
               included="Qué incluye", related="También te puede gustar", all="Todos los tratamientos",
               whatsapp="Escríbenos por WhatsApp", open="Abierto diario 10:00–19:00", hours="Horario", address="Dirección",
               switch="EN", switch_label="English", menu="Menú", explore="Ver el menú",
               advance="Reservar al menos {h} h antes de la hora de inicio.", price_label="Precio", dur_label="Duración",
               cat_label="Colección", directions="Cómo llegar", skip="Ir al contenido",
               wa_text="¡Hola! Me gustaría reservar un tratamiento en The Art Spa Tulum.", plate="Nº"),
}

def money(n): return f"${n:,} MXN"
def name(s, lang): return s["name"] if lang == "en" else s["name_es"]
def wa(lang): return f"https://wa.me/{SITE['whatsapp']}?text=" + T[lang]["wa_text"].replace(" ", "%20").replace("!", "%21").replace("'", "%27")
def img(s): return SITE["img_base"] + s["img"]
def svc_in(cat):
    return [s for s in SERVICES if s["cat"] == cat or cat in s.get("also", [])]
def num(s): return f"{SERVICES.index(s)+1:02d}"

# ---------------------------------------------------------------- schema
def address_ld():
    return {"@type": "PostalAddress", "streetAddress": SITE["street"], "addressLocality": SITE["city"],
            "addressRegion": SITE["region"], "postalCode": SITE["postal"], "addressCountry": SITE["country"]}

def business_ld(lang, full=False):
    ld = {
        "@context": "https://schema.org", "@type": "DaySpa", "@id": D + "/#spa",
        "name": SITE["name"], "url": D + "/",
        "description": ("Gallery-inspired day spa in La Veleta, Tulum offering massages, couples rituals, facials, private sauna and hydropool. Original photography, paintings and wall art by artists throughout the space."
                        if lang == "en" else
                        "Spa inspirado en una galería en La Veleta, Tulum, con masajes, rituales en pareja, faciales, sauna privada e hidroalberca. Fotografía, pintura y murales de artistas en todo el espacio."),
        "image": D + "/assets/img/og.jpg", "logo": D + "/assets/img/logo.png",
        "telephone": SITE["phone"], "email": SITE["email"], "priceRange": "$450 – $5,800 MXN",
        "currenciesAccepted": "MXN", "address": address_ld(),
        "geo": {"@type": "GeoCoordinates", "latitude": float(SITE["lat"]), "longitude": float(SITE["lng"])},
        "hasMap": f"https://www.google.com/maps/place/?q=place_id:{GPLACE}",
        "openingHoursSpecification": [{"@type": "OpeningHoursSpecification",
            "dayOfWeek": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
            "opens": SITE["hours_open"], "closes": SITE["hours_close"]}],
        "sameAs": [SITE["instagram"], SITE["facebook"], SITE["booking_base"], f"https://www.google.com/maps/place/?q=place_id:{GPLACE}"],
        "amenityFeature": [{"@type": "LocationFeatureSpecification", "name": n, "value": True}
                           for n in ["Sauna", "Hydropool (cold pool)", "Couples massage room", "Art gallery interior"]],
        "areaServed": ["Tulum", "La Veleta", "Aldea Zamá", "Tulum Hotel Zone", "Riviera Maya"],
        "knowsLanguage": ["en", "es"],
        "potentialAction": {"@type": "ReserveAction", "target": {"@type": "EntryPoint", "urlTemplate": D + u("book", lang),
                            "actionPlatform": ["http://schema.org/DesktopWebPlatform", "http://schema.org/MobileWebPlatform"]},
                            "result": {"@type": "Reservation", "name": "Spa appointment"}},
    }
    if full:
        ld["hasOfferCatalog"] = {"@type": "OfferCatalog", "name": "Spa menu", "itemListElement": [
            {"@type": "OfferCatalog", "name": CAT[k][lang if lang == "es" else "en"], "itemListElement": [
                {"@type": "Offer", "price": s["price"], "priceCurrency": "MXN", "url": D + u("svc", lang, s),
                 "itemOffered": {"@type": "Service", "name": name(s, lang)}} for s in SERVICES if s["cat"] == k]}
            for k in CAT]}
    return ld

def crumbs_ld(items):
    return {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": i + 1, "name": n, "item": D + h} for i, (n, h) in enumerate(items)]}

def faq_ld(pairs):
    return {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in pairs]}

def ld_tags(lds):
    return "\n".join(f'<script type="application/ld+json">{json.dumps(x, ensure_ascii=False)}</script>' for x in lds)

# ---------------------------------------------------------------- layout
def head(lang, title, desc, path_en, path_es, lds, og_img=None):
    canon = D + (path_en if lang == "en" else path_es)
    desc = desc.replace("{MINM}", _min_massage())
    if len(desc) > 158: desc = desc[:155].rsplit(" ", 1)[0].rstrip(",.;:") + "…"
    og = og_img or (D + "/assets/img/og.jpg")
    return f"""<!doctype html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(title)}</title>
<meta name="description" content="{e(desc)}">
<link rel="canonical" href="{canon}">
<link rel="alternate" hreflang="en" href="{D}{path_en}">
<link rel="alternate" hreflang="es" href="{D}{path_es}">
<link rel="alternate" hreflang="x-default" href="{D}{path_en}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="geo.region" content="MX-ROO"><meta name="geo.placename" content="Tulum">
<meta name="geo.position" content="{SITE['lat']};{SITE['lng']}"><meta name="ICBM" content="{SITE['lat']}, {SITE['lng']}">
<meta property="og:type" content="website"><meta property="og:site_name" content="{SITE['name']}">
<meta property="og:title" content="{e(title)}"><meta property="og:description" content="{e(desc)}">
<meta property="og:url" content="{canon}"><meta property="og:image" content="{og}">
<meta property="og:locale" content="{'en_US' if lang=='en' else 'es_MX'}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#faf7f2">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/assets/img/apple-touch-icon.png">
<link rel="preload" href="/assets/fonts/fraunces-latin-opsz-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/jost-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preconnect" href="https://theartspatulum.simplybook.me">
<link rel="stylesheet" href="/assets/css/style.css?v={ASSET_V}">
{ld_tags(lds)}
</head>
"""

def header(lang, path_other, current="", home=False):
    t = T[lang]
    def nav(key, href, label):
        cur = ' aria-current="page"' if key == current else ""
        return f'<a href="{href}"{cur}>{label}</a>'
    return f"""<body{' class="home"' if home else ''}>
<a class="skip" href="#main">{t['skip']}</a>
<header class="site-header">
  <a class="wordmark" href="{u('home', lang)}" aria-label="The Art Spa Tulum — home">
    <span class="wm-name">The Art Spa</span><span class="wm-place">Tulum</span>
  </a>
  <button class="nav-toggle" aria-expanded="false" aria-controls="site-nav">{t['menu']}</button>
  <nav id="site-nav" class="site-nav" aria-label="Main">
    {nav('treatments', u('treatments', lang), t['treatments'])}
    {nav('specials', u('cat', lang, CAT['specials']), t['specials'])}
    {nav('space', u('space', lang), t['space'])}
    {nav('faq', u('faq', lang), t['faq'])}
    {nav('contact', u('contact', lang), t['contact'])}
    <a class="lang" href="{path_other}" hreflang="{'es' if lang=='en' else 'en'}" lang="{'es' if lang=='en' else 'en'}" title="{t['switch_label']}">{t['switch']}</a>
    <a class="btn btn-ink" href="{u('book', lang)}">{t['book']}</a>
  </nav>
</header>
<main id="main">
"""

def footer(lang):
    t = T[lang]
    cats = "".join(f'<li><a href="{u("cat", lang, c)}">{c["en"] if lang=="en" else c["es"]}</a></li>' for c in CAT.values())
    year = datetime.date.today().year
    return f"""</main>
<footer class="site-footer">
  <div class="foot-grid">
    <div>
      <p class="wordmark"><span class="wm-name">The Art Spa</span><span class="wm-place">Tulum</span></p>
      <p class="muted">{'A gallery-inspired spa in La Veleta, Tulum.' if lang=='en' else 'Un spa inspirado en una galería en La Veleta, Tulum.'}</p>
    </div>
    <div>
      <h2 class="label">{t['address']}</h2>
      <address>{SITE['street']}<br>{SITE['postal']} {SITE['city']}, {SITE['region_short']}, México</address>
      <p><a href="https://www.google.com/maps/search/?api=1&query=The+Art+Spa+Tulum&query_place_id={GPLACE}" rel="noopener">{t['directions']} →</a></p>
    </div>
    <div>
      <h2 class="label">{t['hours']}</h2>
      <p>{'Monday – Sunday' if lang=='en' else 'Lunes a domingo'}<br>10:00 – 19:00</p>
      <p><a href="{wa(lang)}" rel="noopener">WhatsApp {SITE['phone_display']}</a><br>
      <a href="mailto:{SITE['email']}">{SITE['email']}</a></p>
    </div>
    <div>
      <h2 class="label">{t['treatments']}</h2>
      <ul class="plain">{cats}</ul>
    </div>
  </div>
  <div class="foot-bottom">
    <p>© {year} {SITE['name']}</p>
    <p><a href="{SITE['instagram']}" rel="noopener">Instagram</a> · <a href="{SITE['facebook']}" rel="noopener">Facebook</a></p>
  </div>
</footer>
<div class="mobile-bar">
  <a class="btn btn-ink" href="{u('book', lang)}">{t['book']}</a>
  <a class="btn btn-line" href="{wa(lang)}" rel="noopener">WhatsApp</a>
</div>
<a class="wa-float" href="{wa(lang)}" rel="noopener" aria-label="{t['whatsapp']}">
  <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M16 3a13 13 0 0 0-11.2 19.6L3 29l6.6-1.7A13 13 0 1 0 16 3zm0 23.7a10.7 10.7 0 0 1-5.5-1.5l-.4-.2-3.9 1 1-3.8-.2-.4A10.7 10.7 0 1 1 16 26.7zm5.9-8c-.3-.2-1.9-.9-2.2-1s-.5-.2-.7.2-.8 1-1 1.2-.4.2-.7 0a8.8 8.8 0 0 1-4.4-3.8c-.3-.6.3-.5 1-1.7.1-.2 0-.4 0-.5l-1-2.4c-.3-.6-.5-.5-.7-.5h-.6a1.2 1.2 0 0 0-.9.4 3.6 3.6 0 0 0-1.1 2.7 6.3 6.3 0 0 0 1.3 3.3 14.4 14.4 0 0 0 5.5 4.9c2 .9 2.8.9 3.9.8a3.3 3.3 0 0 0 2.1-1.5 2.7 2.7 0 0 0 .2-1.5c-.1-.2-.3-.3-.7-.4z"/></svg>
</a>
<script src="/assets/js/main.js?v={ASSET_V}" defer></script>
</body>
</html>
"""

def card(s, lang):
    t = T[lang]
    note = s.get('note' if lang == 'en' else 'note_es', '')
    return f"""<article class="tile">
  <img src="{img(s)}" alt="{e(name(s, lang))} — The Art Spa Tulum" loading="lazy" decoding="async" width="600" height="800">
  <div class="tile-txt">
    <h3 class="coll-t"><a class="tile-link" href="{u('svc', lang, s)}">{e(name(s, lang))}</a></h3>
    <p class="coll-c">{s['dur']} {t['min']} · {money(s['price'])}</p>
    {('<p class="tile-note">' + e(note) + '</p>') if note else ''}
    <a class="tile-book" href="{u('book', lang)}?service={s['id']}">{t['book']}</a>
  </div>
</article>"""

def write(path, content):
    full = os.path.join(OUT, path.lstrip("/"))
    if full.endswith("/"): full += "index.html"
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", encoding="utf-8") as f: f.write(content)

PAGES = []  # (en_path, es_path, priority)

# ---------------------------------------------------------------- HOME
HERO = SITE["img_base"].replace("preview/", "background/") + "0ab900997bf4574d801e326746df577f.PNG"
IB = SITE["img_base"]
CAT_IMG = {"specials": ("/assets/img/cat-specials.jpg", "50% 35%"), "massages": (IB + "f9c8fd356ec5a6002cfdd53e3843dfa6.png", "50% 50%"),
           "specialty": ("/assets/img/cat-specialty.jpg", "58% 50%"), "couples": ("/assets/img/cat-couples.jpg", "50% 50%"),
           "body": (IB + "536c53090176146b6380a60d71a8d2b3.jpg", "50% 50%"), "facials": (IB + "327ca2c90e1eb9cecad938f52bc4591e.PNG", "50% 50%"),
           "sauna": ("/assets/img/cat-sauna.jpg", "42% 50%")}

def build_home(lang):
    t = T[lang]; en = lang == "en"
    title = ("The Art Spa Tulum | Massage, Couples Spa & Sauna in La Veleta"
             if en else "The Art Spa Tulum | Masajes, Spa en Pareja y Sauna en Tulum")
    desc = ("Gallery-inspired day spa in La Veleta, Tulum. Massages from {MINM} MXN, couples rituals, facials, private sauna and hydropool. Open daily 10:00–19:00. Book online."
            if en else "Spa inspirado en una galería en La Veleta, Tulum. Masajes desde {MINM} MXN, rituales en pareja, faciales, sauna privada e hidroalberca. Abierto diario 10:00–19:00. Reserva en línea.")
    featured = [next(x for x in SERVICES if x["id"] == i) for i in (26, 28, 27, 5, 31, 12)]
    order = ["specials", "massages", "couples", "specialty", "facials", "body", "sauna"]
    tiles = "".join(f"""<a class="coll{' wide' if k in ('specials', 'massages', 'couples') else ''}" href="{u('cat', lang, CAT[k])}"><img src="{CAT_IMG[k][0]}" style="object-position:{CAT_IMG[k][1]}" alt="" loading="lazy" decoding="async"><span class="coll-txt"><span class="coll-t">{CAT[k]['en'] if en else CAT[k]['es']}</span><span class="coll-c">{t['from_']} {money(min(s['price'] for s in svc_in(k)))}</span></span></a>"""
                    for k in order)
    faq_pairs = [(q, a) if en else (qe, ae) for q, a, qe, ae in FAQ[:5]]
    faqs = "".join(f"<details><summary>{e(q)}</summary><p>{e(a)}</p></details>" for q, a in faq_pairs)
    body = f"""
<section class="hero">
  <picture>
    <source type="image/webp" srcset="/assets/img/hero-900.webp 900w, /assets/img/hero.webp 1704w" sizes="100vw">
    <img class="hero-img" src="/assets/img/hero.jpg" alt="{'Guest relaxing on a massage table under The Art Spa Tulum framed logo' if en else 'Huésped relajándose en la camilla bajo el logo enmarcado de The Art Spa Tulum'}" width="1704" height="923" fetchpriority="high">
  </picture>
  <div class="hero-copy">
    <p class="label">Day spa · La Veleta, Tulum</p>
    <h1>{'Where art meets <em>stillness</em>' if en else 'Donde el arte encuentra la <em>calma</em>'}</h1>
  </div>
  <div class="hero-bar">
    <p class="cta-row"><a class="btn btn-light btn-lg" href="{u('book', lang)}">{t['book']}</a> <a class="btn btn-ghost btn-lg" href="{u('treatments', lang)}">{t['explore']}</a></p>
    <p class="hours-chip"><span class="dot"></span>{t['open']}</p>
  </div>
</section>

<section class="section menu-top">
  <header class="sec-head"><p class="label">{'Our menu' if en else 'Nuestro menú'}</p><h2>{'Choose your <em>ritual</em>' if en else 'Elige tu <em>ritual</em>'}</h2></header>
  <div class="coll-grid">{tiles}</div>
</section>

<div class="band"><section class="section">
  <header class="sec-head"><p class="label">{'Most booked' if en else 'Los más reservados'}</p><h2>{'Guest <em>favorites</em>' if en else 'Favoritos de nuestros <em>huéspedes</em>'}</h2></header>
   <div class="works cols3">{''.join(card(s, lang) for s in featured)}</div>
  <p class="center cta-row"><a class="btn btn-line" href="{u('treatments', lang)}">{t['all']}</a></p>
</section></div>

<section class="section split">
  <div class="split-img"><img src="{SITE['img_base']}7153d334c482fcd62e6ffe5e6022580f.PNG" alt="{'Massage room at The Art Spa Tulum' if en else 'Cabina de masaje en The Art Spa Tulum'}" loading="lazy" decoding="async" width="800" height="600"></div>
  <div>
    <p class="label">{t['space']}</p>
    <h2>{'A spa that feels like a <em>gallery</em>' if en else 'Un spa que se siente como <em>galería</em>'}</h2>
    <p class="lede">{'The first spa in Tulum with a true gallery spirit, made for creativity, presence and pause.' if en else 'El primer spa en Tulum con verdadero espíritu de galería, hecho para la creatividad, la presencia y la pausa.'}</p>
    <p>{'Massage, couples rituals, facials, a private sauna and a cold pool, surrounded by original art: photography on the walls, paintings and wall art by artists.' if en else 'Masajes, rituales en pareja, faciales, sauna privada y alberca fría, rodeados de arte original: fotografía, pinturas y murales de artistas.'}</p>
    <ul class="ticks">
      <li>{'Private hot sauna' if en else 'Sauna caliente privada'}</li>
      <li>{'Cold hydropool' if en else 'Hidroalberca fría con burbujas'}</li>
      <li>{'Massage rooms incl. couples suite' if en else 'Cabinas de masaje y suite para parejas'}</li>
      <li>{'Original photography, paintings &amp; wall art' if en else 'Fotografía, pinturas y murales originales'}</li>
    </ul>
    <a class="link" href="{u('space', lang)}">{'Step inside' if en else 'Conoce el espacio'}</a>
  </div>
</section>

<div class="band"><section class="section">
  <header class="sec-head"><p class="label">FAQ</p><h2>{'Good to <em>know</em>' if en else 'Bueno <em>saber</em>'}</h2></header>
  <div class="faq">{faqs}</div>
  <p class="center cta-row"><a class="link" href="{u('faq', lang)}">{'All questions' if en else 'Todas las preguntas'}</a></p>
</section></div>
{reviews_block(lang)}
{visit_block(lang)}
"""
    lds = [business_ld(lang, full=True), faq_ld(faq_pairs),
           {"@context": "https://schema.org", "@type": "WebSite", "name": SITE["name"], "url": D + "/", "inLanguage": lang}]
    write(u("home", lang), head(lang, title, desc, "/", "/es/", lds, og_img=D + "/assets/img/og.jpg") + header(lang, u("home", "es" if en else "en")) + body + footer(lang))

GPLACE = "ChIJkVqVXnnXT48RZNaf0299hcc"
def reviews_block(lang):
    en = lang == "en"
    return f"""<section class="section reviews">
  <header class="sec-head"><p class="label">Google</p><h2>{'Guest <em>reviews</em>' if en else 'Opiniones de <em>huéspedes</em>'}</h2></header>
  <div id="google-reviews" class="reviews-widget"><script defer async src="https://cdn.trustindex.io/loader.js?03727b685ec0489e6886c7722c8"></script></div>
  <p class="center cta-row"><a class="btn btn-line" href="https://search.google.com/local/reviews?placeid={GPLACE}" rel="noopener">{'Read our Google reviews' if en else 'Ver opiniones en Google'}</a> <a class="btn btn-ink" href="https://search.google.com/local/writereview?placeid={GPLACE}" rel="noopener">{'Leave a review' if en else 'Deja tu opinión'}</a></p>
</section>"""

def visit_block(lang):
    en = lang == "en"; t = T[lang]
    return f"""<section class="section visit">
  <div>
    <p class="label">{'Visit' if en else 'Visítanos'}</p>
    <h2>{'Find us in La Veleta' if en else 'Encuéntranos en La Veleta'}</h2>
    <address><strong>{SITE['name']}</strong><br>{SITE['street']}<br>{SITE['postal']} {SITE['city']}, {SITE['region']}, México</address>
    <p>{t['open']}</p>
    <p class="cta-row"><a class="btn btn-ink" href="{u('book', lang)}">{t['book']}</a> <a class="btn btn-line" href="{wa(lang)}" rel="noopener">WhatsApp</a></p>
  </div>
  <div class="map">
    <iframe title="{'Map to The Art Spa Tulum' if en else 'Mapa a The Art Spa Tulum'}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"
      src="https://maps.google.com/maps?q=The+art+Spa+TULUM,+La+Veleta,+Tulum&z=16&output=embed"></iframe>
  </div>
</section>"""

# ---------------------------------------------------------------- TREATMENTS INDEX
def build_treatments(lang):
    t = T[lang]; en = lang == "en"
    title = "Spa Menu & Prices | Massages, Facials & Rituals in Tulum — The Art Spa" if en else "Menú y Precios de Spa en Tulum | The Art Spa"
    desc = ("Full spa menu with prices in MXN: massages from {MINM}, facials $1,199, couples rituals, body rituals, sauna & hydropool. La Veleta, Tulum."
            if en else "Menú completo con precios en MXN: masajes desde {MINM}, faciales $1,199, rituales en pareja, rituales corporales, sauna e hidroalberca. La Veleta, Tulum.")
    secs = ""
    for c in CAT.values():
        rows = "".join(f"""<li><a href="{u('svc', lang, s)}"><span class="r-n">{t['plate']} {num(s)}</span><span class="r-t">{e(name(s, lang))}</span><span class="r-d">{s['dur']} {t['min']}</span><span class="r-p">{money(s['price'])}</span></a></li>"""
                       for s in svc_in(c["key"]))
        secs += f"""<section class="menu-sec" id="{c['slug']}"><header><h2><a href="{u('cat', lang, c)}">{c['en'] if en else c['es']}</a></h2><p class="muted">{e(c['intro'] if en else c['intro_es'])}</p></header><ul class="price-list">{rows}</ul></section>"""
    body = f"""<section class="page-head"><p class="label">{'Price list' if en else 'Lista de precios'} · MXN</p><h1>{'Spa menu &amp; prices' if en else 'Menú y precios'}</h1>
<p class="lede">{'Every treatment, every price. All prices in Mexican pesos. Tap any work to see what is included, or book instantly.' if en else 'Todos los tratamientos y precios en pesos mexicanos. Toca cualquiera para ver qué incluye o reserva al instante.'}</p>
<nav class="chips">{''.join(f'<a href="#{c["slug"]}">{c["en"] if en else c["es"]}</a>' for c in CAT.values())}</nav></section>
<div class="section">{secs}</div>"""
    lds = [crumbs_ld([("Home" if en else "Inicio", u("home", lang)), (t["treatments"], u("treatments", lang))]),
           {"@context": "https://schema.org", "@type": "ItemList", "itemListElement": [
               {"@type": "ListItem", "position": i + 1, "url": D + u("svc", lang, s), "name": name(s, lang)} for i, s in enumerate(SERVICES)]}]
    write(u("treatments", lang), head(lang, title, desc, "/treatments/", "/es/tratamientos/", lds) + header(lang, u("treatments", "es" if en else "en"), "treatments") + body + footer(lang))
    PAGES.append(("/treatments/", "/es/tratamientos/", "0.9")) if en else None

# ---------------------------------------------------------------- CATEGORY
CAT_SEO = {
    "specials": ("Spa Packages in Tulum: Massage + Sauna + Pool", "Paquetes de Spa en Tulum: Masaje + Sauna + Alberca"),
    "massages": ("Massage in Tulum: Aromatherapy, Deep Tissue & Hot Stone", "Masajes en Tulum: Aromaterapia, Tejido Profundo y Piedras Calientes"),
    "specialty": ("Specialty Massages in Tulum: Lymphatic, Recovery & Sobada", "Masajes Especiales en Tulum: Linfático, Recuperación y Sobada"),
    "couples": ("Couples Massage & Spa Rituals in Tulum", "Masaje en Pareja y Rituales de Spa en Tulum"),
    "body": ("Body Wraps & Scrub Rituals in Tulum", "Envolturas y Rituales Corporales en Tulum"),
    "facials": ("Facials in Tulum: 24K Gold, Collagen & Detox", "Faciales en Tulum: Oro 24K, Colágeno y Detox"),
    "sauna": ("Sauna & Cold Hydropool in Tulum", "Sauna e Hidroalberca Fría en Tulum"),
}
def cat_faq_pairs(c, items, lang):
    en = lang == "en"
    nm = (c["en"] if en else c["es"]).lower()
    lo = min(x["price"] for x in items); hi = max(x["price"] for x in items)
    dmin = min(x["dur"] for x in items); dmax = max(x["dur"] for x in items)
    names = ", ".join(name(x, lang) for x in items[:4])
    if en:
        return [
            (f"How much do {nm} cost at The Art Spa Tulum?", f"Our {nm} range from {money(lo)} to {money(hi)}. Options include {names}. All prices are in Mexican pesos."),
            (f"How long do the {nm} last?", f"Sessions last between {dmin} and {dmax} minutes, depending on the treatment."),
            (f"Where can I book {nm} in Tulum?", f"At The Art Spa Tulum in La Veleta ({SITE['street']}, {SITE['postal']} Tulum). Book online with instant confirmation at theartspatulum.mx or message us on WhatsApp at {SITE['phone_display']}. Open daily 10:00–19:00."),
        ]
    return [
        (f"¿Cuánto cuestan los {nm} en The Art Spa Tulum?", f"Nuestros {nm} van de {money(lo)} a {money(hi)}. Opciones: {names}. Todos los precios en pesos mexicanos."),
        (f"¿Cuánto duran los {nm}?", f"Las sesiones duran entre {dmin} y {dmax} minutos, según el tratamiento."),
        (f"¿Dónde reservo {nm} en Tulum?", f"En The Art Spa Tulum, La Veleta ({SITE['street']}, {SITE['postal']} Tulum). Reserva en línea con confirmación inmediata en theartspatulum.mx o por WhatsApp al {SITE['phone_display']}. Abierto diario 10:00–19:00."),
    ]

def cat_faq_block(c, items, lang):
    pairs = cat_faq_pairs(c, items, lang)
    return f"""<section class="section"><header class="sec-head"><p class="label">FAQ</p><h2>{'Good to <em>know</em>' if lang == 'en' else 'Bueno <em>saber</em>'}</h2></header><div class="faq">{''.join(f'<details><summary>{e(q)}</summary><p>{e(a)}</p></details>' for q, a in pairs)}</div></section>"""

def build_cat(c, lang):
    t = T[lang]; en = lang == "en"
    h1 = CAT_SEO[c["key"]][0 if en else 1]
    items = svc_in(c["key"])
    lo = min(s["price"] for s in items)
    title = f"{h1} | The Art Spa"
    main, _, sub = h1.partition(": ")
    h1_html = e(main) + (f'<span class="h1-sub">{e(sub)}</span>' if sub else "")
    desc = f"{c['intro'] if en else c['intro_es']} {'From' if en else 'Desde'} {money(lo)}. La Veleta, Tulum."
    body = f"""<section class="page-head"><nav class="crumbs"><a href="{u('home', lang)}">{'Home' if en else 'Inicio'}</a> / <a href="{u('treatments', lang)}">{t['treatments']}</a></nav>
<p class="label">{t['cat_label']} · {c['en'] if en else c['es']}</p><h1>{h1_html}</h1><p class="lede">{e(c['intro'] if en else c['intro_es'])}</p></section>
<section class="section"><div class="works{' cols3' if c['key'] == 'specials' else ''}">{''.join(card(s, lang) for s in items)}</div></section>{cat_faq_block(c, items, lang)}{visit_block(lang)}"""
    lds = [crumbs_ld([("Home" if en else "Inicio", u("home", lang)), (t["treatments"], u("treatments", lang)), (c["en"] if en else c["es"], u("cat", lang, c))]),
           {"@context": "https://schema.org", "@type": "ItemList", "name": h1, "itemListElement": [
               {"@type": "ListItem", "position": i + 1, "url": D + u("svc", lang, s), "name": name(s, lang)} for i, s in enumerate(items)]},
           faq_ld(cat_faq_pairs(c, items, lang))]
    cur = "specials" if c["key"] == "specials" else "treatments"
    write(u("cat", lang, c), head(lang, title, desc, u("cat", "en", c), u("cat", "es", c), lds) + header(lang, u("cat", "es" if en else "en", c), cur) + body + footer(lang))
    if en: PAGES.append((u("cat", "en", c), u("cat", "es", c), "0.8"))

# ---------------------------------------------------------------- SERVICE
def build_svc(s, lang):
    t = T[lang]; en = lang == "en"
    c = CAT[s["cat"]]; nm = name(s, lang)
    note = s.get("note" if en else "note_es", "")
    title = f"{nm} in Tulum | {money(s['price'])} | The Art Spa" if en else f"{nm} en Tulum | {money(s['price'])} | The Art Spa"
    if len(title) > 65: title = title.rsplit(" | ", 1)[0]
    summ = s["sum" if en else "sum_es"]
    desc = (summ[:150].rsplit(" ", 1)[0] + "…") if len(summ) > 155 else summ
    inc = "".join(f"<li>{e(x)}</li>" for x in s["inc" if en else "inc_es"])
    rel = [x for x in svc_in(s["cat"]) if x is not s][:3]
    if len(rel) < 3: rel += [x for x in SERVICES if x not in rel and x is not s][: 3 - len(rel)]
    qa = [
        ((f"How much is the {nm} at The Art Spa Tulum?" if en else f"¿Cuánto cuesta {nm} en The Art Spa Tulum?"),
         (f"The {nm} costs {money(s['price'])}{(' ' + note) if note else ''} and lasts {s['dur']} minutes." if en else
          f"{nm} cuesta {money(s['price'])}{(' ' + note) if note else ''} y dura {s['dur']} minutos.")),
        (("Where is it offered?" if en else "¿Dónde se ofrece?"),
         (f"At The Art Spa Tulum, {SITE['street']}, {SITE['postal']} Tulum, Quintana Roo. Open daily 10:00–19:00." if en else
          f"En The Art Spa Tulum, {SITE['street']}, {SITE['postal']} Tulum, Quintana Roo. Abierto diario 10:00–19:00.")),
        (("How do I book?" if en else "¿Cómo reservo?"),
         ("Book online at theartspatulum.mx/book with instant confirmation, or message us on WhatsApp at " + SITE["phone_display"] + "." if en else
          "Reserva en línea en theartspatulum.mx/es/reservar con confirmación inmediata, o escríbenos por WhatsApp al " + SITE["phone_display"] + ".")),
    ]
    glance = (f"{'' if nm.startswith('The ') else 'The '}{nm} at The Art Spa Tulum is a {s['dur']}-minute treatment priced at {money(s['price'])}{(' ' + note) if note else ''}, offered daily 10:00–19:00 in La Veleta, Tulum."
              if en else f"{nm} en The Art Spa Tulum es un tratamiento de {s['dur']} minutos por {money(s['price'])}{(' ' + note) if note else ''}, disponible diario de 10:00 a 19:00 en La Veleta, Tulum.")
    adv = f'<p class="notice">{t["advance"].format(h=s["advance"])}</p>' if s.get("advance") else ""
    direct = f"{SITE['booking_base']}/v2/#book/service/{s['id']}/count/1/"
    body = f"""<article class="svc">
<section class="page-head"><nav class="crumbs"><a href="{u('home', lang)}">{'Home' if en else 'Inicio'}</a> / <a href="{u('treatments', lang)}">{t['treatments']}</a> / <a href="{u('cat', lang, c)}">{c['en'] if en else c['es']}</a></nav></section>
<div class="svc-grid section">
  <figure class="svc-photo"><img src="{img(s)}" alt="{e(nm)} at The Art Spa Tulum" width="1200" height="900" fetchpriority="high"></figure>
  <div class="svc-body">
    <p class="label">{c['en'] if en else c['es']}</p>
    <h1>{e(nm)} <span class="in">{'in Tulum' if en else 'en Tulum'}</span></h1>
    <dl class="specs">
      <div><dt>{t['dur_label']}</dt><dd>{s['dur']} {t['min']}</dd></div>
      <div><dt>{t['price_label']}</dt><dd>{money(s['price'])}{('<small>' + e(note) + '</small>') if note else ''}</dd></div>
    </dl>
    <p class="glance">{e(glance)}</p>
    <p class="lede">{e(summ)}</p>
    <h2 class="label">{t['included']}</h2>
    <ul class="ticks">{inc}</ul>
    {adv}
    <p class="cta-row"><a class="btn btn-ink btn-lg" href="{u('book', lang)}?service={s['id']}">{t['book_this']}</a> <a class="btn btn-line btn-lg" href="{wa(lang)}" rel="noopener">WhatsApp</a></p>
    <p class="small muted">{'Prefer the booking app?' if en else '¿Prefieres la app de reservas?'} <a href="{direct}" rel="noopener">{'Open in SimplyBook' if en else 'Abrir en SimplyBook'} ↗</a></p>
  </div>
</div>
<section class="section"><h2 class="label">FAQ</h2><div class="faq">{''.join(f'<details><summary>{e(q)}</summary><p>{e(a)}</p></details>' for q, a in qa)}</div></section>
<section class="section"><header class="sec-head"><h2>{t['related']}</h2></header><div class="works three">{''.join(card(x, lang) for x in rel)}</div></section>
</article>"""
    svc_ld = {"@context": "https://schema.org", "@type": "Service", "name": nm, "description": summ,
              "serviceType": c["en"], "image": img(s), "url": D + u("svc", lang, s),
              "provider": {"@id": D + "/#spa", "@type": "DaySpa", "name": SITE["name"], "address": address_ld(), "telephone": SITE["phone"]},
              "areaServed": {"@type": "City", "name": "Tulum"},
              "offers": {"@type": "Offer", "price": s["price"], "priceCurrency": "MXN", "availability": "https://schema.org/InStock",
                         "url": D + u("book", lang) + f"?service={s['id']}"}}
    lds = [svc_ld, faq_ld(qa), crumbs_ld([("Home" if en else "Inicio", u("home", lang)), (t["treatments"], u("treatments", lang)),
                                         (c["en"] if en else c["es"], u("cat", lang, c)), (nm, u("svc", lang, s))])]
    write(u("svc", lang, s), head(lang, title, desc, u("svc", "en", s), u("svc", "es", s), lds, og_img=img(s)) + header(lang, u("svc", "es" if en else "en", s), "treatments") + body + footer(lang))
    if en: PAGES.append((u("svc", "en", s), u("svc", "es", s), "0.7"))

# ---------------------------------------------------------------- SPACE
def build_space(lang):
    en = lang == "en"; t = T[lang]
    title = "The Space: Gallery Spa, Sauna & Hydropool in Tulum | The Art Spa" if en else "El Espacio: Spa Galería, Sauna e Hidroalberca | The Art Spa"
    desc = ("Step inside Tulum's gallery-inspired spa: original photography, paintings and wall art by artists, a private sauna, cold hydropool and couples massage suite."
            if en else "Conoce el spa galería de Tulum: fotografía, pinturas y murales de artistas, sauna privada, hidroalberca fría y suite de masaje para parejas.")
    rooms = [
        ("The Tea Area", "El Área de Té", "Arrive a little early and settle in beneath a large hand-painted mural. Sip a cup of tea, let the art set the pace, and slow down before your treatment begins.",
         "Llega un poco antes y acomódate bajo un gran mural pintado a mano. Toma una taza de té, deja que el arte marque el ritmo y desacelera antes de tu tratamiento."),
        ("The Sauna", "La Sauna", "A private hot sauna that opens the pores, warms the muscles and prepares the body for deeper work. Included in most rituals or bookable on its own.",
         "Una sauna caliente privada que abre los poros, calienta los músculos y prepara el cuerpo. Incluida en la mayoría de los rituales o por separado."),
        ("The Hydropool", "La Hidroalberca", "A cold, bubbling pool for contrast therapy after the sauna. Hot, cold, repeat: the classic recipe for circulation and calm, on your own or together.",
         "Una alberca fría con burbujas para terapia de contraste después de la sauna. Calor, frío, repetir: la receta clásica para circulación y calma, solo o en pareja."),
        ("The Massage Rooms", "Las Cabinas", "Calm, softly lit treatment rooms with linen curtains and jungle light, including a suite for couples rituals and side-by-side massage.",
         "Cabinas tranquilas con luz suave, cortinas de lino y vista a la selva, incluida una suite para rituales y masajes en pareja."),
    ]
    pics = ["/assets/img/room-tea.jpg", SITE["img_base"] + "c5c9a182a1941c8d1c4e3e6ae12daa77.jpeg", "/assets/img/room-hydropool.jpg", "/assets/img/room-massage.jpg"]
    blocks = "".join(f"""<section class="room"><div class="room-img"><img src="{pics[i]}" alt="{a if en else b} — The Art Spa Tulum" loading="lazy" decoding="async"></div><div><p class="label">{'Room' if en else 'Sala'} {i+1:02d}</p><h2>{a if en else b}</h2><p>{c if en else d}</p></div></section>"""
                     for i, (a, b, c, d) in enumerate(rooms))
    body = f"""<section class="page-head"><p class="label">{t['space']}</p><h1>{'A spa that feels like a <em>gallery</em>' if en else 'Un spa que se siente como <em>galería</em>'}</h1>
<p class="lede">{'The Art Spa Tulum is the first spa in Tulum with a true gallery-inspired atmosphere, a space that encourages creativity, presence and pause.' if en else 'The Art Spa Tulum es el primer spa en Tulum con una verdadera atmósfera de galería: un espacio que invita a la creatividad, la presencia y la pausa.'}</p></section>
<div class="section rooms">{blocks}</div>
<section class="section center"><a class="btn btn-ink btn-lg" href="{u('treatments', lang)}">{'Explore our menu' if en else 'Explora nuestro menú'}</a></section>{visit_block(lang)}"""
    lds = [business_ld(lang), crumbs_ld([("Home" if en else "Inicio", u("home", lang)), (t["space"], u("space", lang))])]
    write(u("space", lang), head(lang, title, desc, "/the-space/", "/es/el-espacio/", lds) + header(lang, u("space", "es" if en else "en"), "space") + body + footer(lang))

# ---------------------------------------------------------------- BOOK
def build_book(lang):
    en = lang == "en"; t = T[lang]
    title = "Book a Massage or Facial in Tulum | The Art Spa Tulum" if en else "Reserva Masaje o Facial en Tulum | The Art Spa Tulum"
    desc = ("Book online with instant confirmation: massages, couples rituals, facials, sauna and hydropool at The Art Spa Tulum, La Veleta. Open daily 10:00–19:00."
            if en else "Reserva en línea con confirmación inmediata: masajes, rituales en pareja, faciales, sauna e hidroalberca en The Art Spa Tulum, La Veleta. Abierto diario 10:00–19:00.")
    body = f"""<section class="page-head narrow"><p class="label">{'Reservations' if en else 'Reservaciones'}</p><h1>{'Book your treatment' if en else 'Reserva tu tratamiento'}</h1>
<p class="lede">{'Choose a treatment, date and time. Confirmation is instant. Questions? Message us on' if en else 'Elige tratamiento, fecha y hora. La confirmación es inmediata. ¿Dudas? Escríbenos por'} <a href="{wa(lang)}" rel="noopener">WhatsApp</a>.</p></section>
<section class="section booking">
  <div id="sbw_booking" class="booking-frame" data-sb="{SITE['booking_base']}"><p class="muted center">{'Loading booking calendar…' if en else 'Cargando calendario…'}</p></div>
  <noscript><p class="center"><a class="btn btn-ink" href="{SITE['booking_base']}/v2/">{'Open the booking page' if en else 'Abrir página de reservas'}</a></p></noscript>
  <p class="small muted center">{'Trouble loading?' if en else '¿No carga?'} <a href="{SITE['booking_base']}/v2/" rel="noopener">{'Open booking in a new tab' if en else 'Abrir reservas en otra pestaña'} ↗</a></p>
</section>
<script src="https://widget.simplybook.me/v2/widget/widget.js" defer></script>"""
    lds = [business_ld(lang), crumbs_ld([("Home" if en else "Inicio", u("home", lang)), (t["book"], u("book", lang))])]
    write(u("book", lang), head(lang, title, desc, "/book/", "/es/reservar/", lds) + header(lang, u("book", "es" if en else "en")) + body + footer(lang))

# ---------------------------------------------------------------- FAQ
def build_faq(lang):
    en = lang == "en"; t = T[lang]
    pairs = [(q, a) if en else (qe, ae) for q, a, qe, ae in FAQ]
    title = "FAQ: Prices, Hours, Location & Booking | The Art Spa Tulum" if en else "Preguntas Frecuentes: Precios, Horario y Ubicación | The Art Spa"
    desc = ("Answers about The Art Spa Tulum: massage prices, couples massage, sauna and hydropool, opening hours, location in La Veleta and how to book."
            if en else "Respuestas sobre The Art Spa Tulum: precios de masajes, masaje en pareja, sauna e hidroalberca, horario, ubicación en La Veleta y cómo reservar.")
    body = f"""<section class="page-head narrow"><p class="label">FAQ</p><h1>{'Frequently asked questions' if en else 'Preguntas frecuentes'}</h1></section>
<section class="section narrow"><div class="faq open-all">{''.join(f'<details open><summary><h2>{e(q)}</h2></summary><p>{e(a)}</p></details>' for q, a in pairs)}</div></section>{visit_block(lang)}"""
    lds = [faq_ld(pairs), crumbs_ld([("Home" if en else "Inicio", u("home", lang)), ("FAQ", u("faq", lang))])]
    write(u("faq", lang), head(lang, title, desc, "/faq/", "/es/preguntas-frecuentes/", lds) + header(lang, u("faq", "es" if en else "en"), "faq") + body + footer(lang))

# ---------------------------------------------------------------- CONTACT
def build_contact(lang):
    en = lang == "en"; t = T[lang]
    title = "Contact & Directions | The Art Spa Tulum, La Veleta" if en else "Contacto y Ubicación | The Art Spa Tulum, La Veleta"
    desc = (f"Contact The Art Spa Tulum: WhatsApp {SITE['phone_display']}, {SITE['email']}. {SITE['street']}, {SITE['postal']} Tulum. Open daily 10:00–19:00."
            if en else f"Contacta a The Art Spa Tulum: WhatsApp {SITE['phone_display']}, {SITE['email']}. {SITE['street']}, {SITE['postal']} Tulum. Abierto diario 10:00–19:00.")
    maps = f"https://www.google.com/maps/search/?api=1&query=The+Art+Spa+Tulum&query_place_id={GPLACE}"
    rows = [
        ("WhatsApp", f'<a href="{wa(lang)}" rel="noopener">{SITE["phone_display"]}</a>'),
        ("Email", f'<a href="mailto:{SITE["email"]}">{SITE["email"]}</a>'),
        (t["address"], f'{SITE["street"]}<br>{SITE["postal"]} {SITE["city"]}, {SITE["region_short"]}, México<br><a class="link" href="{maps}" rel="noopener">{t["directions"]}</a>'),
        (t["hours"], ("Monday – Sunday" if en else "Lunes a domingo") + "<br>10:00 – 19:00"),
        ("Social", f'<a href="{SITE["instagram"]}" rel="noopener">Instagram @theartspatulum</a><br><a href="{SITE["facebook"]}" rel="noopener">Facebook</a>'),
    ]
    dl = "".join(f"<div><dt>{k}</dt><dd>{v}</dd></div>" for k, v in rows)
    body = f"""<section class="page-head narrow center"><p class="label">{t['contact']}</p><h1>{'Contact &amp; <em>directions</em>' if en else 'Contacto y <em>ubicación</em>'}</h1>
<p class="lede center">{'Questions, group bookings or special requests? The fastest way to reach us is WhatsApp.' if en else '¿Dudas, grupos o peticiones especiales? La forma más rápida de contactarnos es por WhatsApp.'}</p></section>
<section class="section contact-wrap">
  <div class="contact-card">
    <dl class="contact-list">{dl}</dl>
    <p class="cta-row"><a class="btn btn-ink" href="{u('book', lang)}">{t['book']}</a> <a class="btn btn-line" href="{wa(lang)}" rel="noopener">WhatsApp</a></p>
  </div>
  <div class="map contact-map">
    <iframe title="{'Map to The Art Spa Tulum' if en else 'Mapa a The Art Spa Tulum'}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"
      src="https://maps.google.com/maps?q=The+art+Spa+TULUM,+La+Veleta,+Tulum&z=16&output=embed"></iframe>
  </div>
</section>"""
    lds = [business_ld(lang), crumbs_ld([("Home" if en else "Inicio", u("home", lang)), (t["contact"], u("contact", lang))])]
    write(u("contact", lang), head(lang, title, desc, "/contact/", "/es/contacto/", lds) + header(lang, u("contact", "es" if en else "en"), "contact") + body + footer(lang))

# ---------------------------------------------------------------- 404, sitemap, robots, llms
def build_404():
    body = """<section class="page-head narrow center"><p class="label">404</p><h1>This wall is empty.</h1><p class="lede">The page you were looking for isn’t on view. / Esta página no está en exhibición.</p>
<p class="cta-row center"><a class="btn btn-ink" href="/treatments/">See the menu</a> <a class="btn btn-line" href="/es/tratamientos/">Ver el menú</a></p></section>"""
    h = head("en", "Page not found | The Art Spa Tulum", "Page not found.", "/", "/es/", []).replace('content="index, follow, max-image-preview:large"', 'content="noindex"')
    write("/404.html", h + header("en", "/es/") + body + footer("en"))

def build_sitemap():
    core = [("/", "/es/", "1.0"), ("/book/", "/es/reservar/", "0.9"), ("/the-space/", "/es/el-espacio/", "0.7"),
            ("/faq/", "/es/preguntas-frecuentes/", "0.7"), ("/contact/", "/es/contacto/", "0.6")]
    urls = []
    for en_p, es_p, pr in core + PAGES:
        alt = f'<xhtml:link rel="alternate" hreflang="en" href="{D}{en_p}"/><xhtml:link rel="alternate" hreflang="es" href="{D}{es_p}"/><xhtml:link rel="alternate" hreflang="x-default" href="{D}{en_p}"/>'
        imgx = ""
        svc = next((x for x in SERVICES if u("svc", "en", x) == en_p), None)
        if svc: imgx = f"<image:image><image:loc>{e(img(svc))}</image:loc><image:title>{e(svc['name'])} — The Art Spa Tulum</image:title></image:image>"
        elif en_p == "/": imgx = f"<image:image><image:loc>{D}/assets/img/hero.jpg</image:loc><image:title>The Art Spa Tulum</image:title></image:image>"
        elif en_p == "/the-space/": imgx = "".join(f"<image:image><image:loc>{D}/assets/img/{f}</image:loc></image:image>" for f in ("room-tea.jpg", "room-hydropool.jpg", "room-massage.jpg"))
        for p in (en_p, es_p):
            urls.append(f"<url><loc>{D}{p}</loc><lastmod>{TODAY}</lastmod><priority>{pr}</priority>{alt}{imgx}</url>")
    write("/sitemap.xml", '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n' + "\n".join(urls) + "\n</urlset>\n")
    return len(urls)

def build_robots():
    write("/robots.txt", f"""# The Art Spa Tulum
User-agent: *
Allow: /
Disallow: /404.html

# AI assistants and answer engines are welcome (GEO)
User-agent: GPTBot
Allow: /
User-agent: OAI-SearchBot
Allow: /
User-agent: ChatGPT-User
Allow: /
User-agent: ClaudeBot
Allow: /
User-agent: Claude-SearchBot
Allow: /
User-agent: PerplexityBot
Allow: /
User-agent: Google-Extended
Allow: /
User-agent: Applebot-Extended
Allow: /

Sitemap: {D}/sitemap.xml
""")

def build_llms():
    lines = [f"# {SITE['name']}", "",
             "> Gallery-inspired day spa in La Veleta, Tulum, Quintana Roo, Mexico. Massages, couples rituals, Mayan treatments, facials, private sauna and cold hydropool, surrounded by original photography, paintings and wall art by artists. Prices in MXN. Bilingual (English/Spanish).", "",
             "## Key facts",
             f"- Address: {SITE['street']}, {SITE['postal']} {SITE['city']}, {SITE['region']}, Mexico",
             f"- Coordinates: {SITE['lat']}, {SITE['lng']}",
             "- Hours: Open every day, 10:00–19:00 (America/Cancun)",
             f"- WhatsApp / phone: {SITE['phone_display']}",
             f"- Email: {SITE['email']}",
             f"- Online booking: {D}/book/ (instant confirmation via SimplyBook.me)",
             f"- Instagram: {SITE['instagram']}",
             "- Facilities: private hot sauna, cold hydropool, massage rooms incl. couples suite, art gallery interior",
             _fill("- Price range: $450–$5,800 MXN. Massages from {MINM} MXN (60 min). Couples packages from {COUPLE} MXN for two."),
             "- Neighborhood: La Veleta, a few minutes from downtown Tulum and the Hotel Zone road", "",
             "## Pages",
             f"- [Spa menu & prices]({D}/treatments/)", f"- [Book online]({D}/book/)", f"- [The space]({D}/the-space/)",
             f"- [FAQ]({D}/faq/)", f"- [Contact]({D}/contact/)", f"- [Español]({D}/es/)", ""]
    for c in CAT.values():
        lines.append(f"## {c['en']}")
        for s in svc_in(c["key"]):
            note = f" ({s['note']})" if s.get("note") else ""
            lines.append(f"- [{s['name']}]({D}{u('svc','en',s)}): {s['dur']} min, {money(s['price'])}{note}. {s['sum']}")
        lines.append("")
    lines += ["## FAQ"] + [f"- Q: {q} A: {a}" for q, a, _, _ in FAQ]
    write("/llms.txt", "\n".join(lines) + "\n")

if __name__ == "__main__":
    for lang in ("en", "es"):
        build_home(lang); build_treatments(lang); build_space(lang); build_book(lang); build_faq(lang); build_contact(lang)
        for c in CAT.values(): build_cat(c, lang)
        for s in SERVICES: build_svc(s, lang)
    build_404(); n = build_sitemap(); build_robots(); build_llms()
    write("/sync-status.txt", f"{datetime.datetime.utcnow().isoformat(timespec='minutes')} UTC\n{SYNC_REPORT}\n")
    print("built; sitemap urls:", n)
