// Cloudflare Git reconnect deployment probe.
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

      if (url.pathname === "/chat-archive" || url.pathname === "/chat-archive/") {
        const authed = await isAuthenticated(request, env);
        return privateHtml(authed ? chatArchivePage() : loginPage("/chat-archive"));
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
    ctx.waitUntil(syncStoryBible(env).catch(() => {}));
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
        review_url TEXT NOT NULL DEFAULT '',
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
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS chat_archive_conversations (
        archive_key TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL DEFAULT '',
        entity_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        source_updated_at TEXT NOT NULL DEFAULT '',
        message_count INTEGER NOT NULL DEFAULT 0,
        chunk_count INTEGER NOT NULL DEFAULT 0,
        content_hash TEXT NOT NULL DEFAULT '',
        imported_at TEXT NOT NULL DEFAULT ''
      )
    `)
  ]);

  const bookColumns = await env.DB.prepare("PRAGMA table_info(books)").all();
  if (!(bookColumns.results || []).some(row => row.name === "review_url")) {
    await env.DB.prepare("ALTER TABLE books ADD COLUMN review_url TEXT NOT NULL DEFAULT ''").run();
  }

  const reviewDefaults = [
    ["nothing-to-run-from", "nothing to run from", "https://www.amazon.com/review/create-review?asin=B0HKDMBSP3"],
    ["falling-into-nothing", "falling into nothing", "https://www.amazon.com/review/create-review?asin=B0HKRCXSXK"],
    ["fragments", "fragments", "https://www.amazon.com/review/create-review?asin=B0HKPZGTC8"]
  ];
  for (const [bookId, bookTitle, reviewUrl] of reviewDefaults) {
    await env.DB.prepare(
      "UPDATE books SET review_url=? WHERE (id=? OR lower(title)=?) AND COALESCE(review_url, '')=''"
    ).bind(reviewUrl, bookId, bookTitle).run();
  }

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
      book_review_visible: "1",
      book_review_heading: "Enjoyed the book?",
      book_review_text: "Please leave a review! Reviews help other readers discover the story and make a huge difference for an independent author.",
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
      book_review_visible: "1",
      book_review_heading: "Enjoyed the book?",
      book_review_text: "Please leave a review! Reviews help other readers discover the story and make a huge difference for an independent author.",
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

  if (path.startsWith("/api/hot-guys")) {
    return privateJson({ error: "This private archive has been retired." }, 410);
  }

  if (path === "/api/chat-archive/status" && request.method === "GET") {
    await ensureSchema(env);
    const row = await env.DB.prepare("SELECT COUNT(*) AS conversations, COALESCE(SUM(message_count),0) AS messages, COALESCE(SUM(chunk_count),0) AS chunks, COALESCE(MAX(imported_at),'') AS last_imported_at FROM chat_archive_conversations").first();
    return privateJson({
      conversations: Number(row?.conversations || 0),
      messages: Number(row?.messages || 0),
      chunks: Number(row?.chunks || 0),
      last_imported_at: row?.last_imported_at || ""
    });
  }

  if (path === "/api/chat-archive/search" && request.method === "GET") {
    const q = String(url.searchParams.get("q") || "").trim();
    if (!q) return privateJson({ results: [] });
    const session = await openChatArchiveSession(env);
    const found = await chatArchiveTool(session, env, "search_lore", {
      query: q.slice(0, 1000),
      entity_type: "reference",
      limit: 20
    });
    return privateJson(found);
  }

  if (path === "/api/chat-archive/import-conversation" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return privateJson({ error: "Invalid conversation payload." }, 400);

    const archiveKey = String(body.archive_key || body.conversation_id || "").trim();
    const conversationId = String(body.conversation_id || "").trim();
    const title = (String(body.title || "Untitled conversation").trim() || "Untitled conversation").slice(0, 500);
    const incoming = Array.isArray(body.messages) ? body.messages : [];
    if (!archiveKey) return privateJson({ error: "Conversation key is missing." }, 400);
    if (!incoming.length) return privateJson({ ok: true, skipped: true, reason: "No visible user/assistant messages." });

    const messages = incoming.map((m, i) => ({
      id: String(m?.id || "").trim(),
      role: m?.role === "assistant" ? "assistant" : "user",
      time: String(m?.time || "").trim(),
      text: String(m?.text ?? ""),
      attachments: Array.isArray(m?.attachments) ? m.attachments.slice(0, 50) : [],
      index: Number.isFinite(Number(m?.index)) ? Number(m.index) : i
    }));

    const contentHash = await sha256Hex(JSON.stringify(messages));
    await ensureSchema(env);
    const existing = await env.DB.prepare("SELECT * FROM chat_archive_conversations WHERE archive_key=?").bind(archiveKey).first();
    if (existing?.content_hash === contentHash) {
      return privateJson({
        ok: true, skipped: true, entity_id: existing.entity_id,
        message_count: Number(existing.message_count || 0),
        chunk_count: Number(existing.chunk_count || 0)
      });
    }

    const session = await openChatArchiveSession(env);
    const now = new Date().toISOString();
    const createdAt = archiveSourceTime(body.created_at);
    const updatedAt = archiveSourceTime(body.updated_at);
    const attachmentCount = messages.reduce((n, m) => n + m.attachments.length, 0);
    const props = {
      conversation_title: title,
      source_platform: "ChatGPT",
      import_source: "chatgpt-export",
      imported_at: now,
      message_count: messages.length,
      attachment_count: attachmentCount,
      archive_version: "1"
    };
    if (conversationId) props.conversation_id = conversationId;
    if (createdAt) props.created_at = createdAt;
    if (updatedAt) props.updated_at_source = updatedAt;
    const lastMessageId = [...messages].reverse().find(m => m.id)?.id || "";
    if (lastMessageId) props.last_source_message_id = lastMessageId;

    let entityId = String(existing?.entity_id || "");
    if (!entityId) {
      const shortId = (conversationId || archiveKey).replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "archive";
      const created = await chatArchiveTool(session, env, "create_entities", {
        entities: [{
          entity_type: "reference",
          name: (title + " [" + shortId + "]").slice(0, 255),
          description: ("Verbatim ChatGPT conversation archive. Original title: " + title).slice(0, 2000),
          properties: { source_type: "document", ...props },
          tags: ["chatgpt-conversation", "chatgpt-archive"]
        }],
        skip_existing: false
      });
      entityId = created.created?.[0]?.entity_id || "";
      if (!entityId) throw new Error("Orbismo did not return a conversation entity ID.");
    } else {
      await chatArchiveTool(session, env, "update_entity", {
        entity_id: entityId,
        updates: {
          description: ("Verbatim ChatGPT conversation archive. Original title: " + title).slice(0, 2000),
          properties: props,
          tags: ["chatgpt-conversation", "chatgpt-archive"]
        },
        merge_mode: "merge"
      });
      const oldLore = await listArchiveLoreIds(session, env, entityId);
      for (const loreId of oldLore) {
        await chatArchiveTool(session, env, "delete_entity_lore", { entity_id: entityId, lore_id: loreId });
      }
    }

    const chunks = buildArchiveChunks(messages);
    for (let i = 0; i < chunks.length; i++) {
      await chatArchiveTool(session, env, "create_entity_lore", {
        entity_id: entityId,
        title: archiveChunkTitle(chunks[i], i, chunks.length),
        content: chunks[i].content,
        display_index: i
      });
    }

    await env.DB.prepare("INSERT INTO chat_archive_conversations (archive_key,conversation_id,entity_id,title,source_updated_at,message_count,chunk_count,content_hash,imported_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(archive_key) DO UPDATE SET conversation_id=excluded.conversation_id,entity_id=excluded.entity_id,title=excluded.title,source_updated_at=excluded.source_updated_at,message_count=excluded.message_count,chunk_count=excluded.chunk_count,content_hash=excluded.content_hash,imported_at=excluded.imported_at")
      .bind(archiveKey, conversationId, entityId, title, updatedAt || "", messages.length, chunks.length, contentHash, now).run();

    return privateJson({ ok: true, skipped: false, entity_id: entityId, message_count: messages.length, chunk_count: chunks.length });
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
      "books_eyebrow","books_heading","books_text","book_review_visible","book_review_heading","book_review_text",
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
        paperback_url,ebook_url,apple_url,kobo_url,review_url,visible,sort_order
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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
        review_url=excluded.review_url,
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
      String(b.review_url || ""),
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
.page-hero{padding:92px 0 48px}.page-hero.compact h1{font-size:clamp(46px,6vw,74px)}.main{padding:28px 0 100px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}.card{background:rgba(255,255,255,.035);border:1px solid var(--line);border-radius:25px;overflow:hidden}.cover{aspect-ratio:2/3;background:radial-gradient(circle at 50% 42%,rgba(126,90,147,.72),transparent 24%),linear-gradient(145deg,#281e2c,#120d15);position:relative;overflow:hidden}.cover.alt{background:linear-gradient(145deg,#30383d,#131719)}.cover.warm{background:radial-gradient(circle at 50% 20%,rgba(190,130,85,.3),transparent 28%),linear-gradient(#484247,#171618)}.cover img{width:100%;height:100%;object-fit:cover}.coverplaceholder{position:absolute;inset:0;padding:28px;display:flex;align-items:center;justify-content:center;text-align:center;font:700 42px/.9 Georgia,serif}.info{padding:28px}.genre{color:var(--accent);font-size:10px;font-weight:700;letter-spacing:.16em;text-transform:uppercase}.info h3{font-size:31px;margin:8px 0 12px}.info p{color:var(--muted);line-height:1.65;min-height:80px}.badge{display:inline-flex;border:1px solid rgba(192,155,115,.35);color:var(--accent);border-radius:999px;padding:10px 13px;font-size:12px;font-weight:700}.buy{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:20px}.buy a{border:1px solid var(--line);border-radius:12px;padding:11px 12px;text-decoration:none;text-align:center;font-size:12px}.empty{padding:50px;border:1px dashed var(--line);border-radius:20px;color:var(--muted);grid-column:1/-1}.review-note{margin-top:22px;padding:17px 18px;border:1px solid rgba(192,155,115,.26);border-radius:16px;background:linear-gradient(135deg,rgba(192,155,115,.09),rgba(118,99,126,.08));box-shadow:0 12px 28px rgba(0,0,0,.12)}.review-note strong{display:block;font:700 17px/1.25 Georgia,"Times New Roman",serif;color:var(--text);margin:0 0 6px}.review-note span{display:block;color:var(--muted);font-size:13px;line-height:1.55}.review-link{display:inline-flex;align-items:center;justify-content:center;margin-top:13px;border:1px solid rgba(192,155,115,.42);border-radius:999px;padding:10px 14px;color:var(--accent);text-decoration:none;font-size:12px;font-weight:700;transition:background .15s ease,border-color .15s ease,color .15s ease}.review-link:hover{background:var(--accent);border-color:var(--accent);color:#18130f}
.home-links{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px;padding:10px 0 30px}.home-links a{display:block;text-decoration:none;border:1px solid var(--line);border-radius:24px;padding:30px;background:rgba(255,255,255,.025)}.home-links h2{font-size:30px;margin:4px 0 12px}.home-links p{color:var(--muted);line-height:1.6;margin:0}.updates{margin:70px 0 36px;padding:48px;border:1px solid var(--line);border-radius:26px;background:radial-gradient(circle at 85% 20%,rgba(118,99,126,.23),transparent 22rem),var(--panel)}.updates h2{font-size:clamp(36px,4.5vw,56px);margin:0 0 14px}.updates p{color:var(--muted);line-height:1.7;max-width:760px}@media(max-width:620px){.instagram-card{border-radius:12px}.instagram-card img{aspect-ratio:auto;max-height:none;object-fit:contain;background:#000}}
.project-page-grid{display:grid;gap:28px;padding:10px 0 100px}.project-card.large{display:grid;grid-template-columns:minmax(300px,.9fr) minmax(0,1.1fr);border:1px solid var(--line);border-radius:26px;overflow:hidden;background:rgba(255,255,255,.03)}.project-image{min-height:360px;background:linear-gradient(145deg,#25201d,#151312);display:grid;place-items:center}.project-image img{width:100%;height:100%;object-fit:cover;min-height:360px}.project-copy{padding:44px;min-width:0}.project-copy h2{font-size:clamp(36px,4vw,52px);margin:0 0 18px;overflow-wrap:anywhere}.project-copy>p:not(.eyebrow){color:var(--muted);line-height:1.75;white-space:pre-line;margin:0}.skill-tags{display:flex;flex-wrap:wrap;gap:9px;margin-top:22px}.skill-tag{border:1px solid var(--line);border-radius:12px;padding:10px 12px;font-size:12px;line-height:1.2;color:var(--text);background:rgba(255,255,255,.015)}.skill-tags:empty{display:none}.project-image:has(img[src=""]){display:none}.project-card.large:has(.project-image img[src=""]){grid-template-columns:1fr}
.about-page{display:grid;grid-template-columns:minmax(0,.8fr) minmax(0,1.2fr);gap:60px;padding:100px 0 120px;align-items:start}.about-profile,.about-copy,.about-identity{min-width:0}.about-identity{display:flex;align-items:center;gap:24px}.author-photo-wrap{display:none;flex:0 0 auto}.author-photo{width:150px;height:150px;object-fit:cover;border-radius:50%;border:1px solid var(--line);box-shadow:0 18px 45px rgba(0,0,0,.28)}.about-page h1{font-size:clamp(42px,5vw,64px);max-width:100%;overflow-wrap:anywhere}.about-copy p{color:var(--muted);line-height:1.82;white-space:pre-line;font-size:17px;margin:42px 0 0}
footer{border-top:1px solid var(--line);padding:38px 0 48px;color:var(--muted);font-size:13px;display:flex;justify-content:space-between;gap:20px;align-items:flex-end}.footer-right{display:flex;flex-direction:column;align-items:flex-end;gap:10px;text-align:right}.footer-links{display:flex;gap:14px}.admin-link{font-size:10px;color:rgba(170,161,152,.52);text-decoration:none;letter-spacing:.10em;text-transform:uppercase}
@media(max-width:900px){.hero{grid-template-columns:1fr;padding-top:56px;gap:20px}.art{min-height:440px}.grid{grid-template-columns:1fr 1fr}.home-links{grid-template-columns:1fr}.page-hero.compact h1{font-size:clamp(40px,7.5vw,60px)}.project-card.large{grid-template-columns:1fr}.project-copy h2{font-size:clamp(34px,6.5vw,46px)}.about-page{grid-template-columns:1fr;gap:20px}.about-page h1{font-size:clamp(38px,6.5vw,52px)}}
@media(max-width:620px){.wrap{width:min(100% - 28px,var(--max))}header{height:78px}.brand span:last-child{font-size:20px;max-width:210px}nav{display:none;position:absolute;top:78px;left:14px;right:14px;background:#171411;border:1px solid var(--line);border-radius:16px;padding:18px;z-index:50;flex-direction:column;align-items:stretch;gap:0}nav>a{padding:12px 2px}.header-socials{display:flex;flex-direction:column;align-items:stretch;gap:0;margin:10px 0 0;padding:14px 0 0;border-left:0;border-top:1px solid var(--line)}.follow-label{padding:2px 2px 7px;font-size:10px}.header-social-links{display:flex;flex-direction:column;align-items:stretch;gap:0}.header-socials a{padding:12px 2px;font-size:14px}.menu{display:block}nav.open{display:flex}.hero{min-height:auto;padding:54px 0 66px;gap:22px}h1{font-size:clamp(36px,10.2vw,48px);line-height:1.02}.lead{font-size:16px}.actions{display:grid;grid-template-columns:1fr}.actions .btn{width:100%}.art{min-height:370px}.book-fan{width:310px;height:360px}.fakebook,.hero-cover{width:195px;height:300px}.fakebook:nth-child(2),.hero-cover:nth-child(2){left:16px;top:52px}.fakebook .big{left:22px;top:125px;font-size:34px}.fakebook .author{left:22px;bottom:24px}.grid{grid-template-columns:1fr}.info h3{font-size:27px;line-height:1.06}.info p{min-height:0}.buy{grid-template-columns:repeat(2,minmax(0,1fr))}.buy a{padding:11px 8px}.page-hero{padding:66px 0 34px}.page-hero.compact h1{font-size:clamp(36px,10vw,46px)}.home-links h2{font-size:28px}.project-copy{padding:28px 22px}.project-copy h2{font-size:clamp(34px,9vw,43px);line-height:1.04}.project-image,.project-image img{min-height:230px}.about-page{padding:68px 0 90px}.about-identity{display:grid;grid-template-columns:104px minmax(0,1fr);gap:16px}.author-photo{width:104px;height:104px}.about-page h1{font-size:clamp(32px,8.8vw,41px);line-height:1.02}.about-copy p{margin-top:20px}.updates{margin:52px 0 28px;padding:30px 24px}.updates h2{font-size:clamp(32px,9vw,44px)}.instagram-feature{margin:0 0 76px;padding:24px 14px}.instagram-head{padding:0 10px}.instagram-head h2{font-size:clamp(30px,8vw,40px)}.instagram-grid{grid-template-columns:1fr;width:100%}.instagram-slot{display:none}.instagram-slot:first-child{display:block;width:100%;max-width:100%;overflow:hidden}.instagram-slot:first-child .instagram-media{display:block!important;min-width:0!important;width:100%!important;max-width:100%!important;margin:0!important}.instagram-slot:first-child iframe{display:block!important;min-width:0!important;width:100%!important;max-width:100%!important;margin:0!important}.instagram-slot:first-child blockquote{min-width:0!important;width:100%!important;max-width:100%!important;margin:0!important}.instagram-slot:first-child blockquote>div{max-width:100%!important}.instagram-empty{min-height:170px}}

/* Home page redesign */
.home-hero{position:relative;min-height:610px;border-bottom:1px solid var(--line)}
.home-hero:after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:1px;background:linear-gradient(90deg,transparent,rgba(192,155,115,.35),transparent)}
.home-feature{display:grid;grid-template-columns:minmax(0,.82fr) minmax(360px,1.18fr);gap:70px;align-items:center;padding:72px 0 54px}
.home-feature-copy h2{font-size:clamp(38px,4.8vw,62px);line-height:1;margin:0 0 18px;max-width:570px}
.home-feature-copy p{color:var(--muted);font-size:16px;line-height:1.7;max-width:520px;margin:0 0 26px}
.text-link{display:inline-flex;align-items:center;gap:9px;color:var(--accent);text-decoration:none;font-size:13px;font-weight:700;letter-spacing:.04em}
.text-link span{transition:transform .2s ease}.text-link:hover span{transform:translateX(4px)}
.home-shelf{position:relative;display:flex;align-items:flex-end;justify-content:center;height:330px;min-width:0;padding:0 20px;isolation:isolate}
.home-shelf:after{content:"";position:absolute;left:8%;right:8%;bottom:15px;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.15),transparent);box-shadow:0 18px 28px rgba(0,0,0,.4);z-index:-1}
.home-shelf-book{display:block;position:relative;width:min(180px,31%);aspect-ratio:2/3;border-radius:5px 12px 12px 5px;overflow:hidden;border:1px solid rgba(255,255,255,.09);box-shadow:0 25px 44px rgba(0,0,0,.48);background:#211b1e;transform-origin:bottom center;transition:transform .2s ease,filter .2s ease;flex:0 0 auto}
.home-shelf-book+ .home-shelf-book{margin-left:-16px}
.home-shelf-book:nth-child(1){transform:translateY(16px) rotate(-4deg);z-index:1}
.home-shelf-book:nth-child(2){transform:translateY(-3px);z-index:3}
.home-shelf-book:nth-child(3){transform:translateY(16px) rotate(4deg);z-index:2}
.home-shelf-book:hover{z-index:6;filter:brightness(1.08)}
.home-shelf-book:nth-child(1):hover{transform:translateY(7px) rotate(-2deg)}
.home-shelf-book:nth-child(2):hover{transform:translateY(-12px)}
.home-shelf-book:nth-child(3):hover{transform:translateY(7px) rotate(2deg)}
.home-shelf-book img{width:100%;height:100%;object-fit:cover}
.home-shelf-placeholder{position:absolute;inset:0;display:grid;place-items:center;text-align:center;padding:20px;font:700 20px/1.05 Georgia,serif;color:var(--text);background:radial-gradient(circle at 50% 35%,rgba(118,99,126,.45),transparent 35%),linear-gradient(145deg,#29202d,#140f17)}
.home-paths{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid var(--line);border-bottom:1px solid var(--line);margin:10px 0 0}
.home-path{position:relative;display:grid;grid-template-columns:110px 1fr auto;gap:28px;align-items:start;text-decoration:none;padding:34px 28px 34px 0;min-width:0}
.home-path+.home-path{border-left:1px solid var(--line);padding-left:34px}
.home-path .eyebrow{margin:6px 0 0;font-size:10px}
.home-path h2{font-size:30px;margin:0 0 8px}
.home-path p{color:var(--muted);line-height:1.55;margin:0;font-size:14px}
.home-path-arrow{font-size:20px;color:var(--accent);transition:transform .2s ease}
.home-path:hover .home-path-arrow{transform:translate(3px,-3px)}
@media(max-width:900px){
  .home-feature{grid-template-columns:1fr;gap:20px;padding-top:52px}
  .home-feature-copy{max-width:650px}
  .home-shelf{height:315px}
  .home-paths{grid-template-columns:1fr}
  .home-path+.home-path{border-left:0;border-top:1px solid var(--line);padding-left:0}
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
function reviewNote(b,s){const status=String(b.status||"").trim().toLowerCase();if(String(s.book_review_visible??"1")==="0"||status==="coming soon")return "";const heading=String(s.book_review_heading||"Enjoyed the book?").trim(),text=String(s.book_review_text||"Please leave a review! Reviews help other readers discover the story and make a huge difference for an independent author.").trim(),reviewUrl=safeUrl(b.review_url);if(!heading&&!text&&!reviewUrl)return "";return '<div class="review-note">'+(heading?'<strong>'+esc(heading)+'</strong>':"")+(text?'<span>'+esc(text)+'</span>':"")+(reviewUrl?'<a class="review-link" target="_blank" rel="noopener" href="'+esc(reviewUrl)+'">★ Leave a Review on Amazon</a>':"")+'</div>'}
fetch("/api/site").then(r=>r.json()).then(data=>{const s=data.settings||{};document.title=(routeTitle=>routeTitle+" | "+(s.author_name||"Dylan Cunningham"))("${pageTitle}");["brandName","footerName","footerName2"].forEach(id=>setText(id,s.author_name||"Dylan Cunningham"));setText("footerText",s.footer_text||"");setText("navHome",s.nav_home||"Home");setText("navBooks",s.nav_books||"Books");setText("navProjects",s.nav_projects||"Projects");setText("navAbout",s.nav_about||"About");setText("footerContactLabel",s.footer_contact_label||"Contact");setText("footerAdminLabel",s.footer_admin_label||"Admin");const contactLink=document.getElementById("contactLink");if(contactLink)contactLink.href="mailto:"+(s.contact_email||"dcunn1993@gmail.com");renderSocialLinks(s.social_links||"");setText("eyebrow",s.eyebrow||"FICTION THAT STAYS WITH YOU");setText("heroTitle",s.hero_title||"");setText("heroText",s.hero_text||"");setText("homeBooksButton",s.home_books_button||"Explore the books");setText("homeProjectsButton",s.home_projects_button||"See my projects");const homeBooksButton=document.getElementById("homeBooksButton"),homeProjectsButton=document.getElementById("homeProjectsButton");if(homeBooksButton){homeBooksButton.href=s.home_books_button_url||"/books";homeBooksButton.style.display=String(s.home_books_button_visible??"1")==="0"?"none":""}if(homeProjectsButton){homeProjectsButton.href=s.home_projects_button_url||"/projects";homeProjectsButton.style.display=String(s.home_projects_button_visible??"1")==="0"?"none":""}setText("homeBooksEyebrow",s.home_books_eyebrow||"BOOKS");setText("homeBooksHeading",s.home_books_heading||"Stories that stay with you.");setText("homeBooksText",s.home_books_text||"Browse published novels and upcoming releases.");setText("homeProjectsEyebrow",s.home_projects_eyebrow||"PROJECTS");setText("homeProjectsHeading",s.home_projects_heading||"Beyond the books.");setText("homeProjectsText",s.home_projects_text||"Explore The Remnant Suite and Witness Systems.");setText("homeAboutEyebrow",s.home_about_eyebrow||"ABOUT");setText("homeAboutHeading",s.home_about_heading||"Meet the author.");setText("homeAboutText",s.home_about_text||"Writing, software, systems, and probably a cat nearby.");setText("updatesEyebrow",s.updates_eyebrow||"STAY IN THE LOOP");setText("updatesHeading",s.updates_heading||"");setText("updatesText",s.updates_text||"");setText("booksEyebrow",s.books_eyebrow||"THE BOOKS");setText("booksHeading",s.books_heading||"Choose your next story.");setText("booksText",s.books_text||"Current releases and upcoming novels from Dylan Cunningham.");setText("aboutEyebrow",s.about_eyebrow||"ABOUT THE AUTHOR");setText("projectsEyebrow",s.projects_eyebrow||"PROJECTS");setText("projectsHeading",s.projects_heading||"Beyond the books");setText("projectsText",s.projects_text||"");setText("remnantEyebrow",s.remnant_eyebrow||"DESKTOP SOFTWARE");setText("remnantTitle",s.remnant_title||"The Remnant Suite");setText("remnantText",s.remnant_text||"");setSkillTags("remnantSkills",s.remnant_skills||"");setText("witnessEyebrow",s.witness_eyebrow||"SYSTEMS & IOT");setText("witnessTitle",s.witness_title||"Witness Systems");setText("witnessText",s.witness_text||"");setSkillTags("witnessSkills",s.witness_skills||"");setText("aboutHeading",s.about_heading||s.author_name||"");setText("aboutText",s.about_text||"");
const photoKey=String(s.author_photo_key||"").trim(),photo=document.getElementById("aboutPhoto"),photoWrap=document.getElementById("authorPhotoWrap");if(photo&&photoWrap&&photoKey){photo.src=mediaUrl(photoKey);photoWrap.style.display="block"}
[["remnantImage","remnant_image_key"],["witnessImage","witness_image_key"]].forEach(([id,key])=>{const img=document.getElementById(id);if(img){const src=mediaUrl(String(s[key]||"").trim());img.src=src;if(!src){const wrap=img.closest(".project-image");if(wrap)wrap.style.display="none"}}});
const books=data.books||[],hero=document.getElementById("heroBooks");if(hero){const heroCovers=books.filter(b=>b.cover_key||safeUrl(b.cover_url)).slice(0,2);if(heroCovers.length)hero.innerHTML=heroCovers.map(b=>{const src=b.cover_key?mediaUrl(b.cover_key):safeUrl(b.cover_url);return '<img class="hero-cover" src="'+esc(src)+'" alt="'+esc(b.title)+' cover">'}).join("")}
const homeShelf=document.getElementById("homeShelf");if(homeShelf){const featured=books.slice(0,3);homeShelf.innerHTML=featured.map((b,i)=>{const src=b.cover_key?mediaUrl(b.cover_key):safeUrl(b.cover_url);return '<a class="home-shelf-book" href="/books" aria-label="'+esc(b.title)+'">'+(src?'<img src="'+esc(src)+'" alt="'+esc(b.title)+' cover">':'<span class="home-shelf-placeholder">'+esc(b.title)+'</span>')+'</a>'}).join("")}
const grid=document.getElementById("bookGrid");if(grid)grid.innerHTML=books.length?books.map((b,i)=>'<article class="card"><div class="cover '+(i%3===1?"alt":i%3===2?"warm":"")+'">'+coverMarkup(b,i)+'</div><div class="info"><div class="genre">'+esc(b.genre)+'</div><h3>'+esc(b.title)+'</h3>'+(b.subtitle?'<div style="color:var(--muted);margin-top:-7px;margin-bottom:12px">'+esc(b.subtitle)+'</div>':"")+'<p>'+esc(b.description)+'</p>'+storeLinks(b)+reviewNote(b,s)+'</div></article>').join(""):'<div class="empty">Books will appear here soon.</div>'}).catch(()=>{const grid=document.getElementById("bookGrid");if(grid)grid.innerHTML='<div class="empty">The book list could not load.</div>'});
</script></body></html>`;
}


