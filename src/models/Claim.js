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

const partInvoiceSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    invoiceNumber: { type: String, default: '' },
    fileId: { type: String, default: null },
    fileName: { type: String, default: '' },
    fileUrl: { type: String, default: '' },
  },
  { _id: false }
);

const claimPartSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    /** Supplier name (admin Purchase tab). */
    company: { type: String, default: '' },
    partName: { type: String, default: '' },
    amount: { type: Number, default: 0 },
    quotePrice: { type: Number, default: null },
    orderDate: { type: String, default: '' },
    tentativeReceivedDate: { type: String, default: '' },
    receivedBy: { type: String, default: '' },
    /** Multiple invoices per line; each row links invoice number + PDF. */
    invoices: { type: [partInvoiceSchema], default: [] },
    /** Legacy single-invoice fields (kept for older records). */
    invoiceNumber: { type: String, default: '' },
    invoiceFileId: { type: String, default: null },
    invoiceFileName: { type: String, default: '' },
    invoiceFileUrl: { type: String, default: '' },
    status: { type: String, enum: ['pending', 'completed'], default: 'pending' },
    notes: { type: String, default: '' },
  },
  { _id: false }
);


const claimSchema = new mongoose.Schema(
  {
    
    intakeReference: { type: String, unique: true, sparse: true, trim: true },
    /** Internal / insurer-style reference (HRZ-…). */
    reference: { type: String, unique: true, sparse: true },
    status: {
      type: String,
      enum: ['Pending Review', 'Approved', 'Rejected', 'Litigation', 'Recovery'],
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
claimSchema.index({ createdAt: -1 });
claimSchema.index({ plateNumber: 1 });

export const Claim = mongoose.model('Claim', claimSchema);
