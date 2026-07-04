'use strict';
const Joi = require('joi');

const returnSchema = Joi.object({
  invoiceNumber: Joi.string().required().messages({
    'string.empty': 'Invoice number is required',
    'any.required': 'Invoice number is required',
  }),
  customerName: Joi.string().required().messages({
    'string.empty': 'Customer name is required',
    'any.required': 'Customer name is required',
  }),
  productName: Joi.string().required().messages({
    'string.empty': 'Product name is required',
    'any.required': 'Product name is required',
  }),
  quantity: Joi.number().integer().min(1).required().messages({
    'number.min': 'Quantity must be at least 1',
    'any.required': 'Quantity is required',
  }),
  refundAmount: Joi.number().min(0).required().messages({
    'number.min': 'Refund amount cannot be negative',
    'any.required': 'Refund amount is required',
  }),
  reason: Joi.string().allow('', null).optional(),
});

module.exports = returnSchema;
