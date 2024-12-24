import React, { useState } from 'react';
import axios from 'axios';
import './css/InvoiceForm.css';

const InvoiceForm = () => {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [phone, setPhone] = useState('');
    const [items, setItems] = useState([{ product: '', quantity: 1 }]);
    const [amount, setAmount] = useState(0);
    const [responseMessage, setResponseMessage] = useState(null);

    const handleAddItem = () => {
        setItems([...items, { product: '', quantity: 1 }]);
    };

    const handleItemChange = (index, field, value) => {
        const newItems = [...items];
        newItems[index][field] = value;
        setItems(newItems);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!name || !email || !phone || amount <= 0 || items.length === 0 || items.some(item => !item.product || item.quantity <= 0)) {
            alert("Please fill in all fields correctly.");
            return;
        }

        const invoiceData = {
            name,
            email,
            phone,
            items,
            amount: parseFloat(amount)
        };

        try {
            const response = await axios.post('http://localhost:8000/invoices/create', invoiceData);
            console.log('Invoice created:', response.data);
            setResponseMessage(response.data);
        } catch (error) {
            console.error('Error creating invoice:', error);
            if (error.response) {
                console.error('Response error:', error.response.data);
                setResponseMessage({
                    message: 'Error creating invoice',
                    error: error.response.data
                });
            } else {
                console.error('Error message:', error.message);
                setResponseMessage({
                    message: 'Error creating invoice',
                    error: error.message
                });
            }
        }
    };

    return (
        <>
            <div className="title">
                <h1 className="invoice-title">Invoice</h1>
            </div>
            <div className="invoice-form-container">
                <form onSubmit={handleSubmit} className="invoice-form">
                    <input
                        type="text"
                        placeholder="Name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                    />
                    <input
                        type="email"
                        placeholder="Email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                    />
                    <input
                        type="text"
                        placeholder="Phone"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        required
                    />
                    {items.map((item, index) => (
                        <div key={index} className="item-inputs">
                            <input
                                type="text"
                                placeholder="Product"
                                value={item.product}
                                onChange={(e) => handleItemChange(index, 'product', e.target.value)}
                                required
                            />
                            <input
                                type="number"
                                placeholder="Quantity"
                                value={item.quantity}
                                onChange={(e) => handleItemChange(index, 'quantity', e.target.value)}
                                required
                            />
                        </div>
                    ))}
                    <button type="button" onClick={handleAddItem} className="add-item-btn">Add Item</button>
                    <input
                        type="number"
                        placeholder="Amount"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        required
                    />
                    <button type="submit" className="submit-btn">Create Invoice</button>
                </form>

                {responseMessage && responseMessage.invoice && (
                    <div className="invoice-details-container">
                        <h3>Invoice Created Successfully</h3>
                        <div className="invoice-details">
                            <h4>Invoice ID: {responseMessage.invoice._id}</h4>
                            <p><strong>Customer Name:</strong> {responseMessage.invoice.customer.name}</p>
                            <p><strong>Date:</strong> {new Date(responseMessage.invoice.date).toLocaleString()}</p>
                            <p><strong>Status:</strong> {responseMessage.invoice.status}</p>
                        </div>

                        <div className="items-list">
                            <h5>Items:</h5>
                            <ul>
                                {responseMessage.invoice.items.map((item) => (
                                    <li key={item._id}>
                                        {item.product} - Quantity: {item.quantity} - Price: ${item.price.toFixed(2)}
                                    </li>
                                ))}
                            </ul>
                        </div>

                        <div className="total-amount">
                            <p><strong>Total Amount:</strong> ${responseMessage.invoice.total.toFixed(2)}</p>
                            <p><strong>Amount Paid:</strong> ${responseMessage.invoice.paid.toFixed(2)}</p>
                            <p><strong>Refunds:</strong> ${responseMessage.invoice.refunds.toFixed(2)}</p>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
};

export default InvoiceForm;
