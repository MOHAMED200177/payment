import React, { useEffect, useState } from 'react';
import axios from 'axios';
import './css/all.css';

const InvoicePage = () => {
    const [invoices, setInvoices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedInvoice, setSelectedInvoice] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchInvoices = async () => {
            try {
                const response = await axios.get('http://localhost:8000/invoices');
                console.log('Invoices Response:', response); // إضافة طباعة للاستجابة من الـ API

                // التحقق من وجود البيانات في الاستجابة
                if (response.data && response.data.data) {
                    setInvoices(response.data.data); // تخزين البيانات في الحالة
                } else {
                    setError('No invoices found'); // في حال عدم وجود بيانات
                }
            } catch (err) {
                setError('Error fetching invoices'); // في حال حدوث خطأ في الاسترجاع
                console.error(err);
            } finally {
                setLoading(false); // إيقاف حالة التحميل
            }
        };

        fetchInvoices();
    }, []);

    const getInvoiceDetails = async (id) => {
        try {
            const response = await axios.get(`http://localhost:8000/invoices/${id}`);
            console.log('Invoice Details:', response); // طباعة الاستجابة
            setSelectedInvoice(response.data.data);
        } catch (err) {
            console.error('Error fetching invoice details:', err);
        }
    };

    const deleteInvoice = async (id) => {
        try {
            await axios.delete(`http://localhost:8000/invoices/${id}`);
            setInvoices(invoices.filter((invoice) => invoice._id !== id));
            setSelectedInvoice(null);
        } catch (err) {
            console.error('Error deleting invoice:', err);
        }
    };

    const updateInvoice = async (id) => {
        const newTitle = prompt('Enter new title for the invoice:');
        const newAmount = prompt('Enter new amount for the invoice:');

        if (newTitle && newAmount) {
            try {
                const updatedInvoice = { title: newTitle, amount: Number(newAmount) };
                await axios.put(`http://localhost:8000/invoices/${id}`, updatedInvoice);
                setInvoices(
                    invoices.map((invoice) =>
                        invoice._id === id ? { ...invoice, ...updatedInvoice } : invoice
                    )
                );
            } catch (err) {
                console.error('Error updating invoice:', err);
            }
        }
    };

    if (loading) {
        return <p>Loading invoices...</p>;
    }

    if (error) {
        return <p>{error}</p>;
    }

    return (
        <div>
            <h1>Invoices</h1>
            <table border="1">
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Title</th>
                        <th>Amount</th>
                        <th>Status</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {invoices.length > 0 ? (
                        invoices.map((invoice) => (
                            <tr key={invoice._id}>
                                <td>{invoice._id}</td>
                                <td>{invoice.title}</td>
                                <td>${invoice.amount}</td>
                                <td>{invoice.status}</td>
                                <td>
                                    <button onClick={() => getInvoiceDetails(invoice._id)}>View</button>
                                </td>
                            </tr>
                        ))
                    ) : (
                        <tr>
                            <td colSpan="5">No invoices found.</td>
                        </tr>
                    )}
                </tbody>
            </table>

            {selectedInvoice && (
                <div className="details-container">
                    <h2>Invoice Details</h2>
                    <p><strong>ID:</strong> {selectedInvoice._id}</p>
                    <p><strong>Customer:</strong> {selectedInvoice.customer || 'N/A'}</p>
                    <p><strong>Date:</strong> {new Date(selectedInvoice.date).toLocaleDateString()}</p>
                    <p><strong>Status:</strong> {selectedInvoice.status}</p>

                    <h3>Items:</h3>
                    <table>
                        <thead>
                            <tr>
                                <th>Product</th>
                                <th>Quantity</th>
                                <th>Price</th>
                            </tr>
                        </thead>
                        <tbody>
                            {selectedInvoice.items && selectedInvoice.items.length > 0 ? (
                                selectedInvoice.items.map((item) => (
                                    <tr key={item._id}>
                                        <td>{item.product}</td>
                                        <td>{item.quantity}</td>
                                        <td>${item.price}</td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan="3">No items found.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>

                    <p><strong>Total:</strong> ${selectedInvoice.total}</p>
                    <p><strong>Paid:</strong> ${selectedInvoice.paid}</p>
                    <p><strong>Remaining:</strong> ${selectedInvoice.remaining}</p>
                    <p><strong>Discount:</strong> ${selectedInvoice.discount}</p>
                    <p><strong>Refunds:</strong> ${selectedInvoice.refunds}</p>

                    <button className="edit" onClick={() => updateInvoice(selectedInvoice._id)}>
                        Edit
                    </button>
                    <button className="delete" onClick={() => deleteInvoice(selectedInvoice._id)}>
                        Delete
                    </button>
                </div>
            )}
        </div>
    );
};

export default InvoicePage;
