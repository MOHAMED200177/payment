'use strict';
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

/**
 * Roles:
 *   ADMIN       — full access, manages users, company settings
 *   ACCOUNTANT  — full ERP module access, cannot manage users
 *
 * Authentication: username + password only (offline-friendly, no email required).
 *
 * Uniqueness: username is unique WITHIN a company, not globally.
 * Two companies may both have a user named "ahmed" — that is intentional.
 * The compound index enforces this.
 */
const ROLES = ['ADMIN', 'ACCOUNTANT'];

const userSchema = new mongoose.Schema(
  {
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: [true, 'Company reference is required'],
      index: true,
    },
    username: {
      type: String,
      required: [true, 'Username is required'],
      trim: true,
      lowercase: true,
      minlength: [3, 'Username must be at least 3 characters'],
      match: [/^[a-z0-9_.-]+$/, 'Username may only contain letters, numbers, underscores, dots, hyphens'],
    },
    name: {
      type: String,
      required: [true, 'Display name is required'],
      trim: true,
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      select: false,
    },
    role: {
      type: String,
      enum: ROLES,
      required: true,
    },
    active: {
      type: Boolean,
      default: true,
    },
    // Soft metadata — when was this user created by whom
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

// Username must be unique per company (not globally)
userSchema.index({ company: 1, username: 1 }, { unique: true });
userSchema.index({ company: 1, role: 1 });
userSchema.index({ company: 1, active: 1 });

// Hash password before save
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Compare candidate password
userSchema.methods.correctPassword = async function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

// Safe JSON — never expose password
userSchema.methods.toSafeJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
module.exports.ROLES = ROLES;
