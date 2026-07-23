'use strict';
const Joi = require('joi');

// FIX: `amount` was `required()` - but a valid invoice can be created with 0 payment
// (outstanding balance). Changed to optional with default 0.
// FIX: Added `notes` field which is stored on Invoice model but not validated here.
// FIX: Added `paymentTerms` field to allow overriding default net_30.
const invoiceSchema = Joi.object({
  name: Joi.string().required(),
  email: Joi.string().email().optional(),
  phone: Joi.string().optional(),
  items: Joi.array()
    .items(
      Joi.object({
        product: Joi.string().required(),
        quantity: Joi.number().integer().min(1).required(),
        unitPrice: Joi.number().min(0).optional(),
      })
    )
    .min(1)
    .required(),
  // FIX: amount is now optional, defaults to 0 (fully outstanding invoice)
  amount: Joi.number().min(0).default(0),
  discount: Joi.number().min(0).max(100).optional(),
  notes: Joi.string().optional().allow('', null),
  paymentTerms: Joi.string()
    .valid('immediate', 'net_7', 'net_15', 'net_30', 'net_60')
    .optional(),
}).options({ stripUnknown: true });

module.exports = invoiceSchema;
