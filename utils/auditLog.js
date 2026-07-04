'use strict';
const AuditLog = require('../models/auditLog.model');
const logger = require('./logger');

/**
 * Record an audit log entry for important business actions.
 * Non-blocking — failures are logged but never break the main operation.
 */
async function logAudit({
  req,
  action,
  module,
  entityId = null,
  entityLabel = null,
  oldValues = null,
  newValues = null,
}) {
  if (!req?.companyId || !req?.user) return;

  try {
    await AuditLog.create({
      company: req.companyId,
      user: req.user._id,
      userName: req.user.name || req.user.username,
      action,
      module,
      entityId,
      entityLabel,
      oldValues: sanitizeValues(oldValues),
      newValues: sanitizeValues(newValues),
      ipAddress: req.ip || req.headers?.['x-forwarded-for'] || null,
      userAgent: req.headers?.['user-agent'] || null,
    });
  } catch (err) {
    logger.error(`Audit log failed: ${err.message}`);
  }
}

function sanitizeValues(values) {
  if (!values || typeof values !== 'object') return values;
  const copy = { ...values };
  const sensitive = ['password', 'recoveryKeyHash', 'recoveryKey'];
  for (const key of sensitive) {
    if (key in copy) copy[key] = '[REDACTED]';
  }
  return copy;
}

module.exports = { logAudit };
