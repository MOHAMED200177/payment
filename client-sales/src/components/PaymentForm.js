// src/components/PaymentForm.js
import React, { useState } from 'react';
import axios from 'axios';
import './css/Form.css';

const PaymentForm = ({ onPaymentAdded }) => {
    const [email, setEmail] = useState('');
    const [amount, setAmount] = useState('');
    const [invoiceId, setInvoiceId] = useState('');

    const addPayment = async () => {
        try {
            await axios.post('http://localhost:8000/pay/add', { email, amount: Number(amount), invoiceId });
            alert('Payment added successfully!');
            onPaymentAdded();
        } catch (error) {
            alert('Error adding payment: ' + (error.response ? error.response.data.message : error.message));
            console.error('Error adding payment:', error);
        }
    };

    return (
        <>
            <div className="title">
                <h2>Add Payment</h2>
            </div>
            <div className="form-container">
                <form className="form">
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Customer Email"
                    />
                    <input
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="Amount"
                    />
                    <input
                        type="text"
                        value={invoiceId}
                        onChange={(e) => setInvoiceId(e.target.value)}
                        placeholder="Invoice ID"
                    />
                    <button onClick={addPayment} className="submit-btn">Add Payment</button>
                </form>
            </div>
        </>
    );
};

export default PaymentForm;