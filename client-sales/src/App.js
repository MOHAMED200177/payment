// src/App.js
import React from 'react';
import './App.css'
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import InvoiceForm from './components/InvoiceForm';
import InvoiceList from './components/InvoiceList';
import StockForm from './components/StockForm';
import StockList from './components/StockList';
import PaymentForm from './components/PaymentForm';
import ReturnForm from './components/ReturnForm';
import CustomerStatement from './components/CustomerStatement';

const App = () => {
  return (
    <Router>
      <div>
        <h1>Invoice Management</h1>
        <nav>
          <ul>
            <li><Link to="/">Invoices</Link></li>
            <li><Link to="/stock">Stock</Link></li>
            <li><Link to="/payments">Payments</Link></li>
            <li><Link to="/returns">Returns</Link></li>
            <li><Link to="/customer-statement">Customer Statement</Link></li>
          </ul>
        </nav>

        <Routes>
          <Route path="/" element={<InvoicePage />} />
          <Route path="/stock" element={<StockPage />} />
          <Route path="/payments" element={<PaymentPage />} />
          <Route path="/returns" element={<ReturnPage />} />
          <Route path="/customer-statement" element={<CustomerStatement />} />
        </Routes>
      </div>
    </Router>
  );
};

// مكونات الصفحات
const InvoicePage = () => (
  <div>
    <InvoiceForm />
    <InvoiceList />
  </div>
);

const StockPage = () => (
  <div>
    <StockForm onStockCreated={() => window.location.reload()} />
    <StockList />
  </div>
);

const PaymentPage = () => (
  <div>
    <PaymentForm onPaymentAdded={() => window.location.reload()} />
  </div>
);

const ReturnPage = () => (
  <div>
    <ReturnForm onReturnAdded={() => window.location.reload()} />
  </div>
);

export default App;