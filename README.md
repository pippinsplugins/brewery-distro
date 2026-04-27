# Brewery Distribution Manager

A web app for managing self-distribution operations for a small microbrewery. Tracks products, inventory across multiple locations, customer accounts, orders, outreach history, reminders, keg tracking, tap handles, and email — all backed by a local SQLite database.

## Features

- **Dashboard** — At-a-glance KPIs: active accounts, monthly orders & revenue, overdue reminders, low-stock alerts, recent outreach, pending deliveries, and upcoming todos. Filterable by location.
- **Products** — Master product catalog (name, style, ABV). Adding a product auto-creates inventory rows at every configured location. Supports format variations (e.g. 1/6 Keg, 1/2 Keg, cans) with per-format pricing and multi-tier pricing. Products can be excluded from bulk email offerings.
- **Inventory** — Per-location stock levels with low-stock thresholds and alerts. Tracks allocated and available units against open orders. Stock is adjusted through stock movements (sales, received, write-offs, adjustments) for a full audit trail.
- **Accounts** — Manage bars, restaurants, retail stores, grocery stores, hotels, event venues, and individuals. Store contact info, preferred contact method (Email, Phone, SMS, In-Person, Any), billing contact, address, ABC license, keg deposit preference, serviced-by location, check-in frequency, and assigned sales rep. Detailed profile view with outreach history, orders, kegs, deposits owed, and tap handles. Filter by status, type, tag (multi-select with AND logic), and preferred contact method. Merge duplicate accounts.
- **Orders & Sales** — Create and manage orders with invoice numbers, delivery dates, payment status (Draft / Pending / Paid / Cancelled / Pre-Sale), and payment method tracking. Line-item builder for selecting products with quantity, price tier, and per-item taxable flag. Custom non-inventory line items supported. Confirm deliveries to auto-decrement inventory and create keg tracking records. Import orders from PDF invoices (Gemini AI parsing).
- **Outreach Log** — Log every customer contact (phone, email, in-person, SMS) with notes and follow-up dates. Automatically updates the account's "Last Contacted" date. @mention staff members in notes to trigger email notifications.
- **Reminders / Todos** — Task management with due dates, priorities, account/staff assignment, and recurring schedules (daily, weekly, biweekly, monthly, quarterly, yearly). Completing a recurring reminder auto-creates the next occurrence.
- **Keg Tracking** — Track kegs deployed to accounts and mark returns. Auto-created when delivering keg-format products. Outstanding keg counts shown on account profiles and a dedicated kegs view. Includes deposit tracking with per-keg deposit rates, refund calculation on returns, and outstanding deposit balances.
- **Keg Deposits** — Configure global deposit rates per keg format (1/6, 1/4, 1/2) in Settings. Accounts can be flagged to charge deposits, and orders auto-detect the preference with manual override. Deposits are snapshotted onto keg records at delivery time, and refunds are tracked as kegs are returned.
- **Account Credits** — Issue and track account credits. Credits are applied to orders and reduce balances. Per-account credit balance visible on the account profile.
- **Tap Handles** — Track promotional tap handles deployed to venues and mark collections.
- **Email** — Send individual or bulk emails directly from the app using each staff member's own Gmail account via OAuth2. Bulk emails use BCC for recipient privacy. Sends are auto-logged as outreach entries. Reply-to address configurable in Settings.
- **Inbound Email Orders** — Forward order request emails to a Gmail account monitored by a Google Apps Script. The script posts emails to the app's inbound webhook, where Gemini AI parses them into Draft orders for review. Falls back to a local keyword parser when Gemini is unavailable.
- **Staff** — Manage sales reps with assignment to accounts and orders. Staff can be assigned to specific locations. @mention staff members in notes to notify them by email.
- **Notifications** — Email notifications for @mentions in notes and staff assignment changes across accounts, orders, outreach, and todos.
- **Reports** — Date-range sales reports with granularity auto-selected by span (day/week/month). Includes: sales summary chart, top products by quantity, account activity, stock movement summary, sales by rep, and gallonage.
- **Gallonage** — Track volume sold by format (barrels, gallons). Filter by location, account type, or tag. Per-account breakdown included.
- **Sales Export** — Export order totals with account details (name, ABC license, address) for state reporting. Filter by location and exclude account types.
- **Forecast** — Velocity report showing average units sold per week/month by product and format, with trend charts.
- **Multi-Location** — Configure multiple warehouse/taproom locations. Inventory, orders, dashboard, staff, and reports all filter by location.
- **Map** — Visual map of account locations using OpenStreetMap. Filter by tag.
- **QuickBooks Online** — Optional sync: push invoices and payments to QBO. Void invoices when orders or accounts are deleted.
- **Webhooks** — Accept incoming orders from external systems (POS, accounting, Zapier, Make, n8n, etc.) via an API webhook endpoint.
- **API Keys** — Generate named API keys in Settings for programmatic access to all API endpoints.
- **Mobile-Optimized** — Fully responsive layout with touch-friendly targets (44px minimums), iOS zoom prevention, and condensed table columns on small screens.

