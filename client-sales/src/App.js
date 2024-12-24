import React from 'react';
import './App.css';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import InvoiceForm from './components/InvoiceForm';
import StockForm from './components/StockForm';
import PaymentForm from './components/PaymentForm';
import ReturnForm from './components/ReturnForm';
import CustomerStatement from './components/CustomerStatement';

const App = () => {
  return (
    <Router>
      <div className="app-container">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/invoices" element={<InvoicePage />} />
          <Route path="/stock" element={<StockPage />} />
          <Route path="/payments" element={<PaymentPage />} />
          <Route path="/returns" element={<ReturnPage />} />
          <Route path="/customer-statement" element={<CustomerStatement />} />
        </Routes>
        <Footer />
      </div>
    </Router>
  );
};

const HomePage = () => (
  <>
    <div className="title">
      <h1>Invoice Management</h1>
    </div>
    <div className="grid-container">
      <Link to="/invoices" className="grid-item">Invoices</Link>
      <Link to="/stock" className="grid-item">Stock</Link>
      <Link to="/payments" className="grid-item">Payments</Link>
      <Link to="/returns" className="grid-item">Returns</Link>
      <Link to="/customer-statement" className="grid-item">Customer Statement</Link>
    </div>
  </>
);

const InvoicePage = () => (
  <div>
    <InvoiceForm />
  </div>
);

const StockPage = () => (
  <div>
    <StockForm onStockCreated={() => window.location.reload()} />
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

// Footer Component
const Footer = () => (
  <footer className="footer">
    <p>&copy; {new Date().getFullYear()} Invoice Management. All rights reserved.</p>
  </footer>
);

export default App;