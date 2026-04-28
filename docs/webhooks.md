# Webhooks & API Integration

## Authentication

Generate an API key in **Settings > API Keys**. Pass it in either header:

```
Authorization: Bearer <your-api-key>
X-API-Key: <your-api-key>
```

API keys work with all `/api/*` endpoints (products, inventory, orders, settings, etc.) as well as the incoming webhook endpoint.

---

## Incoming Webhook

**Endpoint:** `POST /api/webhooks/incoming`

**Auth:** API key (see above)

**Content-Type:** `application/json`

**Body format:**

```json
{
  "action": "<action-name>",
  "data": { ... }
}
```

Every request is logged and viewable via `GET /api/webhooks/log`.

---

### `inventory.update`

Adjust stock for an inventory item. Creates a stock movement record and updates the unit count.

**Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `inventoryId` | string | yes | The inventory row ID |
| `quantity` | integer | yes | Non-zero quantity to adjust |
| `mode` | string | no | `"delta"` (default) adds/subtracts from current stock. `"absolute"` sets stock to this exact number. |
| `notes` | string | no | Note for the stock movement record. Defaults to `"API webhook"`. |
| `date` | string | no | Date for the movement (`YYYY-MM-DD`). Defaults to today. |

**Delta mode:** `quantity` is added to current stock. Use negative values to subtract (e.g. `-5` removes 5 units). Stock cannot go below 0.

**Absolute mode:** Stock is set to exactly `quantity`. Must be >= 0.

**Example:**

```bash
curl -X POST https://your-app.com/api/webhooks/incoming \
  -H "Authorization: Bearer <key>" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "inventory.update",
    "data": {
      "inventoryId": "abc-123",
      "quantity": 24,
      "mode": "delta",
      "notes": "POS restock"
    }
  }'
```

**Response:**

```json
{
  "movement": {
    "ID": "...",
    "InventoryID": "abc-123",
    "InventoryName": "Hazy IPA — 1/6 Keg",
    "Type": "received",
    "Quantity": "24",
    "Notes": "POS restock",
    "Date": "2026-03-26"
  },
  "newUnits": 48
}
```

---

### `product.create`

Create a new product with optional format variations. Inventory rows are automatically created at every configured location.

**Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Product name |
| `style` | string | no | Beer style (e.g. `"IPA"`, `"Stout"`) |
| `abv` | string | no | ABV percentage (e.g. `"6.5"`) |
| `notes` | string | no | Product notes |
| `variations` | array | no | Format variations (see below). If omitted, one blank-format variation is created. |

**Variation object:**

| Field | Type | Description |
|-------|------|-------------|
| `format` | string | Format name (e.g. `"1/6 Keg"`, `"16oz 4-Pack"`) |
| `pricePerUnit` | string | Price per unit (e.g. `"89.00"`) |
| `prices` | array | Multi-tier pricing: `[{ "label": "Tier Name", "price": "89.00" }, ...]` |

**Example:**

```bash
curl -X POST https://your-app.com/api/webhooks/incoming \
  -H "Authorization: Bearer <key>" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "product.create",
    "data": {
      "name": "Hazy IPA",
      "style": "IPA",
      "abv": "6.5",
      "variations": [
        { "format": "1/6 Keg", "pricePerUnit": "89.00" },
        { "format": "1/2 Keg", "pricePerUnit": "175.00" },
        { "format": "16oz 4-Pack", "pricePerUnit": "12.99" }
      ]
    }
  }'
```

**Response:**

```json
{
  "product": { "ID": "...", "Name": "Hazy IPA", "Style": "IPA", "ABV": "6.5", ... },
  "inventoryRows": [
    { "ID": "...", "ProductID": "...", "Format": "1/6 Keg", "Location": "Kansas City", "Units": "0", ... },
    { "ID": "...", "ProductID": "...", "Format": "1/6 Keg", "Location": "St. Louis", "Units": "0", ... },
    ...
  ]
}
```

---

### `product.update`

Update an existing product's fields. If the name changes, it is cascaded to all related inventory rows.

**Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `productId` | string | one of these | Product ID for direct lookup |
| `name` | string | one of these | Product name for fuzzy lookup (case-insensitive) |
| `updates` | object | yes | Fields to update (see below) |

**Update fields** (all optional, at least one required):

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | New product name |
| `style` | string | New style |
| `abv` | string | New ABV |
| `notes` | string | New notes |

**Example:**

```bash
curl -X POST https://your-app.com/api/webhooks/incoming \
  -H "Authorization: Bearer <key>" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "product.update",
    "data": {
      "name": "Hazy IPA",
      "updates": { "abv": "6.8", "notes": "Updated recipe" }
    }
  }'
```

**Response:**

```json
{
  "product": { "ID": "...", "Name": "Hazy IPA", "ABV": "6.8", "Notes": "Updated recipe", ... }
}
```

---

### `order.create`

Create a new order. Accounts and staff are resolved by name if IDs aren't provided.

**Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `accountId` | string | one of these | Account ID for direct lookup |
| `accountName` | string | one of these | Account name for lookup (case-insensitive) |
| `orderDate` | string | no | Order date (`YYYY-MM-DD` or ISO 8601). Defaults to now. |
| `deliveryDate` | string | no | Delivery date (`YYYY-MM-DD`) |
| `invoiceNumber` | string | no | Invoice number |
| `orderAmount` | string | no | Pre-tax order total. Defaults to `"0"`. |
| `taxAmount` | string | no | Tax amount. Defaults to `"0"`. |
| `notes` | string | no | Order notes |
| `location` | string | no | Warehouse/taproom location name |
| `staffId` | string | no | Staff member ID |
| `staffName` | string | no | Staff member name for lookup (case-insensitive) |
| `requestedProducts` | string | no | Free-text product list |
| `status` | string | no | `Pending` (default), `Paid`, `Cancelled`, or `Pre-Sale` |
| `delivered` | boolean | no | Whether the order has been delivered. Defaults to `false`. |

**Example:**

```bash
curl -X POST https://your-app.com/api/webhooks/incoming \
  -H "Authorization: Bearer <key>" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "order.create",
    "data": {
      "accountName": "The Craft Bar",
      "orderAmount": "450.00",
      "taxAmount": "38.25",
      "staffName": "Alex",
      "location": "Kansas City",
      "status": "Pending",
      "notes": "POS import"
    }
  }'
```

**Response:**

```json
{
  "order": { "ID": "...", "AccountName": "The Craft Bar", "OrderAmount": "450.00", "Status": "Pending", ... }
}
```

---

## Webhook Log

**Endpoint:** `GET /api/webhooks/log`

**Auth:** API key or session

Returns the last 100 incoming webhook requests (newest first). Each entry includes the action, payload, status (`success`/`error`), error message (if any), API key name, and timestamp.

---

## REST API Endpoints

All standard REST endpoints also accept API key authentication. Useful endpoints for integrations:

### Products

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/products` | List all products |
| `GET` | `/api/products/:id` | Get a single product |
| `POST` | `/api/products` | Create a product (auto-creates inventory rows at every location) |
| `PUT` | `/api/products/:id` | Update product fields (cascades Name changes to inventory) |
| `DELETE` | `/api/products/:id` | Delete product (refused if any stock > 0) |
| `GET` | `/api/products/:id/variations` | List format variations (deduplicated from inventory rows) |
| `POST` | `/api/products/:id/variations` | Add a new format variation |
| `DELETE` | `/api/products/:id/variations/:format` | Remove a format variation (refused if stock > 0) |

### Inventory

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/inventory` | List all inventory, enriched with product data. Supports `?location=Name` filter. Includes computed `Allocated` and `Available` fields. |
| `GET` | `/api/inventory/:id` | Get a single inventory item (enriched) |
| `PUT` | `/api/inventory/:id` | Update inventory metadata (Units are managed via stock-movements only) |
| `DELETE` | `/api/inventory/:id` | Delete an inventory row |

### Orders

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/orders` | List all orders. Supports `?accountId=`, `?staffId=`, `?location=` filters. |
| `POST` | `/api/orders` | Create an order |
| `PUT` | `/api/orders/:id` | Update an order (cannot un-deliver a delivered order) |
| `DELETE` | `/api/orders/:id` | Delete an order (voids linked QBO invoice if present) |
| `POST` | `/api/orders/import` | Upload PDF invoice(s) for AI parsing, returns preview data |
| `POST` | `/api/orders/import/confirm` | Bulk-create orders from parsed invoice data |

### Order Items

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/order-items` | List line items. Supports `?orderId=` filter. |
| `GET` | `/api/order-items/counts` | Map of `{ orderId: itemCount }` for all orders (badge display) |
| `POST` | `/api/order-items` | Create a single line item |
| `POST` | `/api/order-items/bulk` | Create multiple line items at once |
| `DELETE` | `/api/order-items` | Delete all line items for an order (requires `?orderId=`) |

### Accounts

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/accounts` | List all accounts |
| `POST` | `/api/accounts` | Create an account |
| `PUT` | `/api/accounts/:id` | Update an account |
| `DELETE` | `/api/accounts/:id` | Delete account (cascades to outreach, reminders, orders, kegs, tap handles, credits) |
| `GET` | `/api/accounts/:id/merge-preview` | Preview what would be moved from a source account. Requires `?sourceId=`. |
| `POST` | `/api/accounts/:id/merge` | Merge source account into this account, reassigning all related records |

### Credits

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/credits` | List all credit records. Supports `?accountId=` filter. |
| `GET` | `/api/credits/balance/:accountId` | Computed credit balance for an account |
| `POST` | `/api/credits` | Create a credit (`type`: `"credit"` or `"applied"`) |
| `PUT` | `/api/credits/:id` | Update amount, reason, or notes |
| `DELETE` | `/api/credits/:id` | Delete a credit record |

