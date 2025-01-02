import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { ClipLoader } from 'react-spinners';
import './CustomerList.css';

const CustomerList = () => {
    const [customers, setCustomers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchCustomers = async () => {
            try {
                const response = await axios.get('http://localhost:8000/customers');
                setCustomers(response.data.data.data || []);
            } catch (err) {
                setError('Failed to load customers. Please try again later.');
            } finally {
                setLoading(false);
            }
        };

        fetchCustomers();
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
        <div className="customer-list-container">
            <h1>Customer List</h1>
            <table className="customer-table">
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Phone</th>
                        <th>Address</th>
                        <th>Balance</th>
                        <th>Date</th>
                    </tr>
                </thead>
                <tbody>
                    {customers.length > 0 ? (
                        customers.map((customer, index) => (
                            <tr key={customer._id}>
                                <td>{index + 1}</td>
                                <td>{customer.name || 'N/A'}</td>
                                <td>{customer.email || 'N/A'}</td>
                                <td>{customer.phone || 'N/A'}</td>
                                <td>{customer.address || 'N/A'}</td>
                                <td>{customer.balance !== undefined ? customer.balance : 'N/A'}</td>
                                <td>{customer.date ? new Date(customer.date).toLocaleString() : 'N/A'}</td>
                            </tr>
                        ))
                    ) : (
                        <tr>
                            <td colSpan="7" className="no-data">No customers found</td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
};

export default CustomerList;
