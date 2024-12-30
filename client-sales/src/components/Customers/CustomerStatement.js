import React, { useState } from 'react';
import axios from 'axios';
import './cs.css';

const CustomerStatement = () => {
    const [email, setEmail] = useState('');
    const [statement, setStatement] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const fetchCustomerStatement = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            const response = await axios.post('http://localhost:8000/customers/statement', { email });
            setStatement(response.data);
            setError('');
        } catch (err) {
            setError(err.response ? err.response.data.message : 'Error fetching statement');
            setStatement(null);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="statement-page">
            <div className="form-container">
            <div className="title">
                <h2>Customer Statement</h2>
            </div>
                <form className="form" onSubmit={fetchCustomerStatement}>
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Enter Customer Email"
                        required
                    />
                    <button type="submit" className="submit-btn">
                        {loading ? 'Loading...' : 'Get Statement'}
                    </button>
                </form>
            </div>

            {error && <p className="error-message">{error}</p>}

            {loading && <div className="loader"> loading...</div>}

            {statement && (
                <div className="statement-container">
                    <h3>Customer Details</h3>
                    <div className="details-box">
                        <p><strong>Name:</strong> {statement.customer.name}</p>
                        <p><strong>Email:</strong> {statement.customer.email}</p>
                        <p><strong>Phone:</strong> {statement.customer.phone}</p>
                    </div>

                    <h3>Transactions</h3>
                    <table className="transactions-table">
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Type</th>
                                <th>Debit</th>
                                <th>Credit</th>
                            </tr>
                        </thead>
                        <tbody>
                            {statement.transactions.map((transaction, index) => (
                                <tr key={index}>
                                    <td>{new Date(transaction.date).toLocaleDateString()}</td>
                                    <td>{transaction.type}</td>
                                    <td>{transaction.status === 'debit' ? transaction.amount : '-'}</td>
                                    <td>{transaction.status === 'credit' ? transaction.amount : '-'}</td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr>
                                <td colSpan="2"><strong>Total</strong></td>
                                <td><strong>{statement.totals.totalDebit}</strong></td>
                                <td><strong>{statement.totals.totalCredit}</strong></td>
                            </tr>
                        </tfoot>
                    </table>

                    <h3>Account Statement Report</h3>
                    <div className="report-box">
                        <p>
                            This is the account statement for customer <strong>{statement.customer.name}</strong>,
                            with email <strong>{statement.customer.email}</strong>, and phone <strong>{statement.customer.phone}</strong>.
                        </p>
                        <p>The total debit is <strong>{statement.totals.totalDebit}</strong>, the total credit is <strong>{statement.totals.totalCredit}</strong>, and the balance is <strong>{statement.totals.balance}</strong>.</p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CustomerStatement;

