# Multi-Tenant ERP — Architecture & Refactor Guide

## 1. Architecture Summary

### Before (Single-Tenant)
- One MongoDB database shared by everyone.
- Authentication via email + password (email-dependent).
- No company isolation — all data globally visible.
- Users had no company association.
- `getNextSequence` was global (counter shared across all data).

### After (Multi-Tenant)
- One MongoDB database, **data isolated per company** via `company: ObjectId`.
- Authentication via **username + password + companySlug** (fully offline).
- Every document carries a `company` field enforced at schema level (Mongoose plugin).
- All queries automatically scoped by `protect` → `injectTenant` middleware chain.
- Two roles only: **ADMIN** and **ACCOUNTANT**.
- Admin password recovery via offline recovery key (SHA-256, shown once, rotated on use).
- Counters (invoice numbers etc.) are per-company.

---

## 2. Admin Password Recovery — Design Decision

Four approaches were evaluated:

| Approach | Security | Offline? | Verdict |
|----------|----------|----------|---------|
| Email reset | High (token expiry) | ❌ No | Rejected |
| SMS/OTP | High | ❌ No | Rejected |
| Global master key | Low (single point of failure) | ✅ Yes | Rejected |
| **Per-company recovery key** | **High** | **✅ Yes** | **Chosen** |

**Implementation:**
- On company registration, a 64-character hex key is generated (`crypto.randomBytes(32)`).
- Its SHA-256 hash is stored in `Company.recoveryKeyHash` (never the plain key).
- The plain key is shown ONCE in the registration response.
- `POST /auth/admin-recovery` verifies the plain key by hashing and comparing.
- On successful recovery, the key is **rotated** — a new one is generated, old one invalidated.
- Brute-force protected by 1-second delay on failed attempts + auth rate limiter.

---

## 3. Files Modified

| File | Change |
|------|--------|
| `models/user.model.js` | Username-based auth, company field, ADMIN/ACCOUNTANT roles only |
| `models/customer.js` | Added `company` field via tenantPlugin, per-company unique indexes |
| `models/supplier.js` | Added `company` field |
| `models/product.js` | Added `company` field, per-company unique indexes |
| `models/category.js` | Added `company` field |
| `models/stock.js` | Added `company` field, unique index is now `(company, product)` |
| `models/invoice.js` | Added `company` field, invoiceNumber unique per company |
| `models/payment.js` | Added `company` field |
| `models/return.js` | Added `company` field |
| `models/transactions.js` | Added `company` field |
| `models/sales.js` | Added `company` field |
| `models/purchaseOrder.model.js` | Added `company` field |
| `models/supplierPayment.model.js` | Added `company` field |
| `models/expense.model.js` | Added `company` field |
| `models/counter.js` | Added `company` field, compound unique `(company, name)` |
| `middlewares/auth.js` | JWT now carries company ID, token verifies company match |
| `controllers/authController.js` | Full rewrite — company registration, username login, user management, recovery |
| `controllers/crudFactory.js` | All operations scoped to `req.tenantFilter` |
| `controllers/invoiceController.js` | All queries include `company` filter |
| `controllers/paymentController.js` | All queries include `company` filter |
| `controllers/returnController.js` | All queries include `company` filter |
| `controllers/purchaseOrderController.js` | All queries include `company` filter |
| `controllers/stockController.js` | All queries include `company` filter |
| `controllers/productController.js` | Validates category/supplier belong to same company |
| `controllers/supplierController.js` | getSupplierStatement scoped to company |
| `controllers/customerController.js` | Statement scoped to company |
| `controllers/analyticsController.js` | All aggregation pipelines include company match |
| `controllers/exportController.js` | Exports scoped to company |
| `controllers/reportController.js` | Delegates to tenant-aware analytics |
| `controllers/categoryController.js` | Uses tenant-aware crudFactory |
| `utils/getNextSequence.js` | Requires `companyId` — per-company independent counters |
| `routes/auth.routes.js` | New routes: register, login, user management, recovery |
| `app.js` | All ERP routes now use `[protect, injectTenant]` middleware chain |

---

## 4. New Files Created

