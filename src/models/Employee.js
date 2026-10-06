import mongoose from 'mongoose';

const employeeSchema = new mongoose.Schema(
  {
    employeeNumber: { type: String, required: true, unique: true, trim: true },
    displayName: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    department: { type: String, trim: true, default: '' },
    jobTitle: { type: String, trim: true, default: '' },
    hireDate: { type: Date, default: null },
    hourlyRate: { type: Number, min: 0, default: 0 },
    payCurrency: { type: String, trim: true, default: 'AUD' },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

employeeSchema.index({ status: 1, displayName: 1 });

export const Employee = mongoose.model('Employee', employeeSchema);
