import React, { useState } from 'react';
import axios from 'axios';
import './CustomerData.css';

const CustomerData = () => {
    const [customerName, setCustomerName] = useState('');
    const [customerData, setCustomerData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const fetchData = async () => {
        setLoading(true);
        setError(null);
        setCustomerData(null);

        try {
            const response = await axios.post('http://localhost:8000/customers/profile', {
                name: customerName,
            });
            setCustomerData(response.data.data.data);
        } catch (err) {
            setError('Error fetching data, please ensure the name is correct.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="form-container">
            <div className="title">
                <h1>Customer Search</h1>
            </div>
            <div className="form">
                <input
                    type="text"
                    placeholder="Enter customer name"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="search-input"
                />
                <button onClick={fetchData} className="submit-btn">
                    Search
                </button>
            </div>

            {loading && <div className="loading">Loading data...</div>}
            {error && <div className="error">{error}</div>}

            {customerData && (
                <>
                    <div className="customer-card">
                        <p><strong>Name:</strong> {customerData.name}</p>
                        <p><strong>Email:</strong> {customerData.email}</p>
                        <p><strong>Phone:</strong> {customerData.phone}</p>
                        <p><strong>Balance:</strong> {customerData.balance}</p>
                        <p><strong>Outstanding Balance:</strong> {customerData.outstandingBalance}</p>
                    </div>

                    <div className="section">
                        <h2>Invoices</h2>
                        {customerData.invoice.length > 0 ? (
                            customerData.invoice.map((inv) => (
                                <div key={inv._id} className="item-card">
                                    <p><strong>Invoice ID:</strong> {inv._id}</p>
                                    <p><strong>Total:</strong> {inv.total}</p>
                                    <p><strong>Paid:</strong> {inv.paid}</p>
                                    <p><strong>Status:</strong> {inv.status}</p>
                                </div>
                            ))
                        ) : (
                            <p>No invoices found.</p>
                        )}
                    </div>

                    <div className="section">
                        <h2>Payments</h2>
                        {customerData.payment.length > 0 ? (
                            customerData.payment.map((payment) => (
                                <div key={payment._id} className="item-card">
                                    <p><strong>Payment ID:</strong> {payment._id}</p>
                                    <p><strong>Amount:</strong> {payment.amount}</p>
                                    <p><strong>Status:</strong> {payment.status}</p>
                                </div>
                            ))
                        ) : (
                            <p>No payments found.</p>
                        )}
                    </div>

                    <div className="section">
                        <h2>Returns</h2>
                        {customerData.returns.length > 0 ? (
                            customerData.returns.map((ret) => (
                                <div key={ret._id} className="item-card">
                                    <p><strong>Return ID:</strong> {ret._id}</p>
                                    <p><strong>Reason:</strong> {ret.reason}</p>
                                    <p><strong>Date:</strong> {new Date(ret.date).toLocaleString()}</p>
                                </div>
                            ))
                        ) : (
                            <p>No returns found.</p>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

export default CustomerData;
