# CLAUDE.md — Brewery Distribution Manager

## Project Overview

Brewery Distribution Manager is a full-stack web application for managing self-distribution operations at microbreweries. It tracks products, inventory across multiple locations, customer accounts, orders, outreach history, reminders/todos, keg tracking, tap handles, and email communications, all backed by a local SQLite database.

## Tech Stack

- **Backend:** Node.js + Express.js 4.x
- **Database:** SQLite via better-sqlite3 (single file at `data/brewery.db`, auto-created on startup)
- **Auth:** Passport.js with Google OAuth2
- **Email:** Gmail API via googleapis
- **Frontend:** Vanilla JavaScript SPA (no framework), hash-based routing, Leaflet.js for maps
- **Styling:** Plain CSS with custom properties for theming
- **Production:** PM2 process manager, Nginx reverse proxy, DigitalOcean

## Quick Start

```bash
cp .env.example .env   # Fill in GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SESSION_SECRET
npm install
npm run dev            # Starts with nodemon (auto-reload)
```

The server runs on `http://localhost:3000` by default.

## Commands

```bash
npm start       # Production start (node server.js)
npm run dev     # Development with auto-reload (nodemon server.js)
```

There are no test or lint commands configured. No build step is needed — the frontend is vanilla JS served as static files.

## Project Structure

```
server.js                  # Express server entry point
db.js                      # SQLite init, schema migrations, CRUD helpers
email-service.js           # Gmail OAuth2 email sending

middleware/
  requireAuth.js           # Auth middleware for protected routes

routes/                    # One file per feature domain
  auth.js                  # Google OAuth login/logout
  dashboard.js             # Dashboard KPI aggregation
  products.js              # Product CRUD
  inventory.js             # Inventory management
  accounts.js              # Customer accounts (largest route file)
  orders.js                # Order creation & delivery
  order-items.js           # Order line items
  outreach.js              # Customer contact logging
  reminders.js             # Tasks/todos with recurrence
  staff.js                 # Sales rep management
  stock-movements.js       # Inventory transaction history
  settings.js              # Global app settings (key-value)
  keg-tracking.js          # Keg deployment & returns
  tap-handles.js           # Tap handle tracking
  email.js                 # Email sending endpoints
  notifications.js         # Notification log
  webhooks.js              # Incoming order webhook

lib/
  notifications.js         # @mention and assignment notification logic
  pdf-parser.js            # Invoice PDF extraction

public/                    # Frontend SPA
  index.html               # SPA shell
  login.html               # OAuth login page
  style.css                # All application styles
  js/
    init.js                # Hash router and view initialization
    core.js                # State management, API client, pagination
    dashboard.js, products.js, inventory.js, accounts.js,
    outreach.js, todos.js, orders.js, staff.js, kegs.js,
    tap-handles.js, map.js, settings.js, mentions.js
```

## Architecture & Patterns

### Backend

- **Centralized CRUD:** `db.js` exposes `getAllRows`, `getRow`, `addRow`, `updateRow`, `deleteRow` helpers used by all routes.
- **Schema migrations:** `db.initializeDatabase()` runs on startup and non-destructively adds missing columns to existing tables.
- **All DB values are TEXT:** SQLite columns use TEXT type with empty string defaults. IDs are UUID v4.
- **Timestamps:** ISO 8601 format via `new Date().toISOString()`.
- **Error handling:** Try-catch in route handlers returning 500 with `console.error` logging.
- **Async fire-and-forget:** Notifications and emails are sent asynchronously without awaiting results.

### Frontend

- **Global state object:** `state = { view, location, accounts, inventory, staff, ... }` in `core.js`.
- **View loaders:** `VIEW_LOADERS` maps hash routes to async render functions in `init.js`.
- **Modal system:** `openModal(title, form, onSubmit)` for all create/edit forms.
- **Pagination:** Global `_pagination` object tracks page/perPage per view.
- **HTML escaping:** `esc()` function for user input. Always use it when rendering user data.
- **Event handlers:** Inline `onclick` attributes calling global functions.
- **Toast notifications:** `toast(message, type)` for user feedback.

### Security

- Helmet.js for CSP, XSS protection, disabled x-powered-by.
- Rate limiting: `/auth` 10/min, `/api` 100/min, `/webhooks` 30/min.
- httpOnly session cookies with sameSite=lax, secure in production.
- Webhook auth via Bearer token with timing-safe comparison.
- Email header injection prevention via `sanitizeHeader()`.

## Database Tables

| Table | Purpose |
|-------|---------|
| Products | Master product catalog |
| Inventory | Per-location stock levels (auto-created when a product is added) |
| Accounts | Customer/venue records with contact info |
| Orders | Sales orders with status and delivery tracking |
| OrderItems | Line items for each order |
| StockMovements | Inventory audit trail (sale, received, write-off, adjustment) |
| Outreach | Customer contact history |
| Reminders | Tasks/todos with recurrence support |
| KegTracking | Keg deployment and return tracking with deposits |
| TapHandles | Promotional tap handle tracking |
| Staff | Sales representatives |
| EmailLog | Sent email history |
| Notifications | @mention and assignment notification log |
| Settings | Key-value config store (locations, deposit rates, tags as JSON) |

## Key Workflows

1. **Create Product** — auto-creates Inventory rows at all configured locations.
2. **Create Order** — logs @mentions, fires assignment notifications.
3. **Deliver Order** — decrements inventory, creates StockMovement records, marks kegs as deployed.
4. **Recurring Reminders** — completing a reminder auto-creates the next occurrence based on recurrence rule.
5. **Webhook Orders** — `POST /webhooks/order` accepts orders from POS/Zapier/Make with flexible field mapping.

## Environment Variables

Required: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`

Optional: `PORT` (default 3000), `DB_PATH`, `NODE_ENV`, `GOOGLE_CALLBACK_URL`, `GOOGLE_ALLOWED_DOMAIN`, `WEBHOOK_SECRET`

See `.env.example` for the full list.

## Conventions for AI Assistants

- **No test suite exists.** Manually verify changes by reading related code paths. When adding new routes, follow the pattern in existing route files.
- **No linter configured.** Follow the existing code style: 2-space indentation, single quotes in JS, semicolons.
- **Prefer editing existing files** over creating new ones. The codebase is organized by feature domain.
- **Route files** export an Express Router. Follow the try-catch + 500 error pattern used everywhere.
- **Frontend views** are loaded via `VIEW_LOADERS` in `public/js/init.js`. New views need a loader entry there.
- **Always HTML-escape** user data in frontend rendering using the `esc()` function.
- **Database changes** go in `db.js` — add new tables in `initializeDatabase()` and add column migrations in the migration section.
- **Multi-location awareness:** Inventory and dashboard queries filter by location. Keep this in mind when modifying these features.
- **No TypeScript, no bundler, no framework.** Keep the frontend vanilla JS. Do not introduce build tooling.
