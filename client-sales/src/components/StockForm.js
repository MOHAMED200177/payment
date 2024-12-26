import React, { useState } from 'react';
import axios from 'axios';
import './css/Form.css';


const StockForm = ({ onStockCreated }) => {
    const [product, setProduct] = useState('');
    const [quantity, setQuantity] = useState('');
    const [price, setPrice] = useState('');

    const createStock = async () => {
        try {
            await axios.post('http://localhost:8000/stock', { product, quantity, price });
            alert('Stock item created successfully!');
            onStockCreated();
        } catch (error) {
            console.error('Error creating stock:', error);
        }
    };

    return (
        <>
            <div className="title">
                <h1>Create Stock</h1>
            </div>
            <div className="form-container">
                <form className="form">
                    <input
                        type="text"
                        value={product}
                        onChange={(e) => setProduct(e.target.value)}
                        placeholder="Product"
                    />
                    <input
                        type="number"
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                        placeholder="Quantity"
                    />
                    <input
                        type="number"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        placeholder="Price"
                    />
                    <button onClick={createStock} className="submit-btn">Create Stock Item</button>
                </form>
            </div>
        </>
    );
};

export default StockForm;
