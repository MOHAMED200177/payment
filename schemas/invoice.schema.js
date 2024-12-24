const Joi = require('joi');

const invoiceSchema = Joi.object({
    name: Joi.string().required(),
    email: Joi.string().email().required(),
    phone: Joi.string().required(),
    items: Joi.array().items(
        Joi.object({
            product: Joi.string().required(),
            quantity: Joi.number().integer().min(1).required(),
        })
    ).required(),
    amount: Joi.number().min(0).required(),
    discount: Joi.number().min(0).max(100).optional(),
}).options({ stripUnknown: true });

module.exports = invoiceSchema;
