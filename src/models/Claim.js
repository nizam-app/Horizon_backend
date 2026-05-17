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
    id: { type: String, required: true },
    supplier: { type: String, required: true },
    amount: { type: Number, required: true },
    reference: { type: String, default: '' },
    notes: { type: String, default: '' },
  },
  { _id: false }
);

const claimPartSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    company: { type: String, default: '' },
    amount: { type: Number, default: 0 },
    status: { type: String, enum: ['pending', 'completed'], default: 'pending' },
    notes: { type: String, default: '' },
  },
  { _id: false }
);

/**
 * Flexible claim document: queue fields for the admin list, nested `data` for the case file,
 * optional `payload` for the raw user-app submission shape.
 */
const claimSchema = new mongoose.Schema(
  {
    /** User-facing draft / intake code from the claim wizard (HR-XXXX-XXXX). */
    intakeReference: { type: String, unique: true, sparse: true, trim: true },
    /** Internal / insurer-style reference (HRZ-…). */
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
    /** Admin workspace (horizon-admin-app): pending | completed — legacy aliases normalized on save. */
    paymentStatus: { type: String, enum: ['pending', 'completed'], default: 'pending' },
    adminNote: { type: String, default: '' },
    parts: [claimPartSchema],
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    payload: { type: mongoose.Schema.Types.Mixed },
    /** Repair / workshop quote amount (AUD). */
    quotePrice: { type: Number, default: null },
    /** Amount decided by the insurance company (AUD). */
    insuranceApprovedPrice: { type: Number, default: null },
    quoteOptions: [quoteOptionSchema],
    primaryQuoteId: { type: String, default: null },
    finalQuoteId: { type: String, default: null },
    caseFiles: { type: [mongoose.Schema.Types.Mixed], default: [] },
    files: [fileRefSchema],
  },
  { timestamps: true }
);

claimSchema.index({ status: 1, createdAt: -1 });
claimSchema.index({ plateNumber: 1 });

export const Claim = mongoose.model('Claim', claimSchema);