const CHAT_ARCHIVE_WORLD_ID = "0b8b5a5d-42bb-4e12-a143-046eff715257";
const CHAT_ARCHIVE_MCP_URL = "https://app.orbismo.com/api/v1/worlds/" + CHAT_ARCHIVE_WORLD_ID + "/mcp";

function chatArchiveKey(env) {
  return String(env.ORBISMO_CHAT_ARCHIVE_API_KEY || env.ORBISMO_HOT_GUYS_API_KEY || "").trim();
}

function chatArchiveHeaders(env, sessionId = "") {
  const headers = {
    "authorization": "Bearer " + chatArchiveKey(env),
    "content-type": "application/json",
    "accept": "application/json, text/event-stream"
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  return headers;
}

async function openChatArchiveSession(env) {
  if (!chatArchiveKey(env)) throw new Error("ORBIT/Orbismo archive API key is not configured.");
  const res = await fetch(CHAT_ARCHIVE_MCP_URL, {
    method: "POST", headers: chatArchiveHeaders(env),
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "dc1993-chat-archive", version: "1.0" } } })
  });
  const text = await res.text();
  if (!res.ok) throw new Error("Orbismo archive initialization failed (" + res.status + "): " + text.slice(0, 300));
  const sessionId = res.headers.get("mcp-session-id") || res.headers.get("Mcp-Session-Id") || "";
  if (!sessionId) throw new Error("Orbismo archive did not return an MCP session ID.");
  return sessionId;
}

