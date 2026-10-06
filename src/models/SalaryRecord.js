import mongoose from 'mongoose';

const salaryRecordSchema = new mongoose.Schema(
  {
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    weekStart: { type: Date, default: null },
    /** @deprecated Legacy monthly rows; new payments use weekStart only */
    periodYear: { type: Number, min: 2000, max: 2100, default: null },
    periodMonth: { type: Number, min: 1, max: 12, default: null },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, trim: true, default: 'AUD' },
    payDate: { type: Date, default: null },
    notes: { type: String, trim: true, default: '' },
    createdBy: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

salaryRecordSchema.index({ employeeId: 1, weekStart: -1 });
salaryRecordSchema.index({ weekStart: -1 });

export const SalaryRecord = mongoose.model('SalaryRecord', salaryRecordSchema);

/** Drop legacy unique monthly index when upgrading existing databases. */
export async function ensureSalaryPayrollIndexes() {
  try {
    await SalaryRecord.collection.dropIndex('employeeId_1_periodYear_1_periodMonth_1');
  } catch {
    /* index may not exist */
  }
  await SalaryRecord.syncIndexes();
}
