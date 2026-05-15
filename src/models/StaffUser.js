import mongoose from 'mongoose';

const staffUserSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['admin', 'moderator'], required: true },
    displayName: { type: String, required: true, trim: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const StaffUser = mongoose.model('StaffUser', staffUserSchema);