async function chatArchiveTool(sessionId, env, name, args) {
  const res = await fetch(CHAT_ARCHIVE_MCP_URL, {
    method: "POST", headers: chatArchiveHeaders(env, sessionId),
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name, arguments: args || {} } })
  });
  const text = await res.text();
  if (!res.ok) throw new Error("Orbismo archive tool " + name + " failed (" + res.status + "): " + text.slice(0, 350));
  const decoded = parseMcpResponse(text);
  if (decoded?.isError) throw new Error("Orbismo archive tool " + name + " returned an error.");
  const parsed = decodeMcpContent(decoded);
  if (parsed && typeof parsed === "object") return parsed;
  throw new Error("Orbismo archive tool " + name + " returned an unreadable response.");
}

function archiveSourceTime(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "";
  const ms = n < 100000000000 ? n * 1000 : n;
  try { return new Date(ms).toISOString(); } catch { return ""; }
}

function buildArchiveChunks(messages) {
  const chunks = [];
  let current = [];
  let chars = 0;
  const limit = 32000;
  for (const m of messages) {
    const piece = JSON.stringify({ id: m.id, role: m.role, time: m.time, text: m.text, attachments: m.attachments, index: m.index });
    if (current.length && chars + piece.length + 1 > limit) {
      chunks.push(makeArchiveChunk(current)); current = []; chars = 0;
    }
    current.push(m); chars += piece.length + 1;
  }
  if (current.length) chunks.push(makeArchiveChunk(current));
  return chunks;
}

