import React, { useState } from 'react';
import axios from 'axios';
import './css/Form.css';

const PaymentForm = ({ onPaymentAdded }) => {
    const [name, setName] = useState('');
    const [amount, setAmount] = useState('');
    const [invoiceId, setInvoiceId] = useState('');
    const [responseMessage, setResponseMessage] = useState('');

    const addPayment = async () => {
        try {
            const response = await axios.post('http://localhost:8000/pay/add', { name, amount: Number(amount), invoiceId });
            setResponseMessage(`Success: ${response.data.message}`);
            onPaymentAdded();
        } catch (error) {
            setResponseMessage(`Error: ${error.response ? error.response.data.message : error.message}`);
        }
    };

    return (
        <>
            <div className="form-container">
                <div className="title">
                    <h2>Add Payment</h2>
                </div>
                <form className="form" onSubmit={(e) => e.preventDefault()}>
                    <label htmlFor="name">Customer name</label>
                    <input
                        id="name"
                        type="name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Customer Email"
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
                    <button onClick={addPayment} className="submit-btn">Add Payment</button>
                </form>
                {responseMessage && <div className="message">{responseMessage}</div>}
            </div>
        </>
    );
};

export default PaymentForm;
