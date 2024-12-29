import React, { useState } from 'react';
import axios from 'axios';
import './css/Form.css';
import './css/invoiceRes.css';

const InvoiceForm = () => {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [phone, setPhone] = useState('');
    const [items, setItems] = useState([{ product: '', quantity: 1 }]);
    const [amount, setAmount] = useState(0);
    const [discount, setDiscount] = useState(0);
    const [responseMessage, setResponseMessage] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const handleAddItem = () => {
        setItems([...items, { product: '', quantity: 1 }]);
    };

    const handleItemChange = (index, field, value) => {
        const updatedItems = [...items];
        updatedItems[index][field] = value;
        setItems(updatedItems);
    };

    const resetForm = () => {
        setName('');
        setEmail('');
        setPhone('');
        setItems([{ product: '', quantity: 1 }]);
        setAmount(0);
        setDiscount(0);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);
        setResponseMessage(null);

        if (!name || !email || !phone || amount <= 0 || items.length === 0 || items.some(item => !item.product || item.quantity <= 0)) {
            setError('Please fill all fields correctly');
            return;
        }

        const invoiceData = {
            name,
            email,
            phone,
            items,
            amount: parseFloat(amount),
            discount: parseFloat(discount),
        };

        setLoading(true);

        try {
            const response = await axios.post('http://localhost:8000/invoices/create', invoiceData);

            if (response.data) {
                setResponseMessage(response.data);
                resetForm();
            }
        } catch (error) {
            console.error('Error:', error.response || error.message);
            setError(
                error.response?.data?.message || 'Failed to create invoice'
            );
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <div className="form-container">
                <div className="title">
                    <h1>Invoice</h1>
                </div>
                <form onSubmit={handleSubmit} className="form">
                    <div>
                        <label htmlFor="name">Name</label>
                        <input
                            type="text"
                            id="name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                        />
                    </div>
                    <div>
                        <label htmlFor="email">Email</label>
                        <input
                            type="email"
                            id="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                        />
                    </div>
                    <div>
                        <label htmlFor="phone">Phone</label>
                        <input
                            type="text"
                            id="phone"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            required
                        />
                    </div>
                    {items.map((item, index) => (
                        <div key={index} className="item-inputs">
                            <label htmlFor="Product">Product</label>
                            <input
                                type="text"
                                value={item.product}
                                onChange={(e) => handleItemChange(index, 'product', e.target.value)}
                                required
                            />
                            <label>Quantity</label>
                            <input
                                type="number"
                                value={item.quantity}
                                onChange={(e) => handleItemChange(index, 'quantity', parseInt(e.target.value))}
                                required
                            />
                        </div>
                    ))}
                    <button type="button" onClick={handleAddItem} className="add-item-btn">
                        Add Item
                    </button>
                    <div>
                        <label htmlFor="amount">Amount</label>
                        <input
                            type="number"
                            id="amount"
                            value={amount}
                            onChange={(e) => setAmount(parseFloat(e.target.value))}
                            required
                        />
                    </div>
                    <div>
                        <label htmlFor="discount">Discount (%)</label>
                        <input
                            type="number"
                            id="discount"
                            value={discount}
                            onChange={(e) => setDiscount(parseFloat(e.target.value))}
                            required
                        />
                    </div>
                    <button type="submit" className="submit-btn" disabled={loading}>
                        {loading ? 'Creating...' : 'Create Invoice'}
                    </button>
                </form>

                {loading && <p>Loading...</p>}

                {error && (
                    <div className="error-message">
                        <button onClick={() => setError(null)} className="close-btn">×</button>
                        <p>{error}</p>
                    </div>
                )}

                {responseMessage && responseMessage.invoice && (
                    <div className="details-container show">
                        <button className="close-btn" onClick={() => setResponseMessage(null)}>×</button>
                        <h3>Invoice Created Successfully</h3>

                        <div className="details">
                            <h4>Invoice ID:</h4>
                            <p>{responseMessage.invoice._id}</p>
                        </div>

                        <div className="details">
                            <h4>Customer Name:</h4>
                            <p>{responseMessage.invoice.customer?.name || 'No Name Provided'}</p>
                        </div>

                        <div className="details">
                            <h4>Date:</h4>
                            <p>{new Date(responseMessage.invoice.date).toLocaleString()}</p>
                        </div>

                        <div className="details">
                            <h4>Status:</h4>
                            <p>{responseMessage.invoice.status || 'Unknown'}</p>
                        </div>

                        <div className="items-list">
                            <h4>Items:</h4>
                            {responseMessage.invoice.items && responseMessage.invoice.items.length > 0 ? (
                                <ul>
                                    {responseMessage.invoice.items.map((item, index) => (
                                        <li key={index} className="item-details">
                                            <p><strong>Product:</strong> {item.product || 'No Product Name'}</p>
                                            <p><strong>Quantity:</strong> {item.quantity}</p>
                                            <p><strong>Price:</strong> ${item.price?.toFixed(2) || '0.00'}</p>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p>No items available</p>
                            )}
                        </div>

                        <div className="total-amount">
                            <h4>Invoice Summary:</h4>
                            <p><strong>Total Amount:</strong> ${responseMessage.invoice.total?.toFixed(2) || '0.00'}</p>
                            <p><strong>Discount Applied:</strong> ${responseMessage.invoice.discount?.toFixed(2) || '0.00'}</p>
                            <p><strong>Amount Paid:</strong> ${responseMessage.invoice.paid?.toFixed(2) || '0.00'}</p>
                            <p><strong>Remaining:</strong> ${responseMessage.invoice.remaining?.toFixed(2) || '0.00'}</p>
                            <p><strong>Refunds:</strong> ${responseMessage.invoice.refunds?.toFixed(2) || '0.00'}</p>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
};

export default InvoiceForm;
