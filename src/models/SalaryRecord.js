import mongoose from 'mongoose';

const salaryRecordSchema = new mongoose.Schema(
  {
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    periodYear: { type: Number, required: true, min: 2000, max: 2100 },
    periodMonth: { type: Number, required: true, min: 1, max: 12 },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, trim: true, default: 'NZD' },
    payDate: { type: Date, default: null },
    notes: { type: String, trim: true, default: '' },
    createdBy: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

salaryRecordSchema.index({ employeeId: 1, periodYear: -1, periodMonth: -1 });
salaryRecordSchema.index({ employeeId: 1, periodYear: 1, periodMonth: 1 }, { unique: true });

export const SalaryRecord = mongoose.model('SalaryRecord', salaryRecordSchema);
