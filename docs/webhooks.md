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

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/products` | List all products |
| `GET` | `/api/products/:id` | Get a single product |
| `GET` | `/api/products/:id/variations` | Get format variations for a product |
| `GET` | `/api/inventory` | List all inventory (supports `?location=Name` filter) |
| `GET` | `/api/inventory/:id` | Get a single inventory item (enriched with product data) |
| `GET` | `/api/orders` | List all orders |
| `GET` | `/api/accounts` | List all accounts |
| `GET` | `/api/stock-movements` | List stock movements (supports `?inventoryId=ID` filter) |

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