function makeArchiveChunk(messages) {
  const first = messages[0], last = messages[messages.length - 1];
  const lines = messages.map(m => "CHAT_ARCHIVE_MESSAGE " + JSON.stringify({ source_message_id: m.id || "", role: m.role, time: m.time || "", source_index: m.index, text: m.text, attachments: m.attachments || [] }));
  return { first, last, content: lines.join("\n") };
}

function archiveChunkTitle(chunk, index, total) {
  const a = Number(chunk.first?.index || 0) + 1, b = Number(chunk.last?.index || 0) + 1;
  return "Messages " + a + "-" + b + " · part " + (index + 1) + " of " + total;
}

async function listArchiveLoreIds(sessionId, env, entityId) {
  const ids = [];
  let offset = 0;
  for (let page = 0; page < 100; page++) {
    const out = await chatArchiveTool(sessionId, env, "list_entity_lore", { entity_id: entityId, limit: 100, offset });
    const rows = out.results || out.lore || out.items || [];
    for (const row of rows) {
      const id = row?.lore_id || row?.id;
      if (id) ids.push(id);
    }
    if (!out.has_more || !rows.length) break;
    offset += rows.length;
  }
  return ids;
}

function parseMcpResponse(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  if (trimmed[0] === "{") return JSON.parse(trimmed);
  const data = trimmed.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).filter(Boolean).filter(x => x !== "[DONE]");
  for (let i = data.length - 1; i >= 0; i--) {
    try { return JSON.parse(data[i]); } catch {}
  }
  return null;
}

function decodeMcpContent(decoded) {
  const content = decoded?.result?.content || decoded?.content;
  if (!Array.isArray(content)) return decoded?.result || decoded;
  for (const item of content) {
    if (item?.type === "text" && typeof item.text === "string") {
      try { return JSON.parse(item.text); } catch { return { text: item.text }; }
    }
  }
  return decoded?.result || decoded;
}

