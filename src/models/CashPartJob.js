import mongoose from 'mongoose';

const partInvoiceSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    invoiceNumber: { type: String, default: '' },
    fileId: { type: String, default: null },
    fileName: { type: String, default: '' },
    fileUrl: { type: String, default: '' },
  },
  { _id: false },
);

const cashPartSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    company: { type: String, default: '' },
    partName: { type: String, default: '' },
    amount: { type: Number, default: 0 },
    quotePrice: { type: Number, default: null },
    orderDate: { type: String, default: '' },
    tentativeReceivedDate: { type: String, default: '' },
    receivedBy: { type: String, default: '' },
    invoices: { type: [partInvoiceSchema], default: [] },
    invoiceNumber: { type: String, default: '' },
    invoiceFileId: { type: String, default: null },
    invoiceFileName: { type: String, default: '' },
    invoiceFileUrl: { type: String, default: '' },
    status: { type: String, enum: ['pending', 'completed'], default: 'pending' },
    notes: { type: String, default: '' },
    supplierId: { type: String, default: null },
    supplierPartId: { type: String, default: null },
    listPriceSnapshot: { type: Number, default: null },
  },
  { _id: false },
);

const cashFileSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    name: { type: String, default: '' },
    url: { type: String, default: '' },
    fileUrl: { type: String, default: '' },
    storageKey: { type: String, default: '' },
    storageProvider: { type: String, default: '' },
    cloudinaryPublicId: { type: String, default: '' },
    cloudinaryResourceType: { type: String, default: '' },
    mimeType: { type: String, default: '' },
    size: { type: Number, default: 0 },
  },
  { _id: false },
);

const cashPartJobSchema = new mongoose.Schema(
  {
    customerName: { type: String, required: true, trim: true, maxlength: 200 },
    vehicle: { type: String, required: true, trim: true, maxlength: 80 },
    parts: { type: [cashPartSchema], default: [] },
    files: { type: [cashFileSchema], default: [] },
  },
  { timestamps: true, collection: 'cashpartjobs' },
);

cashPartJobSchema.index({ updatedAt: -1 });
cashPartJobSchema.index({ customerName: 1, vehicle: 1 });

export const CashPartJob = mongoose.model('CashPartJob', cashPartJobSchema);
