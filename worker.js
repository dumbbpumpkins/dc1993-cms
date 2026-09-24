// Deployment refresh: Hot Guys dashboard + read/write Orbismo integration.
const COOKIE_NAME = "dc1993_admin";

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (url.pathname.startsWith("/api/")) {
        return handleApi(request, env, url);
      }

      if (url.pathname === "/favicon.svg") {
        return new Response(faviconSvg(), {
          headers: {
            "content-type": "image/svg+xml; charset=utf-8",
            "cache-control": "public, max-age=86400"
          }
        });
      }

      if (url.pathname.startsWith("/media/")) {
        return handleMedia(request, env, url);
      }

      if (url.pathname === "/story-bible" || url.pathname === "/story-bible/") {
        const authed = await isAuthenticated(request, env);
        return privateHtml(authed ? storyBiblePage() : loginPage("/story-bible"));
      }

      if (url.pathname === "/hot-guys" || url.pathname === "/hot-guys/") {
        const authed = await isAuthenticated(request, env);
        return privateHtml(authed ? hotGuysPage() : loginPage("/hot-guys"));
      }

      if (url.pathname === "/admin" || url.pathname === "/admin/") {
        const authed = await isAuthenticated(request, env);
        return privateHtml(authed ? adminPage() : loginPage("/admin"));
      }

      return html(publicPage(url.pathname));
    } catch (err) {
      return new Response("Server error: " + (err?.message || String(err)), { status: 500 });
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(Promise.allSettled([
      syncStoryBible(env),
      env.ORBISMO_HOT_GUYS_API_KEY ? syncHotGuys(env) : Promise.resolve()
    ]));
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
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS story_bible_cache (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        snapshot_json TEXT NOT NULL DEFAULT '{}',
        synced_at TEXT NOT NULL DEFAULT '',
        sync_status TEXT NOT NULL DEFAULT 'never',
        sync_error TEXT NOT NULL DEFAULT '',
        content_hash TEXT NOT NULL DEFAULT ''
      )
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS hot_guys_cache (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        snapshot_json TEXT NOT NULL DEFAULT '{}',
        synced_at TEXT NOT NULL DEFAULT '',
        sync_status TEXT NOT NULL DEFAULT 'never',
        sync_error TEXT NOT NULL DEFAULT '',
        content_hash TEXT NOT NULL DEFAULT ''
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
      home_books_eyebrow: "BOOKS",
      home_books_heading: "Stories that stay with you.",
      home_books_text: "Browse published novels and upcoming releases.",
      home_projects_eyebrow: "PROJECTS",
      home_projects_heading: "Beyond the books.",
      home_projects_text: "Explore The Remnant Suite and Witness Systems.",
      home_about_eyebrow: "ABOUT",
      home_about_heading: "Meet the author.",
      home_about_text: "Writing, software, systems, and probably a cat nearby.",
      home_books_button: "Explore the books",
      home_books_button_url: "/books",
      home_books_button_visible: "1",
      home_projects_button: "See my projects",
      home_projects_button_url: "/projects",
      home_projects_button_visible: "1",
      nav_home: "Home",
      nav_books: "Books",
      nav_projects: "Projects",
      nav_about: "About",
      contact_email: "dcunn1993@gmail.com",
      footer_contact_label: "Contact",
      footer_admin_label: "Admin",
      social_links: "",
      books_eyebrow: "THE BOOKS",
      books_heading: "Choose your next story.",
      books_text: "Current releases and upcoming novels from Dylan Cunningham.",
      about_eyebrow: "ABOUT THE AUTHOR",
      about_heading: "Dylan Cunningham",
      about_text: "Dylan Cunningham writes character-driven fiction centered on people under pressure, the relationships that hold them together, and the emotional consequences that follow them home.",
      projects_eyebrow: "PROJECTS",
      projects_heading: "Beyond the books",
      projects_text: "Independent technical projects built around the same thing I enjoy most: understanding complicated systems and making them work better.",
      remnant_eyebrow: "DESKTOP SOFTWARE",
      remnant_eyebrow: "DESKTOP SOFTWARE",
      remnant_title: "The Remnant Suite",
      remnant_image_key: "",
      remnant_text: "A Windows desktop application for large-scale digital media preservation and organization. I lead the product design, workflow development, quality assurance, testing, and technical systems behind the project, including databases, metadata, duplicate detection, recognition workflows, and audit logging.",
      remnant_skills: "",
      witness_eyebrow: "SYSTEMS & IOT",
      witness_eyebrow: "SYSTEMS & IOT",
      witness_title: "Witness Systems",
      witness_image_key: "",
      witness_text: "An independent IoT and security systems project focused on connecting hardware, software, networking, and device management into practical monitoring solutions. The work includes systems integration, troubleshooting, configuration, and extending the capabilities of commercial hardware.",
      witness_skills: "",
      updates_eyebrow: "STAY IN THE LOOP",
      updates_heading: "New books. Release dates. No noise.",
      updates_text: "Follow along for new releases, project updates, and publication news.",
      instagram_heading: "Latest from Instagram",
      instagram_post_url_1: "",
      instagram_post_url_2: "",
      instagram_post_url_3: "",
      instagram_post_url_4: "",
      footer_text: "All rights reserved."
    };

    await env.DB.batch(
      Object.entries(defaults).map(([key, value]) =>
        env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").bind(key, value)
      )
    );
  } else {
    const projectDefaults = {
      home_books_eyebrow: "BOOKS",
      home_books_heading: "Stories that stay with you.",
      home_books_text: "Browse published novels and upcoming releases.",
      home_projects_eyebrow: "PROJECTS",
      home_projects_heading: "Beyond the books.",
      home_projects_text: "Explore The Remnant Suite and Witness Systems.",
      home_about_eyebrow: "ABOUT",
      home_about_heading: "Meet the author.",
      home_about_text: "Writing, software, systems, and probably a cat nearby.",
      home_books_button: "Explore the books",
      home_books_button_url: "/books",
      home_books_button_visible: "1",
      home_projects_button: "See my projects",
      home_projects_button_url: "/projects",
      home_projects_button_visible: "1",
      nav_home: "Home",
      nav_books: "Books",
      nav_projects: "Projects",
      nav_about: "About",
      contact_email: "dcunn1993@gmail.com",
      footer_contact_label: "Contact",
      footer_admin_label: "Admin",
      social_links: "",
      books_eyebrow: "THE BOOKS",
      books_heading: "Choose your next story.",
      books_text: "Current releases and upcoming novels from Dylan Cunningham.",
      about_eyebrow: "ABOUT THE AUTHOR",
      updates_eyebrow: "STAY IN THE LOOP",
      instagram_heading: "Latest from Instagram",
      instagram_post_url_1: "",
      instagram_post_url_2: "",
      instagram_post_url_3: "",
      instagram_post_url_4: "",
      projects_eyebrow: "PROJECTS",
      projects_heading: "Beyond the books",
      projects_text: "Independent technical projects built around the same thing I enjoy most: understanding complicated systems and making them work better.",
      remnant_title: "The Remnant Suite",
      remnant_image_key: "",
      remnant_text: "A Windows desktop application for large-scale digital media preservation and organization. I lead the product design, workflow development, quality assurance, testing, and technical systems behind the project, including databases, metadata, duplicate detection, recognition workflows, and audit logging.",
      remnant_skills: "",
      witness_title: "Witness Systems",
      witness_image_key: "",
      witness_text: "An independent IoT and security systems project focused on connecting hardware, software, networking, and device management into practical monitoring solutions. The work includes systems integration, troubleshooting, configuration, and extending the capabilities of commercial hardware.",
      witness_skills: ""
    };
    await env.DB.batch(
      Object.entries(projectDefaults).map(([key, value]) =>
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

async function getInstagramPosts(env) {
  const userId = String(env.INSTAGRAM_USER_ID || "").trim();
  const token = String(env.INSTAGRAM_ACCESS_TOKEN || "").trim();
  if (!userId || !token) return [];

  try {
    const api = new URL("https://graph.facebook.com/v26.0/" + encodeURIComponent(userId) + "/media");
    api.searchParams.set("fields", "id,permalink,timestamp,media_type,media_url,thumbnail_url,caption");
    api.searchParams.set("limit", "12");

    const res = await fetch(api.toString(), {
      headers: { authorization: "Bearer " + token }
    });
    if (!res.ok) return [];

    const body = await res.json().catch(() => ({}));
    return Array.isArray(body.data)
      ? body.data.filter(x => x && typeof x.permalink === "string" && x.permalink.includes("instagram.com/"))
      : [];
  } catch {
    return [];
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
  const instagramPosts = includeHidden ? [] : await getInstagramPosts(env);
  return { settings, books: booksRows.results || [], instagram_posts: instagramPosts };
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

  if (path === "/api/story-bible" && request.method === "GET") {
    let cache = await getStoryBibleCache(env);
    const last = Date.parse(cache.synced_at || "");
    const stale = !cache.snapshot || !Number.isFinite(last) || (Date.now() - last) > 65000;

    if (stale && env.ORBISMO_API_KEY) {
      try {
        await syncStoryBible(env);
        cache = await getStoryBibleCache(env);
      } catch (err) {
        cache = {
          ...(await getStoryBibleCache(env)),
          status: "error",
          error: err?.message || String(err)
        };
      }
    }

    return privateJson(cache);
  }

  if (path === "/api/story-bible/sync" && request.method === "POST") {
    try {
      await syncStoryBible(env);
      return privateJson(await getStoryBibleCache(env));
    } catch (err) {
      return privateJson({
        ...(await getStoryBibleCache(env)),
        error: err?.message || String(err)
      }, 502);
    }
  }

  if (path === "/api/hot-guys" && request.method === "GET") {
    let cache = await getHotGuysCache(env);
    const last = Date.parse(cache.synced_at || "");
    const stale = !cache.snapshot || !Number.isFinite(last) || (Date.now() - last) > 65000;
    if (stale && env.ORBISMO_HOT_GUYS_API_KEY) {
      try {
        await syncHotGuys(env);
        cache = await getHotGuysCache(env);
      } catch (err) {
        cache = { ...(await getHotGuysCache(env)), status: "error", error: err?.message || String(err) };
      }
    }
    return privateJson(cache);
  }

  if (path === "/api/hot-guys/sync" && request.method === "POST") {
    try {
      await syncHotGuys(env);
      return privateJson(await getHotGuysCache(env));
    } catch (err) {
      return privateJson({ ...(await getHotGuysCache(env)), error: err?.message || String(err) }, 502);
    }
  }

  if (path === "/api/hot-guys/person/create" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const name = String(body.name || "").trim();
    if (!name) return privateJson({ error: "Name is required." }, 400);
    const session = await openHotGuysSession(env);
    const found = await hotGuysTool(session, env, "search_entities", { query: name, entity_type: "person", view: "compact", limit: 20 });
    const duplicate = (found.results || []).find(x => String(x.name || "").trim().toLowerCase() === name.toLowerCase());
    if (duplicate) return privateJson({ error: "A person with that name already exists.", entity_id: duplicate.entity_id }, 409);
    const props = cleanHotGuysProperties(body.properties || {});
    props.person_type = "human";
    const created = await hotGuysTool(session, env, "create_entities", {
      entities: [{ entity_type: "person", name, description: String(body.description || "").trim(), properties: props, tags: ["hot-guy"] }],
      skip_existing: true
    });
    const entityId = created.created?.[0]?.entity_id;
    if (!entityId) return privateJson({ error: "Orbismo did not create the person." }, 502);
    await hotGuysTool(session, env, "create_relationships", {
      relationships: [{ source_id: entityId, target_id: "group/the_roster", relationship_type: "MEMBER_OF", properties: { role: "roster entry" } }],
      skip_duplicates: true
    });
    await syncHotGuys(env);
    return privateJson({ ok: true, entity_id: entityId, cache: await getHotGuysCache(env) });
  }

  if (path === "/api/hot-guys/person/update" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const entityId = String(body.entity_id || "");
    if (!entityId.startsWith("person/")) return privateJson({ error: "Invalid person." }, 400);
    const updates = {
      name: String(body.name || "").trim(),
      description: String(body.description || "").trim(),
      properties: cleanHotGuysProperties(body.properties || {})
    };
    if (!updates.name) delete updates.name;
    const session = await openHotGuysSession(env);
    await hotGuysTool(session, env, "update_entity", { entity_id: entityId, updates, merge_mode: "merge" });
    await syncHotGuys(env);
    return privateJson({ ok: true, cache: await getHotGuysCache(env) });
  }

  if (path === "/api/hot-guys/lore/save" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const entityId = String(body.entity_id || "");
    const loreId = String(body.lore_id || "");
    const title = String(body.title || "").trim();
    const content = String(body.content || "").trim();
    if (!entityId.startsWith("person/") || !title || !content) return privateJson({ error: "Person, title, and note are required." }, 400);
    const session = await openHotGuysSession(env);
    if (loreId) {
      await hotGuysTool(session, env, "update_entity_lore", { entity_id: entityId, lore_id: loreId, title, content });
    } else {
      await hotGuysTool(session, env, "create_entity_lore", { entity_id: entityId, title, content });
    }
    await syncHotGuys(env);
    return privateJson({ ok: true, cache: await getHotGuysCache(env) });
  }

  if (path === "/api/hot-guys/lore/delete" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const entityId = String(body.entity_id || "");
    const loreId = String(body.lore_id || "");
    if (!entityId.startsWith("person/") || !loreId) return privateJson({ error: "Invalid lore note." }, 400);
    const session = await openHotGuysSession(env);
    await hotGuysTool(session, env, "delete_entity_lore", { entity_id: entityId, lore_id: loreId });
    await syncHotGuys(env);
    return privateJson({ ok: true, cache: await getHotGuysCache(env) });
  }

  if (path === "/api/admin/content" && request.method === "GET") {
    return json(await getSiteData(env, true));
  }

  if (path === "/api/admin/settings" && request.method === "POST") {
    await ensureSchema(env);
    const body = await request.json();
    const allowed = [
      "author_name","eyebrow","hero_title","hero_text",
      "home_books_eyebrow","home_books_heading","home_books_text",
      "home_projects_eyebrow","home_projects_heading","home_projects_text",
      "home_about_eyebrow","home_about_heading","home_about_text",
      "home_books_button","home_books_button_url","home_books_button_visible","home_projects_button","home_projects_button_url","home_projects_button_visible",
      "nav_home","nav_books","nav_projects","nav_about","contact_email","footer_contact_label","footer_admin_label","social_links",
      "books_eyebrow","books_heading","books_text",
      "about_eyebrow","about_heading","about_text","author_photo_key",
      "projects_eyebrow","projects_heading","projects_text","remnant_eyebrow","remnant_title","remnant_image_key","remnant_text","remnant_skills","witness_eyebrow","witness_title","witness_image_key","witness_text","witness_skills",
      "updates_eyebrow","updates_heading","updates_text","instagram_heading","instagram_post_url_1","instagram_post_url_2","instagram_post_url_3","instagram_post_url_4","footer_text"
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

  if (path === "/api/admin/upload-author-photo" && request.method === "POST") {
    if (!env.COVERS) return json({ error: "R2 binding COVERS is missing." }, 500);

    const form = await request.formData();
    const file = form.get("file");
    const oldKey = String(form.get("oldKey") || "");

    if (!file || typeof file === "string") return json({ error: "Choose an image first." }, 400);
    if (!String(file.type || "").startsWith("image/")) return json({ error: "Author photo must be an image." }, 400);
    if (file.size > 8 * 1024 * 1024) return json({ error: "Author photo must be under 8 MB." }, 400);

    const ext = extensionFor(file.type, file.name);
    const key = `author/profile-${Date.now()}.${ext}`;

    await env.COVERS.put(key, file.stream(), {
      httpMetadata: {
        contentType: file.type || "image/jpeg",
        cacheControl: "public, max-age=31536000, immutable"
      }
    });

    if (oldKey.startsWith("author/") && oldKey !== key) {
      await env.COVERS.delete(oldKey).catch(() => {});
    }

    return json({ ok: true, photo_key: key, url: `/media/${key}` });
  }

  if (path === "/api/admin/upload-project-image" && request.method === "POST") {
    if (!env.COVERS) return json({ error: "R2 binding COVERS is missing." }, 500);

    const form = await request.formData();
    const file = form.get("file");
    const project = slugify(form.get("project") || "project");
    const oldKey = String(form.get("oldKey") || "");

    if (!file || typeof file === "string") return json({ error: "Choose an image first." }, 400);
    if (!String(file.type || "").startsWith("image/")) return json({ error: "Project image must be an image." }, 400);
    if (file.size > 8 * 1024 * 1024) return json({ error: "Project image must be under 8 MB." }, 400);

    const ext = extensionFor(file.type, file.name);
    const key = `projects/${project}-${Date.now()}.${ext}`;

    await env.COVERS.put(key, file.stream(), {
      httpMetadata: {
        contentType: file.type || "image/jpeg",
        cacheControl: "public, max-age=31536000, immutable"
      }
    });

    if (oldKey.startsWith("projects/") && oldKey !== key) {
      await env.COVERS.delete(oldKey).catch(() => {});
    }

    return json({ ok: true, image_key: key, url: `/media/${key}` });
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

function privateHtml(body) {
  return new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, private",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "x-frame-options": "DENY"
    }
  });
}

function privateJson(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, private",
      "x-content-type-options": "nosniff"
    }
  });
}

function faviconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">\n  <rect width="64" height="64" rx="16" fill="#11100f"/>\n  <circle cx="32" cy="32" r="24" fill="none" stroke="#3a342f" stroke-width="2"/>\n  <text x="32" y="40" text-anchor="middle" font-family="Georgia,serif" font-size="25" fill="#c09b73">DC</text>\n</svg>`;
}

function publicPage(pathname = "/") {
  const route = ["/", "/books", "/projects", "/about"].includes(pathname) ? pathname : "/";
  const pageTitle = route === "/books" ? "Books" : route === "/projects" ? "Projects" : route === "/about" ? "About" : "Home";
  const body = route === "/books" ? `
<section class="page-hero compact"><p class="eyebrow" id="booksEyebrow">THE BOOKS</p><h1 id="booksHeading">Choose your next story.</h1><p class="lead" id="booksText">Current releases and upcoming novels from Dylan Cunningham.</p></section>
<section class="main"><div class="grid" id="bookGrid"><div class="empty">Loading books…</div></div></section>` : route === "/projects" ? `
<section class="page-hero compact"><p class="eyebrow" id="projectsEyebrow">PROJECTS</p><h1 id="projectsHeading">Beyond the books</h1><p class="lead" id="projectsText"></p></section>
<section class="project-page-grid">
<article class="project-card large"><div class="project-image" id="remnantImageWrap"><img id="remnantImage" alt="The Remnant Suite project image"></div><div class="project-copy"><p class="eyebrow" id="remnantEyebrow">DESKTOP SOFTWARE</p><h2 id="remnantTitle"></h2><p id="remnantText"></p><div class="skill-tags" id="remnantSkills"></div></div></article>
<article class="project-card large"><div class="project-image" id="witnessImageWrap"><img id="witnessImage" alt="Witness Systems project image"></div><div class="project-copy"><p class="eyebrow" id="witnessEyebrow">SYSTEMS &amp; IOT</p><h2 id="witnessTitle"></h2><p id="witnessText"></p><div class="skill-tags" id="witnessSkills"></div></div></article>
</section>` : route === "/about" ? `
<section class="about-page"><div class="about-profile"><p class="eyebrow" id="aboutEyebrow">ABOUT THE AUTHOR</p><div class="about-identity"><div class="author-photo-wrap" id="authorPhotoWrap"><img class="author-photo" id="aboutPhoto" alt="Author photo"></div><h1 id="aboutHeading"></h1></div></div><div class="about-copy"><p id="aboutText"></p></div></section>` : `
<section class="hero home-hero"><div class="copy"><p class="eyebrow" id="eyebrow">FICTION THAT STAYS WITH YOU</p><h1 id="heroTitle">Stories about love, loss, memory, and the places we call home.</h1><p class="lead" id="heroText"></p><div class="actions"><a class="btn primary" id="homeBooksButton" href="/books">Explore the books</a><a class="btn secondary" id="homeProjectsButton" href="/projects">See my projects</a></div></div><div class="art" aria-hidden="true"><div class="book-fan" id="heroBooks"><div class="fakebook"><div class="small">A NOVEL</div><div class="big">FALLING<br>INTO<br>NOTHING</div><div class="author">DYLAN CUNNINGHAM</div></div><div class="fakebook"><div class="small">A NOVEL</div><div class="big">SCHOLA</div><div class="author">DYLAN CUNNINGHAM</div></div></div></div></section>
<section class="home-feature">
  <div class="home-feature-copy">
    <span class="eyebrow" id="homeBooksEyebrow">BOOKS</span>
    <h2 id="homeBooksHeading">Stories that stay with you.</h2>
    <p id="homeBooksText">Browse published novels and upcoming releases.</p>
    <a class="text-link" href="/books">Browse all books <span aria-hidden="true">→</span></a>
  </div>
  <div class="home-shelf" id="homeShelf" aria-label="Featured books"></div>
</section>
<section class="home-paths" aria-label="Explore more">
  <a class="home-path" href="/projects">
    <span class="eyebrow" id="homeProjectsEyebrow">PROJECTS</span>
    <div><h2 id="homeProjectsHeading">Beyond the books.</h2><p id="homeProjectsText">Explore The Remnant Suite and Witness Systems.</p></div>
    <span class="home-path-arrow" aria-hidden="true">↗</span>
  </a>
  <a class="home-path" href="/about">
    <span class="eyebrow" id="homeAboutEyebrow">ABOUT</span>
    <div><h2 id="homeAboutHeading">Meet the author.</h2><p id="homeAboutText">Writing, software, systems, and probably a cat nearby.</p></div>
    <span class="home-path-arrow" aria-hidden="true">↗</span>
  </a>
</section>
<section class="updates"><p class="eyebrow" id="updatesEyebrow">STAY IN THE LOOP</p><h2 id="updatesHeading"></h2><p id="updatesText"></p></section>
`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#11100f"><meta name="description" content="Official website of author and developer Dylan Cunningham."><link rel="icon" href="/favicon.svg" type="image/svg+xml"><title>${pageTitle} | Dylan Cunningham</title>
<style>
:root{--bg:#11100f;--panel:#1c1916;--text:#f2eee9;--muted:#aaa198;--accent:#c09b73;--accent2:#76637e;--line:rgba(255,255,255,.10);--max:1180px}
*{box-sizing:border-box}html{scroll-behavior:smooth;background:var(--bg)}body{margin:0;background:radial-gradient(circle at 88% 8%,rgba(118,99,126,.16),transparent 28rem),radial-gradient(circle at 8% 4%,rgba(192,155,115,.10),transparent 24rem),var(--bg);color:var(--text);font-family:Arial,Helvetica,sans-serif;overflow-x:hidden}img{display:block;max-width:100%}a{color:inherit}.wrap{width:min(var(--max),calc(100% - 36px));margin:auto}
header{height:86px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line)}.brand{display:flex;align-items:center;gap:13px;text-decoration:none;min-width:0}.mark{width:40px;height:40px;border:1px solid var(--line);border-radius:50%;display:grid;place-items:center;font-family:Georgia,serif;color:var(--accent);flex:0 0 auto}.brand span:last-child{font:600 21px/1 Georgia,serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}nav{display:flex;gap:28px;align-items:center}nav a{text-decoration:none;color:var(--muted);font-size:14px}nav a.active{color:var(--text)}.header-socials{display:flex;flex-direction:column;align-items:flex-start;gap:4px;margin-left:2px;padding-left:20px;border-left:1px solid var(--line)}.follow-label{color:var(--muted);font-size:9px;font-weight:700;letter-spacing:.18em;text-transform:uppercase}.header-social-links{display:flex;align-items:center;gap:14px}.header-socials a{color:var(--accent);font-size:12px;letter-spacing:.04em}.menu{display:none;background:none;border:1px solid var(--line);color:var(--text);border-radius:50%;width:44px;height:44px;font-size:22px}
.eyebrow{color:var(--accent);font-size:12px;font-weight:700;letter-spacing:.22em;margin:0 0 20px}h1,h2,h3{font-family:Georgia,"Times New Roman",serif}h1{font-size:clamp(48px,6.4vw,86px);line-height:.98;letter-spacing:-.035em;margin:0;max-width:800px}.lead{color:var(--muted);font-size:17px;line-height:1.75;max-width:700px;margin:28px 0 0}#projectsText{max-width:none}
.hero{min-height:650px;display:grid;grid-template-columns:minmax(0,1.1fr) minmax(330px,.9fr);gap:56px;align-items:center;padding:70px 0 90px}.copy,.art{min-width:0}.actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:34px}.btn{display:inline-flex;justify-content:center;align-items:center;text-decoration:none;border:0;border-radius:999px;padding:15px 22px;font-weight:700;font-size:14px}.primary{background:var(--accent);color:#18130f}.secondary{border:1px solid var(--line);background:rgba(255,255,255,.02)}.art{min-height:520px;position:relative;display:grid;place-items:center}.book-fan{position:relative;width:390px;height:460px;max-width:100%}.fakebook{position:absolute;width:245px;height:370px;border-radius:8px 18px 18px 8px;padding:28px;box-shadow:0 30px 70px rgba(0,0,0,.5);background:linear-gradient(145deg,#29202d,#140f17);overflow:hidden}.fakebook:nth-child(1){right:8px;top:8px;transform:rotate(7deg);background:linear-gradient(145deg,#302725,#171413)}.fakebook:nth-child(2){left:20px;top:75px;transform:rotate(-5deg)}.fakebook .small{font-size:10px;letter-spacing:.18em}.fakebook .big{position:absolute;left:28px;top:155px;font:700 42px/.9 Georgia,serif}.fakebook .author{position:absolute;left:28px;bottom:30px;font-size:9px;letter-spacing:.18em}.hero-cover{position:absolute;width:245px;height:370px;object-fit:cover;border-radius:8px 18px 18px 8px;box-shadow:0 30px 70px rgba(0,0,0,.5)}.hero-cover:nth-child(1){right:8px;top:8px;transform:rotate(7deg)}.hero-cover:nth-child(2){left:20px;top:75px;transform:rotate(-5deg)}
.page-hero{padding:92px 0 48px}.page-hero.compact h1{font-size:clamp(46px,6vw,74px)}.main{padding:28px 0 100px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}.card{background:rgba(255,255,255,.035);border:1px solid var(--line);border-radius:25px;overflow:hidden}.cover{aspect-ratio:2/3;background:radial-gradient(circle at 50% 42%,rgba(126,90,147,.72),transparent 24%),linear-gradient(145deg,#281e2c,#120d15);position:relative;overflow:hidden}.cover.alt{background:linear-gradient(145deg,#30383d,#131719)}.cover.warm{background:radial-gradient(circle at 50% 20%,rgba(190,130,85,.3),transparent 28%),linear-gradient(#484247,#171618)}.cover img{width:100%;height:100%;object-fit:cover}.coverplaceholder{position:absolute;inset:0;padding:28px;display:flex;align-items:center;justify-content:center;text-align:center;font:700 42px/.9 Georgia,serif}.info{padding:28px}.genre{color:var(--accent);font-size:10px;font-weight:700;letter-spacing:.16em;text-transform:uppercase}.info h3{font-size:31px;margin:8px 0 12px}.info p{color:var(--muted);line-height:1.65;min-height:80px}.badge{display:inline-flex;border:1px solid rgba(192,155,115,.35);color:var(--accent);border-radius:999px;padding:10px 13px;font-size:12px;font-weight:700}.buy{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:20px}.buy a{border:1px solid var(--line);border-radius:12px;padding:11px 12px;text-decoration:none;text-align:center;font-size:12px}.empty{padding:50px;border:1px dashed var(--line);border-radius:20px;color:var(--muted);grid-column:1/-1}
.home-links{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px;padding:10px 0 30px}.home-links a{display:block;text-decoration:none;border:1px solid var(--line);border-radius:24px;padding:30px;background:rgba(255,255,255,.025)}.home-links h2{font-size:30px;margin:4px 0 12px}.home-links p{color:var(--muted);line-height:1.6;margin:0}.updates{margin:70px 0 36px;padding:48px;border:1px solid var(--line);border-radius:26px;background:radial-gradient(circle at 85% 20%,rgba(118,99,126,.23),transparent 22rem),var(--panel)}.updates h2{font-size:clamp(36px,4.5vw,56px);margin:0 0 14px}.updates p{color:var(--muted);line-height:1.7;max-width:760px}@media(max-width:620px){.instagram-card{border-radius:12px}.instagram-card img{aspect-ratio:auto;max-height:none;object-fit:contain;background:#000}}
.project-page-grid{display:grid;gap:28px;padding:10px 0 100px}.project-card.large{display:grid;grid-template-columns:minmax(300px,.9fr) minmax(0,1.1fr);border:1px solid var(--line);border-radius:26px;overflow:hidden;background:rgba(255,255,255,.03)}.project-image{min-height:360px;background:linear-gradient(145deg,#25201d,#151312);display:grid;place-items:center}.project-image img{width:100%;height:100%;object-fit:cover;min-height:360px}.project-copy{padding:44px;min-width:0}.project-copy h2{font-size:clamp(36px,4vw,52px);margin:0 0 18px;overflow-wrap:anywhere}.project-copy>p:not(.eyebrow){color:var(--muted);line-height:1.75;white-space:pre-line;margin:0}.skill-tags{display:flex;flex-wrap:wrap;gap:9px;margin-top:22px}.skill-tag{border:1px solid var(--line);border-radius:12px;padding:10px 12px;font-size:12px;line-height:1.2;color:var(--text);background:rgba(255,255,255,.015)}.skill-tags:empty{display:none}.project-image:has(img[src=""]){display:none}.project-card.large:has(.project-image img[src=""]){grid-template-columns:1fr}
.about-page{display:grid;grid-template-columns:minmax(0,.8fr) minmax(0,1.2fr);gap:60px;padding:100px 0 120px;align-items:start}.about-profile,.about-copy,.about-identity{min-width:0}.about-identity{display:flex;align-items:center;gap:24px}.author-photo-wrap{display:none;flex:0 0 auto}.author-photo{width:150px;height:150px;object-fit:cover;border-radius:50%;border:1px solid var(--line);box-shadow:0 18px 45px rgba(0,0,0,.28)}.about-page h1{font-size:clamp(42px,5vw,64px);max-width:100%;overflow-wrap:anywhere}.about-copy p{color:var(--muted);line-height:1.82;white-space:pre-line;font-size:17px;margin:42px 0 0}
footer{border-top:1px solid var(--line);padding:38px 0 48px;color:var(--muted);font-size:13px;display:flex;justify-content:space-between;gap:20px;align-items:flex-end}.footer-right{display:flex;flex-direction:column;align-items:flex-end;gap:10px;text-align:right}.footer-links{display:flex;gap:14px}.admin-link{font-size:10px;color:rgba(170,161,152,.52);text-decoration:none;letter-spacing:.10em;text-transform:uppercase}
@media(max-width:900px){.hero{grid-template-columns:1fr;padding-top:56px;gap:20px}.art{min-height:440px}.grid{grid-template-columns:1fr 1fr}.home-links{grid-template-columns:1fr}.page-hero.compact h1{font-size:clamp(40px,7.5vw,60px)}.project-card.large{grid-template-columns:1fr}.project-copy h2{font-size:clamp(34px,6.5vw,46px)}.about-page{grid-template-columns:1fr;gap:20px}.about-page h1{font-size:clamp(38px,6.5vw,52px)}}
@media(max-width:620px){.wrap{width:min(100% - 28px,var(--max))}header{height:78px}.brand span:last-child{font-size:20px;max-width:210px}nav{display:none;position:absolute;top:78px;left:14px;right:14px;background:#171411;border:1px solid var(--line);border-radius:16px;padding:18px;z-index:50;flex-direction:column;align-items:stretch;gap:0}nav>a{padding:12px 2px}.header-socials{display:flex;flex-direction:column;align-items:stretch;gap:0;margin:10px 0 0;padding:14px 0 0;border-left:0;border-top:1px solid var(--line)}.follow-label{padding:2px 2px 7px;font-size:10px}.header-social-links{display:flex;flex-direction:column;align-items:stretch;gap:0}.header-socials a{padding:12px 2px;font-size:14px}.menu{display:block}nav.open{display:flex}.hero{min-height:auto;padding:54px 0 66px;gap:22px}h1{font-size:clamp(36px,10.2vw,48px);line-height:1.02}.lead{font-size:16px}.actions{display:grid;grid-template-columns:1fr}.actions .btn{width:100%}.art{min-height:370px}.book-fan{width:310px;height:360px}.fakebook,.hero-cover{width:195px;height:300px}.fakebook:nth-child(2),.hero-cover:nth-child(2){left:16px;top:52px}.fakebook .big{left:22px;top:125px;font-size:34px}.fakebook .author{left:22px;bottom:24px}.grid{grid-template-columns:1fr}.info h3{font-size:27px;line-height:1.06}.info p{min-height:0}.buy{grid-template-columns:repeat(2,minmax(0,1fr))}.buy a{padding:11px 8px}.page-hero{padding:66px 0 34px}.page-hero.compact h1{font-size:clamp(36px,10vw,46px)}.home-links h2{font-size:28px}.project-copy{padding:28px 22px}.project-copy h2{font-size:clamp(34px,9vw,43px);line-height:1.04}.project-image,.project-image img{min-height:230px}.about-page{padding:68px 0 90px}.about-identity{display:grid;grid-template-columns:104px minmax(0,1fr);gap:16px}.author-photo{width:104px;height:104px}.about-page h1{font-size:clamp(32px,8.8vw,41px);line-height:1.02}.about-copy p{margin-top:20px}.updates{margin:52px 0 28px;padding:30px 24px}.updates h2{font-size:clamp(32px,9vw,44px)}.instagram-feature{margin:0 0 76px;padding:24px 14px}.instagram-head{padding:0 10px}.instagram-head h2{font-size:clamp(30px,8vw,40px)}.instagram-grid{grid-template-columns:1fr;width:100%}.instagram-slot{display:none}.instagram-slot:first-child{display:block;width:100%;max-width:100%;overflow:hidden}.instagram-slot:first-child .instagram-media{display:block!important;min-width:0!important;width:100%!important;max-width:100%!important;margin:0!important}.instagram-slot:first-child iframe{display:block!important;width:100%!important;max-width:100%!important;min-width:0!important;margin:0!important}footer{flex-direction:column;align-items:flex-start}.footer-right{align-items:flex-start;text-align:left}}

/* Theme playground: Literary Night */
body{
  background:
    radial-gradient(circle at 82% 4%,rgba(119,92,136,.20),transparent 31rem),
    radial-gradient(circle at 10% 12%,rgba(193,151,101,.13),transparent 27rem),
    linear-gradient(180deg,#0f0e10 0%,#131113 48%,#0d0c0e 100%);
  color:#f5f0e9;
}
:root{
  --bg:#0f0e10;
  --panel:#191619;
  --text:#f5f0e9;
  --muted:#b9aea5;
  --accent:#d0a56e;
  --accent2:#876f93;
  --line:rgba(236,220,203,.13);
}
header{
  height:92px;
  border-bottom:1px solid rgba(208,165,110,.20);
}
.mark{
  border-color:rgba(208,165,110,.32);
  background:rgba(208,165,110,.055);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.02);
}
.brand span:last-child{letter-spacing:.015em}
nav a{transition:color .18s ease}
nav a:hover{color:var(--text)}
.eyebrow{
  color:#d7ad78;
  letter-spacing:.24em;
}
h1,h2,h3{
  font-weight:500;
  text-wrap:balance;
}
h1{
  line-height:.96;
  letter-spacing:-.041em;
  text-shadow:0 2px 26px rgba(0,0,0,.20);
}
.lead{color:#c2b7ae}
.hero{
  min-height:680px;
  padding-top:78px;
  padding-bottom:104px;
}
.primary{
  background:linear-gradient(180deg,#d7ad78,#c49761);
  color:#17110c;
  box-shadow:0 10px 30px rgba(178,128,72,.16);
}
.secondary{
  border-color:rgba(236,220,203,.18);
  background:rgba(255,255,255,.025);
}
.btn{
  transition:transform .18s ease,border-color .18s ease,background .18s ease;
}
.btn:hover{transform:translateY(-1px)}
.secondary:hover{
  border-color:rgba(208,165,110,.38);
  background:rgba(208,165,110,.055);
}
.home-links{gap:22px}
.home-links a{
  display:block;
  text-decoration:none;
  border:1px solid var(--line);
  border-radius:24px;
  padding:30px;
  background:rgba(255,255,255,.025);
  box-shadow:none;
  transition:none;
}
.home-links a:before{content:none}
.home-links a:hover{
  transform:none;
  border-color:var(--line);
  background:rgba(255,255,255,.025);
}
.home-links h2{font-weight:500}
.card,.project-card.large,.instagram-feature{
  border-color:rgba(236,220,203,.12);
  background:
    linear-gradient(145deg,rgba(255,255,255,.03),rgba(255,255,255,.008)),
    rgba(19,16,19,.70);
  box-shadow:0 22px 55px rgba(0,0,0,.14);
}
.card{border-radius:20px}
.info{padding:30px}
.info h3{font-weight:500;letter-spacing:-.015em}
.buy a,.skill-tag{
  border-color:rgba(236,220,203,.14);
  background:rgba(255,255,255,.018);
}
.buy a:hover{
  border-color:rgba(208,165,110,.32);
  background:rgba(208,165,110,.05);
}
.badge{
  border-color:rgba(208,165,110,.42);
  background:rgba(208,165,110,.055);
}
.page-hero{padding-top:104px}
.page-hero:after{
  content:"";
  display:block;
  width:68px;
  height:1px;
  margin-top:34px;
  background:linear-gradient(90deg,var(--accent),transparent);
}
.updates{
  border-color:rgba(208,165,110,.18);
  background:
    radial-gradient(circle at 86% 15%,rgba(119,92,136,.25),transparent 23rem),
    linear-gradient(145deg,rgba(208,165,110,.045),rgba(255,255,255,.012)),
    #171419;
  box-shadow:0 24px 70px rgba(0,0,0,.16);
}
.project-image{
  background:
    radial-gradient(circle at 50% 20%,rgba(119,92,136,.15),transparent 55%),
    #141216;
}
.author-photo{
  border-color:rgba(208,165,110,.28);
  box-shadow:0 20px 55px rgba(0,0,0,.34),0 0 0 6px rgba(208,165,110,.035);
}
footer{border-top-color:rgba(208,165,110,.18)}
@media(max-width:620px){
  header{height:78px}
  .hero{padding-top:58px;padding-bottom:72px}
  .page-hero{padding-top:72px}
}

/* Homepage revamp */
.home-hero{
  position:relative;
  padding-top:96px;
  padding-bottom:118px;
}
.home-hero:after{
  content:"";
  position:absolute;
  left:0;
  right:0;
  bottom:0;
  height:1px;
  background:linear-gradient(90deg,transparent,rgba(208,165,110,.34),transparent);
}
.home-feature{
  display:grid;
  grid-template-columns:minmax(0,.82fr) minmax(420px,1.18fr);
  gap:70px;
  align-items:center;
  padding:112px 0 108px;
  border-bottom:1px solid rgba(236,220,203,.11);
}
.home-feature-copy h2{
  font:500 clamp(42px,5vw,68px)/.98 Georgia,"Times New Roman",serif;
  letter-spacing:-.03em;
  margin:0 0 22px;
  max-width:560px;
}
.home-feature-copy p{
  color:var(--muted);
  font-size:17px;
  line-height:1.75;
  max-width:510px;
  margin:0;
}
.text-link{
  display:inline-flex;
  gap:10px;
  align-items:center;
  margin-top:28px;
  color:var(--accent);
  text-decoration:none;
  font-weight:700;
  font-size:14px;
}
.text-link span{font-size:18px;transition:transform .18s ease}
.text-link:hover span{transform:translateX(4px)}
.home-shelf{
  display:flex;
  justify-content:flex-end;
  align-items:flex-end;
  gap:18px;
  min-height:430px;
  padding:22px 0 6px;
}
.home-shelf-book{
  position:relative;
  width:min(29%,190px);
  aspect-ratio:2/3;
  border-radius:5px 13px 13px 5px;
  overflow:hidden;
  background:#171319;
  box-shadow:0 26px 58px rgba(0,0,0,.38);
  transform-origin:bottom center;
}
.home-shelf-book:nth-child(1){transform:translateY(22px) rotate(-3deg)}
.home-shelf-book:nth-child(2){transform:translateY(-8px);z-index:2}
.home-shelf-book:nth-child(3){transform:translateY(24px) rotate(3deg)}
.home-shelf-book img{width:100%;height:100%;object-fit:cover}
.home-shelf-placeholder{
  width:100%;
  height:100%;
  display:grid;
  place-items:center;
  padding:20px;
  text-align:center;
  color:var(--text);
  font:500 24px/1.05 Georgia,serif;
  border:1px solid var(--line);
}
.home-paths{
  padding:18px 0 42px;
}
.home-path{
  display:grid;
  grid-template-columns:170px minmax(0,1fr) 48px;
  gap:28px;
  align-items:center;
  padding:42px 4px;
  text-decoration:none;
  border-bottom:1px solid rgba(236,220,203,.11);
}
.home-path:first-child{border-top:1px solid rgba(236,220,203,.11)}
.home-path .eyebrow{margin:0}
.home-path h2{
  margin:0 0 8px;
  font-size:clamp(32px,4vw,50px);
  font-weight:500;
  letter-spacing:-.02em;
}
.home-path p{
  margin:0;
  color:var(--muted);
  line-height:1.65;
}
.home-path-arrow{
  justify-self:end;
  width:42px;
  height:42px;
  display:grid;
  place-items:center;
  border:1px solid var(--line);
  border-radius:50%;
  color:var(--accent);
  font-size:19px;
  transition:transform .18s ease,border-color .18s ease,background .18s ease;
}
.home-path:hover .home-path-arrow{
  transform:translate(2px,-2px);
  border-color:rgba(208,165,110,.40);
  background:rgba(208,165,110,.055);
}
@media(max-width:900px){
  .home-feature{grid-template-columns:1fr;gap:34px;padding:82px 0}
  .home-shelf{justify-content:center;min-height:390px}
  .home-shelf-book{width:min(29%,180px)}
  .home-path{grid-template-columns:135px minmax(0,1fr) 44px}
}
@media(max-width:620px){
  .home-hero{padding-top:60px;padding-bottom:76px}
  .home-feature{padding:68px 0 62px;gap:30px}
  .home-feature-copy h2{font-size:clamp(38px,11vw,50px)}
  .home-shelf{min-height:285px;gap:10px;padding-top:10px}
  .home-shelf-book{width:31%;max-width:126px}
  .home-path{grid-template-columns:1fr 42px;gap:14px 12px;padding:34px 0}
  .home-path .eyebrow{grid-column:1/-1;margin-bottom:4px}
  .home-path div{grid-column:1}
  .home-path-arrow{grid-column:2;grid-row:2;align-self:center}
  .home-path h2{font-size:34px;line-height:1.02}
  .home-path p{font-size:15px}
}

/* Homepage spacing refinements */
.home-feature{padding:72px 0 58px;gap:44px}
.home-shelf{min-height:310px;padding:0}
.home-paths{padding:0 0 12px}
.home-path{padding:26px 4px}
.updates{margin:34px 0 28px}
@media(max-width:900px){
  .home-feature{padding:64px 0 56px;gap:24px}
  .home-shelf{min-height:320px}
  .home-path{padding:26px 0}
  .updates{margin:38px 0 26px}
}
@media(max-width:620px){
  .home-feature{padding:44px 0 30px;gap:10px}
  .home-feature-copy p{margin-bottom:0}
  .text-link{margin-top:20px}
  .home-shelf{min-height:0;height:230px;margin-top:-2px;padding:0;align-items:center}
  .home-shelf-book{max-width:132px}
  .home-shelf-book:nth-child(1){transform:translateY(8px) rotate(-3deg)}
  .home-shelf-book:nth-child(2){transform:translateY(-6px)}
  .home-shelf-book:nth-child(3){transform:translateY(8px) rotate(3deg)}
  .home-paths{padding:0}
  .home-path{padding:20px 0}
  .home-path .eyebrow{margin-bottom:0}
  .home-path h2{margin-bottom:6px}
  .updates{margin:24px 0 22px}
}
</style></head>
<body><div class="wrap"><header><a class="brand" href="/"><span class="mark">DC</span><span id="brandName">Dylan Cunningham</span></a><button class="menu" id="menuBtn" aria-label="Open menu">☰</button><nav id="nav"><a id="navHome" href="/" ${route==="/"?'class="active"':''}>Home</a><a id="navBooks" href="/books" ${route==="/books"?'class="active"':''}>Books</a><a id="navProjects" href="/projects" ${route==="/projects"?'class="active"':''}>Projects</a><a id="navAbout" href="/about" ${route==="/about"?'class="active"':''}>About</a><span class="header-socials" id="headerSocials"><span class="follow-label">Follow</span><span class="header-social-links" id="headerSocialLinks"></span></span></nav></header><main>${body}</main><footer><strong id="footerName"></strong><div class="footer-right"><span>© <span id="year"></span> <span id="footerName2"></span>. <span id="footerText"></span></span><div class="footer-links" id="footerLinks"><a class="admin-link" id="contactLink" href="mailto:dcunn1993@gmail.com"><span id="footerContactLabel">Contact</span></a><a class="admin-link" href="/story-bible"><span>Story Bible</span></a><a class="admin-link" href="/admin"><span id="footerAdminLabel">Admin</span></a></div></div></footer></div>
<script>
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
const safeUrl=u=>{const raw=String(u??"").trim();if(!raw||raw==="#"||raw.toLowerCase()==="javascript:void(0)")return"";try{const x=new URL(raw,location.origin);if(!["http:","https:"].includes(x.protocol))return"";return x.href}catch{return""}};
const safeInstagramUrl=u=>{const raw=String(u??"").trim();if(!raw)return"";try{const x=new URL(raw);let host=x.hostname.toLowerCase();if(host.startsWith("www."))host=host.slice(4);if(host!=="instagram.com")return"";const parts=x.pathname.split("/").filter(Boolean);if(!["p","reel","tv"].includes(parts[0]||"")||!parts[1])return"";return "https://www.instagram.com/"+parts[0]+"/"+parts[1]+"/"}catch{return""}};
const setText=(id,value)=>{const e=document.getElementById(id);if(e)e.textContent=value??""};
const setSkillTags=(id,value)=>{const e=document.getElementById(id);if(!e)return;const items=String(value||"").split(/[,\\n]+/).map(x=>x.trim()).filter(Boolean);e.innerHTML=items.map(x=>'<span class="skill-tag">'+esc(x)+'</span>').join("")};
const renderSocialLinks=value=>{const header=document.getElementById("headerSocials"),headerLinks=document.getElementById("headerSocialLinks");if(headerLinks)headerLinks.innerHTML="";const items=String(value||"").split(/\\n+/).map(x=>x.trim()).filter(Boolean).map(line=>{const parts=line.split("|"),label=(parts.shift()||"").trim(),url=parts.join("|").trim(),href=safeUrl(url);return label&&href?{label,href}:null}).filter(Boolean);items.forEach(item=>{if(headerLinks){const a=document.createElement("a");a.href=item.href;a.target="_blank";a.rel="noopener";a.textContent=item.label;headerLinks.appendChild(a)}});if(header)header.style.display=items.length?"flex":"none";};
document.getElementById("year").textContent=new Date().getFullYear();document.getElementById("menuBtn").onclick=()=>document.getElementById("nav").classList.toggle("open");document.getElementById("nav").addEventListener("click",e=>{if(e.target.closest("a"))document.getElementById("nav").classList.remove("open")});
function mediaUrl(key){return key?"/media/"+encodeURIComponent(key).replace(/%2F/g,"/"):""}
function coverMarkup(b,i){const src=b.cover_key?mediaUrl(b.cover_key):safeUrl(b.cover_url);if(src)return '<img src="'+esc(src)+'" alt="'+esc(b.title)+' cover">';return '<div class="coverplaceholder">'+esc(b.title)+'</div>'}
function storeLinks(b){const status=String(b.status||"Coming Soon").trim();if(status.toLowerCase()==="coming soon")return '<span class="badge">Coming Soon</span>';const items=[["Paperback",b.paperback_url],["Ebook / Kindle",b.ebook_url],["Apple Books",b.apple_url],["Kobo",b.kobo_url]].filter(x=>safeUrl(x[1]));if(!items.length)return '<span class="badge">'+esc(status)+'</span>';return '<div class="buy">'+items.map(x=>'<a target="_blank" rel="noopener" href="'+esc(safeUrl(x[1]))+'">'+esc(x[0])+'</a>').join("")+'</div>'}
fetch("/api/site").then(r=>r.json()).then(data=>{const s=data.settings||{};document.title=(routeTitle=>routeTitle+" | "+(s.author_name||"Dylan Cunningham"))("${pageTitle}");["brandName","footerName","footerName2"].forEach(id=>setText(id,s.author_name||"Dylan Cunningham"));setText("footerText",s.footer_text||"");setText("navHome",s.nav_home||"Home");setText("navBooks",s.nav_books||"Books");setText("navProjects",s.nav_projects||"Projects");setText("navAbout",s.nav_about||"About");setText("footerContactLabel",s.footer_contact_label||"Contact");setText("footerAdminLabel",s.footer_admin_label||"Admin");const contactLink=document.getElementById("contactLink");if(contactLink)contactLink.href="mailto:"+(s.contact_email||"dcunn1993@gmail.com");renderSocialLinks(s.social_links||"");setText("eyebrow",s.eyebrow||"FICTION THAT STAYS WITH YOU");setText("heroTitle",s.hero_title||"");setText("heroText",s.hero_text||"");setText("homeBooksButton",s.home_books_button||"Explore the books");setText("homeProjectsButton",s.home_projects_button||"See my projects");const homeBooksButton=document.getElementById("homeBooksButton"),homeProjectsButton=document.getElementById("homeProjectsButton");if(homeBooksButton){homeBooksButton.href=s.home_books_button_url||"/books";homeBooksButton.style.display=String(s.home_books_button_visible??"1")==="0"?"none":""}if(homeProjectsButton){homeProjectsButton.href=s.home_projects_button_url||"/projects";homeProjectsButton.style.display=String(s.home_projects_button_visible??"1")==="0"?"none":""}setText("homeBooksEyebrow",s.home_books_eyebrow||"BOOKS");setText("homeBooksHeading",s.home_books_heading||"Stories that stay with you.");setText("homeBooksText",s.home_books_text||"Browse published novels and upcoming releases.");setText("homeProjectsEyebrow",s.home_projects_eyebrow||"PROJECTS");setText("homeProjectsHeading",s.home_projects_heading||"Beyond the books.");setText("homeProjectsText",s.home_projects_text||"Explore The Remnant Suite and Witness Systems.");setText("homeAboutEyebrow",s.home_about_eyebrow||"ABOUT");setText("homeAboutHeading",s.home_about_heading||"Meet the author.");setText("homeAboutText",s.home_about_text||"Writing, software, systems, and probably a cat nearby.");setText("updatesEyebrow",s.updates_eyebrow||"STAY IN THE LOOP");setText("updatesHeading",s.updates_heading||"");setText("updatesText",s.updates_text||"");setText("booksEyebrow",s.books_eyebrow||"THE BOOKS");setText("booksHeading",s.books_heading||"Choose your next story.");setText("booksText",s.books_text||"Current releases and upcoming novels from Dylan Cunningham.");setText("aboutEyebrow",s.about_eyebrow||"ABOUT THE AUTHOR");setText("projectsEyebrow",s.projects_eyebrow||"PROJECTS");setText("projectsHeading",s.projects_heading||"Beyond the books");setText("projectsText",s.projects_text||"");setText("remnantEyebrow",s.remnant_eyebrow||"DESKTOP SOFTWARE");setText("remnantTitle",s.remnant_title||"The Remnant Suite");setText("remnantText",s.remnant_text||"");setSkillTags("remnantSkills",s.remnant_skills||"");setText("witnessEyebrow",s.witness_eyebrow||"SYSTEMS & IOT");setText("witnessTitle",s.witness_title||"Witness Systems");setText("witnessText",s.witness_text||"");setSkillTags("witnessSkills",s.witness_skills||"");setText("aboutHeading",s.about_heading||s.author_name||"");setText("aboutText",s.about_text||"");
const photoKey=String(s.author_photo_key||"").trim(),photo=document.getElementById("aboutPhoto"),photoWrap=document.getElementById("authorPhotoWrap");if(photo&&photoWrap&&photoKey){photo.src=mediaUrl(photoKey);photoWrap.style.display="block"}
[["remnantImage","remnant_image_key"],["witnessImage","witness_image_key"]].forEach(([id,key])=>{const img=document.getElementById(id);if(img){const src=mediaUrl(String(s[key]||"").trim());img.src=src;if(!src){const wrap=img.closest(".project-image");if(wrap)wrap.style.display="none"}}});
const books=data.books||[],hero=document.getElementById("heroBooks");if(hero){const heroCovers=books.filter(b=>b.cover_key||safeUrl(b.cover_url)).slice(0,2);if(heroCovers.length)hero.innerHTML=heroCovers.map(b=>{const src=b.cover_key?mediaUrl(b.cover_key):safeUrl(b.cover_url);return '<img class="hero-cover" src="'+esc(src)+'" alt="'+esc(b.title)+' cover">'}).join("")}
const homeShelf=document.getElementById("homeShelf");if(homeShelf){const featured=books.slice(0,3);homeShelf.innerHTML=featured.map((b,i)=>{const src=b.cover_key?mediaUrl(b.cover_key):safeUrl(b.cover_url);return '<a class="home-shelf-book" href="/books" aria-label="'+esc(b.title)+'">'+(src?'<img src="'+esc(src)+'" alt="'+esc(b.title)+' cover">':'<span class="home-shelf-placeholder">'+esc(b.title)+'</span>')+'</a>'}).join("")}
const grid=document.getElementById("bookGrid");if(grid)grid.innerHTML=books.length?books.map((b,i)=>'<article class="card"><div class="cover '+(i%3===1?"alt":i%3===2?"warm":"")+'">'+coverMarkup(b,i)+'</div><div class="info"><div class="genre">'+esc(b.genre)+'</div><h3>'+esc(b.title)+'</h3>'+(b.subtitle?'<div style="color:var(--muted);margin-top:-7px;margin-bottom:12px">'+esc(b.subtitle)+'</div>':"")+'<p>'+esc(b.description)+'</p>'+storeLinks(b)+'</div></article>').join(""):'<div class="empty">Books will appear here soon.</div>'}).catch(()=>{const grid=document.getElementById("bookGrid");if(grid)grid.innerHTML='<div class="empty">The book list could not load.</div>'});
</script></body></html>`;
}


const HOT_GUYS_WORLD_ID = "0b8b5a5d-42bb-4e12-a143-046eff715257";
const HOT_GUYS_MCP_URL = "https://app.orbismo.com/api/v1/worlds/" + HOT_GUYS_WORLD_ID + "/mcp";

function cleanHotGuysProperties(input) {
  const out = {};
  for (const key of ["first_noticed","last_noted","known_from","attraction_status"]) {
    if (Object.prototype.hasOwnProperty.call(input, key)) out[key] = String(input[key] || "").trim();
  }
  for (const key of ["favorite_features","vibe_tags","aliases"]) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    const raw = input[key];
    out[key] = Array.isArray(raw)
      ? raw.map(x => String(x).trim()).filter(Boolean).slice(0, 50)
      : String(raw || "").split(/[\n,]+/).map(x => x.trim()).filter(Boolean).slice(0, 50);
  }
  return out;
}

async function getHotGuysCache(env) {
  await ensureSchema(env);
  const row = await env.DB.prepare("SELECT snapshot_json, synced_at, sync_status, sync_error FROM hot_guys_cache WHERE id=1").first();
  if (!row) return { snapshot: null, synced_at: "", status: "never", error: "" };
  let snapshot = null;
  try { snapshot = JSON.parse(row.snapshot_json || "null"); } catch {}
  return { snapshot, synced_at: row.synced_at || "", status: row.sync_status || "never", error: row.sync_error || "" };
}

async function markHotGuysSyncError(env, message) {
  const now = new Date().toISOString();
  const clean = String(message || "Unknown sync error").slice(0, 1500);
  await env.DB.prepare(`
    INSERT INTO hot_guys_cache (id, snapshot_json, synced_at, sync_status, sync_error, content_hash)
    VALUES (1, '{}', ?, 'error', ?, '')
    ON CONFLICT(id) DO UPDATE SET synced_at=excluded.synced_at, sync_status='error', sync_error=excluded.sync_error
  `).bind(now, clean).run();
}

function hotGuysHeaders(env, sessionId = "") {
  const headers = {
    "authorization": "Bearer " + env.ORBISMO_HOT_GUYS_API_KEY,
    "content-type": "application/json",
    "accept": "application/json, text/event-stream",
    "mcp-protocol-version": ORBISMO_PROTOCOL_VERSION
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  return headers;
}

async function openHotGuysSession(env) {
  if (!env.ORBISMO_HOT_GUYS_API_KEY) throw new Error("ORBISMO_HOT_GUYS_API_KEY secret is not configured.");
  const res = await fetch(HOT_GUYS_MCP_URL, {
    method: "POST",
    headers: hotGuysHeaders(env),
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: ORBISMO_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "dc1993-hot-guys", version: "1.0.0" } }
    })
  });
  const rpc = await parseMcpResponse(res);
  if (rpc.error) throw new Error(rpc.error.message || "Hot Guys Orbismo MCP initialize failed.");
  const sessionId = res.headers.get("mcp-session-id") || "";
  if (sessionId) {
    const notify = await fetch(HOT_GUYS_MCP_URL, {
      method: "POST",
      headers: hotGuysHeaders(env, sessionId),
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })
    });
    if (!notify.ok) throw new Error("Hot Guys Orbismo initialization acknowledgement failed.");
  }
  return { sessionId, nextId: 2 };
}

async function hotGuysTool(session, env, name, args) {
  const id = session.nextId++;
  const res = await fetch(HOT_GUYS_MCP_URL, {
    method: "POST",
    headers: hotGuysHeaders(env, session.sessionId),
    body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args || {} } })
  });
  const rpc = await parseMcpResponse(res);
  if (rpc.error) throw new Error(rpc.error.message || ("Hot Guys Orbismo tool failed: " + name));
  const result = rpc.result || {};
  if (result.isError) {
    const msg = Array.isArray(result.content) ? result.content.map(x => x?.text || "").filter(Boolean).join(" ") : "Hot Guys Orbismo tool returned an error.";
    throw new Error(msg || ("Hot Guys Orbismo tool returned an error: " + name));
  }
  if (result.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
  if (Array.isArray(result.content)) {
    const text = result.content.filter(x => x && x.type === "text").map(x => x.text || "").join("\n").trim();
    if (text) { try { return JSON.parse(text); } catch { return { text }; } }
  }
  return result;
}

async function completeHotGuysEntityBlocks(session, env, entity) {
  let relCursor = entity?.relationships?.next_cursor || null;
  while (relCursor) {
    const page = await hotGuysTool(session, env, "get_entities", {
      entity_ids: [entity.entity_id], view: "full", active_only: false,
      relationships: { limit: 100, cursor: relCursor, embed_target: "name" },
      lore: { limit: 1, include_content: false }
    });
    const item = page.entities?.[0]; if (!item) break;
    entity.relationships.items.push(...(item.relationships?.items || []));
    relCursor = item.relationships?.next_cursor || null;
  }
  if (entity.relationships) { entity.relationships.returned = entity.relationships.items?.length || 0; entity.relationships.next_cursor = null; }

  let loreCursor = entity?.lore?.next_cursor || null;
  while (loreCursor) {
    const page = await hotGuysTool(session, env, "get_entities", {
      entity_ids: [entity.entity_id], view: "full", active_only: false,
      relationships: { limit: 1, embed_target: "name" },
      lore: { limit: 50, cursor: loreCursor, include_content: true }
    });
    const item = page.entities?.[0]; if (!item) break;
    entity.lore.items.push(...(item.lore?.items || []));
    loreCursor = item.lore?.next_cursor || null;
  }
  if (entity.lore) { entity.lore.returned = entity.lore.items?.length || 0; entity.lore.next_cursor = null; }
}

async function syncHotGuys(env) {
  await ensureSchema(env);
  if (!env.ORBISMO_HOT_GUYS_API_KEY) {
    const msg = "ORBISMO_HOT_GUYS_API_KEY secret is not configured.";
    await markHotGuysSyncError(env, msg); throw new Error(msg);
  }
  try {
    const session = await openHotGuysSession(env);
    const context = await hotGuysTool(session, env, "get_world_context", { include_stats: true });
    const instructions = await hotGuysTool(session, env, "get_world_instructions", {});
    const compact = []; let cursor = null;
    do {
      const page = await hotGuysTool(session, env, "search_entities", { view: "compact", limit: 100, ...(cursor ? { cursor } : {}) });
      compact.push(...(page.results || [])); cursor = page.next_cursor || null;
    } while (cursor);

    const entities = [];
    for (let i = 0; i < compact.length; i += 20) {
      const batch = await hotGuysTool(session, env, "get_entities", {
        entity_ids: compact.slice(i, i + 20).map(x => x.entity_id),
        view: "full", active_only: false,
        relationships: { limit: 100, embed_target: "name" },
        lore: { limit: 50, include_content: true }
      });
      for (const entity of batch.entities || []) { await completeHotGuysEntityBlocks(session, env, entity); entities.push(entity); }
    }

    entities.sort((a,b) => String(a.name || "").localeCompare(String(b.name || "")));
    const core = { version: 1, source: "Orbismo", world_id: HOT_GUYS_WORLD_ID, schema: context, world_instructions: instructions?.instructions || "", entities };
    const contentHash = await sha256Hex(JSON.stringify(core));
    const now = new Date().toISOString();
    const current = await env.DB.prepare("SELECT content_hash FROM hot_guys_cache WHERE id=1").first();

    if (current?.content_hash === contentHash) {
      await env.DB.prepare(`
        INSERT INTO hot_guys_cache (id, snapshot_json, synced_at, sync_status, sync_error, content_hash)
        VALUES (1, '{}', ?, 'ok', '', ?)
        ON CONFLICT(id) DO UPDATE SET synced_at=excluded.synced_at, sync_status='ok', sync_error='', content_hash=excluded.content_hash
      `).bind(now, contentHash).run();
      return;
    }

    const snapshot = { ...core, generated_at: now, entity_count: entities.length };
    await env.DB.prepare(`
      INSERT INTO hot_guys_cache (id, snapshot_json, synced_at, sync_status, sync_error, content_hash)
      VALUES (1, ?, ?, 'ok', '', ?)
      ON CONFLICT(id) DO UPDATE SET snapshot_json=excluded.snapshot_json, synced_at=excluded.synced_at, sync_status='ok', sync_error='', content_hash=excluded.content_hash
    `).bind(JSON.stringify(snapshot), now, contentHash).run();
  } catch (err) {
    await markHotGuysSyncError(env, err?.message || String(err)); throw err;
  }
}

const ORBISMO_WORLD_ID = "ae5af97f-66fa-40cf-9cea-8b9c63c09437";
const ORBISMO_MCP_URL = "https://app.orbismo.com/api/v1/worlds/" + ORBISMO_WORLD_ID + "/mcp";
const ORBISMO_PROTOCOL_VERSION = "2025-03-26";

async function getStoryBibleCache(env) {
  await ensureSchema(env);
  const row = await env.DB.prepare(
    "SELECT snapshot_json, synced_at, sync_status, sync_error FROM story_bible_cache WHERE id=1"
  ).first();

  if (!row) {
    return {
      snapshot: null,
      synced_at: "",
      status: "never",
      error: ""
    };
  }

  let snapshot = null;
  try {
    snapshot = JSON.parse(row.snapshot_json || "null");
  } catch {}

  return {
    snapshot,
    synced_at: row.synced_at || "",
    status: row.sync_status || "never",
    error: row.sync_error || ""
  };
}

async function syncStoryBible(env) {
  await ensureSchema(env);

  if (!env.ORBISMO_API_KEY) {
    const msg = "ORBISMO_API_KEY secret is not configured.";
    await markStoryBibleSyncError(env, msg);
    throw new Error(msg);
  }

  try {
    const session = await openOrbismoSession(env);

    const context = await orbismoTool(session, env, "get_world_context", { include_stats: true });
    const instructions = await orbismoTool(session, env, "get_world_instructions", {});

    const compact = [];
    let cursor = null;
    do {
      const page = await orbismoTool(session, env, "search_entities", {
        view: "compact",
        limit: 100,
        ...(cursor ? { cursor } : {})
      });
      compact.push(...(page.results || []));
      cursor = page.next_cursor || null;
    } while (cursor);

    const entities = [];
    for (let i = 0; i < compact.length; i += 20) {
      const ids = compact.slice(i, i + 20).map(x => x.entity_id);
      const batch = await orbismoTool(session, env, "get_entities", {
        entity_ids: ids,
        view: "full",
        active_only: false,
        relationships: { limit: 100, embed_target: "name" },
        lore: { limit: 50, include_content: true }
      });

      for (const entity of batch.entities || []) {
        await completeEntityBlocks(session, env, entity);
        entities.push(entity);
      }
    }

    entities.sort((a, b) =>
      String(a.entity_type || "").localeCompare(String(b.entity_type || "")) ||
      String(a.name || "").localeCompare(String(b.name || ""))
    );

    const core = {
      version: 1,
      source: "Orbismo",
      world_id: ORBISMO_WORLD_ID,
      schema: context,
      world_instructions: instructions?.instructions || "",
      entities
    };

    const serializedCore = JSON.stringify(core);
    const contentHash = await sha256Hex(serializedCore);
    const now = new Date().toISOString();
    const current = await env.DB.prepare(
      "SELECT content_hash FROM story_bible_cache WHERE id=1"
    ).first();

    if (current?.content_hash === contentHash) {
      await env.DB.prepare(`
        INSERT INTO story_bible_cache
          (id, snapshot_json, synced_at, sync_status, sync_error, content_hash)
        VALUES
          (1, '{}', ?, 'ok', '', ?)
        ON CONFLICT(id) DO UPDATE SET
          synced_at=excluded.synced_at,
          sync_status='ok',
          sync_error='',
          content_hash=excluded.content_hash
      `).bind(now, contentHash).run();
      return;
    }

    const snapshot = {
      ...core,
      generated_at: now,
      entity_count: entities.length
    };

    await env.DB.prepare(`
      INSERT INTO story_bible_cache
        (id, snapshot_json, synced_at, sync_status, sync_error, content_hash)
      VALUES
        (1, ?, ?, 'ok', '', ?)
      ON CONFLICT(id) DO UPDATE SET
        snapshot_json=excluded.snapshot_json,
        synced_at=excluded.synced_at,
        sync_status='ok',
        sync_error='',
        content_hash=excluded.content_hash
    `).bind(JSON.stringify(snapshot), now, contentHash).run();
  } catch (err) {
    await markStoryBibleSyncError(env, err?.message || String(err));
    throw err;
  }
}

async function markStoryBibleSyncError(env, message) {
  const now = new Date().toISOString();
  const clean = String(message || "Unknown sync error").slice(0, 1500);
  await env.DB.prepare(`
    INSERT INTO story_bible_cache
      (id, snapshot_json, synced_at, sync_status, sync_error, content_hash)
    VALUES
      (1, '{}', ?, 'error', ?, '')
    ON CONFLICT(id) DO UPDATE SET
      synced_at=excluded.synced_at,
      sync_status='error',
      sync_error=excluded.sync_error
  `).bind(now, clean).run();
}

async function completeEntityBlocks(session, env, entity) {
  let relCursor = entity?.relationships?.next_cursor || null;
  while (relCursor) {
    const page = await orbismoTool(session, env, "get_entities", {
      entity_ids: [entity.entity_id],
      view: "full",
      active_only: false,
      relationships: {
        limit: 100,
        cursor: relCursor,
        embed_target: "name"
      },
      lore: { limit: 1, include_content: false }
    });
    const item = page.entities?.[0];
    if (!item) break;
    entity.relationships.items.push(...(item.relationships?.items || []));
    relCursor = item.relationships?.next_cursor || null;
  }
  if (entity.relationships) {
    entity.relationships.returned = entity.relationships.items?.length || 0;
    entity.relationships.next_cursor = null;
  }

  let loreCursor = entity?.lore?.next_cursor || null;
  while (loreCursor) {
    const page = await orbismoTool(session, env, "get_entities", {
      entity_ids: [entity.entity_id],
      view: "full",
      active_only: false,
      relationships: { limit: 1, embed_target: "name" },
      lore: {
        limit: 50,
        cursor: loreCursor,
        include_content: true
      }
    });
    const item = page.entities?.[0];
    if (!item) break;
    entity.lore.items.push(...(item.lore?.items || []));
    loreCursor = item.lore?.next_cursor || null;
  }
  if (entity.lore) {
    entity.lore.returned = entity.lore.items?.length || 0;
    entity.lore.next_cursor = null;
  }
}

async function openOrbismoSession(env) {
  const payload = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: ORBISMO_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: "dc1993-story-bible",
        version: "1.0.0"
      }
    }
  };

  const res = await fetch(ORBISMO_MCP_URL, {
    method: "POST",
    headers: orbismoHeaders(env),
    body: JSON.stringify(payload)
  });

  const rpc = await parseMcpResponse(res);
  if (rpc.error) throw new Error(rpc.error.message || "Orbismo MCP initialize failed.");

  const sessionId = res.headers.get("mcp-session-id") || "";
  if (sessionId) {
    const notify = await fetch(ORBISMO_MCP_URL, {
      method: "POST",
      headers: orbismoHeaders(env, sessionId),
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {}
      })
    });
    if (!notify.ok) {
      const body = await notify.text().catch(() => "");
      throw new Error("Orbismo MCP initialization acknowledgement failed: " + notify.status + " " + body.slice(0, 200));
    }
  }

  return { sessionId, nextId: 2 };
}

async function orbismoTool(session, env, name, args) {
  const id = session.nextId++;
  const res = await fetch(ORBISMO_MCP_URL, {
    method: "POST",
    headers: orbismoHeaders(env, session.sessionId),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: {
        name,
        arguments: args || {}
      }
    })
  });

  const rpc = await parseMcpResponse(res);
  if (rpc.error) throw new Error(rpc.error.message || ("Orbismo tool failed: " + name));

  const result = rpc.result || {};
  if (result.isError) {
    const msg = Array.isArray(result.content)
      ? result.content.map(x => x?.text || "").filter(Boolean).join(" ")
      : "Orbismo tool returned an error.";
    throw new Error(msg || ("Orbismo tool returned an error: " + name));
  }

  if (result.structuredContent && typeof result.structuredContent === "object") {
    return result.structuredContent;
  }

  if (Array.isArray(result.content)) {
    const text = result.content
      .filter(x => x && x.type === "text")
      .map(x => x.text || "")
      .join("\n")
      .trim();
    if (text) {
      try { return JSON.parse(text); } catch { return { text }; }
    }
  }

  return result;
}

function orbismoHeaders(env, sessionId = "") {
  const headers = {
    "authorization": "Bearer " + env.ORBISMO_API_KEY,
    "content-type": "application/json",
    "accept": "application/json, text/event-stream",
    "mcp-protocol-version": ORBISMO_PROTOCOL_VERSION
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  return headers;
}

async function parseMcpResponse(res) {
  const text = await res.text();
  if (!res.ok) {
    throw new Error("Orbismo MCP HTTP " + res.status + ": " + text.slice(0, 400));
  }
  if (!text.trim()) return {};

  try {
    return JSON.parse(text);
  } catch {}

  const events = text.split(/\r?\n\r?\n/);
  for (const event of events) {
    const data = event
      .split(/\r?\n/)
      .filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).trim())
      .join("\n");
    if (!data) continue;
    try {
      const parsed = JSON.parse(data);
      if (parsed && (parsed.result || parsed.error || parsed.id !== undefined)) return parsed;
    } catch {}
  }

  throw new Error("Orbismo returned an unreadable MCP response.");
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function storyBiblePage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<title>Story Bible · Dylan Cunningham</title>
<style>
:root{--bg:#11100f;--panel:#1b1815;--panel2:#211d19;--line:rgba(255,255,255,.09);--text:#f2eee9;--muted:#a9a096;--accent:#c09b73;--soft:#d8c2aa}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:Arial,sans-serif;min-height:100vh}
a{color:inherit}.shell{width:min(1420px,calc(100% - 32px));margin:auto;padding:24px 0 56px}
.top{display:flex;gap:18px;align-items:flex-start;justify-content:space-between;border-bottom:1px solid var(--line);padding-bottom:20px;margin-bottom:20px}
.eyebrow{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--accent);font-weight:800;margin:0 0 8px}
h1,h2,h3{font-family:Georgia,serif}.top h1{font-size:clamp(36px,6vw,64px);margin:0}.sub{color:var(--muted);margin:8px 0 0;line-height:1.55}
.actions{display:flex;gap:9px;flex-wrap:wrap;justify-content:flex-end}.btn{border:1px solid var(--line);background:var(--panel);color:var(--text);border-radius:999px;padding:11px 15px;font-weight:700;text-decoration:none;cursor:pointer}.btn.primary{background:var(--accent);color:#17120f;border-color:transparent}
.statusbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;background:var(--panel);border:1px solid var(--line);padding:12px 15px;border-radius:14px;margin-bottom:18px;font-size:13px;color:var(--muted)}
.dot{width:8px;height:8px;border-radius:50%;background:#777}.dot.ok{background:#70b780}.dot.error{background:#d97878}.dot.syncing{background:#d4aa63}
.controls{display:grid;grid-template-columns:minmax(220px,1fr) 180px 220px;gap:10px;margin-bottom:18px}.control{width:100%;border:1px solid var(--line);background:#161310;color:var(--text);padding:13px 14px;border-radius:12px;font-size:15px}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px}.stat{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px}.stat b{display:block;font-family:Georgia,serif;font-size:30px}.stat span{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}
.layout{display:grid;grid-template-columns:310px minmax(0,1fr);gap:16px}.sidebar,.content{min-width:0}.box{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:15px;margin-bottom:14px}.box h2{font-size:20px;margin:0 0 12px}.filter{display:flex;width:100%;justify-content:space-between;gap:12px;border:0;background:transparent;color:var(--text);padding:10px 8px;border-radius:10px;text-align:left;cursor:pointer}.filter:hover,.filter.active{background:rgba(192,155,115,.13)}.count{color:var(--muted)}
.entity-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.entity{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px;cursor:pointer;min-width:0}.entity:hover{border-color:rgba(192,155,115,.48)}.type{font-size:10px;text-transform:uppercase;letter-spacing:.13em;color:var(--accent);font-weight:800}.entity h3{font-size:22px;margin:7px 0 8px}.desc{color:var(--muted);line-height:1.5;font-size:14px}.tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px}.tag{font-size:11px;border:1px solid var(--line);padding:5px 8px;border-radius:999px;color:var(--soft)}
.empty{padding:42px 18px;text-align:center;color:var(--muted);background:var(--panel);border:1px solid var(--line);border-radius:18px}
.modal{position:fixed;inset:0;background:rgba(0,0,0,.74);display:none;align-items:flex-start;justify-content:center;padding:28px 14px;overflow:auto;z-index:30}.modal.open{display:flex}.detail{width:min(900px,100%);background:#171411;border:1px solid var(--line);border-radius:22px;padding:22px;box-shadow:0 24px 80px rgba(0,0,0,.4)}.detailhead{display:flex;justify-content:space-between;gap:16px}.close{border:0;background:transparent;color:var(--text);font-size:28px;cursor:pointer}.detail h2{font-size:36px;margin:3px 0 8px}.section{border-top:1px solid var(--line);margin-top:18px;padding-top:16px}.section h3{font-size:20px;margin:0 0 10px}.props{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.prop{background:var(--panel2);padding:10px 12px;border-radius:10px}.prop small{display:block;color:var(--muted);margin-bottom:4px}.lore{background:var(--panel2);border-radius:13px;padding:14px;margin-top:9px}.lore h4{margin:0 0 8px;font-family:Georgia,serif;font-size:18px}.lore p{white-space:pre-wrap;line-height:1.62;margin:0;color:#ded7d0}.rel{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--line);font-size:14px}.rel:last-child{border-bottom:0}.rel span:last-child{color:var(--muted);text-align:right}
.error{color:#ffabab}
@media(max-width:850px){.top{display:block}.actions{justify-content:flex-start;margin-top:16px}.controls{grid-template-columns:1fr}.stats{grid-template-columns:repeat(2,1fr)}.layout{grid-template-columns:1fr}.sidebar{display:grid;grid-template-columns:1fr 1fr;gap:10px}.box{margin:0}.entity-grid{grid-template-columns:1fr}.props{grid-template-columns:1fr}}
@media(max-width:520px){.shell{width:min(100% - 20px,1420px);padding-top:15px}.sidebar{display:block}.box{margin-bottom:10px}.detail{padding:17px}.detail h2{font-size:30px}}
</style>
</head>
<body>
<div class="shell">
  <div class="top">
    <div><p class="eyebrow">PRIVATE REFERENCE</p><h1>Story Bible</h1><p class="sub">A searchable mirror of the current Orbismo canon.</p></div>
    <div class="actions"><button class="btn primary" id="syncBtn">Sync now</button><a class="btn" href="/admin">Admin</a><a class="btn" href="/">Site</a></div>
  </div>
  <div class="statusbar"><span class="dot" id="statusDot"></span><span id="syncStatus">Loading…</span></div>
  <div class="controls">
    <input class="control" id="search" type="search" placeholder="Search names, lore, descriptions, tags…">
    <select class="control" id="typeFilter"><option value="">All entity types</option></select>
    <select class="control" id="seriesFilter"><option value="">All series / catalog</option><option value="where-we-land">Where We Land</option><option value="lives-of-schola">Lives of Schola</option><option value="__catalog">Catalog / unscoped</option></select>
  </div>
  <div class="stats" id="stats"></div>
  <div class="layout">
    <aside class="sidebar"><div class="box"><h2>Entity types</h2><div id="typeList"></div></div><div class="box"><h2>Series</h2><div id="seriesList"></div></div></aside>
    <main class="content"><div class="entity-grid" id="entityGrid"></div></main>
  </div>
</div>
<div class="modal" id="modal"><div class="detail"><div class="detailhead"><div><div class="type" id="detailType"></div><h2 id="detailName"></h2><div class="tags" id="detailTags"></div></div><button class="close" id="closeBtn" aria-label="Close">×</button></div><div class="desc" id="detailDesc"></div><div id="detailBody"></div></div></div>
<script>
let SNAP=null,ENTITIES=[],TYPE="",SERIES="",QUERY="";
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
const fmt=d=>{if(!d)return"Never";try{return new Date(d).toLocaleString()}catch{return d}};
const seriesOf=e=>{const t=e.tags||[];if(t.includes("where-we-land"))return"where-we-land";if(t.includes("lives-of-schola"))return"lives-of-schola";return"__catalog"};
const loreText=e=>(e.lore?.items||[]).map(x=>(x.title||"")+" "+(x.content||"")).join(" ");
const hay=e=>[e.name,e.short_description,(e.tags||[]).join(" "),JSON.stringify(e.properties||{}),loreText(e)].join(" ").toLowerCase();
async function api(path,opt={}){const r=await fetch(path,opt);if(r.status===401){location="/story-bible";throw new Error("Unauthorized")}const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||"Request failed");return j}
function stat(label,value){return '<div class="stat"><b>'+esc(value)+'</b><span>'+esc(label)+'</span></div>'}
function labelType(t){return String(t||"").replace(/_/g," ").replace(/\\b\\w/g,c=>c.toUpperCase())}
function render(){
  if(!SNAP){document.getElementById("stats").innerHTML=stat("Entities",0)+stat("Series",0)+stat("Books",0)+stat("Lore chunks",0);document.getElementById("entityGrid").innerHTML='<div class="empty">No Orbismo snapshot yet. Tap <b>Sync now</b> after the Worker has the API key.</div>';return}
  ENTITIES=SNAP.entities||[];
  const types={};ENTITIES.forEach(e=>types[e.entity_type]=(types[e.entity_type]||0)+1);
  const lore=ENTITIES.reduce((n,e)=>n+(e.lore?.items?.length||0),0);
  const books=ENTITIES.filter(e=>e.entity_type==="project"&&(e.tags||[]).includes("book")).length;
  document.getElementById("stats").innerHTML=stat("Entities",ENTITIES.length)+stat("Series",ENTITIES.filter(e=>e.entity_type==="world").length)+stat("Books",books)+stat("Lore chunks",lore);
  const typeSelect=document.getElementById("typeFilter");const current=typeSelect.value;typeSelect.innerHTML='<option value="">All entity types</option>'+Object.keys(types).sort().map(t=>'<option value="'+esc(t)+'">'+esc(labelType(t))+' ('+types[t]+')</option>').join("");typeSelect.value=current;
  document.getElementById("typeList").innerHTML='<button class="filter '+(!TYPE?"active":"")+'" data-type="">All <span class="count">'+ENTITIES.length+'</span></button>'+Object.entries(types).sort((a,b)=>a[0].localeCompare(b[0])).map(([t,n])=>'<button class="filter '+(TYPE===t?"active":"")+'" data-type="'+esc(t)+'">'+esc(labelType(t))+' <span class="count">'+n+'</span></button>').join("");
  const sc={"where-we-land":0,"lives-of-schola":0,"__catalog":0};ENTITIES.forEach(e=>sc[seriesOf(e)]++);
  document.getElementById("seriesList").innerHTML='<button class="filter '+(!SERIES?"active":"")+'" data-series="">All <span class="count">'+ENTITIES.length+'</span></button><button class="filter '+(SERIES==="where-we-land"?"active":"")+'" data-series="where-we-land">Where We Land <span class="count">'+sc["where-we-land"]+'</span></button><button class="filter '+(SERIES==="lives-of-schola"?"active":"")+'" data-series="lives-of-schola">Lives of Schola <span class="count">'+sc["lives-of-schola"]+'</span></button><button class="filter '+(SERIES==="__catalog"?"active":"")+'" data-series="__catalog">Catalog <span class="count">'+sc["__catalog"]+'</span></button>';
  document.querySelectorAll("[data-type]").forEach(b=>b.onclick=()=>{TYPE=b.dataset.type;document.getElementById("typeFilter").value=TYPE;render()});
  document.querySelectorAll("[data-series]").forEach(b=>b.onclick=()=>{SERIES=b.dataset.series;document.getElementById("seriesFilter").value=SERIES;render()});
  const q=QUERY.trim().toLowerCase();const filtered=ENTITIES.filter(e=>(!TYPE||e.entity_type===TYPE)&&(!SERIES||seriesOf(e)===SERIES)&&(!q||hay(e).includes(q)));
  document.getElementById("entityGrid").innerHTML=filtered.length?filtered.map(e=>'<article class="entity" data-id="'+esc(e.entity_id)+'"><div class="type">'+esc(labelType(e.entity_type))+'</div><h3>'+esc(e.name)+'</h3><div class="desc">'+esc(e.short_description||"No description yet.")+'</div><div class="tags">'+(e.tags||[]).slice(0,6).map(t=>'<span class="tag">'+esc(t)+'</span>').join("")+'</div></article>').join(""):'<div class="empty">No matching entries.</div>';
  document.querySelectorAll(".entity").forEach(el=>el.onclick=()=>openEntity(el.dataset.id));
}
function openEntity(id){
  const e=ENTITIES.find(x=>x.entity_id===id);if(!e)return;
  document.getElementById("detailType").textContent=labelType(e.entity_type);
  document.getElementById("detailName").textContent=e.name||"";
  document.getElementById("detailDesc").textContent=e.short_description||"";
  document.getElementById("detailTags").innerHTML=(e.tags||[]).map(t=>'<span class="tag">'+esc(t)+'</span>').join("");
  const props=Object.entries(e.properties||{}).filter(([,v])=>v!==null&&v!==""&&v!==undefined);
  const rels=e.relationships?.items||[];const lore=e.lore?.items||[];
  let body="";
  if(props.length)body+='<section class="section"><h3>Properties</h3><div class="props">'+props.map(([k,v])=>'<div class="prop"><small>'+esc(labelType(k))+'</small>'+esc(Array.isArray(v)?v.join(", "):typeof v==="object"?JSON.stringify(v):v)+'</div>').join("")+'</div></section>';
  if(rels.length)body+='<section class="section"><h3>Relationships</h3>'+rels.map(r=>'<div class="rel"><span>'+esc(r.display_label||r.relationship_type||"Related")+'</span><span>'+esc(r.entity_name||r.entity_id||"")+'</span></div>').join("")+'</section>';
  if(lore.length)body+='<section class="section"><h3>Lore</h3>'+lore.map(l=>'<article class="lore"><h4>'+esc(l.title||"Lore")+'</h4><p>'+esc(l.content||"")+'</p></article>').join("")+'</section>';
  document.getElementById("detailBody").innerHTML=body||'<div class="empty" style="margin-top:18px">No additional details yet.</div>';
  document.getElementById("modal").classList.add("open");
}
async function load(){
  const data=await api("/api/story-bible");
  SNAP=data.snapshot;
  const dot=document.getElementById("statusDot"),status=document.getElementById("syncStatus");dot.className="dot "+(data.status==="ok"?"ok":data.status==="error"?"error":"");
  status.innerHTML=data.status==="error"?'<span class="error">Last sync failed: '+esc(data.error||"Unknown error")+'</span>':"Last synced: "+esc(fmt(data.synced_at));
  render();
}
document.getElementById("search").oninput=e=>{QUERY=e.target.value;render()};
document.getElementById("typeFilter").onchange=e=>{TYPE=e.target.value;render()};
document.getElementById("seriesFilter").onchange=e=>{SERIES=e.target.value;render()};
document.getElementById("closeBtn").onclick=()=>document.getElementById("modal").classList.remove("open");
document.getElementById("modal").onclick=e=>{if(e.target.id==="modal")e.currentTarget.classList.remove("open")};
document.getElementById("syncBtn").onclick=async()=>{const b=document.getElementById("syncBtn"),dot=document.getElementById("statusDot"),status=document.getElementById("syncStatus");b.disabled=true;b.textContent="Syncing…";dot.className="dot syncing";status.textContent="Syncing from Orbismo…";try{const data=await api("/api/story-bible/sync",{method:"POST"});SNAP=data.snapshot;await load()}catch(e){status.innerHTML='<span class="error">'+esc(e.message)+'</span>'}finally{b.disabled=false;b.textContent="Sync now"}};
load().catch(e=>{document.getElementById("syncStatus").innerHTML='<span class="error">'+esc(e.message)+'</span>'});
setInterval(()=>load().catch(()=>{}),60000);
</script>
</body></html>`;
}

function hotGuysPage() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><title>HG · DC1993</title>
<style>
:root{--bg:#100e0f;--panel:#1b1719;--panel2:#241e21;--line:rgba(255,255,255,.09);--text:#f5eff2;--muted:#aa9fa4;--accent:#c49a83}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:Arial,sans-serif;min-height:100vh}button,input,textarea,select{font:inherit}a{color:inherit}.shell{width:min(1180px,calc(100% - 28px));margin:auto;padding:24px 0 70px}
.top{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;border-bottom:1px solid var(--line);padding-bottom:20px;margin-bottom:18px}.eyebrow{font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--accent);font-weight:800;margin:0 0 8px}.top h1{font:700 clamp(40px,7vw,68px)/1 Georgia,serif;margin:0}.sub{color:var(--muted);line-height:1.55;margin:9px 0 0}.actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.btn{border:1px solid var(--line);background:var(--panel);color:var(--text);border-radius:999px;padding:11px 15px;font-weight:700;text-decoration:none;cursor:pointer}.btn.primary{background:var(--accent);color:#1a1314;border-color:transparent}
.statusbar{display:flex;gap:10px;align-items:center;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:12px 14px;color:var(--muted);font-size:13px;margin-bottom:16px}.dot{width:8px;height:8px;border-radius:50%;background:#777}.dot.ok{background:#77b88a}.dot.error{background:#df7e86}.dot.syncing{background:#d3a565}
.controls{display:grid;grid-template-columns:1fr 190px auto;gap:10px;margin-bottom:16px}.control{width:100%;border:1px solid var(--line);background:#151114;color:var(--text);padding:13px 14px;border-radius:12px}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px}.stat{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:15px}.stat b{display:block;font:700 29px Georgia,serif}.stat span{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.card{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:18px;cursor:pointer}.card:hover{border-color:rgba(196,154,131,.45)}.card h2{font:700 25px Georgia,serif;margin:5px 0 7px}.meta{font-size:12px;color:var(--accent);text-transform:uppercase;letter-spacing:.08em}.desc{color:var(--muted);line-height:1.5}.chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:11px}.chip{font-size:11px;border:1px solid var(--line);padding:5px 8px;border-radius:999px;color:#d8cdd2}.empty{background:var(--panel);border:1px solid var(--line);border-radius:18px;color:var(--muted);padding:44px 20px;text-align:center;grid-column:1/-1}
.modal{position:fixed;inset:0;background:rgba(0,0,0,.76);display:none;align-items:flex-start;justify-content:center;padding:24px 12px;overflow:auto;z-index:50}.modal.open{display:flex}.dialog{width:min(840px,100%);background:#171316;border:1px solid var(--line);border-radius:22px;padding:20px}.modalhead{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.modalhead h2{font:700 34px Georgia,serif;margin:0}.close{border:0;background:transparent;color:var(--text);font-size:29px;cursor:pointer}.formgrid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px}.full{grid-column:1/-1}label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:#c8bbc1;margin-bottom:6px;font-weight:700}input,textarea,select{width:100%;border:1px solid var(--line);background:#100d0f;color:var(--text);border-radius:11px;padding:12px 13px;outline:none}textarea{min-height:100px;resize:vertical;line-height:1.5}
.section{border-top:1px solid var(--line);margin-top:20px;padding-top:18px}.sectionhead{display:flex;align-items:center;justify-content:space-between;gap:12px}.section h3{font:700 22px Georgia,serif;margin:0}.note{background:var(--panel2);border-radius:13px;padding:14px;margin-top:10px}.note h4{font:700 18px Georgia,serif;margin:0 0 7px}.note p{white-space:pre-wrap;color:#e2d8dd;line-height:1.58;margin:0}.noteactions{display:flex;gap:7px;margin-top:10px}.mini{border:1px solid var(--line);background:transparent;color:var(--text);border-radius:9px;padding:7px 9px;cursor:pointer;font-size:12px}.mini.danger{color:#ffadb4}.savebar{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}.error{color:#ffadb4}
@media(max-width:760px){.top{display:block}.actions{justify-content:flex-start;margin-top:14px}.controls{grid-template-columns:1fr}.stats{grid-template-columns:repeat(2,1fr)}.grid{grid-template-columns:1fr}.formgrid{grid-template-columns:1fr}.full{grid-column:auto}}
</style></head><body><div class="shell">
<div class="top"><div><p class="eyebrow">PRIVATE ARCHIVE</p><h1>Hot Guys</h1><p class="sub">Who, why, and exactly when the problem began.</p></div><div class="actions"><button class="btn primary" id="syncBtn">Sync now</button><a class="btn" href="/admin">Admin</a></div></div>
<div class="statusbar"><span class="dot" id="dot"></span><span id="status">Loading…</span></div>
<div class="controls"><input class="control" id="search" type="search" placeholder="Search names, features, vibes, lore…"><select class="control" id="filter"><option value="">All statuses</option><option>current</option><option>recurring</option><option>former</option><option>one-off</option><option>unknown</option></select><button class="btn primary" id="addBtn">+ Add guy</button></div>
<div class="stats" id="stats"></div><div class="grid" id="grid"></div></div>
<div class="modal" id="modal"><div class="dialog"><div class="modalhead"><h2 id="modalTitle">Entry</h2><button class="close" id="close">×</button></div><input type="hidden" id="entityId">
<div class="formgrid"><div><label>Name / label</label><input id="name"></div><div><label>Attraction status</label><select id="attraction_status"><option value=""></option><option>current</option><option>recurring</option><option>former</option><option>one-off</option><option>unknown</option></select></div><div class="full"><label>Description</label><textarea id="description"></textarea></div><div><label>First noticed</label><input id="first_noticed" placeholder="2026-09-24 or Summer 2020"></div><div><label>Last noted</label><input id="last_noted" placeholder="2026-09-24"></div><div class="full"><label>Known from</label><input id="known_from" placeholder="Instagram, actor, real life, photo…"></div><div><label>Favorite features</label><textarea id="favorite_features" placeholder="One per line"></textarea></div><div><label>Vibe tags</label><textarea id="vibe_tags" placeholder="One per line"></textarea></div><div class="full"><label>Aliases / labels</label><textarea id="aliases" placeholder="One per line"></textarea></div></div>
<div class="savebar"><button class="btn primary" id="savePerson">Save entry</button></div>
<div class="section" id="loreSection"><div class="sectionhead"><h3>Dated notes</h3><button class="mini" id="newNote">+ Add note</button></div><div id="notes"></div><div id="noteEditor" style="display:none;margin-top:12px"><input type="hidden" id="loreId"><label>Note title</label><input id="loreTitle" placeholder="2026-09-24 — Blue plaid photo"><label style="margin-top:10px">Note</label><textarea id="loreContent" style="min-height:150px"></textarea><div class="savebar"><button class="btn primary" id="saveNote">Save note</button><button class="btn" id="cancelNote">Cancel</button></div></div></div>
</div></div>
<script>
let CACHE=null,SNAP=null,PEOPLE=[],CURRENT=null;
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
const arr=v=>Array.isArray(v)?v:[];
const fmt=d=>{if(!d)return"Never";try{return new Date(d).toLocaleString()}catch{return d}};
async function api(path,opt={}){const r=await fetch(path,opt);if(r.status===401){location="/hot-guys";throw new Error("Unauthorized")}const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||"Request failed");return j}
function hay(p){return [p.name,p.short_description,JSON.stringify(p.properties||{}),...(p.lore?.items||[]).map(x=>(x.title||"")+" "+(x.content||""))].join(" ").toLowerCase()}
function stat(label,n){return '<div class="stat"><b>'+esc(n)+'</b><span>'+esc(label)+'</span></div>'}
function card(p){const pr=p.properties||{};const features=arr(pr.favorite_features).slice(0,5).map(x=>'<span class="chip">'+esc(x)+'</span>').join("");return '<div class="card" data-id="'+esc(p.entity_id)+'"><div class="meta">'+esc(pr.attraction_status||"unclassified")+'</div><h2>'+esc(p.name)+'</h2><div class="desc">'+esc(p.short_description||pr.known_from||"")+'</div>'+(features?'<div class="chips">'+features+'</div>':'')+'</div>'}
function render(){PEOPLE=(SNAP?.entities||[]).filter(x=>x.entity_type==="person"&&((x.tags||[]).includes("hot-guy")||(x.relationships?.items||[]).some(r=>r.entity_id==="group/the_roster")));const q=$("search").value.trim().toLowerCase(),status=$("filter").value;const shown=PEOPLE.filter(p=>(!q||hay(p).includes(q))&&(!status||String(p.properties?.attraction_status||"unknown")===status));const current=PEOPLE.filter(p=>p.properties?.attraction_status==="current").length,recurring=PEOPLE.filter(p=>p.properties?.attraction_status==="recurring").length,notes=PEOPLE.reduce((n,p)=>n+(p.lore?.items||[]).length,0);$("stats").innerHTML=stat("Roster",PEOPLE.length)+stat("Current",current)+stat("Recurring",recurring)+stat("Notes",notes);$("grid").innerHTML=shown.map(card).join("")||'<div class="empty">'+(PEOPLE.length?"Nothing matches that filter.":"The roster is empty. This is either peaceful or temporary.")+'</div>'}
async function load(force=false){$("dot").className="dot syncing";$("status").textContent=force?"Syncing…":"Loading…";CACHE=await api(force?"/api/hot-guys/sync":"/api/hot-guys",force?{method:"POST"}:{});SNAP=CACHE.snapshot;$("dot").className="dot "+(CACHE.status==="ok"?"ok":CACHE.status==="error"?"error":"");$("status").innerHTML='Last synced: '+esc(fmt(CACHE.synced_at))+(CACHE.error?' · <span class="error">'+esc(CACHE.error)+'</span>':'');render()}
function blank(){CURRENT=null;$("entityId").value="";$("name").value="";$("description").value="";["first_noticed","last_noted","known_from"].forEach(k=>$(k).value="");$("attraction_status").value="";["favorite_features","vibe_tags","aliases"].forEach(k=>$(k).value="");$("notes").innerHTML="";$("loreSection").style.display="none";$("noteEditor").style.display="none";$("modalTitle").textContent="Add to the roster";$("modal").classList.add("open")}
function openPerson(id){CURRENT=PEOPLE.find(x=>x.entity_id===id);if(!CURRENT)return;const pr=CURRENT.properties||{};$("entityId").value=CURRENT.entity_id;$("name").value=CURRENT.name||"";$("description").value=CURRENT.short_description||"";["first_noticed","last_noted","known_from","attraction_status"].forEach(k=>$(k).value=pr[k]||"");["favorite_features","vibe_tags","aliases"].forEach(k=>$(k).value=arr(pr[k]).join("\\n"));$("modalTitle").textContent=CURRENT.name;$("loreSection").style.display="block";renderNotes();$("noteEditor").style.display="none";$("modal").classList.add("open")}
function renderNotes(){const items=[...(CURRENT?.lore?.items||[])].sort((a,b)=>String(a.title||"").localeCompare(String(b.title||"")));$("notes").innerHTML=items.map(n=>'<div class="note"><h4>'+esc(n.title||"Untitled")+'</h4><p>'+esc(n.content||"")+'</p><div class="noteactions"><button class="mini editNote" data-id="'+esc(n.lore_id)+'">Edit</button><button class="mini danger deleteNote" data-id="'+esc(n.lore_id)+'">Delete</button></div></div>').join("")||'<div class="desc" style="margin-top:10px">No dated notes yet.</div>'}
function personBody(){return {entity_id:$("entityId").value,name:$("name").value,description:$("description").value,properties:{first_noticed:$("first_noticed").value,last_noted:$("last_noted").value,known_from:$("known_from").value,attraction_status:$("attraction_status").value,favorite_features:$("favorite_features").value,vibe_tags:$("vibe_tags").value,aliases:$("aliases").value}}}
$("syncBtn").onclick=()=>load(true).catch(showError);$("search").oninput=render;$("filter").onchange=render;$("addBtn").onclick=blank;$("close").onclick=()=>$("modal").classList.remove("open");$("grid").onclick=e=>{const c=e.target.closest(".card");if(c)openPerson(c.dataset.id)};
$("savePerson").onclick=async()=>{try{const body=personBody();const j=await api(body.entity_id?"/api/hot-guys/person/update":"/api/hot-guys/person/create",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});CACHE=j.cache||CACHE;SNAP=CACHE?.snapshot||SNAP;render();openPerson(j.entity_id||body.entity_id)}catch(e){alert(e.message)}};
$("newNote").onclick=()=>{$("loreId").value="";$("loreTitle").value="";$("loreContent").value="";$("noteEditor").style.display="block";$("loreTitle").focus()};$("cancelNote").onclick=()=>$("noteEditor").style.display="none";
$("notes").onclick=async e=>{const edit=e.target.closest(".editNote"),del=e.target.closest(".deleteNote");if(edit){const n=(CURRENT?.lore?.items||[]).find(x=>x.lore_id===edit.dataset.id);if(!n)return;$("loreId").value=n.lore_id;$("loreTitle").value=n.title||"";$("loreContent").value=n.content||"";$("noteEditor").style.display="block";$("loreTitle").focus()}if(del){if(!confirm("Delete this note? This cannot be undone."))return;try{const j=await api("/api/hot-guys/lore/delete",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({entity_id:CURRENT.entity_id,lore_id:del.dataset.id})});CACHE=j.cache;SNAP=CACHE.snapshot;render();openPerson(CURRENT.entity_id)}catch(err){alert(err.message)}}};
$("saveNote").onclick=async()=>{if(!CURRENT)return;try{const j=await api("/api/hot-guys/lore/save",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({entity_id:CURRENT.entity_id,lore_id:$("loreId").value,title:$("loreTitle").value,content:$("loreContent").value})});CACHE=j.cache;SNAP=CACHE.snapshot;render();openPerson(CURRENT.entity_id)}catch(err){alert(err.message)}};
function showError(e){$("dot").className="dot error";$("status").innerHTML='<span class="error">'+esc(e.message)+'</span>'}
load().catch(showError);setInterval(()=>load().catch(()=>{}),60000);
</script></body></html>`;
}

function loginPage(next = "/admin") {
  const target = next === "/story-bible" ? "/story-bible" : next === "/hot-guys" ? "/hot-guys" : "/admin";
  const heading = target === "/story-bible" ? "Story Bible" : target === "/hot-guys" ? "HG" : "Site Admin";

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><title>${heading} · DC1993</title><style>
*{box-sizing:border-box}body{margin:0;background:#11100f;color:#f2eee9;font-family:Arial,sans-serif;min-height:100vh;display:grid;place-items:center;padding:20px}
.card{width:min(430px,100%);background:#1c1916;border:1px solid rgba(255,255,255,.1);border-radius:24px;padding:30px}
h1{font-family:Georgia,serif;font-size:40px;margin:0 0 8px}.sub{color:#aaa198;line-height:1.6;margin-bottom:24px}
label{display:block;font-size:13px;margin-bottom:8px}.input{width:100%;padding:14px 15px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:#12100f;color:white;font-size:16px}
button{width:100%;margin-top:14px;padding:14px;border:0;border-radius:999px;background:#c09b73;color:#17120f;font-weight:700;font-size:15px}
#error{color:#ff9b9b;min-height:20px;margin-top:12px;font-size:13px}</style></head>
<body><form class="card" id="f"><h1>${heading}</h1><div class="sub">${target === "/story-bible" ? "Private story reference. Sign in with your site admin password." : target === "/hot-guys" ? "Private archive. Sign in with your site admin password." : "Edit dc1993.com without touching code."}</div><label for="p">Admin password</label><input class="input" id="p" type="password" autocomplete="current-password" required><button>Sign in</button><div id="error"></div></form>
<script>document.getElementById("f").onsubmit=async e=>{e.preventDefault();const r=await fetch("/api/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({password:document.getElementById("p").value})});if(r.ok){location=${JSON.stringify(target)}}else{const j=await r.json().catch(()=>({}));document.getElementById("error").textContent=j.error||"Could not sign in."}}</script>
</body></html>`;
}

function adminPage() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><title>DC1993 Admin</title>
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
.check{display:flex;align-items:center;gap:8px;margin-top:26px}.check input{width:20px;height:20px}.preview{max-width:170px;border-radius:9px;margin-top:10px}.authorPreview{width:130px;height:130px;object-fit:cover;border-radius:50%;border:1px solid var(--line);margin-top:12px}.projectPreview{width:min(420px,100%);aspect-ratio:16/9;object-fit:cover;border-radius:14px;border:1px solid var(--line);margin-top:12px}
.toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:#ece5dd;color:#18130f;padding:12px 16px;border-radius:999px;font-weight:700;font-size:13px;opacity:0;pointer-events:none;transition:.2s;z-index:99}.toast.show{opacity:1}
hr{border:0;border-top:1px solid var(--line);margin:24px 0}
@media(max-width:700px){.grid{grid-template-columns:1fr}.full{grid-column:auto}.box{padding:20px 16px}.bookrow{grid-template-columns:58px minmax(0,1fr)}.thumb{width:58px;height:86px}.rowBtns{grid-column:1/-1;justify-content:flex-start}.check{margin-top:0}.top h1{font-size:22px}}
</style></head>
<body><div class="shell">
<div class="top"><h1>dc1993.com Admin</h1><div style="display:flex;gap:14px"><a href="/hot-guys">HG</a><a href="/" target="_blank">View site ↗</a><a href="#" id="logout">Sign out</a></div></div>
<div class="tabs">
<button class="active" data-tab="home">Homepage</button>
<button data-tab="books">Books</button>
<button data-tab="about">About</button>
<button data-tab="projects">Projects</button>
<button data-tab="updates">Updates</button>
</div>

<section class="panel active" id="home">
<div class="box"><h2>Homepage</h2><p class="hint">Change the main wording visitors see first.</p>
<div class="grid">
<div class="full"><label>Author name</label><input id="author_name" type="text"></div>
<div class="full"><label>Small heading</label><input id="eyebrow" type="text"></div>
<div class="full"><label>Main headline</label><textarea id="hero_title"></textarea></div>
<div class="full"><label>Intro text</label><textarea id="hero_text"></textarea></div>
<div class="full"><hr><h2 style="font-size:24px">Homepage cards</h2><p class="hint">Edit the three navigation cards shown below the homepage hero.</p></div>
<div><label>Books card small heading</label><input id="home_books_eyebrow" type="text"></div>
<div><label>Books card heading</label><input id="home_books_heading" type="text"></div>
<div class="full"><label>Books card text</label><textarea id="home_books_text"></textarea></div>
<div><label>Projects card small heading</label><input id="home_projects_eyebrow" type="text"></div>
<div><label>Projects card heading</label><input id="home_projects_heading" type="text"></div>
<div class="full"><label>Projects card text</label><textarea id="home_projects_text"></textarea></div>
<div><label>About card small heading</label><input id="home_about_eyebrow" type="text"></div>
<div><label>About card heading</label><input id="home_about_heading" type="text"></div>
<div class="full"><label>About card text</label><textarea id="home_about_text"></textarea></div>
<div><label>Primary button text</label><input id="home_books_button" type="text"></div>
<div><label>Primary button destination</label><input id="home_books_button_url" type="text" placeholder="/books or https://..."></div>
<div class="full"><label class="check"><input id="home_books_button_visible" type="checkbox"> Show primary button</label></div>
<div><label>Secondary button text</label><input id="home_projects_button" type="text"></div>
<div><label>Secondary button destination</label><input id="home_projects_button_url" type="text" placeholder="/projects or https://..."></div>
<div class="full"><label class="check"><input id="home_projects_button_visible" type="checkbox"> Show secondary button</label></div>
<div class="full"><hr><h2 style="font-size:24px">Site-wide labels</h2><p class="hint">Edit navigation, contact information, and footer labels.</p></div>
<div><label>Home nav label</label><input id="nav_home" type="text"></div>
<div><label>Books nav label</label><input id="nav_books" type="text"></div>
<div><label>Projects nav label</label><input id="nav_projects" type="text"></div>
<div><label>About nav label</label><input id="nav_about" type="text"></div>
<div class="full"><label>Contact email</label><input id="contact_email" type="text"></div>
<div><label>Contact link label</label><input id="footer_contact_label" type="text"></div>
<div><label>Admin link label</label><input id="footer_admin_label" type="text"></div>
<div class="full"><label>Social / external links</label><textarea id="social_links" placeholder="Instagram | https://instagram.com/yourname&#10;GitHub | https://github.com/yourname"></textarea><p class="hint" style="margin-top:7px">One link per line using Label | URL. Add as many sites as you want.</p></div>
<div class="full"><label>Footer text</label><input id="footer_text" type="text"></div>
</div><div class="actions"><button class="btn primary" onclick="saveSettings()">Save homepage</button></div></div>
</section>

<section class="panel" id="books">
<div class="box"><h2>Books page</h2><p class="hint">Edit the wording shown above your book list.</p>
<div class="grid">
<div class="full"><label>Small heading</label><input id="books_eyebrow" type="text"></div>
<div class="full"><label>Page heading</label><input id="books_heading" type="text"></div>
<div class="full"><label>Subheader / intro text</label><textarea id="books_text"></textarea></div>
</div><div class="actions"><button class="btn primary" onclick="saveSettings()">Save books page text</button></div></div>
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

<section class="panel" id="about"><div class="box"><h2>About</h2><p class="hint">Edit your author bio and profile photo whenever you want.</p>
<div class="grid">
<div class="full"><label>Small heading</label><input id="about_eyebrow" type="text"></div>
<div class="full"><label>Heading</label><input id="about_heading" type="text"></div>
<div class="full"><label>Author photo</label><input id="author_photo_file" type="file" accept="image/*"><input id="author_photo_key" type="hidden"><img id="authorPhotoPreview" class="authorPreview" style="display:none" alt="Author photo preview"></div>
<div class="full"><label>About text</label><textarea id="about_text" style="min-height:230px"></textarea></div>
</div>
<div class="actions"><button class="btn primary" onclick="saveSettings()">Save about section</button></div></div></section>

<section class="panel" id="projects"><div class="box"><h2>Projects</h2><p class="hint">Edit the dedicated Projects page and upload a showcase image for each program.</p>
<div class="grid">
<div class="full"><label>Small heading</label><input id="projects_eyebrow" type="text"></div>
<div class="full"><label>Page heading</label><input id="projects_heading" type="text"></div>
<div class="full"><label>Page introduction</label><textarea id="projects_text"></textarea></div>
<div><label>Remnant category label</label><input id="remnant_eyebrow" type="text"></div>
<div><label>Witness category label</label><input id="witness_eyebrow" type="text"></div>
<div><label>Remnant title</label><input id="remnant_title" type="text"></div>
<div><label>Witness title</label><input id="witness_title" type="text"></div>
<div class="full"><label>Remnant showcase image</label><input id="remnant_image_file" type="file" accept="image/*"><input id="remnant_image_key" type="hidden"><img id="remnantImagePreview" class="projectPreview" style="display:none" alt="Remnant project image preview"></div>
<div class="full"><label>Remnant description</label><textarea id="remnant_text" style="min-height:170px"></textarea></div>
<div class="full"><label>Remnant skills / technologies</label><textarea id="remnant_skills" placeholder="One per line or comma-separated"></textarea></div>
<div class="full"><label>Witness showcase image</label><input id="witness_image_file" type="file" accept="image/*"><input id="witness_image_key" type="hidden"><img id="witnessImagePreview" class="projectPreview" style="display:none" alt="Witness project image preview"></div>
<div class="full"><label>Witness description</label><textarea id="witness_text" style="min-height:170px"></textarea></div>
<div class="full"><label>Witness skills / technologies</label><textarea id="witness_skills" placeholder="One per line or comma-separated"></textarea></div>
</div>
<div class="actions"><button class="btn primary" onclick="saveSettings()">Save projects</button></div></div></section>

<section class="panel" id="updates"><div class="box"><h2>Updates</h2><p class="hint">Control the update/newsletter area on the homepage.</p>
<div class="grid"><div class="full"><label>Small heading</label><input id="updates_eyebrow" type="text"></div><div class="full"><label>Heading</label><input id="updates_heading" type="text"></div><div class="full"><label>Text</label><textarea id="updates_text"></textarea></div><div class="full"><hr><h2 style="font-size:24px">Featured Instagram</h2><p class="hint">Post 1 stays pinned first. Posts 2–4 are filled automatically from your latest Instagram uploads. The manual fields for 2–4 remain as fallbacks if the Instagram API is unavailable.</p></div><div class="full"><label>Instagram section heading</label><input id="instagram_heading" type="text"></div><div class="full"><label>Pinned Instagram post 1</label><input id="instagram_post_url_1" type="url" placeholder="Paid/ad post stays first"></div><div class="full"><label>Fallback post 2</label><input id="instagram_post_url_2" type="url" placeholder="Used only if automatic Instagram loading fails"></div><div class="full"><label>Fallback post 3</label><input id="instagram_post_url_3" type="url" placeholder="Used only if automatic Instagram loading fails"></div><div class="full"><label>Fallback post 4</label><input id="instagram_post_url_4" type="url" placeholder="Used only if automatic Instagram loading fails"></div></div>
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
function fillSettings(){
  for(const [k,v] of Object.entries(DATA.settings||{})){if($(k)&&$(k).type!=="checkbox")$(k).value=v}
  ["home_books_button_visible","home_projects_button_visible"].forEach(id=>{if($(id))$(id).checked=String((DATA.settings||{})[id]??"1")!=="0"});
  const key=String((DATA.settings||{}).author_photo_key||"").trim();
  if($("author_photo_key"))$("author_photo_key").value=key;
  if($("authorPhotoPreview")){
    $("authorPhotoPreview").src=key?"/media/"+key:"";
    $("authorPhotoPreview").style.display=key?"block":"none";
  }
  if($("author_photo_file"))$("author_photo_file").value="";
  [["remnant","remnant_image_key","remnantImagePreview"],["witness","witness_image_key","witnessImagePreview"]].forEach(([name,keyId,previewId])=>{
    const key=String((DATA.settings||{})[keyId]||"").trim();
    if($(keyId))$(keyId).value=key;
    if($(previewId)){$(previewId).src=key?"/media/"+key:"";$(previewId).style.display=key?"block":"none"}
    if($(name+"_image_file"))$(name+"_image_file").value="";
  });
}
if($("author_photo_file"))$("author_photo_file").onchange=()=>{
  const f=$("author_photo_file").files[0];
  if(f){
    $("authorPhotoPreview").src=URL.createObjectURL(f);
    $("authorPhotoPreview").style.display="block";
  }
};
[["remnant","remnantImagePreview"],["witness","witnessImagePreview"]].forEach(([name,previewId])=>{
  if($(name+"_image_file"))$(name+"_image_file").onchange=()=>{
    const f=$(name+"_image_file").files[0];
    if(f){$(previewId).src=URL.createObjectURL(f);$(previewId).style.display="block"}
  };
});
async function saveSettings(){
  if($("author_photo_file")){
    const file=$("author_photo_file").files[0];
    if(file){
      const fd=new FormData();
      fd.append("file",file);
      fd.append("oldKey",$("author_photo_key").value||"");
      const up=await api("/api/admin/upload-author-photo",{method:"POST",body:fd});
      $("author_photo_key").value=up.photo_key||"";
    }
  }
  for(const name of ["remnant","witness"]){
    const input=$(name+"_image_file");
    const file=input&&input.files?input.files[0]:null;
    if(file){
      const fd=new FormData();fd.append("file",file);fd.append("project",name);fd.append("oldKey",$(name+"_image_key").value||"");
      const up=await api("/api/admin/upload-project-image",{method:"POST",body:fd});
      $(name+"_image_key").value=up.image_key||"";
    }
  }
  const ids=["author_name","eyebrow","hero_title","hero_text","home_books_eyebrow","home_books_heading","home_books_text","home_projects_eyebrow","home_projects_heading","home_projects_text","home_about_eyebrow","home_about_heading","home_about_text","home_books_button","home_books_button_url","home_books_button_visible","home_projects_button","home_projects_button_url","home_projects_button_visible","nav_home","nav_books","nav_projects","nav_about","contact_email","footer_contact_label","footer_admin_label","social_links","books_eyebrow","books_heading","books_text","about_eyebrow","about_heading","about_text","author_photo_key","projects_eyebrow","projects_heading","projects_text","remnant_eyebrow","remnant_title","remnant_image_key","remnant_text","remnant_skills","witness_eyebrow","witness_title","witness_image_key","witness_text","witness_skills","updates_eyebrow","updates_heading","updates_text","instagram_heading","instagram_post_url_1","instagram_post_url_2","instagram_post_url_3","instagram_post_url_4","footer_text"];
  const body={};
  ids.forEach(id=>{if(!$(id))return;body[id]=$(id).type==="checkbox"?($(id).checked?"1":"0"):$(id).value});
  await api("/api/admin/settings",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  toast("Saved");
  await load();
}
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
