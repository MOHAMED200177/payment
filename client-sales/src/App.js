import React from 'react';
import './App.css';
import logo from './img/logo.jpg'; // استدعاء الصورة
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import InvoiceForm from './components/InvoiceForm';
import InvoiceList from './components/InvoiceList';
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
          <Route path="/invoices/*" element={<InvoicePage />} />
          <Route path="/stock/*" element={<StockPage />} />
          <Route path="/payments/*" element={<PaymentPage />} />
          <Route path="/returns/*" element={<ReturnPage />} />
          <Route path="/customer-statement" element={<CustomerStatement />} />
        </Routes>
        <Footer />
      </div>
    </Router>
  );
};

const HomePage = () => (
  <div>
    <div className="title-with-logo">
      <img src={logo} alt="Logo" className="logo" />
      <h1>Management</h1>
    </div>
    <div className="grid-container">
      <Link to="/invoices" className="grid-item">Invoices</Link>
      <Link to="/stock" className="grid-item">Stock</Link>
      <Link to="/payments" className="grid-item">Payments</Link>
      <Link to="/returns" className="grid-item">Returns</Link>
      <Link to="/customer-statement" className="grid-item">Customers</Link>
    </div>
  </div>
);

const InvoicePage = () => {
  const location = useLocation();

  return (
    <div>
      <PageHeader title="Invoices" />
      {location.pathname === '/invoices' && (
        <div className="grid-container">
          <Link to="create" className="grid-item" target="_blank" rel="noopener noreferrer">Create Invoice</Link>
          <Link to="view" className="grid-item" target="_blank" rel="noopener noreferrer" >View Invoices</Link>
          <Link to="edit" className="grid-item" target="_blank" rel="noopener noreferrer" >Edit Invoice</Link>
          <Link to="delete" className="grid-item" target="_blank" rel="noopener noreferrer">Delete Invoice</Link>
        </div>
      )}
      <Routes>
        <Route path="create" element={<InvoiceForm />} />
        <Route path="view" element={<div>{<InvoiceList />}</div>} />
        <Route path="edit" element={<div>Edit Invoice</div>} />
        <Route path="delete" element={<div>Delete Invoice</div>} />
      </Routes>
    </div>
  );
};

const StockPage = () => {
  const location = useLocation();

  return (
    <div>
      <PageHeader title="Stock" />
      {location.pathname === '/stock' && (
        <div className="grid-container">
          <Link to="create" className="grid-item">Add Stock</Link>
          <Link to="view" className="grid-item">View Stock</Link>
          <Link to="edit" className="grid-item">Edit Stock</Link>
          <Link to="delete" className="grid-item">Delete Stock</Link>
        </div>
      )}
      <Routes>
        <Route path="create" element={<StockForm />} />
        <Route path="view" element={<div>View Stock</div>} />
        <Route path="edit" element={<div>Edit Stock</div>} />
        <Route path="delete" element={<div>Delete Stock</div>} />
      </Routes>
    </div>
  );
};

const PaymentPage = () => {
  const location = useLocation();

  return (
    <div>
      <PageHeader title="Payments" />
      {location.pathname === '/payments' && (
        <div className="grid-container">
          <Link to="create" className="grid-item">Add Payment</Link>
          <Link to="view" className="grid-item">View Payments</Link>
          <Link to="edit" className="grid-item">Edit Payment</Link>
          <Link to="delete" className="grid-item">Delete Payment</Link>
        </div>
      )}
      <Routes>
        <Route path="create" element={<PaymentForm />} />
        <Route path="view" element={<div>View Payments</div>} />
        <Route path="edit" element={<div>Edit Payment</div>} />
        <Route path="delete" element={<div>Delete Payment</div>} />
      </Routes>
    </div>
  );
};

const ReturnPage = () => {
  const location = useLocation();

  return (
    <div>
      <PageHeader title="Returns" />
      {location.pathname === '/returns' && (
        <div className="grid-container">
          <Link to="create" className="grid-item">Add Return</Link>
          <Link to="view" className="grid-item">View Returns</Link>
          <Link to="edit" className="grid-item">Edit Return</Link>
          <Link to="delete" className="grid-item">Delete Return</Link>
        </div>
      )}
      <Routes>
        <Route path="create" element={<ReturnForm />} />
        <Route path="view" element={<div>View Returns</div>} />
        <Route path="edit" element={<div>Edit Return</div>} />
        <Route path="delete" element={<div>Delete Return</div>} />
      </Routes>
    </div>
  );
};

const PageHeader = ({ title }) => (
  <div className="title-with-logo">
    <img src={logo} alt="Logo" className="logo" />
    <h1>{title}</h1>
  </div>
);

const Footer = () => (
  <footer className="footer">
    <p>&copy; {new Date().getFullYear()} Invoice Management. All rights reserved.</p>
  </footer>
);

export default App;