async function sha256Hex(value) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value || "")));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function loginPage(next = "/admin") {
  const safeNext = String(next || "/admin").startsWith("/") ? String(next || "/admin") : "/admin";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Private Access</title><style>
  :root{--bg:#11100f;--panel:#1c1916;--text:#f2eee9;--muted:#aaa198;--accent:#c09b73;--line:rgba(255,255,255,.1)}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 80% 10%,rgba(118,99,126,.2),transparent 30rem),var(--bg);color:var(--text);font-family:Arial,sans-serif;min-height:100vh;display:grid;place-items:center;padding:24px}.box{width:min(470px,100%);border:1px solid var(--line);border-radius:24px;padding:34px;background:var(--panel)}h1{font:700 42px/1 Georgia,serif;margin:0 0 10px}p{color:var(--muted);line-height:1.6}input{width:100%;padding:14px;border-radius:12px;border:1px solid var(--line);background:#12100f;color:var(--text);font-size:16px}button{width:100%;margin-top:12px;padding:14px;border:0;border-radius:999px;background:var(--accent);font-weight:800;color:#18130f;cursor:pointer}.err{color:#ef9d9d;min-height:22px;margin-top:12px;font-size:13px}</style></head><body><form class="box" id="f"><div style="color:#c09b73;font-size:11px;letter-spacing:.2em;margin-bottom:12px">PRIVATE ACCESS</div><h1>Sign in</h1><p>This area is private.</p><input id="p" type="password" autocomplete="current-password" placeholder="Password" autofocus><button>Continue</button><div id="e" class="err"></div></form><script>document.getElementById("f").onsubmit=async e=>{e.preventDefault();const r=await fetch("/api/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({password:document.getElementById("p").value})});const j=await r.json();if(r.ok)location=${JSON.stringify(safeNext)};else document.getElementById("e").textContent=j.error||"Login failed"}</script></body></html>`;
}


async function getStoryBibleCache(env) {
  await ensureSchema(env);
  const row = await env.DB.prepare("SELECT * FROM story_bible_cache WHERE id=1").first();
  if (!row) return { snapshot: null, synced_at: "", status: "never", error: "" };

  let snapshot = null;
  try { snapshot = JSON.parse(row.snapshot_json || "{}"); } catch {}
  return {
    snapshot,
    synced_at: row.synced_at || "",
    status: row.sync_status || "never",
    error: row.sync_error || ""
  };
}

function orbismoHeaders(env, sessionId = "") {
  const headers = {
    "authorization": `Bearer ${env.ORBISMO_API_KEY}`,
    "content-type": "application/json",
    "accept": "application/json, text/event-stream"
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  return headers;
}

async function openOrbismoSession(env) {
  const res = await fetch(env.ORBISMO_MCP_URL, {
    method: "POST",
    headers: orbismoHeaders(env),
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "dc1993-story-bible", version: "1.0" } }
    })
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Orbismo initialization failed (${res.status}): ${text.slice(0,300)}`);
  const sessionId = res.headers.get("mcp-session-id") || res.headers.get("Mcp-Session-Id") || "";
  if (!sessionId) throw new Error("Orbismo did not return an MCP session ID.");
  return sessionId;
}

async function orbismoTool(sessionId, env, name, args = {}) {
  const res = await fetch(env.ORBISMO_MCP_URL, {
    method: "POST",
    headers: orbismoHeaders(env, sessionId),
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name, arguments: args } })
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Orbismo tool ${name} failed (${res.status}): ${text.slice(0,350)}`);
  const decoded = parseMcpResponse(text);
  if (decoded?.isError) throw new Error(`Orbismo tool ${name} returned an error.`);
  const parsed = decodeMcpContent(decoded);
  if (parsed && typeof parsed === "object") return parsed;
  throw new Error(`Orbismo tool ${name} returned an unreadable response.`);
}

async function pagedOrbismo(sessionId, env, toolName, args = {}, pageSize = 100) {
  const out = [];
  let offset = 0;
  for (let page = 0; page < 100; page++) {
    const data = await orbismoTool(sessionId, env, toolName, { ...args, limit: pageSize, offset });
    const rows = data.results || data.entities || data.relationships || data.lore || [];
    if (Array.isArray(rows)) out.push(...rows);
    if (!data.has_more || !rows.length) break;
    offset += rows.length;
  }
  return out;
}

function relationshipProjectId(r) {
  const target = r?.target_id || r?.to_entity_id || r?.to_id || r?.target?.entity_id || r?.target?.id;
  const source = r?.source_id || r?.from_entity_id || r?.from_id || r?.source?.entity_id || r?.source?.id;
  const proj = [source, target].find(x => String(x || "").startsWith("project/"));
  return proj || "";
}

function relatedEntityId(r) {
  const target = r?.target_id || r?.to_entity_id || r?.to_id || r?.target?.entity_id || r?.target?.id;
  const source = r?.source_id || r?.from_entity_id || r?.from_id || r?.source?.entity_id || r?.source?.id;
  return [source, target].find(x => x && !String(x).startsWith("project/")) || "";
}

async function syncStoryBible(env) {
  if (!env.DB) throw new Error("D1 binding DB is missing.");
  if (!env.ORBISMO_MCP_URL || !env.ORBISMO_API_KEY) throw new Error("Orbismo bindings are missing.");
  await ensureSchema(env);

  const session = await openOrbismoSession(env);
  const projects = await pagedOrbismo(session, env, "search_entities", { entity_type: "project", view: "full" });
  const relationships = await pagedOrbismo(session, env, "search_relationships", {});

  const seriesProjects = projects.filter(p => p?.properties?.project_type === "series");
  const bookProjects = projects.filter(p => p?.properties?.project_type === "book");
  const projectMap = new Map(projects.map(p => [p.entity_id, p]));

  const series = [];
  for (const s of seriesProjects) {
    const sid = s.entity_id;
    const rels = relationships.filter(r => relationshipProjectId(r) === sid);
    const bookIds = rels.filter(r => String(r.relationship_type || r.type || "").toUpperCase() === "CONTAINS_BOOK").map(relatedEntityId).filter(Boolean);
    const books = bookIds.map(id => projectMap.get(id)).filter(Boolean);

    const memberRels = rels.filter(r => String(r.relationship_type || r.type || "").toUpperCase() === "BELONGS_TO_WORLD");
    const memberIds = [...new Set(memberRels.map(relatedEntityId).filter(Boolean))];
    const detailIds = new Set([...memberIds, sid, ...bookIds]);

    for (const b of books) {
      const brels = relationships.filter(r => relationshipProjectId(r) === b.entity_id);
      brels.filter(r => String(r.relationship_type || r.type || "").toUpperCase() === "CONTAINS_BOOK").forEach(r => detailIds.add(relatedEntityId(r)));
    }

    const entities = [];
    for (const id of detailIds) {
      const entityType = String(id).split("/")[0] || "";
      const found = await orbismoTool(session, env, "get_entity", { entity_id: id });
      const e = found.entity || found;
      if (!e?.entity_id) continue;
      const lore = await pagedOrbismo(session, env, "list_entity_lore", { entity_id: e.entity_id });
      entities.push({ ...e, lore, entity_type: e.entity_type || entityType });
    }

    series.push({
      entity_id: sid,
      name: s.name,
      description: s.description || "",
      properties: s.properties || {},
      tags: s.tags || [],
      books: books.map(b => ({ entity_id: b.entity_id, name: b.name, description: b.description || "", properties: b.properties || {}, tags: b.tags || [] })),
      entities
    });
  }

  const snapshot = { generated_at: new Date().toISOString(), series };
  const text = JSON.stringify(snapshot);
  const hash = await sha256Hex(text);
  const now = new Date().toISOString();

  await env.DB.prepare(`
    INSERT INTO story_bible_cache (id,snapshot_json,synced_at,sync_status,sync_error,content_hash)
    VALUES (1,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET snapshot_json=excluded.snapshot_json,synced_at=excluded.synced_at,sync_status=excluded.sync_status,sync_error=excluded.sync_error,content_hash=excluded.content_hash
  `).bind(text, now, "ok", "", hash).run();
}



const HOT_GUYS_MCP_URL = "https://app.orbismo.com/api/v1/worlds/b4f340c6-c29c-4b75-bc90-fdd140a893a2/mcp";
const HOT_GUYS_ROSTER_ID = "group/the_roster";

function hotGuysHeaders(env, sessionId = "") {
  const key = String(env.ORBISMO_HOT_GUYS_API_KEY || "").trim();
  const headers = { "authorization": "Bearer " + key, "content-type": "application/json", "accept": "application/json, text/event-stream" };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  return headers;
}

async function openHotGuysSession(env) {
  if (!String(env.ORBISMO_HOT_GUYS_API_KEY || "").trim()) throw new Error("ORIBISMO_HOT_GUYS_API_KEY is not configured.");
  const res = await fetch(HOT_GUYS_MCP_URL, { method: "POST", headers: hotGuysHeaders(env), body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "dc1993-hot-guys", version: "1.0" } } }) });
  const text = await res.text();
  if (!res.ok) throw new Error("Hot Guys Orbismo initialization failed (" + res.status + "): " + text.slice(0, 300));
  const sessionId = res.headers.get("mcp-session-id") || res.headers.get("Mcp-Session-Id") || "";
  if (!sessionId) throw new Error("Hot Guys Orbismo did not return an MCP session ID.");
  return sessionId;
}

