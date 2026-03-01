# Brewery Distribution Manager

A web app for managing self-distribution operations for a small microbrewery. Tracks products, inventory across multiple locations, customer accounts, orders, outreach history, reminders, keg tracking, tap handles, and email — all backed by a local SQLite database.

## Features

- **Dashboard** — At-a-glance KPIs: active accounts, monthly orders & revenue, overdue reminders, low-stock alerts, recent outreach, and pending deliveries.
- **Products** — Master product catalog (name, style, ABV, format, price). Adding a product auto-creates inventory rows at every configured location.
- **Inventory** — Per-location stock levels with low-stock thresholds and alerts. Stock is adjusted through stock movements (sales, received, write-offs, adjustments) for a full audit trail.
- **Accounts** — Manage bars, restaurants, retail stores, grocery stores, hotels, event venues, and individuals. Store contact info, preferred contact method, address, ABC license, and assigned sales rep. Detailed profile view with outreach history, orders, kegs, and tap handles in one place.
- **Orders & Sales** — Create and manage orders with invoice numbers, delivery dates, and payment status (Pending / Paid / Cancelled / Pre-Sale). Confirm deliveries with product selection, which auto-decrements inventory and creates keg tracking records.
- **Outreach Log** — Log every customer contact (phone, email, in-person) with notes and follow-up dates. Automatically updates the account's "Last Contacted" date.
- **Reminders / Todos** — Task management with due dates, priorities, account/staff assignment, and recurring schedules (daily, weekly, biweekly, monthly, quarterly, yearly). Completing a recurring reminder auto-creates the next occurrence.
- **Keg Tracking** — Track kegs deployed to accounts and mark returns. Auto-created when delivering keg-format products. Outstanding keg counts shown on account profiles and a dedicated kegs view.
- **Tap Handles** — Track promotional tap handles deployed to venues and mark collections.
- **Email** — Send individual or bulk emails directly from the app using each staff member's own Gmail account via OAuth2. Bulk emails use BCC for recipient privacy. Sends are auto-logged as outreach entries.
- **Staff** — Manage sales reps with assignment to accounts and orders.
- **Multi-Location** — Configure multiple warehouse/taproom locations. Inventory, orders, and the dashboard filter by location.
- **Map** — Visual map of account locations.
- **Zapier Webhook** — Accept incoming orders from external systems (POS, accounting) via a webhook endpoint.

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
PORT=3000                          # Server port (default: 3000)
DB_PATH=./data/brewery.db         # SQLite database path (default: ./data/brewery.db)
GOOGLE_ALLOWED_DOMAIN=company.com  # Restrict login to a Google Workspace domain
GOOGLE_CALLBACK_URL=https://...    # Full OAuth callback URL for production
WEBHOOK_SECRET=a_long_random_string  # Enables the Zapier webhook endpoint
```

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
| `WEBHOOK_SECRET` | No | Bearer token for authenticating Zapier webhook calls |

## Zapier webhook

When `WEBHOOK_SECRET` is set, the app exposes a `POST /webhooks/zapier/order` endpoint that accepts orders from external systems. Include the secret as a Bearer token in the Authorization header.

The endpoint accepts flexible field names to accommodate different source systems:

- **Account:** `AccountID`, `account_id`, `AccountName`, `account_name`, `customer_name`, or `client_name`
- **Order date:** `OrderDate`, `order_date`, `sale_date`, `SaleDate`, or `invoice_date` (defaults to today)
- **Amount:** `OrderAmount`, `order_amount`, `SaleAmount`, `sale_amount`, `amount`, or `subtotal`
- **Tax:** `TaxAmount`, `tax_amount`, or `tax`
- **Invoice:** `InvoiceNumber` or `invoice_number`
- **Status:** `Status` or `status` (Pending, Paid, or Cancelled)

## Data structure

All data is stored in a local SQLite database with these tables:

| Table | Columns |
|---|---|
| Products | ID, Name, Style, ABV, Format, PricePerUnit, Notes, CreatedAt |
| Inventory | ID, Name, Location, Style, ABV, Format, Units, PricePerUnit, LowStockThreshold, Notes, LastUpdated, ProductID, ProductName |
| Accounts | ID, Name, Type, Tags, ContactName, Email, AdditionalEmails, Phone, PreferredMethod, Address, City, State, Zip, ABCLicense, Status, Notes, LastContacted, StaffID, StaffName, CreatedAt |
| Orders | ID, AccountID, AccountName, Location, StaffID, StaffName, OrderDate, DeliveryDate, InvoiceNumber, OrderAmount, TaxAmount, Notes, RequestedProducts, Status, Delivered, CreatedAt |
| OrderItems | ID, OrderID, InventoryID, ProductName, Format, Quantity, UnitPrice, LineTotal, CreatedAt |
| StockMovements | ID, InventoryID, InventoryName, OrderID, Type (sale/received/write-off/adjustment), Quantity, Notes, Date, CreatedAt |
| Outreach | ID, AccountID, AccountName, Date, Method, Notes, FollowUpDate, FollowUpStatus, CreatedAt |
| Reminders | ID, Type, AccountID, AccountName, Title, DueDate, Priority, Notes, Completed, StaffID, StaffName, Recurrence, RecurrenceParentID, CreatedAt |
| KegTracking | ID, AccountID, AccountName, OrderID, InventoryID, ProductName, Format, Quantity, DeliveredDate, ReturnedDate, ReturnedQuantity, Notes, CreatedAt |
| TapHandles | ID, AccountID, AccountName, Quantity, DeployedDate, CollectedDate, CollectedQuantity, Notes, CreatedAt |
| Staff | ID, Name, Email, Phone, Role, Active, Notes, CreatedAt |
| EmailLog | ID, SenderName, SenderEmail, Recipients, Subject, Body, Type, AccountIDs, Status, Error, CreatedAt |
| Settings | ID, Key, Value, UpdatedAt |
