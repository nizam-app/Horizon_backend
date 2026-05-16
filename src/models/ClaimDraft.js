import mongoose from 'mongoose';

/**
 * Wizard autosave by intake reference (HR-XXXX-XXXX). Removed when the claim is submitted.
 */
const claimDraftSchema = new mongoose.Schema(
  {
    intakeReference: { type: String, required: true, unique: true, trim: true, index: true },
    snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: true }
);

export const ClaimDraft = mongoose.model('ClaimDraft', claimDraftSchema);