async function hotGuysTool(sessionId, env, name, args) {
  const res = await fetch(HOT_GUYS_MCP_URL, { method: "POST", headers: hotGuysHeaders(env, sessionId), body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name, arguments: args || {} } }) });
  const text = await res.text();
  if (!res.ok) throw new Error("Hot Guys Orbismo tool " + name + " failed (" + res.status + "): " + text.slice(0, 350));
  const decoded = parseMcpResponse(text);
  if (decoded?.isError) throw new Error("Hot Guys Orbismo tool " + name + " returned an error.");
  const parsed = decodeMcpContent(decoded);
  if (parsed && typeof parsed === "object") return parsed;
  throw new Error("Hot Guys Orbismo tool " + name + " returned an unreadable response.");
}

function cleanHotGuysProperties(input) {
  const allowed = ["alias","pronouns","age","birth_year","status","occupation","location","attractiveness_score","vibe","body_type","hair","eyes","height","facial_hair","hands","feet","voice","smile","style","signature_outfit","accessories","distinctive_features","appeal_notes","canonical","reference_count","notes"];
  const out = {};
  for (const key of allowed) if (Object.prototype.hasOwnProperty.call(input, key)) out[key] = input[key];
  return out;
}

async function getHotGuysCache(env) {
  await ensureSchema(env);
  const row = await env.DB.prepare("SELECT * FROM hot_guys_cache WHERE id=1").first();
  if (!row) return { snapshot: null, synced_at: "", status: "never", error: "" };
  let snapshot = null;
  try { snapshot = JSON.parse(row.snapshot_json || "{}"); } catch {}
  return { snapshot, synced_at: row.synced_at || "", status: row.sync_status || "never", error: row.sync_error || "" };
}

