'use strict';
const Counter = require('../models/counter');

/**
 * Get the next sequence number for a given name, scoped to a company.
 *
 * Each company has its own independent counters.
 * Company A's invoices start at 1, Company B's invoices also start at 1.
 *
 * @param {string} name - Sequence name (e.g. 'invoice', 'salesOrder')
 * @param {ObjectId} companyId - The company this counter belongs to
 * @param {ClientSession} [session] - MongoDB session for transactions
 * @returns {Promise<number>} Next sequence value
 */
const getNextSequence = async (name, companyId, session = null) => {
  if (!companyId) {
    throw new Error('getNextSequence requires a companyId');
  }

  const options = { new: true, upsert: true };
  if (session) options.session = session;

  const result = await Counter.findOneAndUpdate(
    { name, company: companyId },
    { $inc: { value: 1 }, $setOnInsert: { company: companyId } },
    options
  );

  return result.value;
};

module.exports = getNextSequence;
