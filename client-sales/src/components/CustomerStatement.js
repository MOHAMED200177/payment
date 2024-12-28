import React, { useState } from 'react';
import axios from 'axios';

const CustomerStatement = () => {
    const [email, setEmail] = useState('');
    const [statement, setStatement] = useState(null);
    const [error, setError] = useState('');

    const fetchCustomerStatement = async (e) => {
        e.preventDefault(); // منع إعادة تحميل الصفحة
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
        <div>
            <div className="title">
                <h2>Customer Statement</h2>
            </div>
            <div className="form-container">
                <form className="form" onSubmit={fetchCustomerStatement}>
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Enter Customer Email"
                        required
                    />
                    <button type="submit" className="submit-btn">
                        Get Statement
                    </button>
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
                    <p>Total Debit: {statement.totals.totalDebit}</p>
                    <p>Total Credit: {statement.totals.totalCredit}</p>
                    <p>Balance: {statement.totals.balance}</p>

                    <h3>Transactions</h3>
                    <ul>
                        {statement.transactions.map((transaction, index) => (
                            <li key={index}>
                                ID: {transaction.id}, Type: {transaction.type},
                                Amount: {transaction.amount}, Status: {transaction.status},
                                Date: {new Date(transaction.date).toLocaleDateString()}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};

export default CustomerStatement;
