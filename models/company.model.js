'use strict';
const mongoose = require('mongoose');
const crypto = require('crypto');

/**
 * Company — the root tenant entity.
 *
 * Every other document in the system carries a `company` ObjectId field.
 * All queries are automatically scoped to one company via the `withCompany`
 * middleware (middlewares/tenant.js).
 *
 * Recovery key design (Admin password recovery):
 *   - On company registration a random 32-byte hex recovery key is generated.
 *   - It is hashed (SHA-256) before storage — the plain text is shown ONCE to
 *     the Admin and never stored or logged.
 *   - To recover: POST /auth/admin-recovery  { username, recoveryKey, newPassword }
 *   - The plain key is hashed and compared against recoveryKeyHash.
 *   - On successful recovery the key is rotated (new hash stored, new plain key shown).
 *
 * Why this approach (chosen after comparing alternatives):
 *   1. Email reset         — requires internet/SMTP. Ruled out (offline system).
 *   2. SMS / OTP           — requires internet. Ruled out.
 *   3. Master admin key    — a single global backdoor key is a severe security risk.
 *   4. Recovery key (this) — company-scoped, shown once, hashed at rest. Best balance
 *                            of security and practicality for an offline system.
 */
const companySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Company name is required'],
      trim: true,
    },
    slug: {
      type: String,
      unique: true,
      lowercase: true,
      trim: true,
    },
    active: {
      type: Boolean,
      default: true,
    },
    // Hashed recovery key for offline Admin password recovery
    recoveryKeyHash: {
      type: String,
      select: false,   // never returned in queries by default
    },
  },
  { timestamps: true }
);

companySchema.index({ slug: 1 }, { unique: true });
companySchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
companySchema.index({ active: 1 });

// Auto-generate slug from name before first save
companySchema.pre('save', function (next) {
  if (this.isNew && !this.slug) {
    this.slug =
      this.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') +
      '-' +
      Date.now();
  }
  next();
});

/**
 * Generate a new recovery key.
 * Returns { plain, hash } — store hash, show plain ONCE to the user.
 */
companySchema.statics.generateRecoveryKey = function () {
  const plain = crypto.randomBytes(32).toString('hex'); // 64 char hex
  const hash = crypto.createHash('sha256').update(plain).digest('hex');
  return { plain, hash };
};

/**
 * Verify a plain recovery key against stored hash.
 */
companySchema.methods.verifyRecoveryKey = function (plain) {
  const hash = crypto.createHash('sha256').update(plain).digest('hex');
  return hash === this.recoveryKeyHash;
};

module.exports = mongoose.model('Company', companySchema);