| File | Purpose |
|------|---------|
| `models/company.model.js` | Root tenant entity with recovery key support |
| `models/tenantPlugin.js` | Mongoose plugin — adds `company` field to any schema |
| `middlewares/tenant.js` | `injectTenant` middleware + `assertTenant` helper |
| `scripts/migrate-to-multitenant.js` | One-time migration script for existing data |

---

## 5. Environment Variables

Add to `.env/.env`:

```env
# Existing (keep these)
DATABASE=mongodb://localhost:27017/your-db
JWT_SECRET=your-very-long-random-secret-here
JWT_EXPIRES_IN=8h
PORT=8000
NODE_ENV=development

# New — optional tweaks
RATE_LIMIT_MAX=400
CORS_ORIGIN=http://localhost:3000
LOG_LEVEL=info
```

No new environment variables are required. The system intentionally avoids email/SMTP configuration.

---

## 6. API Changes

### Authentication (Breaking Changes)

#### Register Company (new)
```
POST /auth/register
Body: { companyName, username, name, password }
Response: { token, user, company, recoveryKey, recoveryKeyNotice }
```

#### Login (changed)
```
POST /auth/login
Body: { username, password, companySlug }   ← was { email, password }
Response: { token, user, company }
```

#### Admin Recovery (new)
```
POST /auth/admin-recovery
Body: { companySlug, username, recoveryKey, newPassword }
Response: { newRecoveryKey }
```

### User Management (new — ADMIN only)
```
GET    /auth/users
POST   /auth/users              { username, name, password }
GET    /auth/users/:id
PATCH  /auth/users/:id          { name, active }
DELETE /auth/users/:id
PATCH  /auth/users/:id/reset-password   { newPassword }
```

### All ERP Endpoints (no URL changes)
All existing ERP URLs remain identical. The only difference is:
- Requests now require `Authorization: Bearer <token>`.
- Responses only contain data belonging to the authenticated company.

---

## 7. Migration Steps (Existing Data)

Run once after deploying the new code:

```bash
COMPANY_NAME="Your Company Name" \
ADMIN_USERNAME="admin" \
ADMIN_PASSWORD="YourSecurePassword123" \
node scripts/migrate-to-multitenant.js
```

The script will:
1. Create a `Company` document.
2. Create an ADMIN user.
3. Print a recovery key — **save it immediately**.
4. Stamp all existing documents with `company: <id>`.
5. Print index commands to run in MongoDB shell.

After running the migration, drop and recreate the old global unique indexes:

```javascript
// Run in MongoDB shell
db.customers.dropIndex("name_1")
db.customers.dropIndex("email_1")
db.customers.dropIndex("phone_1")
db.suppliers.dropIndex("name_1")
db.products.dropIndex("name_1")
db.products.dropIndex("productCode_1")
db.categories.dropIndex("name_1")
db.stocks.dropIndex("product_1")
db.counters.dropIndex("name_1")
```

Mongoose will recreate the new compound indexes (`company + field`) on the next app start.

---

## 8. Security Guarantees

| Threat | Protection |
|--------|-----------|
| Cross-tenant data access | Every query includes `{ company: req.companyId }` — companyId comes from DB, not client |
| ID guessing (reading another tenant's document by ObjectId) | `findOne({ _id, company })` returns 404 if company doesn't match |
| Token reuse across companies | JWT carries `company` field; `protect` verifies it matches DB user's company |
| Privilege escalation (accountant→admin) | Role check in `restrictTo('ADMIN')` middleware; role cannot be updated via PATCH /users/:id |
| Brute-force admin recovery | 1-second delay on failure + rate limiter |
| Recovery key reuse | Key is rotated on every successful recovery |
| NoSQL injection | `$`-key sanitizer on `req.query` and `req.params` |
| Password exposure | `password` field has `select: false`; never returned in queries |

---

## 9. Frontend Integration Notes

The frontend needs two small changes:

1. **Login form**: Replace `email` field with `username` + `companySlug`.
2. **Registration**: Add `companyName` field alongside `username`, `name`, `password`.

Everything else (invoice creation, payments, products, etc.) works identically — just include the JWT in every request header.
