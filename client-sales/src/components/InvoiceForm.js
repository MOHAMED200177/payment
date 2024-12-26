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
            alert('Please fill in all fields correctly.');
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
            setResponseMessage(response.data);
            setLoading(false); // إيقاف التحميل بعد استلام الرد
        } catch (error) {
            console.error('Error creating invoice:', error);
            setLoading(false); // إيقاف التحميل في حالة وجود خطأ
            if (error.response) {
                setResponseMessage({
                    message: 'Error creating invoice',
                    error: error.response.data,
                });
            } else {
                setResponseMessage({
                    message: 'Error creating invoice',
                    error: error.message,
                });
            }
        }
    };

    return (
        <>
            <div className="title">
                <h1>Invoice</h1>
            </div>
            <div className="form-container">
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
                            <label htmlFor={`product-${index}`}>Product</label>
                            <input
                                type="text"
                                id={`product-${index}`}
                                value={item.product}
                                onChange={(e) => handleItemChange(index, 'product', e.target.value)}
                                required
                            />
                            <label htmlFor={`quantity-${index}`}>Quantity</label>
                            <input
                                type="number"
                                id={`quantity-${index}`}
                                value={item.quantity}
                                onChange={(e) => handleItemChange(index, 'quantity', e.target.value)}
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
                            onChange={(e) => setAmount(e.target.value)}
                            required
                        />
                    </div>
                    <div>
                        <label htmlFor="discount">Discount (%)</label>
                        <input
                            type="number"
                            id="discount"
                            value={discount}
                            onChange={(e) => setDiscount(e.target.value)}
                            required
                        />
                    </div>
                    <button type="submit" className="submit-btn">
                        Create Invoice
                    </button>
                </form>

                {loading && (
                    <div className="loading-animation">
                        <p>Loading...</p>
                    </div>
                )}

                {responseMessage && responseMessage.invoice && (
                    <div className={`details-container ${responseMessage ? 'show' : ''}`}>
                        <button className="close-btn" onClick={() => setResponseMessage(null)}>X</button>
                        <h3>Invoice Created Successfully</h3>
                        <div className="details">
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
                            <p><strong>Discount Applied:</strong> ${responseMessage.invoice.discount.toFixed(2)}</p>
                            <p><strong>Amount Paid:</strong> ${responseMessage.invoice.paid.toFixed(2)}</p>
                            <p><strong>Remaining:</strong> ${responseMessage.invoice.remaining.toFixed(2)}</p>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
};

export default InvoiceForm;

