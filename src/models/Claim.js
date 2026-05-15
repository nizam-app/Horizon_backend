import mongoose from 'mongoose';

const fileRefSchema = new mongoose.Schema(
  {
    category: { type: String, required: true },
    originalName: { type: String, default: '' },
    mimeType: { type: String, default: '' },
    size: { type: Number, default: 0 },
    storageKey: { type: String, default: '' },
  },
  { _id: true, timestamps: true }
);

const quoteOptionSchema = new mongoose.Schema(
  {
    supplier: { type: String, required: true },
    amount: { type: Number, required: true },
    reference: { type: String, default: '' },
  },
  { _id: true }
);

/**
 * Flexible claim document: queue fields for the admin list, nested `data` for the case file,
 * optional `payload` for the raw user-app submission shape.
 */
const claimSchema = new mongoose.Schema(
  {
    reference: { type: String, unique: true, sparse: true },
    status: {
      type: String,
      enum: ['Pending Review', 'Approved', 'Rejected'],
      default: 'Pending Review',
    },
    priority: { type: String, default: 'Normal' },
    plateNumber: { type: String, default: '' },
    driverName: { type: String, default: '' },
    dateOfIncident: { type: String, default: '' },
    submittedAt: { type: String, default: '' },
    summary: { type: String, default: '' },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    payload: { type: mongoose.Schema.Types.Mixed },
    quoteOptions: [quoteOptionSchema],
    primaryQuoteId: { type: mongoose.Schema.Types.ObjectId, default: null },
    finalQuoteId: { type: mongoose.Schema.Types.ObjectId, default: null },
    files: [fileRefSchema],
  },
  { timestamps: true }
);

claimSchema.index({ status: 1, createdAt: -1 });
claimSchema.index({ plateNumber: 1 });

export const Claim = mongoose.model('Claim', claimSchema);
