import React, { useState } from 'react';
import axios from 'axios';

const CustomerManagement = () => {
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        address: '',
        phone: '',
    });

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData({ ...formData, [name]: value });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            await axios.post('http://localhost:8000/customers', formData);
            setFormData({ name: '', email: '', address: '', phone: '' });
            alert('Customer created successfully!');
        } catch (err) {
            console.error('Error creating customer:', err);
        }
    };

    return (
        <div className="form-container">
            <div className="title">
                <h2>add Customer</h2>
            </div>

            {/* Customer Form */}
            <form className="form" onSubmit={handleSubmit}>
                <input
                    type="text"
                    name="name"
                    placeholder="Name"
                    value={formData.name}
                    onChange={handleChange}
                    required
                />
                <input
                    type="email"
                    name="email"
                    placeholder="Email"
                    value={formData.email}
                    onChange={handleChange}
                    required
                />
                <input
                    type="text"
                    name="address"
                    placeholder="Address"
                    value={formData.address}
                    onChange={handleChange}
                />
                <input
                    type="text"
                    name="phone"
                    placeholder="Phone"
                    value={formData.phone}
                    onChange={handleChange}
                />
                <button type="submit" className="submit-btn">Add Customer</button>
            </form>
        </div>
    );
};

export default CustomerManagement;
