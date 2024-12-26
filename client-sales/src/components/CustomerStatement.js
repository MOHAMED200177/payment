// src/components/CustomerStatement.js
import React, { useState } from 'react';
import axios from 'axios';

const CustomerStatement = () => {
    const [email, setEmail] = useState('');
    const [statement, setStatement] = useState(null);
    const [error, setError] = useState('');

    const fetchCustomerStatement = async () => {
        try {
            const response = await axios.post('http://localhost:8000/customers/statement', { email });
            setStatement(response.data);
            setError('');
        } catch (err) {
            setError(err.response ? err.response.data.message : 'Error fetching statement');
            setStatement(null);
        }
    };

    return (
        <>
            <div className="title">
                <h2>Customer Statement</h2>
            </div>
            <div className="form-container">
                <form className="form">
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Enter Customer Email"
                    />
                    <button onClick={fetchCustomerStatement} className="submit-btn">Get Statement</button>
                </form>
            </div>


            {error && <p style={{ color: 'red' }}>{error}</p>}

            {statement && (
                <div>
                    <h3>Customer Details</h3>
                    <p>Name: {statement.customer.name}</p>
                    <p>Email: {statement.customer.email}</p>
                    <p>Phone: {statement.customer.phone}</p>

                    <h3>Totals</h3>
                    <p>Total Invoices: {statement.totals.totalInvoices}</p>
                    <p>Total Payments: {statement.totals.totalPayments}</p>
                    <p>Total Refunds: {statement.totals.totalRefunds}</p>
                    <p>Balance: {statement.totals.balance}</p>

                    <h3>Invoices</h3>
                    <ul>
                        {statement.invoices.map(invoice => (
                            <li key={invoice.id}>
                                ID: {invoice.id}, Total: {invoice.total}, Paid: {invoice.paid}, Refunds: {invoice.refunds}, Status: {invoice.status}, Date: {new Date(invoice.date).toLocaleDateString()}
                            </li>
                        ))}
                    </ul>

                    <h3>Payments</h3>
                    <ul>
                        {statement.payments.map(payment => (
                            <li key={payment.id}>
                                Amount: {payment.amount}, Date: {new Date(payment.date).toLocaleDateString()}
                            </li>
                        ))}
                    </ul>

                    <h3>Returns</h3>
                    <ul>
                        {statement.returns.map((ret, index) => (
                            <li key={index}>
                                Product: {ret.product}, Quantity: {ret.quantity}, Reason: {ret.reason}, Date: {new Date(ret.date).toLocaleDateString()}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </>
    );
};

export default CustomerStatement;