## Setup

### 1. Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com/) and create (or select) a project.
2. Enable the **Gmail API** (required for the email feature).
3. Go to **APIs & Services > Credentials** and create an **OAuth 2.0 Client ID** (Web application type).
4. Under **Authorised JavaScript origins**, add your domain (for local dev: `http://localhost:3000`).
5. Under **Authorised redirect URIs**, add `http://localhost:3000/auth/google/callback` (or your production equivalent).
6. Copy the **Client ID** and **Client Secret** for the next step.

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in the required values:

```
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
SESSION_SECRET=a_long_random_string
```

Optional settings:

```
PORT=3000                             # Server port (default: 3000)
DB_PATH=./data/brewery.db            # SQLite database path (default: ./data/brewery.db)
GOOGLE_ALLOWED_DOMAIN=company.com    # Restrict login to a Google Workspace domain
GOOGLE_CALLBACK_URL=https://...      # Full OAuth callback URL for production
WEBHOOK_SECRET=a_long_random_string  # Enables the legacy /webhooks/order endpoint
BASE_PATH=/trb                        # Sub-path prefix for reverse-proxy deployments

# QuickBooks Online (optional)
QBO_CLIENT_ID=your_qbo_client_id
QBO_CLIENT_SECRET=your_qbo_client_secret
QBO_ENVIRONMENT=sandbox               # or: production
QBO_REDIRECT_URI=https://...          # Full OAuth callback URL for QBO
```

Gemini AI key (for inbound email order parsing) and API keys are configured through the Settings UI, not environment variables.

### 3. Install and run

