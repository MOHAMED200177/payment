'use strict';
const Joi = require('joi');

const purchaseOrderSchema = Joi.object({
  supplierId: Joi.string().required().messages({
    'string.empty': 'Supplier ID is required',
    'any.required': 'Supplier ID is required',
  }),
  items: Joi.array()
    .items(
      Joi.object({
        product: Joi.string().required().messages({
          'string.empty': 'Product ID is required',
          'any.required': 'Product ID is required',
        }),
        quantity: Joi.number().integer().min(1).required().messages({
          'number.min': 'Quantity must be at least 1',
          'any.required': 'Quantity is required',
        }),
        unitPrice: Joi.number().min(0).required().messages({
          'number.min': 'Unit price cannot be negative',
          'any.required': 'Unit price is required',
        }),
      })
    )
    .min(1)
    .required()
    .messages({
      'array.min': 'At least one item is required',
      'any.required': 'Items are required',
    }),
  notes: Joi.string().allow('', null).optional(),
});

module.exports = purchaseOrderSchema;
