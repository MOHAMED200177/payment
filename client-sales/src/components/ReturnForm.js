// src/components/ReturnForm.js
import React, { useState } from 'react';
import axios from 'axios';

const ReturnForm = ({ onReturnAdded }) => {
    const [invoiceId, setInvoiceId] = useState('');
    const [productName, setProductName] = useState('');
    const [customerName, setCustomerName] = useState('');
    const [quantity, setQuantity] = useState('');
    const [reason, setReason] = useState('');

    const addReturn = async () => {
        try {
            await axios.post('http://localhost:8000/return/add',{
                invoiceId,
                productName,
                customerName,
                quantity: Number(quantity),
                reason,
            });
            alert('Return added successfully!');
            onReturnAdded();
        } catch (error) {
            alert('Error adding return: ' + (error.response ? error.response.data.message : error.message));
            console.error('Error adding return:', error);
        }
    };

    return (
        <div>
            <h2>Add Return</h2>
            <input
                type="text"
                value={invoiceId}
                onChange={(e) => setInvoiceId(e.target.value)}
                placeholder="Invoice ID"
            />
            <input
                type="text"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="Product Name"
            />
            <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Customer Name"
            />
            <input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="Quantity"
            />
            <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason for Return"
            />
            <button onClick={addReturn}>Add Return</button>
        </div>
    );
};

export default ReturnForm;