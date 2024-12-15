import React, { useState } from 'react';
import axios from 'axios';

const InvoiceForm = () => {
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        phone: '',
        items: [{ product: '', quantity: 1, price: 0 }],
        amount: 0,
    });
    const [invoice, setInvoice] = useState(null);
    const [loading, setLoading] = useState(false);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData({ ...formData, [name]: value });
    };

    const handleItemChange = (index, e) => {
        const { name, value } = e.target;
        const updatedItems = [...formData.items];
        updatedItems[index] = { ...updatedItems[index], [name]: value };
        setFormData({ ...formData, items: updatedItems });
    };

    const addItem = () => {
        setFormData({
            ...formData,
            items: [...formData.items, { product: '', quantity: 1, price: 0 }],
        });
    };

    // Add the handleSubmit function here
    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            const response = await axios.post('http://localhost:5000/api/invoice/create', formData);  // Use the correct URL
            setInvoice(response.data.invoice);
            alert('Invoice created successfully!');
        } catch (error) {
            console.error('Error creating invoice:', error.response ? error.response.data : error.message);
            alert('Error creating invoice! Please check the console for details.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div>
            <form onSubmit={handleSubmit}>
                <div>
                    <label>Name:</label>
                    <input
                        type="text"
                        name="name"
                        value={formData.name}
                        onChange={handleChange}
                        required
                    />
                </div>
                <div>
                    <label>Email:</label>
                    <input
                        type="email"
                        name="email"
                        value={formData.email}
                        onChange={handleChange}
                        required
                    />
                </div>
                <div>
                    <label>Phone:</label>
                    <input
                        type="text"
                        name="phone"
                        value={formData.phone}
                        onChange={handleChange}
                        required
                    />
                </div>

                <div>
                    <h3>Items</h3>
                    {formData.items.map((item, index) => (
                        <div key={index}>
                            <div>
                                <label>Product:</label>
                                <input
                                    type="text"
                                    name="product"
                                    value={item.product}
                                    onChange={(e) => handleItemChange(index, e)}
                                    required
                                />
                            </div>
                            <div>
                                <label>Quantity:</label>
                                <input
                                    type="number"
                                    name="quantity"
                                    value={item.quantity}
                                    onChange={(e) => handleItemChange(index, e)}
                                    min="1"
                                    required
                                />
                            </div>
                            <div>
                                <label>Price:</label>
                                <input
                                    type="number"
                                    name="price"
                                    value={item.price}
                                    onChange={(e) => handleItemChange(index, e)}
                                    min="0"
                                    required
                                />
                            </div>
                        </div>
                    ))}
                    <button type="button" onClick={addItem}>Add Item</button>
                </div>

                <div>
                    <label>Amount Paid:</label>
                    <input
                        type="number"
                        name="amount"
                        value={formData.amount}
                        onChange={handleChange}
                        min="0"
                        required
                    />
                </div>

                <button type="submit" disabled={loading}>
                    {loading ? 'Creating Invoice...' : 'Create Invoice'}
                </button>
            </form>

            {/* If invoice is created, display it */}
            {invoice && (
                <div>
                    <h2>Invoice Details</h2>
                    <p><strong>Customer Name:</strong> {invoice.customer.name}</p>
                    <ul>
                        {invoice.items.map((item, index) => (
                            <li key={index}>
                                {item.product} - {item.quantity} x {item.price} = {item.quantity * item.price}
                            </li>
                        ))}
                    </ul>
                    <p><strong>Total:</strong> {invoice.total}</p>
                    <p><strong>Amount Paid:</strong> {invoice.paid}</p>
                </div>
            )}
        </div>
    );
};

export default InvoiceForm;
