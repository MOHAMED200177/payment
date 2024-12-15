import React, { useState } from 'react';
import axios from 'axios';

const StockList = () => {
    const [stocks, setStocks] = useState([]);
    const [showStocks, setShowStocks] = useState(false);

    const fetchStocks = async () => {
        try {
            const response = await axios.get('http://localhost:8000/stock');
            console.log('Fetched stocks:', response.data);
            if (response.data && response.data.data && Array.isArray(response.data.data.data)) {
                setStocks(response.data.data.data); // هنا نختار البيانات الصحيحة
                setShowStocks(true);
            } else {
                console.error('Data is not an array or missing');
            }
        } catch (error) {
            console.error('Error fetching stocks:', error);
        }
    };

    return (
        <div>
            <h2>All Stocks</h2>
            <button onClick={fetchStocks}>Show All Stocks</button>

            {showStocks && (
                <ul>
                    {stocks.map((stock) => (
                        <li key={stock._id}>
                            {stock.product} - {stock.quantity} units - ${stock.price}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

export default StockList;