```bash
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000). You'll be prompted to sign in with Google. On first login, Google will ask you to grant permission to send email on your behalf (Gmail send scope).

The SQLite database is created automatically on first run.

## Development

```bash
npm run dev   # uses nodemon for auto-reload
```

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Yes | OAuth 2.0 Client ID from Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | Yes | OAuth 2.0 Client Secret |
| `SESSION_SECRET` | Yes | Secret used to sign session cookies |
| `PORT` | No | Server port (default: `3000`) |
| `DB_PATH` | No | Path to SQLite database file (default: `./data/brewery.db`) |
| `GOOGLE_ALLOWED_DOMAIN` | No | Restrict sign-in to a single Google Workspace domain |
| `GOOGLE_CALLBACK_URL` | No | Full OAuth callback URL for production deployments |
| `WEBHOOK_SECRET` | No | Bearer token for the legacy `POST /webhooks/order` endpoint |
| `BASE_PATH` | No | URL prefix for sub-path deployments (e.g. `/trb`) |
| `QBO_CLIENT_ID` | No | Intuit OAuth Client ID for QuickBooks Online sync |
| `QBO_CLIENT_SECRET` | No | Intuit OAuth Client Secret |
| `QBO_ENVIRONMENT` | No | `sandbox` or `production` (default: `sandbox`) |
| `QBO_REDIRECT_URI` | No | Full OAuth callback URL for QBO authorization |

## API Keys

Generate named API keys in **Settings > API Keys**. Keys authenticate all `/api/*` endpoints using either:

```
Authorization: Bearer <your-api-key>
X-API-Key: <your-api-key>
```

API keys bypass the session/CSRF requirement and are designed for server-to-server integrations. The raw key is shown only once at creation — store it securely.

## Webhooks

See [`docs/webhooks.md`](docs/webhooks.md) for full webhook and REST API documentation, including the `inventory.update`, `product.create`, `product.update`, and `order.create` webhook actions.

## Legacy Webhook

When `WEBHOOK_SECRET` is set, the app also exposes a `POST /webhooks/order` endpoint (the original simple webhook format). The newer `POST /api/webhooks/incoming` endpoint with API key auth is preferred for new integrations.

## Data structure

All data is stored in a local SQLite database. Every column is TEXT type. The schema is defined in `db.js` via the `HEADERS` object and is migration-safe: any missing columns are automatically added on startup.

| Table | Key Columns |
|---|---|
| Products | ID, Name, Style, ABV, Format\*, PricePerUnit\*, Notes, ExcludeFromEmailOfferings, CreatedAt |
| Inventory | ID, ProductID, ProductName, Location, Style, ABV, Format, Units, PricePerUnit, Prices (JSON), LowStockThreshold, Notes, LastUpdated |
| Accounts | ID, Name, Type, Tags (JSON), ContactName, Email, AdditionalEmails (JSON), Phone, PreferredMethod, BillingContactName, BillingEmail, BillingPhone, Address, City, State, Zip, ABCLicense, ChargeDeposits, Taxable, Status, Notes, LastContacted, StaffID, StaffName, ServicedBy, QboCustomerId, CheckInFrequency, CreatedAt |
| Orders | ID, AccountID, AccountName, Location, StaffID, StaffName, OrderDate, DeliveryDate, InvoiceNumber, OrderAmount, TaxAmount, DepositAmount, Notes, RequestedProducts, Status, Delivered, PaymentMethod, PaymentReference, PaymentDate, QboInvoiceId, QboPaymentId, QboSyncStatus, InvoicePdf, CreatedAt |
| OrderItems | ID, OrderID, InventoryID, ProductName, Format, PriceTier, Quantity, UnitPrice, LineTotal, Taxable, CreatedAt |
| StockMovements | ID, InventoryID, InventoryName, OrderID, Type (sale/received/write-off/adjustment), Quantity, Notes, Date, CreatedAt |
| Outreach | ID, AccountID, AccountName, Date, Method, Notes, FollowUpDate, FollowUpStatus, CreatedAt |
| Reminders | ID, Type, AccountID, AccountName, Title, DueDate, Priority, Notes, Completed, StaffID, StaffName, Recurrence, RecurrenceParentID, CreatedAt |
| KegTracking | ID, AccountID, AccountName, OrderID, InventoryID, ProductName, Format, Quantity, DepositPerUnit, DepositTotal, DepositRefunded, DeliveredDate, ReturnedDate, ReturnedQuantity, Notes, CreatedAt |
| TapHandles | ID, AccountID, AccountName, Quantity, DeployedDate, CollectedDate, CollectedQuantity, Notes, CreatedAt |
| Staff | ID, Name, Email, Phone, Role, Active, Notes, Locations (JSON), CreatedAt |
| EmailLog | ID, SenderName, SenderEmail, Recipients, Subject, Body, Type, AccountIDs, Status, Error, CreatedAt |
| Settings | ID, Key, Value, UpdatedAt |
| AccountCredits | ID, AccountID, AccountName, Type (credit/applied), Amount, OrderID, Reason, Notes, CreatedAt |
| Notifications | ID, Type, Channel, RecipientStaffID, RecipientName, RecipientEmail, SenderName, SenderEmail, EntityType, EntityID, EntityName, Message, Status, Error, CreatedAt |
| WebhookLog | ID, ApiKeyName, Action, Payload, Status, Error, CreatedAt |
| InboundEmails | ID, GmailMessageId, GmailThreadId, From, FromName, To, Subject, Body, ReceivedAt, Status, ParsedData, OrderID, Error, CreatedAt |

\* `Format` and `PricePerUnit` on the Products table are retained for backward compatibility but are empty for all new products. These values live on Inventory rows, supporting multiple format variations per product.

## Project structure

```
/
├── server.js               # Express app entry point
├── db.js                   # SQLite setup, HEADERS schema, CRUD helpers, migrations
├── email-service.js        # Gmail OAuth2 send helper
├── inbound-email-service.js # Inbound email parsing (Gemini AI + local fallback)
├── qbo-service.js          # QuickBooks Online OAuth + sync
├── routes/                 # Express route handlers (one file per resource)
│   ├── accounts.js         # Accounts CRUD + merge
│   ├── api-webhooks.js     # Incoming webhook receiver + log
│   ├── auth.js             # Google OAuth2 strategy + session
│   ├── credits.js          # Account credits
│   ├── dashboard.js        # Dashboard KPI aggregation
│   ├── email.js            # Send individual + bulk email
│   ├── forecast.js         # Velocity/forecast report
│   ├── gallonage.js        # Volume-by-format report
│   ├── inbound-emails.js   # Inbound email management
│   ├── inventory.js        # Inventory CRUD + enrichment
│   ├── keg-tracking.js     # Keg deploy/return tracking
│   ├── notifications.js    # Notification log
│   ├── order-items.js      # Order line items
│   ├── orders.js           # Orders CRUD + PDF import
│   ├── outreach.js         # Outreach log
│   ├── products.js         # Products CRUD + variations
│   ├── qbo.js              # QuickBooks OAuth + sync endpoints
│   ├── reminders.js        # Reminders/todos with recurrence
│   ├── reports.js          # Full sales report
│   ├── sales-export.js     # Order export for state reporting
│   ├── settings.js         # Settings + API key management
│   ├── staff.js            # Staff management
│   ├── stock-movements.js  # Stock movement CRUD
│   ├── tap-handles.js      # Tap handle tracking
│   └── webhooks.js         # Legacy /webhooks/order endpoint
├── lib/
│   ├── notifications.js    # @mention + assignment email notification helpers
│   └── pdf-parser.js       # PDF invoice text extraction + Gemini parsing
├── middleware/
│   └── requireAuth.js      # Session auth + API key auth middleware
├── public/
│   ├── index.html          # SPA shell
│   ├── login.html          # Login page
│   ├── style.css           # App styles (responsive, mobile-optimized)
│   └── js/                 # Vanilla JS SPA modules (one file per view)
│       ├── core.js         # State, API helpers, pagination, shared utilities
│       ├── init.js         # App initialization, routing, navigation
│       ├── dashboard.js    ├── accounts.js ├── orders.js ├── inventory.js
│       ├── products.js     ├── outreach.js ├── staff.js  ├── todos.js
│       ├── kegs.js         ├── tap-handles.js ├── settings.js ├── map.js
│       ├── reports.js      ├── gallonage.js ├── forecast.js ├── sales-export.js
│       └── inbound-emails.js ├── notifications.js ├── mentions.js
└── docs/
    └── webhooks.md         # Webhook + REST API documentation
```

## Key architectural decisions

- **All columns TEXT**: SQLite stores everything as TEXT. All numeric and boolean comparisons use `parseInt`/`parseFloat`/string comparison in application code.
- **Format variations on Inventory**: Format and PricePerUnit live on Inventory rows (not Products), enabling multiple format variations per product at each location.
- **Inventory uniqueness**: ProductID + Location + Format (a product can have multiple rows per location if it has multiple formats).
- **Stock via movements only**: Inventory `Units` is never updated directly — all changes go through `StockMovements` for a complete audit trail.
- **Session + API key auth**: Browser sessions use Google OAuth2 + express-session. API integrations use hashed API keys stored in Settings.
- **CSRF protection**: State-changing API requests from the browser must include `X-Requested-With: XMLHttpRequest`. API key requests are exempt.
- **Migration-safe schema**: `HEADERS` in `db.js` is the source of truth. Missing columns are added automatically on startup — no migration scripts needed.