### Stock Movements

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/stock-movements` | List stock movements. Supports `?inventoryId=` filter. |
| `POST` | `/api/stock-movements` | Create a stock movement (updates inventory Units) |
| `DELETE` | `/api/stock-movements/:id` | Delete a stock movement (reverses the unit change) |

### Outreach

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/outreach` | List outreach entries. Supports `?accountId=` filter. |
| `POST` | `/api/outreach` | Create an outreach entry (updates account LastContacted) |
| `PUT` | `/api/outreach/:id` | Update an outreach entry |
| `DELETE` | `/api/outreach/:id` | Delete an outreach entry |

### Reminders / Todos

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/reminders` | List reminders. Supports `?status=active\|completed\|all`. |
| `POST` | `/api/reminders` | Create a reminder |
| `PUT` | `/api/reminders/:id` | Update a reminder. Completing a recurring reminder spawns the next occurrence. |
| `DELETE` | `/api/reminders/:id` | Delete a reminder |

### Reports & Analytics

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/dashboard` | Dashboard KPIs. Supports `?location=` filter. |
| `GET` | `/api/reports` | Full sales report. Requires `?start=YYYY-MM-DD&end=YYYY-MM-DD`. Supports `?location=`. |
| `GET` | `/api/gallonage` | Volume report by format and account. Requires `?start=&end=`. Supports `?location=`, `?accountType=`, `?tag=`, `?accountIds=`. |
| `GET` | `/api/sales-export` | Order rows with account details for state reporting. Requires `?start=&end=`. Supports `?location=`, `?excludeTypes=`. |
| `GET` | `/api/forecast` | Velocity/forecast report. Requires `?start=&end=`. Supports `?location=`. |

### Settings & Staff

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/settings` | Get all settings as a key-value map (secrets omitted) |
| `PUT` | `/api/settings` | Update settings (allowed keys: `locations`, `accountTags`, `styles`, `kegDeposits`, `companyName`, `inboundEmail`, `geminiApiKey`, `qboTaxCodeId`) |
| `PUT` | `/api/settings/rename-location` | Rename a location and cascade to inventory + orders |
| `PUT` | `/api/settings/rename-account-tag` | Rename a tag and cascade to all accounts |
| `PUT` | `/api/settings/rename-style` | Rename a style and cascade to products + inventory |
| `GET` | `/api/settings/api-keys` | List API keys (name, prefix, createdAt — no hash) |
| `POST` | `/api/settings/api-keys` | Generate a new API key (raw key returned once only) |
| `DELETE` | `/api/settings/api-keys/:id` | Revoke an API key |
| `GET` | `/api/staff` | List staff |
| `POST` | `/api/staff` | Create a staff member |
| `PUT` | `/api/staff/:id` | Update a staff member |
| `DELETE` | `/api/staff/:id` | Delete a staff member |

---

## Inbound Email Webhook

**Endpoint:** `POST /webhooks/inbound-email`

**Auth:** Bearer token (generated in Settings > Email Order Requests)

```
Authorization: Bearer <webhook-token>
```

> **Note:** This endpoint uses a dedicated webhook token, not an API key. Generate the token in Settings.

**Content-Type:** `application/json`

**Body format:**

```json
{
  "messageId": "gmail-message-id",
  "from": "Name <email@example.com>",
  "to": "orders@yourdomain.com",
  "subject": "Order request",
  "body": "Plain text email body",
  "receivedAt": "2026-04-09T12:00:00Z"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `messageId` | string | yes | Unique email ID (used for deduplication) |
| `from` | string | no | Sender in `Name <email>` format |
| `to` | string | no | Recipient address |
| `subject` | string | no | Email subject line |
| `body` | string | no | Plain text email body |
| `receivedAt` | string | no | ISO 8601 timestamp. Defaults to now. |

**Flow:**
1. Validates the Bearer token against the stored `inboundEmailWebhookToken` setting
2. Deduplicates by `messageId` — if already processed, returns `{ skipped: true, reason: "duplicate" }`
3. Creates an `INBOUND_EMAILS` row with Status `pending`
4. Parses the email with Gemini AI and attempts to create a Draft order
5. Returns the email ID and final status

**Response (new email):**

```json
{
  "success": true,
  "emailId": "uuid",
  "status": "order_created"
}
```

**Response (duplicate):**

```json
{
  "skipped": true,
  "reason": "duplicate"
}
```

**Setup:** Install the [Google Apps Script](/docs/inbound-email-apps-script.js) on the Gmail account that receives order emails. Configure it with the webhook URL and token from Settings, then run the `setup()` function to start forwarding emails every 5 minutes.

---

## Error Responses

All errors return JSON with an `error` field:

```json
{ "error": "Description of what went wrong" }
```

| Status | Meaning |
|--------|---------|
| 400 | Bad request — missing or invalid fields |
| 401 | Unauthorized — invalid or missing API key |
| 404 | Not found — referenced record doesn't exist |
| 500 | Internal server error |
