import React, { useState } from 'react';
import axios from 'axios';
import './css/Form.css';

const StockForm = ({ onStockCreated }) => {
    const [product, setProduct] = useState('');
    const [quantity, setQuantity] = useState('');
    const [price, setPrice] = useState('');
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState(null);
    const [messageType, setMessageType] = useState('');

    const createStock = async (e) => {
        e.preventDefault();
        setLoading(true);
        setMessage(null);

        try {
            const res = await axios.post('http://localhost:8000/stock', { product, quantity, price });
            // if (res.data) {
            //     alert('Stock item created successfully!');
            // } else {
            //     alert('Stock item not created');
            // }
            const successMessage = 'Stock item created successfully!';
            const states = res.data?.states;
            setMessage(successMessage);
            setMessageType(states);

            onStockCreated();
            setProduct('');
            setQuantity('');
            setPrice('');
        } catch (error) {
            const errorMessage = error.response?.data?.message || error.message;
            // Error message with the issue details
            alert(`An error occurred while creating the stock item:\n${errorMessage}`);
        } finally {
            setLoading(false); // Hide loading state
        }
    };

    return (
        <div className="form-wrapper">
            <div className="form-container">
                <div className="title">
                    <h1>Create Stock</h1>
                </div>
                <form className="form" onSubmit={createStock}>
                    <label htmlFor="product">Product</label>
                    <input
                        id="product"
                        type="text"
                        value={product}
                        onChange={(e) => setProduct(e.target.value)}
                        placeholder="Enter product name"
                        required
                    />
                    <label htmlFor="quantity">Quantity</label>
                    <input
                        id="quantity"
                        type="number"
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                        placeholder="Enter quantity"
                        required
                    />
                    <label htmlFor="price">Price</label>
                    <input
                        id="price"
                        type="number"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        placeholder="Enter price"
                        required
                    />
                    <button type="submit" className="submit-btn" disabled={loading}>
                        {loading ? 'Loading...' : 'Create Stock Item'}
                    </button>
                </form>
                {message && (
                    <div className={`message ${messageType}`}>
                        {message}
                    </div>
                )}
            </div>
        </div>
    );
};

export default StockForm;
