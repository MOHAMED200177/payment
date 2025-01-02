import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { ClipLoader } from 'react-spinners';
import './all.css';

const InvoiceList = () => {
    const [invoices, setInvoices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchInvoices = async () => {
            try {
                const response = await axios.get('http://localhost:8000/invoices');
                setInvoices(response.data.data.data || []);
            } catch (err) {
                setError('Failed to load invoices. Please try again later.');
            } finally {
                setLoading(false);
            }
        };

        fetchInvoices();
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
        <div className="invoice-list-container">
            <h1>Invoice List</h1>
            <table className="invoice-table">
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Invoice ID</th>
                        <th>Total</th>
                        <th>Paid</th>
                        <th>Remaining</th>
                        <th>Status</th>
                        <th>Date</th>
                        <th>Items</th>
                    </tr>
                </thead>
                <tbody>
                    {invoices.length > 0 ? (
                        invoices.map((invoice, index) => (
                            <tr key={invoice._id}>
                                <td>{index + 1}</td>
                                <td>{invoice._id || 'N/A'}</td>
                                <td>{invoice.total !== undefined ? invoice.total : 'N/A'}</td>
                                <td>{invoice.paid !== undefined ? invoice.paid : 'N/A'}</td>
                                <td>{invoice.remaining !== undefined ? invoice.remaining : 'N/A'}</td>
                                <td>{invoice.status || 'N/A'}</td>
                                <td>{invoice.date ? new Date(invoice.date).toLocaleString() : 'N/A'}</td>
                                <td>
                                    {invoice.items && invoice.items.length > 0 ? (
                                        <ul>
                                            {invoice.items.map((item, itemIndex) => (
                                                <li key={item._id}>
                                                    {item.product || 'N/A'} - Qty: {item.quantity || 'N/A'} - Price: {item.price || 'N/A'}
                                                </li>
                                            ))}
                                        </ul>
                                    ) : (
                                        'No items'
                                    )}
                                </td>
                            </tr>
                        ))
                    ) : (
                        <tr>
                            <td colSpan="8" className="no-data">No invoices found</td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
};

export default InvoiceList;
