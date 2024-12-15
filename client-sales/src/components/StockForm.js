import React, { useState } from 'react';
import axios from 'axios';

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
        <div>
            <h2>Create Stock</h2>
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
            <button onClick={createStock}>Create Stock Item</button>
        </div>
    );
};

export default StockForm;
