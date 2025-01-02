import React, { useState } from 'react';
import axios from 'axios';
import './css/Form.css';

const PaymentForm = () => {
    const [name, setName] = useState('');
    const [amount, setAmount] = useState('');
    const [invoiceId, setInvoiceId] = useState('');
    const [responseMessage, setResponseMessage] = useState('');
    const [loading, setLoading] = useState(false);

    const addPayment = async () => {
        setLoading(true);
        try {
            console.log('Sending payment data:', {
                name,
                amount: Number(amount),
                invoiceId,
            });
            const response = await axios.post('http://localhost:8000/pay/add', {
                name,
                amount: Number(amount),
                invoiceId,
            });
            console.log('Response received:', response.data);
            setResponseMessage(`Success: ${response.data.message}`);
        } catch (error) {
            if (error.response) {
                console.error('Response error:', error.response.data);
                setResponseMessage(`Error: ${error.response.data.message}`);
            } else if (error.request) {
                console.error('Request error:', error.request);
                setResponseMessage('Error: No response from server');
            } else {
                console.error('Unexpected error:', error.message);
                setResponseMessage(`Error: ${error.message}`);
            }
        } finally {
            setLoading(false); // انتهاء التحميل
        }
    };

    return (
        <div className="form-container">
            <div className="title">
                <h2>Add Payment</h2>
            </div>
            <form className="form" onSubmit={(e) => e.preventDefault()}>
                <label htmlFor="name">Customer Name</label>
                <input
                    id="name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Customer Name"
                />
                <label htmlFor="amount">Amount</label>
                <input
                    id="amount"
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="Amount"
                />
                <label htmlFor="invoiceId">Invoice ID</label>
                <input
                    id="invoiceId"
                    type="text"
                    value={invoiceId}
                    onChange={(e) => setInvoiceId(e.target.value)}
                    placeholder="Invoice ID"
                />
                <button onClick={addPayment} className="submit-btn" disabled={loading}>
                    {loading ? 'Processing...' : 'Add Payment'}
                </button>
            </form>
            {loading && <div className="loading">Loading...</div>} {/* مؤشر التحميل */}
            {responseMessage && <div className="message">{responseMessage}</div>}
        </div>
    );
};

export default PaymentForm;
