'use strict';
const mongoose = require('mongoose');
const tenantPlugin = require('./tenantPlugin');

const auditLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    userName: { type: String, required: true },
    action: {
      type: String,
      required: true,
      enum: [
        'CREATE',
        'UPDATE',
        'DELETE',
        'SOFT_DELETE',
        'RESTORE',
        'LOGIN',
        'LOGOUT',
        'PASSWORD_CHANGE',
        'PASSWORD_RESET',
        'STATUS_CHANGE',
        'PAYMENT',
        'RECEIVE',
        'CANCEL',
      ],
    },
    module: {
      type: String,
      required: true,
      enum: [
        'AUTH',
        'USER',
        'COMPANY',
        'CUSTOMER',
        'SUPPLIER',
        'PRODUCT',
        'CATEGORY',
        'STOCK',
        'INVOICE',
        'PAYMENT',
        'RETURN',
        'PURCHASE_ORDER',
        'EXPENSE',
        'REPORT',
        'SETTINGS',
      ],
    },
    entityId: { type: mongoose.Schema.Types.ObjectId, default: null },
    entityLabel: { type: String, default: null },
    oldValues: { type: mongoose.Schema.Types.Mixed, default: null },
    newValues: { type: mongoose.Schema.Types.Mixed, default: null },
    ipAddress: { type: String, default: null },
    userAgent: { type: String, default: null },
  },
  { timestamps: true }
);

auditLogSchema.plugin(tenantPlugin);

auditLogSchema.index({ company: 1, createdAt: -1 });
auditLogSchema.index({ company: 1, module: 1, createdAt: -1 });
auditLogSchema.index({ company: 1, user: 1, createdAt: -1 });
auditLogSchema.index({ company: 1, entityId: 1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
