const mongoose = require('mongoose');

const prescriptionItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    dosage: {
      type: String,
      required: true,
      // مثال: '500mg'
    },
    frequency: {
      type: String,
      required: true,
      // مثال: 'مرتين يومياً'
    },
    duration: {
      type: String,
      required: true,
      // مثال: '7 أيام'
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    instructions: {
      type: String,
      default: null,
      // مثال: 'بعد الأكل'
    },
  },
  { _id: false }
);

const prescriptionSchema = new mongoose.Schema(
  {
    prescriptionNumber: {
      type: String,
      required: true,
      unique: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
    },
    doctor: {
      name: {
        type: String,
        required: true,
      },
      specialty: {
        type: String,
        default: null,
      },
      licenseNumber: {
        type: String,
        default: null,
      },
      clinic: {
        type: String,
        default: null,
      },
      phone: {
        type: String,
        default: null,
      },
    },
    items: [prescriptionItemSchema],
    diagnosis: {
      type: String,
      default: null,
    },
    notes: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: [
        'pending',
        'dispensed',
        'partially_dispensed',
        'expired',
        'cancelled',
      ],
      default: 'pending',
    },
    // ✅ ربط بالفاتورة
    invoice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Invoice',
      default: null,
    },
    // ✅ تاريخ الوصفة
    prescriptionDate: {
      type: Date,
      required: true,
      default: Date.now,
    },
    // ✅ تاريخ انتهاء الوصفة (عادة 3 شهور)
    expiryDate: {
      type: Date,
      required: true,
    },
    // ✅ هل الوصفة تحتاج موافقة تأمين
    requiresInsurance: {
      type: Boolean,
      default: false,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ✅ Virtual
prescriptionSchema.virtual('formattedPrescriptionNumber').get(function () {
  return `RX-${this.prescriptionNumber.toString().padStart(6, '0')}`;
});

// ✅ Pre save - تحديث الـ status
prescriptionSchema.pre('save', function (next) {
  if (new Date() > this.expiryDate && this.status === 'pending') {
    this.status = 'expired';
  }
  next();
});

// ✅ Indexes
prescriptionSchema.index({ prescriptionNumber: 1 });
prescriptionSchema.index({ customer: 1 });
prescriptionSchema.index({ status: 1 });
prescriptionSchema.index({ expiryDate: 1 });
prescriptionSchema.index({ isDeleted: 1 });

module.exports = mongoose.model('Prescription', prescriptionSchema);
