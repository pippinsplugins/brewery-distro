# Brewery Distribution Manager

A web app for managing self-distribution accounts for a small microbrewery. Tracks inventory, customer accounts, outreach history, and reminders — backed by Google Sheets so no database is required.

## Features

- **Inventory** — Track products (name, style, ABV, format, stock level, price). Low-stock alerts.
- **Accounts** — Manage bars, restaurants, bottle shops, and retailers. Store preferred contact method (email, phone, SMS, in-person), contact info, and status (Active / Prospect / Inactive).
- **Outreach Log** — Log every customer contact with date, method used, notes, and follow-up date. Automatically updates the account's "Last Contacted" date.
- **Reminders** — Deadline tracker for follow-ups, deliveries, payments, orders, and events. Color-coded urgency (overdue / today / upcoming). One click to mark done.
- **Dashboard** — At-a-glance stats, overdue alerts, upcoming reminders, recent outreach, and low-stock warnings.

## Setup

### 1. Google Cloud — create a service account

1. Go to [console.cloud.google.com](https://console.cloud.google.com/) and create (or select) a project.
2. Enable the **Google Sheets API** for that project.
3. Go to **IAM & Admin → Service Accounts** and create a new service account.
4. On the service account, go to **Keys → Add Key → Create new key → JSON**. Download the JSON file.
5. Rename the downloaded file to `credentials.json` and place it in the project root.

### 2. Google Sheets — create and share the spreadsheet

1. Create a new Google Sheet at [sheets.google.com](https://sheets.google.com).
2. Copy the spreadsheet ID from the URL:
   `https://docs.google.com/spreadsheets/d/**[SPREADSHEET_ID]**/edit`
3. Share the spreadsheet with the **client_email** from your `credentials.json`, granting **Editor** access.

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in your `SPREADSHEET_ID`. The app will use `credentials.json` by default.

### 4. Install and run

```bash
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000).

On first run the app automatically creates four sheets inside your spreadsheet: `Inventory`, `Accounts`, `Outreach`, and `Reminders`.

## Data structure

All data lives in your Google Sheet with these tabs:

| Sheet | Columns |
|---|---|
| Inventory | ID, Name, Style, ABV, Format, Units, PricePerUnit, LowStockThreshold, Notes, LastUpdated |
| Accounts | ID, Name, Type, ContactName, Email, Phone, PreferredMethod, Address, City, State, Status, Notes, LastContacted, CreatedAt |
| Outreach | ID, AccountID, AccountName, Date, Method, Notes, FollowUpDate, FollowUpStatus, CreatedAt |
| Reminders | ID, Type, AccountID, AccountName, Title, DueDate, Priority, Notes, Completed, CreatedAt |

## Development

```bash
npm run dev   # uses nodemon for auto-reload
```

## Environment variables

| Variable | Description |
|---|---|
| `SPREADSHEET_ID` | ID of your Google Sheet (required) |
| `GOOGLE_KEY_FILE` | Path to service account JSON key file (default: `credentials.json`) |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Inline JSON credentials (alternative to key file, useful for cloud deployments) |
| `PORT` | Server port (default: 3000) |
