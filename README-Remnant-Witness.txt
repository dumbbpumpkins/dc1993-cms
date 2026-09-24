dc1993.com — Remnant + Witness website update
   
Included file:
- worker.js — complete replacement for the current main/worker.js

What this adds:
- A public “Projects” navigation link.
- A “Beyond the books” section between About and Updates.
- Project cards for The Remnant Suite and Witness Systems.
- A Projects tab in /admin.
- Editable fields for the Projects section heading/introduction and both project titles/descriptions.
- Safe D1 migration behavior: the new default settings are INSERT OR IGNORE, so they populate on the existing database without deleting or resetting current settings.

Preserved:
- Existing books CMS/API behavior.
- Existing D1 books/settings storage.
- Existing R2 cover and author-photo uploads.
- Existing authentication/session behavior.
- Existing mobile book cards, hero covers, footer Contact/Admin links, and responsive layout.

Verification performed:
- node --check worker.js passed successfully.

Deployment:
Replace worker.js in dumbbpumpkins/dc1993-cms on the main branch with the included worker.js. Cloudflare should then deploy through the repo’s existing deployment setup.
