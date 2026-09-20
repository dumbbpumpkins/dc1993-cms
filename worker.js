
const COOKIE_NAME = "dc1993_admin";

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (url.pathname.startsWith("/api/")) {
        return handleApi(request, env, url);
      }

      if (url.pathname.startsWith("/media/")) {
        return handleMedia(request, env, url);
      }

      if (url.pathname === "/admin" || url.pathname === "/admin/") {
        const authed = await isAuthenticated(request, env);
        return html(authed ? adminPage() : loginPage());
      }

      return html(publicPage());
    } catch (err) {
      return new Response("Server error: " + (err?.message || String(err)), { status: 500 });
    }
  }
};

async function ensureSchema(env) {
  if (!env.DB) throw new Error("D1 binding DB is missing.");

  await env.DB.batch([
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL DEFAULT ''
      )
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS books (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        subtitle TEXT NOT NULL DEFAULT '',
        genre TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'Available',
        cover_key TEXT NOT NULL DEFAULT '',
        cover_url TEXT NOT NULL DEFAULT '',
        paperback_url TEXT NOT NULL DEFAULT '',
        ebook_url TEXT NOT NULL DEFAULT '',
        apple_url TEXT NOT NULL DEFAULT '',
        kobo_url TEXT NOT NULL DEFAULT '',
        visible INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0
      )
    `)
  ]);

  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM settings").first();
  if (!count || Number(count.n) === 0) {
    const defaults = {
      author_name: "Dylan Cunningham",
      eyebrow: "FICTION THAT STAYS WITH YOU",
      hero_title: "Stories about love, loss, memory, and the places we call home.",
      hero_text: "Welcome to the official home of Dylan Cunningham. Explore current novels, upcoming releases, and purchase options as they become available.",
      about_heading: "Dylan Cunningham",
      about_text: "Dylan Cunningham writes character-driven fiction centered on people under pressure, the relationships that hold them together, and the emotional consequences that follow them home.",
      updates_heading: "New books. Release dates. No noise.",
      updates_text: "Follow along for new releases, project updates, and publication news.",
      footer_text: "All rights reserved."
    };

    await env.DB.batch(
      Object.entries(defaults).map(([key, value]) =>
        env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").bind(key, value)
      )
    );
  }

  const books = await env.DB.prepare("SELECT COUNT(*) AS n FROM books").first();
  if (!books || Number(books.n) === 0) {
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO books
        (id,title,genre,description,status,visible,sort_order)
        VALUES (?,?,?,?,?,?,?)
      `).bind(
        "schola",
        "Schola",
        "Speculative Fiction",
        "A story of memory, consequence, identity, and what waits beyond the life we know.",
        "Available",
        1,
        1
      ),
      env.DB.prepare(`
        INSERT INTO books
        (id,title,genre,description,status,visible,sort_order)
        VALUES (?,?,?,?,?,?,?)
      `).bind(
        "nothing-to-run-from",
        "Nothing to Run From",
        "Contemporary Romance",
        "A grounded contemporary romance about finding safety in another person without losing yourself along the way.",
        "Available",
        1,
        2
      ),
      env.DB.prepare(`
        INSERT INTO books
        (id,title,genre,description,status,visible,sort_order)
        VALUES (?,?,?,?,?,?,?)
      `).bind(
        "falling-into-nothing",
        "Falling Into Nothing",
        "Contemporary Romance",
        "The next chapter in Remy and Aaron's story.",
        "Coming Soon",
        1,
        3
      )
    ]);
  }
}

async function getSiteData(env, includeHidden = false) {
  await ensureSchema(env);

  const settingsRows = await env.DB.prepare("SELECT key, value FROM settings").all();
  const settings = {};
  for (const row of settingsRows.results || []) settings[row.key] = row.value;

  const query = includeHidden
    ? "SELECT * FROM books ORDER BY sort_order ASC, title ASC"
    : "SELECT * FROM books WHERE visible=1 ORDER BY sort_order ASC, title ASC";

  const booksRows = await env.DB.prepare(query).all();
  return { settings, books: booksRows.results || [] };
}

