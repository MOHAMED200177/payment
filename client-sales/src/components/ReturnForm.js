import React, { useState } from 'react';
import axios from 'axios';
import './css/Form.css';

const ReturnForm = () => {
    const [invoiceId, setInvoiceId] = useState('');
    const [productName, setProductName] = useState('');
    const [name, setName] = useState('');
    const [quantity, setQuantity] = useState('');
    const [reason, setReason] = useState('');
    const [responseMessage, setResponseMessage] = useState('');
    const [loading, setLoading] = useState(false); // حالة التحميل

    const handleReturnAdded = () => {
        console.log('Return added successfully!');
    };

    const addReturn = async () => {
        setLoading(true); // بدء التحميل
        try {
            console.log('Sending data:', {
                invoiceId,
                productName,
                name,
                quantity: Number(quantity),
                reason,
            });
            const response = await axios.post('http://localhost:8000/return/add', {
                invoiceId,
                productName,
                name,
                quantity: Number(quantity),
                reason,
            });
            console.log('Response received:', response.data);
            setResponseMessage(`Success: ${response.data.message}`);
            handleReturnAdded();
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
            setLoading(false);
        }
    };

    return (
        <div className="form-container">
            <div className="title">
                <h2>Create Return</h2>
            </div>
            <form className="form" onSubmit={(e) => e.preventDefault()}>
                <label htmlFor="invoiceId">Invoice ID</label>
                <input
                    id="invoiceId"
                    type="text"
                    value={invoiceId}
                    onChange={(e) => setInvoiceId(e.target.value)}
                    placeholder="Invoice ID"
                />
                <label htmlFor="productName">Product Name</label>
                <input
                    id="productName"
                    type="text"
                    value={productName}
                    onChange={(e) => setProductName(e.target.value)}
                    placeholder="Product Name"
                />
                <label htmlFor="name">Customer Name</label>
                <input
                    id="name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Customer Name"
                />
                <label htmlFor="quantity">Quantity</label>
                <input
                    id="quantity"
                    type="number"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    placeholder="Quantity"
                />
                <label htmlFor="reason">Reason for Return</label>
                <input
                    id="reason"
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Reason for Return"
                />
                <button onClick={addReturn} className="submit-btn" disabled={loading}>
                    {loading ? 'Processing...' : 'Add Return'}
                </button>
            </form>
            {loading && <div className="loading">Loading...</div>} { }
            {responseMessage && <div className="message">{responseMessage}</div>}
        </div>
    );
};

export default ReturnForm;
