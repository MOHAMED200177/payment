// src/components/InvoiceList.js
import React, { useEffect, useState } from 'react';
import axios from 'axios';

const InvoiceList = () => {
    const [invoices, setInvoices] = useState([]);

    useEffect(() => {
        const fetchInvoices = async () => {
            try {
                const response = await axios.get('/invoices');
                setInvoices(response.data);
            } catch (error) {
                console.error('Error fetching invoices:', error);
            }
        };
        fetchInvoices();
    }, []);

    return (
        <div>
            <h2>Invoices</h2>
            <ul>
                {invoices.map((invoice) => (
                    <li key={invoice._id}>
                        <p>Customer: {invoice.customer.name}</p>
                        <p>Total: {invoice.total}</p>
                    </li>
                ))}
            </ul>
        </div>
    );
};

export default InvoiceList;