async function handleApi(request, env, url) {
  const path = url.pathname;

  if (path === "/api/site" && request.method === "GET") {
    return json(await getSiteData(env, false));
  }

  if (path === "/api/login" && request.method === "POST") {
    if (!env.ADMIN_PASSWORD) return json({ error: "ADMIN_PASSWORD secret is not configured." }, 500);
    const body = await request.json().catch(() => ({}));
    if (body.password !== env.ADMIN_PASSWORD) return json({ error: "Incorrect password." }, 401);

    const token = await makeSessionToken(env.ADMIN_PASSWORD);
    return new Response(JSON.stringify({ ok: true }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "set-cookie": `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`
      }
    });
  }

  if (path === "/api/logout" && request.method === "POST") {
    return new Response(JSON.stringify({ ok: true }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "set-cookie": `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
      }
    });
  }

  if (!(await isAuthenticated(request, env))) {
    return json({ error: "Unauthorized" }, 401);
  }

  if (path === "/api/admin/content" && request.method === "GET") {
    return json(await getSiteData(env, true));
  }

  if (path === "/api/admin/settings" && request.method === "POST") {
    await ensureSchema(env);
    const body = await request.json();
    const allowed = [
      "author_name","eyebrow","hero_title","hero_text",
      "about_heading","about_text","updates_heading","updates_text","footer_text"
    ];
    const stmts = [];
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        stmts.push(
          env.DB.prepare(`
            INSERT INTO settings (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value
          `).bind(key, String(body[key] ?? ""))
        );
      }
    }
    if (stmts.length) await env.DB.batch(stmts);
    return json({ ok: true });
  }

  if (path === "/api/admin/books/save" && request.method === "POST") {
    await ensureSchema(env);
    const b = await request.json();

    const id = slugify(b.id || b.title || "");
    if (!id || !String(b.title || "").trim()) return json({ error: "Book title is required." }, 400);

    await env.DB.prepare(`
      INSERT INTO books (
        id,title,subtitle,genre,description,status,cover_key,cover_url,
        paperback_url,ebook_url,apple_url,kobo_url,visible,sort_order
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        title=excluded.title,
        subtitle=excluded.subtitle,
        genre=excluded.genre,
        description=excluded.description,
        status=excluded.status,
        cover_key=excluded.cover_key,
        cover_url=excluded.cover_url,
        paperback_url=excluded.paperback_url,
        ebook_url=excluded.ebook_url,
        apple_url=excluded.apple_url,
        kobo_url=excluded.kobo_url,
        visible=excluded.visible,
        sort_order=excluded.sort_order
    `).bind(
      id,
      String(b.title || "").trim(),
      String(b.subtitle || ""),
      String(b.genre || ""),
      String(b.description || ""),
      String(b.status || "Available"),
      String(b.cover_key || ""),
      String(b.cover_url || ""),
      String(b.paperback_url || ""),
      String(b.ebook_url || ""),
      String(b.apple_url || ""),
      String(b.kobo_url || ""),
      b.visible ? 1 : 0,
      Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : 0
    ).run();

    return json({ ok: true, id });
  }

  if (path === "/api/admin/books/delete" && request.method === "POST") {
    await ensureSchema(env);
    const { id } = await request.json();
    const row = await env.DB.prepare("SELECT cover_key FROM books WHERE id=?").bind(id).first();
    if (row?.cover_key && env.COVERS) {
      await env.COVERS.delete(row.cover_key).catch(() => {});
    }
    await env.DB.prepare("DELETE FROM books WHERE id=?").bind(id).run();
    return json({ ok: true });
  }

  if (path === "/api/admin/books/reorder" && request.method === "POST") {
    await ensureSchema(env);
    const body = await request.json();
    const ids = Array.isArray(body.ids) ? body.ids : [];
    if (ids.length) {
      await env.DB.batch(
        ids.map((id, i) =>
          env.DB.prepare("UPDATE books SET sort_order=? WHERE id=?").bind(i + 1, id)
        )
      );
    }
    return json({ ok: true });
  }

  if (path === "/api/admin/upload-cover" && request.method === "POST") {
    if (!env.COVERS) return json({ error: "R2 binding COVERS is missing." }, 500);

    const form = await request.formData();
    const file = form.get("file");
    const bookId = slugify(form.get("bookId") || "book");

    if (!file || typeof file === "string") return json({ error: "Choose an image first." }, 400);
    if (!String(file.type || "").startsWith("image/")) return json({ error: "Cover must be an image." }, 400);
    if (file.size > 8 * 1024 * 1024) return json({ error: "Cover image must be under 8 MB." }, 400);

    const ext = extensionFor(file.type, file.name);
    const key = `covers/${bookId}-${Date.now()}.${ext}`;

    await env.COVERS.put(key, file.stream(), {
      httpMetadata: {
        contentType: file.type || "image/jpeg",
        cacheControl: "public, max-age=31536000, immutable"
      }
    });

    return json({ ok: true, cover_key: key, url: `/media/${key}` });
  }

  return json({ error: "Not found" }, 404);
}

async function handleMedia(request, env, url) {
  if (!env.COVERS) return new Response("R2 binding missing", { status: 404 });
  const key = decodeURIComponent(url.pathname.replace(/^\/media\//, ""));
  const obj = await env.COVERS.get(key);
  if (!obj) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("cache-control", headers.get("cache-control") || "public, max-age=3600");
  return new Response(obj.body, { headers });
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function extensionFor(type, name = "") {
  const map = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif"
  };
  if (map[type]) return map[type];
  const m = String(name).match(/\.([a-zA-Z0-9]{2,5})$/);
  return m ? m[1].toLowerCase() : "jpg";
}

async function makeSessionToken(password) {
  const exp = Math.floor(Date.now() / 1000) + 2592000;
  const payload = `dc1993:${exp}`;
  const sig = await hmac(password, payload);
  return `${exp}.${sig}`;
}

async function isAuthenticated(request, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const cookie = request.headers.get("cookie") || "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  if (!match) return false;

  const [expStr, sig] = match[1].split(".");
  const exp = Number(expStr);
  if (!exp || Date.now() / 1000 > exp || !sig) return false;

  const expected = await hmac(env.ADMIN_PASSWORD, `dc1993:${exp}`);
  return constantTimeEqual(sig, expected);
}

async function hmac(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const buf = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return bytesToBase64Url(new Uint8Array(buf));
}

function bytesToBase64Url(bytes) {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function html(body) {
  return new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin"
    }
  });
}

function publicPage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#11100f">
<meta name="description" content="Official website of author Dylan Cunningham.">
<title>Dylan Cunningham | Author</title>
<style>
:root{
  --bg:#11100f;--bg2:#181512;--panel:#1c1916;--text:#f2eee9;--muted:#aaa198;
  --accent:#c09b73;--accent2:#76637e;--line:rgba(255,255,255,.10);--max:1180px;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth;background:var(--bg)}
body{margin:0;background:
radial-gradient(circle at 88% 8%,rgba(118,99,126,.16),transparent 28rem),
radial-gradient(circle at 8% 4%,rgba(192,155,115,.10),transparent 24rem),var(--bg);
color:var(--text);font-family:Arial,Helvetica,sans-serif;overflow-x:hidden}
img{display:block;max-width:100%}
a{color:inherit}
.wrap{width:min(var(--max),calc(100% - 36px));margin:auto}
header{height:86px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:13px;text-decoration:none;min-width:0}
.mark{width:40px;height:40px;border:1px solid var(--line);border-radius:50%;display:grid;place-items:center;
font-family:Georgia,serif;color:var(--accent);flex:0 0 auto}
.brand span:last-child{font:600 21px/1 Georgia,serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
nav{display:flex;gap:28px}
nav a{text-decoration:none;color:var(--muted);font-size:14px}
.menu{display:none;background:none;border:1px solid var(--line);color:var(--text);border-radius:50%;width:44px;height:44px;font-size:22px}
.hero{min-height:650px;display:grid;grid-template-columns:minmax(0,1.1fr) minmax(330px,.9fr);gap:56px;align-items:center;padding:70px 0 90px}
.copy,.art{min-width:0}
.eyebrow{color:var(--accent);font-size:12px;font-weight:700;letter-spacing:.22em;margin:0 0 20px}
h1,h2,h3{font-family:Georgia,"Times New Roman",serif}
h1{font-size:clamp(48px,6.4vw,86px);line-height:.98;letter-spacing:-.035em;margin:0;max-width:760px;overflow-wrap:anywhere}
.lead{color:var(--muted);font-size:17px;line-height:1.75;max-width:650px;margin:28px 0 0}
.actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:34px}
.btn{display:inline-flex;justify-content:center;align-items:center;text-decoration:none;border:0;border-radius:999px;padding:15px 22px;font-weight:700;font-size:14px;cursor:pointer}
.primary{background:var(--accent);color:#18130f}.secondary{border:1px solid var(--line);background:rgba(255,255,255,.02)}
.art{min-height:520px;position:relative;display:grid;place-items:center}
.book-fan{position:relative;width:390px;height:460px;max-width:100%}
.fakebook{position:absolute;width:245px;height:370px;border-radius:8px 18px 18px 8px;padding:28px;box-shadow:0 30px 70px rgba(0,0,0,.5);
background:linear-gradient(145deg,#29202d,#140f17);overflow:hidden}
.fakebook:nth-child(1){right:8px;top:8px;transform:rotate(7deg);background:linear-gradient(145deg,#302725,#171413)}
.fakebook:nth-child(2){left:20px;top:75px;transform:rotate(-5deg)}
.fakebook .small{font-size:10px;letter-spacing:.18em}.fakebook .big{position:absolute;left:28px;top:155px;font:700 42px/.9 Georgia,serif}.fakebook .author{position:absolute;left:28px;bottom:30px;font-size:9px;letter-spacing:.18em}
.strip{border-top:1px solid var(--line);border-bottom:1px solid var(--line);min-height:70px;display:flex;align-items:center;justify-content:center;gap:24px;color:var(--muted);font-size:11px;letter-spacing:.15em}
section.main{padding:110px 0}
.sectionhead{max-width:720px;margin-bottom:46px}.sectionhead h2{font-size:clamp(38px,5vw,62px);margin:0 0 16px}.sectionhead p{color:var(--muted);line-height:1.7}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}
.card{background:rgba(255,255,255,.035);border:1px solid var(--line);border-radius:25px;overflow:hidden;min-width:0}
.cover{aspect-ratio:2/3;background:
radial-gradient(circle at 50% 42%,rgba(126,90,147,.72),transparent 24%),
linear-gradient(145deg,#281e2c,#120d15);position:relative;overflow:hidden}
.cover.alt{background:linear-gradient(145deg,#30383d,#131719)}
.cover.warm{background:radial-gradient(circle at 50% 20%,rgba(190,130,85,.3),transparent 28%),linear-gradient(#484247,#171618)}
.cover img{width:100%;height:100%;object-fit:cover}
.coverplaceholder{position:absolute;inset:0;padding:28px;display:flex;align-items:center;justify-content:center;text-align:center;font:700 42px/.9 Georgia,serif}
.info{padding:28px}.genre{color:var(--accent);font-size:10px;font-weight:700;letter-spacing:.16em;text-transform:uppercase}.info h3{font-size:31px;margin:8px 0 12px}.info p{color:var(--muted);line-height:1.65;min-height:80px}
.badge{display:inline-flex;border:1px solid rgba(192,155,115,.35);color:var(--accent);border-radius:999px;padding:10px 13px;font-size:12px;font-weight:700}
.buy{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:20px}.buy a{border:1px solid var(--line);border-radius:12px;padding:11px 12px;text-decoration:none;text-align:center;font-size:12px}.buy a:hover{border-color:rgba(192,155,115,.5)}
.about{display:grid;grid-template-columns:minmax(0,.8fr) minmax(0,1.2fr);gap:60px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:75px 0}.about h2{font-size:clamp(42px,5vw,64px);margin:0}.about p{color:var(--muted);line-height:1.8;white-space:pre-line}
.updates{margin:100px 0;padding:48px;border:1px solid var(--line);border-radius:26px;background:radial-gradient(circle at 85% 20%,rgba(118,99,126,.23),transparent 22rem),var(--panel)}.updates h2{font-size:clamp(36px,4.5vw,56px);margin:0 0 14px}.updates p{color:var(--muted);line-height:1.7;max-width:760px}
footer{border-top:1px solid var(--line);padding:38px 0 48px;color:var(--muted);font-size:13px;display:flex;justify-content:space-between;gap:20px}
.empty{padding:50px;border:1px dashed var(--line);border-radius:20px;color:var(--muted);grid-column:1/-1}
@media(max-width:900px){
  .hero{grid-template-columns:1fr;padding-top:56px;gap:20px}.art{min-height:440px}.grid{grid-template-columns:1fr 1fr}.about{grid-template-columns:1fr}
}
@media(max-width:620px){
  .wrap{width:min(100% - 28px,var(--max))}
  header{height:78px}.brand span:last-child{font-size:20px;max-width:210px}nav{display:none;position:absolute;top:78px;left:14px;right:14px;background:#171411;border:1px solid var(--line);border-radius:16px;padding:18px;z-index:50;flex-direction:column}.menu{display:block}nav.open{display:flex}
  .hero{min-height:auto;padding:54px 0 66px;gap:22px}
  h1{font-size:clamp(44px,13vw,62px);line-height:1.01;letter-spacing:-.04em}
  .lead{font-size:16px;line-height:1.65}
  .actions{display:grid;grid-template-columns:1fr;margin-top:28px}.actions .btn{width:100%}
  .art{min-height:370px}.book-fan{width:310px;height:360px}.fakebook{width:195px;height:300px;padding:22px}.fakebook:nth-child(2){left:16px;top:52px}.fakebook .big{left:22px;top:125px;font-size:34px}.fakebook .author{left:22px;bottom:24px}
  .strip{justify-content:flex-start;overflow:hidden;padding:0 14px;gap:18px;white-space:nowrap;font-size:9px}
  section.main{padding:78px 0}.grid{grid-template-columns:1fr}.info p{min-height:0}
  .about{padding:58px 0;gap:22px}.updates{margin:72px 0;padding:30px 24px}
  .buy{grid-template-columns:1fr}
  footer{flex-direction:column}
}
</style>
</head>
<body>
<div class="wrap">
<header>
<a class="brand" href="#"><span class="mark">DC</span><span id="brandName">Dylan Cunningham</span></a>
<button class="menu" id="menuBtn" aria-label="Open menu">☰</button>
<nav id="nav"><a href="#books">Books</a><a href="#about">About</a><a href="#updates">Updates</a></nav>
</header>

<main>
<section class="hero">
<div class="copy">
<p class="eyebrow" id="eyebrow">FICTION THAT STAYS WITH YOU</p>
<h1 id="heroTitle">Stories about love, loss, memory, and the places we call home.</h1>
<p class="lead" id="heroText"></p>
<div class="actions"><a class="btn primary" href="#books">Explore the books</a><a class="btn secondary" href="#about">About the author</a></div>
</div>
<div class="art" aria-hidden="true">
<div class="book-fan"><div class="fakebook"><div class="small">A NOVEL</div><div class="big">FALLING<br>INTO<br>NOTHING</div><div class="author">DYLAN CUNNINGHAM</div></div><div class="fakebook"><div class="small">A NOVEL</div><div class="big">SCHOLA</div><div class="author">DYLAN CUNNINGHAM</div></div></div>
</div>
</section>
</div>

<div class="strip"><span>CONTEMPORARY FICTION</span><span>•</span><span>LITERARY ROMANCE</span><span>•</span><span>SPECULATIVE FICTION</span></div>

<div class="wrap">
<section class="main" id="books">
<div class="sectionhead"><p class="eyebrow">THE BOOKS</p><h2>Choose your next story.</h2></div>
<div class="grid" id="bookGrid"><div class="empty">Loading books…</div></div>
</section>

<section id="about" class="about">
<div><p class="eyebrow">ABOUT THE AUTHOR</p><h2 id="aboutHeading"></h2></div>
<div><p id="aboutText"></p></div>
</section>

<section id="updates" class="updates"><p class="eyebrow">STAY IN THE LOOP</p><h2 id="updatesHeading"></h2><p id="updatesText"></p></section>

<footer><strong id="footerName"></strong><span>© <span id="year"></span> <span id="footerName2"></span>. <span id="footerText"></span></span></footer>
</div>

<script>
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
const safeUrl=u=>{try{const x=new URL(u,location.origin);return ["http:","https:"].includes(x.protocol)?x.href:""}catch{return ""}};
document.getElementById("year").textContent=new Date().getFullYear();
document.getElementById("menuBtn").onclick=()=>document.getElementById("nav").classList.toggle("open");
document.querySelectorAll("#nav a").forEach(a=>a.onclick=()=>document.getElementById("nav").classList.remove("open"));

function coverMarkup(b,i){
  const src=b.cover_key?"/media/"+encodeURIComponent(b.cover_key).replace(/%2F/g,"/"):safeUrl(b.cover_url);
  if(src) return '<img src="'+esc(src)+'" alt="'+esc(b.title)+' cover">';
  const cls=i%3===1?"alt":i%3===2?"warm":"";
  return '<div class="coverplaceholder">'+esc(b.title)+'</div>';
}
function storeLinks(b){
  const items=[
    ["Paperback",b.paperback_url],["Ebook / Kindle",b.ebook_url],["Apple Books",b.apple_url],["Kobo",b.kobo_url]
  ].filter(x=>safeUrl(x[1]));
  if(!items.length) return '<span class="badge">'+esc(b.status||"Coming Soon")+'</span>';
  return '<div class="buy">'+items.map(x=>'<a target="_blank" rel="noopener" href="'+esc(safeUrl(x[1]))+'">'+esc(x[0])+'</a>').join("")+'</div>';
}
fetch("/api/site").then(r=>r.json()).then(data=>{
  const s=data.settings||{};
  document.title=(s.author_name||"Dylan Cunningham")+" | Author";
  ["brandName","footerName","footerName2"].forEach(id=>document.getElementById(id).textContent=s.author_name||"Dylan Cunningham");
  document.getElementById("eyebrow").textContent=s.eyebrow||"FICTION THAT STAYS WITH YOU";
  document.getElementById("heroTitle").textContent=s.hero_title||"";
  document.getElementById("heroText").textContent=s.hero_text||"";
  document.getElementById("aboutHeading").textContent=s.about_heading||s.author_name||"";
  document.getElementById("aboutText").textContent=s.about_text||"";
  document.getElementById("updatesHeading").textContent=s.updates_heading||"";
  document.getElementById("updatesText").textContent=s.updates_text||"";
  document.getElementById("footerText").textContent=s.footer_text||"";
  const books=data.books||[];
  document.getElementById("bookGrid").innerHTML=books.length?books.map((b,i)=>
    '<article class="card">'+
      '<div class="cover '+(i%3===1?"alt":i%3===2?"warm":"")+'">'+coverMarkup(b,i)+'</div>'+
      '<div class="info"><div class="genre">'+esc(b.genre)+'</div><h3>'+esc(b.title)+'</h3>'+
      (b.subtitle?'<div style="color:var(--muted);margin-top:-7px;margin-bottom:12px">'+esc(b.subtitle)+'</div>':"")+
      '<p>'+esc(b.description)+'</p>'+storeLinks(b)+'</div>'+
    '</article>'
  ).join(""):'<div class="empty">Books will appear here soon.</div>';
}).catch(()=>{document.getElementById("bookGrid").innerHTML='<div class="empty">The book list could not load.</div>'});
</script>
</body></html>`;
}

function loginPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>DC1993 Admin</title><style>
*{box-sizing:border-box}body{margin:0;background:#11100f;color:#f2eee9;font-family:Arial,sans-serif;min-height:100vh;display:grid;place-items:center;padding:20px}
.card{width:min(430px,100%);background:#1c1916;border:1px solid rgba(255,255,255,.1);border-radius:24px;padding:30px}
h1{font-family:Georgia,serif;font-size:40px;margin:0 0 8px}.sub{color:#aaa198;line-height:1.6;margin-bottom:24px}
label{display:block;font-size:13px;margin-bottom:8px}.input{width:100%;padding:14px 15px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:#12100f;color:white;font-size:16px}
button{width:100%;margin-top:14px;padding:14px;border:0;border-radius:999px;background:#c09b73;color:#17120f;font-weight:700;font-size:15px}
#error{color:#ff9b9b;min-height:20px;margin-top:12px;font-size:13px}</style></head>
<body><form class="card" id="f"><h1>Site Admin</h1><div class="sub">Edit dc1993.com without touching code.</div><label for="p">Admin password</label><input class="input" id="p" type="password" autocomplete="current-password" required><button>Sign in</button><div id="error"></div></form>
<script>document.getElementById("f").onsubmit=async e=>{e.preventDefault();const r=await fetch("/api/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({password:document.getElementById("p").value})});if(r.ok){location="/admin"}else{const j=await r.json().catch(()=>({}));document.getElementById("error").textContent=j.error||"Could not sign in."}}</script>
</body></html>`;
}

function adminPage() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>DC1993 Admin</title>
<style>
:root{--bg:#11100f;--panel:#1c1916;--panel2:#24201c;--text:#f2eee9;--muted:#aaa198;--accent:#c09b73;--line:rgba(255,255,255,.11);--danger:#d86c6c}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:Arial,sans-serif}
button,input,textarea,select{font:inherit}.shell{width:min(1100px,calc(100% - 28px));margin:auto;padding-bottom:80px}
.top{position:sticky;top:0;z-index:20;background:rgba(17,16,15,.94);backdrop-filter:blur(12px);display:flex;align-items:center;justify-content:space-between;padding:16px 0;border-bottom:1px solid var(--line)}
.top h1{font:700 25px/1 Georgia,serif;margin:0}.top a{color:var(--accent);text-decoration:none;font-size:13px}.tabs{display:flex;gap:8px;overflow:auto;padding:18px 0 4px}
.tabs button{border:1px solid var(--line);background:transparent;color:var(--muted);border-radius:999px;padding:11px 15px;white-space:nowrap}.tabs button.active{background:var(--accent);color:#17120f;border-color:transparent;font-weight:700}
.panel{display:none;padding-top:24px}.panel.active{display:block}.box{background:var(--panel);border:1px solid var(--line);border-radius:22px;padding:24px;margin-bottom:18px}
h2{font:700 34px/1 Georgia,serif;margin:0 0 8px}.hint{color:var(--muted);line-height:1.55;font-size:14px;margin:0 0 22px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.full{grid-column:1/-1}
label{display:block;font-size:12px;font-weight:700;letter-spacing:.04em;margin:0 0 7px;color:#d7d1cb}
input[type=text],input[type=url],input[type=number],input[type=password],textarea,select{width:100%;border:1px solid var(--line);border-radius:12px;background:#12100f;color:white;padding:13px 14px;outline:none}
textarea{min-height:120px;resize:vertical;line-height:1.5}input:focus,textarea:focus,select:focus{border-color:rgba(192,155,115,.65)}
.actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:18px}.btn{border:0;border-radius:999px;padding:12px 17px;font-weight:700;cursor:pointer}.primary{background:var(--accent);color:#17120f}.secondary{background:transparent;color:var(--text);border:1px solid var(--line)}.danger{background:transparent;color:#ff9a9a;border:1px solid rgba(216,108,108,.35)}
.bookrow{display:grid;grid-template-columns:72px minmax(0,1fr) auto;gap:14px;align-items:center;padding:14px 0;border-bottom:1px solid var(--line)}.bookrow:last-child{border-bottom:0}.thumb{width:72px;height:105px;border-radius:8px;background:#28202d;overflow:hidden;display:grid;place-items:center;font:700 11px Georgia,serif;text-align:center;padding:8px}.thumb img{width:100%;height:100%;object-fit:cover}.bookrow strong{display:block}.bookrow small{display:block;color:var(--muted);margin-top:5px}.rowBtns{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.mini{border:1px solid var(--line);background:transparent;color:var(--text);border-radius:9px;padding:8px 10px;cursor:pointer}
.check{display:flex;align-items:center;gap:8px;margin-top:26px}.check input{width:20px;height:20px}.preview{max-width:170px;border-radius:9px;margin-top:10px}
.toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:#ece5dd;color:#18130f;padding:12px 16px;border-radius:999px;font-weight:700;font-size:13px;opacity:0;pointer-events:none;transition:.2s;z-index:99}.toast.show{opacity:1}
hr{border:0;border-top:1px solid var(--line);margin:24px 0}
@media(max-width:700px){.grid{grid-template-columns:1fr}.full{grid-column:auto}.box{padding:20px 16px}.bookrow{grid-template-columns:58px minmax(0,1fr)}.thumb{width:58px;height:86px}.rowBtns{grid-column:1/-1;justify-content:flex-start}.check{margin-top:0}.top h1{font-size:22px}}
</style></head>
<body><div class="shell">
<div class="top"><h1>dc1993.com Admin</h1><div style="display:flex;gap:14px"><a href="/" target="_blank">View site ↗</a><a href="#" id="logout">Sign out</a></div></div>
<div class="tabs">
<button class="active" data-tab="home">Homepage</button>
<button data-tab="books">Books</button>
<button data-tab="about">About</button>
<button data-tab="updates">Updates</button>
</div>

<section class="panel active" id="home">
<div class="box"><h2>Homepage</h2><p class="hint">Change the main wording visitors see first.</p>
<div class="grid">
<div class="full"><label>Author name</label><input id="author_name" type="text"></div>
<div class="full"><label>Small heading</label><input id="eyebrow" type="text"></div>
<div class="full"><label>Main headline</label><textarea id="hero_title"></textarea></div>
<div class="full"><label>Intro text</label><textarea id="hero_text"></textarea></div>
<div class="full"><label>Footer text</label><input id="footer_text" type="text"></div>
</div><div class="actions"><button class="btn primary" onclick="saveSettings()">Save homepage</button></div></div>
</section>

<section class="panel" id="books">
<div class="box"><h2>Books</h2><p class="hint">Add, edit, hide, reorder, and attach purchase links. Cover uploads go straight to Cloudflare R2.</p>
<div id="bookList"></div><div class="actions"><button class="btn primary" onclick="newBook()">+ Add book</button></div></div>
<div class="box" id="editor" style="display:none"><h2 id="editorTitle">Book</h2><div class="grid">
<input type="hidden" id="b_id">
<div><label>Title</label><input id="b_title" type="text"></div>
<div><label>Subtitle / series line</label><input id="b_subtitle" type="text"></div>
<div><label>Genre</label><input id="b_genre" type="text"></div>
<div><label>Status</label><select id="b_status"><option>Available</option><option>Coming Soon</option><option>Preorder</option><option>Out Now</option></select></div>
<div class="full"><label>Description</label><textarea id="b_description"></textarea></div>
<div><label>Sort order</label><input id="b_sort_order" type="number" min="0"></div>
<div><label>Visible on site</label><div class="check"><input id="b_visible" type="checkbox"><span>Show this book publicly</span></div></div>
<div class="full"><label>Upload cover image</label><input id="b_cover_file" type="file" accept="image/*"><img id="coverPreview" class="preview" style="display:none"><input id="b_cover_key" type="hidden"></div>
<div class="full"><label>Or use an external cover image URL</label><input id="b_cover_url" type="url" placeholder="https://..."></div>
<div><label>Paperback URL</label><input id="b_paperback_url" type="url" placeholder="https://..."></div>
<div><label>Ebook / Kindle URL</label><input id="b_ebook_url" type="url" placeholder="https://..."></div>
<div><label>Apple Books URL</label><input id="b_apple_url" type="url" placeholder="https://..."></div>
<div><label>Kobo URL</label><input id="b_kobo_url" type="url" placeholder="https://..."></div>
</div>
<div class="actions"><button class="btn primary" onclick="saveBook()">Save book</button><button class="btn secondary" onclick="closeEditor()">Cancel</button><button class="btn danger" id="deleteBtn" onclick="deleteBook()">Delete</button></div>
</div>
</section>

<section class="panel" id="about"><div class="box"><h2>About</h2><p class="hint">Edit your author bio whenever you want.</p>
<div class="grid"><div class="full"><label>Heading</label><input id="about_heading" type="text"></div><div class="full"><label>About text</label><textarea id="about_text" style="min-height:230px"></textarea></div></div>
<div class="actions"><button class="btn primary" onclick="saveSettings()">Save about section</button></div></div></section>

<section class="panel" id="updates"><div class="box"><h2>Updates</h2><p class="hint">Control the update/newsletter area on the homepage.</p>
<div class="grid"><div class="full"><label>Heading</label><input id="updates_heading" type="text"></div><div class="full"><label>Text</label><textarea id="updates_text"></textarea></div></div>
<div class="actions"><button class="btn primary" onclick="saveSettings()">Save updates section</button></div></div></section>
</div><div class="toast" id="toast"></div>

<script>
let DATA={settings:{},books:[]}; let editing=null;
const $=id=>document.getElementById(id); const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
document.querySelectorAll(".tabs button").forEach(b=>b.onclick=()=>{document.querySelectorAll(".tabs button").forEach(x=>x.classList.remove("active"));document.querySelectorAll(".panel").forEach(x=>x.classList.remove("active"));b.classList.add("active");$(b.dataset.tab).classList.add("active")});
$("logout").onclick=async e=>{e.preventDefault();await fetch("/api/logout",{method:"POST"});location="/admin"};
function toast(t){const e=$("toast");e.textContent=t;e.classList.add("show");setTimeout(()=>e.classList.remove("show"),1800)}
async function api(path,opt={}){const r=await fetch(path,opt);if(r.status===401){location="/admin";throw new Error("Unauthorized")}const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||"Request failed");return j}
async function load(){DATA=await api("/api/admin/content");fillSettings();renderBooks()}
function fillSettings(){for(const [k,v] of Object.entries(DATA.settings||{})){if($(k))$(k).value=v}}
async function saveSettings(){const ids=["author_name","eyebrow","hero_title","hero_text","about_heading","about_text","updates_heading","updates_text","footer_text"];const body={};ids.forEach(id=>{if($(id))body[id]=$(id).value});await api("/api/admin/settings",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});toast("Saved");await load()}
function coverSrc(b){return b.cover_key?"/media/"+b.cover_key:b.cover_url||""}
function renderBooks(){$("bookList").innerHTML=(DATA.books||[]).map((b,i)=>'<div class="bookrow">'+
'<div class="thumb">'+(coverSrc(b)?'<img src="'+esc(coverSrc(b))+'">':esc(b.title))+'</div>'+
'<div><strong>'+esc(b.title)+'</strong><small>'+esc(b.status)+' · '+(b.visible?"Visible":"Hidden")+'</small></div>'+
'<div class="rowBtns"><button class="mini" onclick="moveBook('+i+',-1)">↑</button><button class="mini" onclick="moveBook('+i+',1)">↓</button><button class="mini" data-book-id="'+esc(b.id)+'" onclick="editBook(this.dataset.bookId)">Edit</button></div></div>').join("")||'<p class="hint">No books yet.</p>'}
async function moveBook(i,d){const arr=[...DATA.books];const j=i+d;if(j<0||j>=arr.length)return;[arr[i],arr[j]]=[arr[j],arr[i]];await api("/api/admin/books/reorder",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({ids:arr.map(x=>x.id)})});await load();toast("Order updated")}
function clearBook(){["b_id","b_title","b_subtitle","b_genre","b_description","b_cover_key","b_cover_url","b_paperback_url","b_ebook_url","b_apple_url","b_kobo_url"].forEach(id=>$(id).value="");$("b_status").value="Available";$("b_sort_order").value=(DATA.books.length+1);$("b_visible").checked=true;$("b_cover_file").value="";$("coverPreview").style.display="none"}
function newBook(){editing=null;clearBook();$("editorTitle").textContent="Add book";$("deleteBtn").style.display="none";$("editor").style.display="block";$("editor").scrollIntoView({behavior:"smooth"})}
function editBook(id){editing=DATA.books.find(x=>x.id===id);if(!editing)return;const map={b_id:"id",b_title:"title",b_subtitle:"subtitle",b_genre:"genre",b_description:"description",b_status:"status",b_sort_order:"sort_order",b_cover_key:"cover_key",b_cover_url:"cover_url",b_paperback_url:"paperback_url",b_ebook_url:"ebook_url",b_apple_url:"apple_url",b_kobo_url:"kobo_url"};for(const [el,k] of Object.entries(map))$(el).value=editing[k]??"";$("b_visible").checked=!!editing.visible;$("b_cover_file").value="";const src=coverSrc(editing);$("coverPreview").src=src;$("coverPreview").style.display=src?"block":"none";$("editorTitle").textContent="Edit "+editing.title;$("deleteBtn").style.display="inline-block";$("editor").style.display="block";$("editor").scrollIntoView({behavior:"smooth"})}
function closeEditor(){$("editor").style.display="none";editing=null}
$("b_cover_file").onchange=()=>{const f=$("b_cover_file").files[0];if(f){$("coverPreview").src=URL.createObjectURL(f);$("coverPreview").style.display="block"}}
async function saveBook(){
 if(!$("b_title").value.trim()){alert("Give the book a title first.");return}
 let coverKey=$("b_cover_key").value;
 const file=$("b_cover_file").files[0];
 if(file){const fd=new FormData();fd.append("file",file);fd.append("bookId",$("b_id").value||$("b_title").value);const up=await api("/api/admin/upload-cover",{method:"POST",body:fd});coverKey=up.cover_key}
 const body={id:$("b_id").value,title:$("b_title").value,subtitle:$("b_subtitle").value,genre:$("b_genre").value,description:$("b_description").value,status:$("b_status").value,sort_order:Number($("b_sort_order").value||0),visible:$("b_visible").checked,cover_key:coverKey,cover_url:$("b_cover_url").value,paperback_url:$("b_paperback_url").value,ebook_url:$("b_ebook_url").value,apple_url:$("b_apple_url").value,kobo_url:$("b_kobo_url").value};
 await api("/api/admin/books/save",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});toast("Book saved");closeEditor();await load()
}
async function deleteBook(){if(!editing)return;if(!confirm("Delete "+editing.title+"?"))return;await api("/api/admin/books/delete",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id:editing.id})});closeEditor();await load();toast("Book deleted")}
load();
</script></body></html>`;
}
