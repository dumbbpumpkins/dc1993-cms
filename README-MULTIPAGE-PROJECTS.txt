dc1993.com multipage + project image update

Replace the existing worker.js with this worker.js.

Public site routes:
- /          Home / landing page
- /books     Books page
- /projects  Projects page
- /about     About page
- /admin     Existing editable CMS

What changed:
- The public site is no longer one long scrolling page.
- Home is a shorter landing page with links to the main sections.
- Books, Projects, and About each have their own URL/page.
- The existing admin dashboard remains the editing surface.
- Projects admin now includes separate image uploads for The Remnant Suite and Witness Systems.
- Project images are stored in the existing Cloudflare R2 COVERS binding under projects/ keys.
- Replacing a project image removes the previous projects/ object after the new upload succeeds.
- Existing book covers, author photo, D1 content, R2 bindings, login/authentication, and book CMS behavior are preserved.
- Existing D1 databases receive the new image-key settings through INSERT OR IGNORE, so no manual migration is required.

Verification performed:
- worker.js passed `node --check`.
- Verified all public route links are present.
- Verified the project upload API and both Admin image fields are present.

No changes to wrangler.jsonc are required.
