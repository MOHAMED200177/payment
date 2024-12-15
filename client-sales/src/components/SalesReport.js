import React, { useState } from 'react';
import axios from 'axios';

const SalesReport = () => {
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [salesData, setSalesData] = useState(null);

    const fetchSalesReport = async () => {
        try {
            const response = await axios.get(`/api/sales-report?startDate=${startDate}&endDate=${endDate}`);
            setSalesData(response.data);
        } catch (error) {
            console.error('Error fetching sales report:', error);
        }
    };

    return (
        <div>
            <h2>Sales Report</h2>
            <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                placeholder="Start Date"
            />
            <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                placeholder="End Date"
            />
            <button onClick={fetchSalesReport}>Get Report</button>

            {salesData && (
                <div>
                    <h3>Total Sales: {salesData.totalSales}</h3>
                    <ul>
                        {salesData.invoices.map((invoice) => (
                            <li key={invoice.id}>
                                {invoice.date} - Total: {invoice.total} - Status: {invoice.status}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};

export default SalesReport;
