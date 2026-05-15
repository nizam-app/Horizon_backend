import { Router } from 'express';
import { Claim } from '../models/Claim.js';

export const claimsRouter = Router();

function nextReference() {
  return `HRZ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}

function deriveQueueFields(payload) {
  const plate = payload?.memberVehicle?.plateNumber || '';
  const driver = payload?.driver?.name || '';
  const dateOfIncident = payload?.incident?.date || '';
  const summary = (payload?.incident?.description || '').slice(0, 280);
  const submittedAt = new Date().toISOString().slice(0, 10);
  const data = {
    memberVehicle: payload?.memberVehicle,
    incident: payload?.incident,
    otherParties: payload?.otherParties || [],
    driver: payload?.driver,
    witnessDetails: payload?.witnessDetails,
    damage: payload?.damage,
  };
  return { plateNumber: plate, driverName: driver, dateOfIncident, submittedAt, summary, data };
}

/** Public: lodge a claim (JSON body matches user-app buildClaimPayload shape). */
claimsRouter.post('/', async (req, res) => {
  try {
    const payload = req.body;
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ error: 'Expected JSON body' });
    }
    const ref = nextReference();
    const { plateNumber, driverName, dateOfIncident, submittedAt, summary, data } = deriveQueueFields(payload);
    const doc = await Claim.create({
      reference: ref,
      status: 'Pending Review',
      priority: 'Normal',
      plateNumber,
      driverName,
      dateOfIncident,
      submittedAt,
      summary,
      data,
      payload,
    });
    return res.status(201).json({ id: doc._id, reference: doc.reference });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Reference collision; retry' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Could not create claim' });
  }
});