async function syncHotGuys(env) {
  if (!env.DB) throw new Error("D1 binding DB is missing.");
  if (!String(env.ORBISMO_HOT_GUYS_API_KEY || "").trim()) throw new Error("ORBISMO_HOT_GUYS_API_KEY is missing.");
  await ensureSchema(env);
  const session = await openHotGuysSession(env);
  const roster = await hotGuysTool(session, env, "get_group_members", { group_id: HOT_GUYS_ROSTER_ID });
  const people = [];
  for (const m of roster.members || []) {
    const id = m.entity_id || m.source_id;
    if (!id || !id.startsWith("person/")) continue;
    const found = await hotGuysTool(session, env, "get_entity", { entity_id: id });
    const e = found.entity || found;
    const loreOut = await hotGuysTool(session, env, "list_entity_lore", { entity_id: id, limit: 100, offset: 0 });
    people.push({ entity_id: id, name: e.name || m.name || id, description: e.description || "", properties: e.properties || {}, tags: e.tags || [], lore: loreOut.results || loreOut.lore || [] });
  }
  people.sort((a,b) => String(a.name).localeCompare(String(b.name)));
  const snapshot = { generated_at: new Date().toISOString(), people };
  const text = JSON.stringify(snapshot), hash = await sha256Hex(text), now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO hot_guys_cache (id,snapshot_json,synced_at,sync_status,sync_error,content_hash) VALUES (1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET snapshot_json=excluded.snapshot_json,synced_at=excluded.synced_at,sync_status=excluded.sync_status,sync_error=excluded.sync_error,content_hash=excluded.content_hash`).bind(text, now, "ok", "", hash).run();
}

function hotGuysPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Private Archive</title></head><body><p>This private archive has been retired.</p></body></html>`;
}

function storyBiblePage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#11100f"><title>Story Bible | Dylan Cunningham</title><style>
:root{--bg:#11100f;--panel:#191613;--panel2:#211d19;--text:#f2eee9;--muted:#aaa198;--accent:#c09b73;--purple:#76637e;--line:rgba(255,255,255,.1)}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 88% 3%,rgba(118,99,126,.2),transparent 30rem),var(--bg);color:var(--text);font-family:Arial,sans-serif}.shell{width:min(1500px,calc(100% - 30px));margin:auto}.top{min-height:74px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);gap:12px}.top h1{font:700 28px/1 Georgia,serif;margin:0}.top a,.top button{color:var(--muted);background:none;border:0;text-decoration:none;cursor:pointer;font-size:12px}.status{color:var(--muted);font-size:12px}.toolbar{display:flex;gap:10px;align-items:center;padding:18px 0}.toolbar input{flex:1;min-width:0;background:#100f0e;border:1px solid var(--line);border-radius:12px;color:var(--text);padding:12px 14px}.toolbar button{border:0;border-radius:999px;background:var(--accent);color:#17120e;font-weight:800;padding:12px 16px;cursor:pointer}.series{display:grid;grid-template-columns:270px 1fr;gap:18px;padding-bottom:50px}.sidebar,.content{border:1px solid var(--line);border-radius:20px;background:rgba(255,255,255,.025);min-width:0}.sidebar{padding:14px;height:max-content;position:sticky;top:12px}.sidebtn{width:100%;display:block;text-align:left;border:0;border-radius:12px;background:none;color:var(--muted);padding:11px;cursor:pointer}.sidebtn.active{background:var(--panel2);color:var(--text)}.content{padding:24px}.empty{color:var(--muted);padding:25px}.sectionTitle{font:700 34px/1.05 Georgia,serif;margin:0 0 5px}.sub{color:var(--muted);font-size:13px;margin-bottom:22px}.bookTabs{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:18px}.bookTabs button{background:#12100f;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:8px 12px;cursor:pointer}.bookTabs button.active{color:var(--text);border-color:rgba(192,155,115,.5)}.entities{display:grid;gap:10px}.entity{border:1px solid var(--line);border-radius:15px;background:#141210;overflow:hidden}.entity button{width:100%;background:none;border:0;color:var(--text);padding:14px 15px;display:flex;justify-content:space-between;text-align:left;cursor:pointer}.entityType{font-size:10px;color:var(--accent);letter-spacing:.12em;text-transform:uppercase}.detail{display:none;padding:0 15px 16px;color:var(--muted);line-height:1.55}.entity.open .detail{display:block}.props{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.prop{background:#100f0e;border-radius:10px;padding:9px;overflow-wrap:anywhere}.prop b{display:block;color:var(--text);font-size:10px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:3px}.lore{margin-top:12px;border-top:1px solid var(--line);padding-top:10px}.lore h4{color:var(--text);margin:9px 0 5px}.lore div{white-space:pre-wrap}.searchhit{margin:8px 0;border-left:2px solid var(--accent);padding-left:10px}.back{display:none}@media(max-width:760px){.shell{width:min(100% - 20px,1500px)}.top{min-height:66px}.top h1{font-size:23px}.series{display:block}.sidebar{position:static}.content{display:none;margin-top:12px;padding:18px}.content.mobileOpen{display:block}.sidebar.mobileHide{display:none}.back{display:inline-block!important;margin-bottom:12px;background:none;border:1px solid var(--line);color:var(--muted);border-radius:999px;padding:8px 11px}.sectionTitle{font-size:29px}.props{grid-template-columns:1fr}.toolbar{align-items:stretch}.toolbar input{width:100%}}</style></head><body><div class="shell"><div class="top"><h1>Story Bible</h1><div><span class="status" id="status">Loading…</span> <a href="/">Public site</a> <a href="/admin">Admin</a> <button id="logout">Log out</button></div></div><div class="toolbar"><input id="q" placeholder="Search everything in the story bible"><button id="search">Search</button></div><div class="series"><aside class="sidebar" id="side"></aside><section class="content" id="content"><div class="empty">Choose a series.</div></section></div></div><script>
let CACHE=null, activeSeries=null, activeBook="all";const $=id=>document.getElementById(id),esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
$("logout").onclick=async()=>{await fetch("/api/logout",{method:"POST"});location="/story-bible"};
async function load(force=false){$("status").textContent=force?"Syncing…":"Loading…";const r=await fetch(force?"/api/story-bible/sync":"/api/story-bible",{method:force?"POST":"GET"});if(r.status===401){location="/story-bible";return}const j=await r.json();if(j.error&&!j.snapshot){$("status").textContent=j.error;return}CACHE=j.snapshot;$("status").textContent=j.status==="error"?"Last sync had an error":"Synced "+new Date(j.synced_at).toLocaleString();renderSide();if(!activeSeries&&CACHE?.series?.[0])openSeries(CACHE.series[0].entity_id)}
function renderSide(){const s=CACHE?.series||[];$("side").innerHTML=s.map(x=>'<button class="sidebtn '+(x.entity_id===activeSeries?'active':'')+'" data-id="'+esc(x.entity_id)+'">'+esc(x.name)+'</button>').join('')+'<button class="sidebtn" id="refresh">↻ Refresh from Orbismo</button>';document.querySelectorAll('.sidebtn[data-id]').forEach(b=>b.onclick=()=>openSeries(b.dataset.id));$("refresh").onclick=()=>load(true)}
function openSeries(id){activeSeries=id;activeBook="all";renderSide();renderContent();$("side").classList.add("mobileHide");$("content").classList.add("mobileOpen")}
function renderContent(){const s=(CACHE?.series||[]).find(x=>x.entity_id===activeSeries);if(!s)return;const books=s.books||[];let entities=s.entities||[];if(activeBook!=="all"){const wanted=new Set([activeBook]);entities=entities.filter(e=>wanted.has(e.entity_id)||String(e.properties?.project_id||"")===activeBook||String(e.properties?.book_project||"")===activeBook)}$("content").innerHTML='<button class="back" id="back">← Series</button><h2 class="sectionTitle">'+esc(s.name)+'</h2><div class="sub">'+esc(s.description||"")+'</div><div class="bookTabs"><button data-b="all" class="'+(activeBook==='all'?'active':'')+'">Whole series</button>'+books.map(b=>'<button data-b="'+esc(b.entity_id)+'" class="'+(activeBook===b.entity_id?'active':'')+'">'+esc(b.name)+'</button>').join('')+'</div><div class="entities">'+entities.map(entityHtml).join('')+'</div>';$("back").onclick=()=>{$("side").classList.remove("mobileHide");$("content").classList.remove("mobileOpen")};document.querySelectorAll('[data-b]').forEach(b=>b.onclick=()=>{activeBook=b.dataset.b;renderContent()});document.querySelectorAll('.entity>button').forEach(b=>b.onclick=()=>b.parentElement.classList.toggle('open'))}
function entityHtml(e){const props=Object.entries(e.properties||{}).filter(([,v])=>v!==""&&v!=null),lore=e.lore||[];return '<article class="entity"><button><span><span class="entityType">'+esc(e.entity_type)+'</span><br><strong>'+esc(e.name)+'</strong></span><span>＋</span></button><div class="detail">'+(e.description?'<p>'+esc(e.description)+'</p>':'')+(props.length?'<div class="props">'+props.map(([k,v])=>'<div class="prop"><b>'+esc(k.replaceAll('_',' '))+'</b>'+esc(typeof v==='object'?JSON.stringify(v):v)+'</div>').join('')+'</div>':'')+(lore.length?'<div class="lore">'+lore.map(l=>'<h4>'+esc(l.title||'Note')+'</h4><div>'+esc(l.content||'')+'</div>').join('')+'</div>':'')+'</div></article>'}
$("search").onclick=()=>{const q=$("q").value.trim().toLowerCase();if(!q)return;const hits=[];(CACHE?.series||[]).forEach(s=>(s.entities||[]).forEach(e=>{const blob=(e.name+' '+e.description+' '+JSON.stringify(e.properties||{})+' '+JSON.stringify(e.lore||[])).toLowerCase();if(blob.includes(q))hits.push({s,e})}));$("side").classList.add("mobileHide");$("content").classList.add("mobileOpen");$("content").innerHTML='<button class="back" id="back">← Series</button><h2 class="sectionTitle">Search</h2><div class="sub">'+hits.length+' result(s)</div>'+hits.map(h=>'<div class="searchhit"><b>'+esc(h.e.name)+'</b><div>'+esc(h.s.name)+' · '+esc(h.e.entity_type)+'</div></div>').join('');$("back").onclick=()=>{$("side").classList.remove("mobileHide");$("content").classList.remove("mobileOpen")}};$("q").addEventListener("keydown",e=>{if(e.key==="Enter")$("search").click()});load();</script></body></html>`;
}

function chatArchivePage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#11100f"><title>Chat Archive | Dylan Cunningham</title><style>
:root{--bg:#11100f;--panel:#191613;--text:#f2eee9;--muted:#aaa198;--accent:#c09b73;--line:rgba(255,255,255,.1)}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 88% 3%,rgba(118,99,126,.2),transparent 30rem),var(--bg);color:var(--text);font-family:Arial,sans-serif}.shell{width:min(1000px,calc(100% - 28px));margin:auto}.top{min-height:74px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);gap:12px}.top h1{font:700 28px/1 Georgia,serif;margin:0}.top a{color:var(--muted);text-decoration:none;font-size:12px}.card{margin:24px 0;border:1px solid var(--line);border-radius:20px;padding:22px;background:rgba(255,255,255,.025)}.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.stat{padding:16px;border:1px solid var(--line);border-radius:14px;background:#141210}.stat b{display:block;font:700 25px Georgia,serif;color:var(--accent)}.stat span{font-size:11px;color:var(--muted)}input{width:100%;background:#100f0e;border:1px solid var(--line);border-radius:12px;color:var(--text);padding:13px}button{border:0;border-radius:999px;background:var(--accent);color:#17120e;font-weight:800;padding:12px 16px;cursor:pointer}.row{display:flex;gap:10px}.results{margin-top:16px}.hit{border-top:1px solid var(--line);padding:14px 0}.hit:first-child{border-top:0}.hit b{display:block}.hit small{color:var(--muted)}@media(max-width:620px){.stats{grid-template-columns:1fr}.row{display:grid}.top{align-items:flex-start;padding:18px 0}}</style></head><body><div class="shell"><div class="top"><h1>Chat Archive</h1><div><a href="/">Public site</a> <a href="/admin">Admin</a></div></div><div class="card"><div class="stats"><div class="stat"><b id="conv">…</b><span>Conversations imported</span></div><div class="stat"><b id="msg">…</b><span>Messages archived</span></div><div class="stat"><b id="chunks">…</b><span>Archive chunks</span></div></div></div><div class="card"><h2>Search archive</h2><div class="row"><input id="q" placeholder="Search your ChatGPT archive"><button id="go">Search</button></div><div class="results" id="results"></div></div></div><script>const $=id=>document.getElementById(id),esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));async function load(){const r=await fetch('/api/chat-archive/status');if(r.status===401){location='/chat-archive';return}const j=await r.json();$('conv').textContent=j.conversations||0;$('msg').textContent=j.messages||0;$('chunks').textContent=j.chunks||0}async function search(){const q=$('q').value.trim();if(!q)return;const r=await fetch('/api/chat-archive/search?q='+encodeURIComponent(q));const j=await r.json();const rows=j.results||j.matches||[];$('results').innerHTML=rows.length?rows.map(x=>'<div class="hit"><b>'+esc(x.title||x.entity_name||'Result')+'</b><small>'+esc(x.content||x.text||x.description||JSON.stringify(x))+'</small></div>').join(''):'<p style="color:#aaa198">No results.</p>'}$('go').onclick=search;$('q').addEventListener('keydown',e=>{if(e.key==='Enter')search()});load();</script></body></html>`;
}

function adminPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#11100f"><title>Admin | Dylan Cunningham</title><style>
  :root{--bg:#11100f;--panel:#1c1916;--panel2:#24201c;--text:#f2eee9;--muted:#aaa198;--accent:#c09b73;--line:rgba(255,255,255,.1);--danger:#d16f6f}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:Arial,sans-serif}.shell{width:min(1120px,calc(100% - 28px));margin:auto;padding-bottom:70px}.top{min-height:78px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);gap:12px}.top h1{font:700 32px/1 Georgia,serif;margin:0}.top a{color:var(--muted);text-decoration:none;font-size:13px}.tabs{display:flex;gap:8px;overflow:auto;padding:18px 0 12px}.tabs button{white-space:nowrap;background:#151311;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:10px 13px;cursor:pointer}.tabs button.active{color:var(--text);border-color:rgba(192,155,115,.5)}.panel{display:none}.panel.active{display:block}.box{border:1px solid var(--line);border-radius:20px;background:var(--panel);padding:22px;margin-top:12px}.box h2{font:700 30px/1.05 Georgia,serif;margin:0 0 5px}.hint{color:var(--muted);font-size:12px;line-height:1.55;margin:0 0 18px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:13px}.full{grid-column:1/-1}label{display:block;color:var(--muted);font-size:11px;margin:0 0 6px}input,textarea,select{width:100%;border:1px solid var(--line);border-radius:11px;background:#100f0e;color:var(--text);padding:12px;font:inherit}textarea{min-height:110px;resize:vertical}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:15px}.btn{border:0;border-radius:999px;padding:11px 15px;font-weight:800;cursor:pointer}.btn.primary{background:var(--accent);color:#18130f}.btn.secondary{background:#302a25;color:var(--text)}.btn.danger{background:#492526;color:#ffd7d7}.bookrow{display:grid;grid-template-columns:58px 1fr auto;gap:12px;align-items:center;border-top:1px solid var(--line);padding:12px 0}.bookrow:first-child{border-top:0}.thumb{width:52px;height:72px;border-radius:5px;background:#161311;overflow:hidden;display:grid;place-items:center;font-size:8px;text-align:center}.thumb img{width:100%;height:100%;object-fit:cover}.bookrow strong{display:block}.bookrow small{color:var(--muted)}.rowBtns{display:flex;gap:5px}.mini{border:1px solid var(--line);background:#161311;color:var(--muted);border-radius:8px;padding:7px;cursor:pointer}.preview{width:150px;margin-top:8px;border-radius:7px}.authorPreview{width:150px;height:150px;object-fit:cover;border-radius:50%;margin-top:8px}.projectPreview{width:min(360px,100%);max-height:220px;object-fit:cover;border-radius:10px;margin-top:8px;border:1px solid var(--line)}.toast{position:fixed;right:18px;bottom:18px;background:#2a241f;border:1px solid var(--line);padding:12px 16px;border-radius:12px;display:none}.toast.show{display:block}.check{display:flex;align-items:center;gap:8px;color:var(--text);font-size:12px}.check input{width:auto}.check label{margin:0;color:var(--text)}hr{border:0;border-top:1px solid var(--line);margin:8px 0}@media(max-width:700px){.grid{grid-template-columns:1fr}.full{grid-column:auto}.bookrow{grid-template-columns:48px 1fr}.rowBtns{grid-column:1/-1}.box{padding:18px}.top h1{font-size:26px}}
  </style></head><body><div class="shell"><div class="top"><h1>Site Admin</h1><div><a href="/">View site</a> · <a href="/story-bible">Story Bible</a> · <a href="/chat-archive">Chat Archive</a> · <a href="#" id="logout">Log out</a></div></div>
<div class="tabs"><button class="active" data-tab="home">Homepage</button><button data-tab="books">Books</button><button data-tab="about">About</button><button data-tab="projects">Projects</button><button data-tab="updates">Updates</button></div>
<section class="panel active" id="home">
<div class="box"><h2>Homepage</h2><p class="hint">Edit the hero, homepage navigation, and site-wide labels.</p><div class="grid">
<div class="full"><label>Author name</label><input id="author_name" type="text"></div>
<div class="full"><label>Hero small heading</label><input id="eyebrow" type="text"></div>
<div class="full"><label>Hero headline</label><textarea id="hero_title"></textarea></div>
<div class="full"><label>Hero intro text</label><textarea id="hero_text"></textarea></div>
<div class="full"><hr><h2 style="font-size:24px">Homepage cards</h2><p class="hint">Edit the book, projects, and about previews on the homepage.</p></div>
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
<div class="full"><hr><h2 style="font-size:24px">Reader review message</h2><p class="hint">Shown beneath each published book. Coming Soon titles are excluded automatically.</p></div>
<div class="full"><label>Review message</label><div class="check"><input id="book_review_visible" type="checkbox"><span>Show the review message under published books</span></div></div>
<div class="full"><label>Review heading</label><input id="book_review_heading" type="text" placeholder="Enjoyed the book?"></div>
<div class="full"><label>Review text</label><textarea id="book_review_text" placeholder="Please leave a review!"></textarea></div>
</div><div class="actions"><button class="btn primary" onclick="saveSettings()">Save books page settings</button></div></div>
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
<div class="full"><label>Amazon Review URL</label><input id="b_review_url" type="url" placeholder="https://www.amazon.com/review/create-review?asin=..."><p class="hint" style="margin-top:7px">Direct link used by the “Leave a Review on Amazon” button. Leave blank to hide the button for this book.</p></div>
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
  ["home_books_button_visible","home_projects_button_visible","book_review_visible"].forEach(id=>{if($(id))$(id).checked=String((DATA.settings||{})[id]??"1")!=="0"});
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
  const ids=["author_name","eyebrow","hero_title","hero_text","home_books_eyebrow","home_books_heading","home_books_text","home_projects_eyebrow","home_projects_heading","home_projects_text","home_about_eyebrow","home_about_heading","home_about_text","home_books_button","home_books_button_url","home_books_button_visible","home_projects_button","home_projects_button_url","home_projects_button_visible","nav_home","nav_books","nav_projects","nav_about","contact_email","footer_contact_label","footer_admin_label","social_links","books_eyebrow","books_heading","books_text","book_review_visible","book_review_heading","book_review_text","about_eyebrow","about_heading","about_text","author_photo_key","projects_eyebrow","projects_heading","projects_text","remnant_eyebrow","remnant_title","remnant_image_key","remnant_text","remnant_skills","witness_eyebrow","witness_title","witness_image_key","witness_text","witness_skills","updates_eyebrow","updates_heading","updates_text","instagram_heading","instagram_post_url_1","instagram_post_url_2","instagram_post_url_3","instagram_post_url_4","footer_text"];
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
function clearBook(){["b_id","b_title","b_subtitle","b_genre","b_description","b_cover_key","b_cover_url","b_paperback_url","b_ebook_url","b_apple_url","b_kobo_url","b_review_url"].forEach(id=>$(id).value="");$("b_status").value="Available";$("b_sort_order").value=(DATA.books.length+1);$("b_visible").checked=true;$("b_cover_file").value="";$("coverPreview").style.display="none"}
function newBook(){editing=null;clearBook();$("editorTitle").textContent="Add book";$("deleteBtn").style.display="none";$("editor").style.display="block";$("editor").scrollIntoView({behavior:"smooth"})}
function editBook(id){editing=DATA.books.find(x=>x.id===id);if(!editing)return;const map={b_id:"id",b_title:"title",b_subtitle:"subtitle",b_genre:"genre",b_description:"description",b_status:"status",b_sort_order:"sort_order",b_cover_key:"cover_key",b_cover_url:"cover_url",b_paperback_url:"paperback_url",b_ebook_url:"ebook_url",b_apple_url:"apple_url",b_kobo_url:"kobo_url",b_review_url:"review_url"};for(const [el,k] of Object.entries(map))$(el).value=editing[k]??"";$("b_visible").checked=!!editing.visible;$("b_cover_file").value="";const src=coverSrc(editing);$("coverPreview").src=src;$("coverPreview").style.display=src?"block":"none";$("editorTitle").textContent="Edit "+editing.title;$("deleteBtn").style.display="inline-block";$("editor").style.display="block";$("editor").scrollIntoView({behavior:"smooth"})}
function closeEditor(){$("editor").style.display="none";editing=null}
$("b_cover_file").onchange=()=>{const f=$("b_cover_file").files[0];if(f){$("coverPreview").src=URL.createObjectURL(f);$("coverPreview").style.display="block"}}
async function saveBook(){
 if(!$("b_title").value.trim()){alert("Give the book a title first.");return}
 let coverKey=$("b_cover_key").value;
 const file=$("b_cover_file").files[0];
 if(file){const fd=new FormData();fd.append("file",file);fd.append("bookId",$("b_id").value||$("b_title").value);const up=await api("/api/admin/upload-cover",{method:"POST",body:fd});coverKey=up.cover_key}
 const body={id:$("b_id").value,title:$("b_title").value,subtitle:$("b_subtitle").value,genre:$("b_genre").value,description:$("b_description").value,status:$("b_status").value,sort_order:Number($("b_sort_order").value||0),visible:$("b_visible").checked,cover_key:coverKey,cover_url:$("b_cover_url").value,paperback_url:$("b_paperback_url").value,ebook_url:$("b_ebook_url").value,apple_url:$("b_apple_url").value,kobo_url:$("b_kobo_url").value,review_url:$("b_review_url").value};
 await api("/api/admin/books/save",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});toast("Book saved");closeEditor();await load()
}
async function deleteBook(){if(!editing)return;if(!confirm("Delete "+editing.title+"?"))return;await api("/api/admin/books/delete",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id:editing.id})});closeEditor();await load();toast("Book deleted")}
load();
</script></body></html>`;
}
