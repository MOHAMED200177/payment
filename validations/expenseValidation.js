'use strict';
const Joi = require('joi');

const expenseSchema = Joi.object({
  category: Joi.string().required().messages({
    'string.empty': 'Category is required',
    'any.required': 'Category is required',
  }),
  amount: Joi.number().min(0.01).required().messages({
    'number.min': 'Amount must be greater than 0',
    'any.required': 'Amount is required',
  }),
  description: Joi.string().required().messages({
    'string.empty': 'Description is required',
    'any.required': 'Description is required',
  }),
  paymentMethod: Joi.string()
    .valid('cash', 'bank_transfer', 'credit_card', 'cheque')
    .required()
    .messages({
      'any.only': 'Invalid payment method',
      'any.required': 'Payment method is required',
    }),
  referenceNumber: Joi.string().allow('', null).optional(),
});

module.exports = expenseSchema;
