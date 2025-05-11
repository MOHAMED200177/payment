# 📦 Inventory & Sales Management System — Backend

## 📚 Overview

This backend system manages products, customers, invoices, returns, transactions, and stock for a sales operation. It ensures data integrity through MongoDB transactions and covers essential business logic like processing product returns, updating stock, issuing refunds, and adjusting customer balances.

---

## ✅ Completed Features

### 📦 Data Models
- **Product**
- **Stock**
- **Customer**
- **Invoice**
- **Transaction**
- **Return**

All models are linked with proper MongoDB references.

---

### ⚙️ CRUD Operations
- **Generic CRUD Factory** for:
  - Get All
  - Get One
  - Update One
  - Delete One

Implemented for:
- Products
- Customers
- Invoices
- Returns
- Transactions
- Stock

---

### 🔄 Return Process Logic
- Validate product existence
- Validate customer and invoice existence
- Validate stock record
- Validate invoice item existence
- Check previously returned quantity for the invoice and product
- Calculate refund amount
- Update stock quantity
- Update invoice returns, subtotal, totalAmount, and balanceDue
- Create a refund transaction
- Update customer’s balance and outstandingBalance
- Save all updates within a MongoDB transaction session
- Commit or rollback on error

---

### 🗂️ Indexes
Added for performance optimization:
- `Return.invoice`
- `Return.product`
- `Stock.product`
- `Invoice.invoiceNumber`

---

### 🧪 Testing
- Postman testing for all endpoints
- Error handling scenarios tested
- Transaction rollback verified

---

## 📈 Next Steps

### 🎨 Frontend
- Build a simple React / Next.js dashboard to interact with the system.

### 📊 Reports / Dashboard
- Total sales
- Refund totals
- Stock levels
- Customer balances

### 📄 Export Invoices / Returns
- Generate downloadable PDF / Excel files for invoices and returns.

### 📝 Customer Statements
- Transaction history
- Outstanding balance report
- Downloadable statements

### 🔔 Notifications
- Email / SMS notifications for returns and refunds.

### 📜 Access Logs
- Track admin and staff operations:
  - Who returned what
  - Refund amounts
  - Timestamp logs

### 🧪 Unit & Integration Tests
- Jest / Supertest for:
  - API endpoints
  - Database operations
  - Transaction behavior

---

## 📂 Project Structure (Backend)

