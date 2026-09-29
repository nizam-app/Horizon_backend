import mongoose from 'mongoose';

const ATTENDANCE_STATUSES = ['present', 'absent', 'leave', 'half-day'];

const attendanceRecordSchema = new mongoose.Schema(
  {
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    date: { type: Date, required: true },
    status: { type: String, enum: ATTENDANCE_STATUSES, required: true },
    checkIn: { type: String, trim: true, default: '' },
    checkOut: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

attendanceRecordSchema.index({ employeeId: 1, date: 1 }, { unique: true });
attendanceRecordSchema.index({ date: -1 });

export const ATTENDANCE_STATUSES_LIST = ATTENDANCE_STATUSES;
export const AttendanceRecord = mongoose.model('AttendanceRecord', attendanceRecordSchema);
