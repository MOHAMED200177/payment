import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { ClipLoader } from 'react-spinners';
import './StockList.css';

const StockList = () => {
    const [stocks, setStocks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchStocks = async () => {
            try {
                const response = await axios.get('http://localhost:8000/stock');
                setStocks(response.data.data.data || []);
            } catch (err) {
                setError('Failed to load stocks. Please try again later.');
            } finally {
                setLoading(false);
            }
        };

        fetchStocks();
    }, []);

    if (loading) {
        return (
            <div className="spinner-container">
                <ClipLoader size={50} color="#007BFF" />
            </div>
        );
    }

    if (error) {
        return <div className="error-message">{error}</div>;
    }

    return (
        <div className="stock-list-container">
            <h1>Stock List</h1>
            <table className="stock-table">
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Product</th>
                        <th>Quantity</th>
                        <th>Price</th>
                        <th>Date</th>
                    </tr>
                </thead>
                <tbody>
                    {stocks.length > 0 ? (
                        stocks.map((stock, index) => (
                            <tr key={stock._id}>
                                <td>{index + 1}</td>
                                <td>{stock.product || 'N/A'}</td>
                                <td>{stock.quantity !== undefined ? stock.quantity : 'N/A'}</td>
                                <td>{stock.price !== undefined ? `$${stock.price}` : 'N/A'}</td>
                                <td>{stock.date ? new Date(stock.date).toLocaleString() : 'N/A'}</td>
                            </tr>
                        ))
                    ) : (
                        <tr>
                            <td colSpan="5" className="no-data">No stocks found</td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
};

export default StockList;
