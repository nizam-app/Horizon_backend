import mongoose from 'mongoose';

const actorSchema = new mongoose.Schema(
  {
    staffId: { type: String, default: '' },
    email: { type: String, default: '' },
    displayName: { type: String, default: '' },
  },
  { _id: false },
);

const claimEditRequestSchema = new mongoose.Schema(
  {
    claimId: { type: mongoose.Schema.Types.ObjectId, ref: 'Claim', required: true, index: true },
    section: { type: String, required: true },
    proposedData: { type: mongoose.Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'superseded'],
      default: 'pending',
      index: true,
    },
    requestedBy: { type: actorSchema, default: () => ({}) },
    reviewedBy: { type: actorSchema, default: null },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, default: '' },
  },
  { timestamps: true },
);

claimEditRequestSchema.index({ claimId: 1, section: 1, status: 1 });

export const ClaimEditRequest = mongoose.model('ClaimEditRequest', claimEditRequestSchema);
