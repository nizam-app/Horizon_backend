import { Claim } from '../models/Claim.js';

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeSupplierKey(company) {
  return String(company ?? '').trim().toLowerCase();
}

export async function listSupplierSuggestions({ q, limit = 30 } = {}) {
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 30));
  const term = String(q || '').trim();

  const pipeline = [
    { $match: { 'parts.0': { $exists: true } } },
    { $unwind: '$parts' },
    {
      $match: {
        $expr: {
          $gt: [{ $strLenCP: { $trim: { input: { $ifNull: ['$parts.company', ''] } } } }, 0],
        },
      },
    },
  ];

  if (term) {
    pipeline.push({
      $match: { 'parts.company': { $regex: escapeRegex(term), $options: 'i' } },
    });
  }

  pipeline.push(
    {
      $group: {
        _id: { $toLower: { $trim: { input: '$parts.company' } } },
        name: { $first: '$parts.company' },
      },
    },
    { $sort: { name: 1 } },
    { $limit: safeLimit },
  );

  const rows = await Claim.aggregate(pipeline);
  return {
    suppliers: rows.map((r) => String(r.name || '').trim()).filter(Boolean),
  };
}

export async function listPartSuggestionsForSupplier({ supplier, limit = 50 } = {}) {
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const term = String(supplier || '').trim();
  if (!term) return { parts: [] };

  const supplierKey = normalizeSupplierKey(term);

  const pipeline = [
    { $match: { 'parts.0': { $exists: true } } },
    { $unwind: '$parts' },
    {
      $match: {
        $expr: {
          $eq: [{ $toLower: { $trim: { input: { $ifNull: ['$parts.company', ''] } } } }, supplierKey],
        },
      },
    },
    {
      $match: {
        $expr: {
          $gt: [{ $strLenCP: { $trim: { input: { $ifNull: ['$parts.partName', ''] } } } }, 0],
        },
      },
    },
    { $sort: { updatedAt: -1 } },
    {
      $group: {
        _id: { $toLower: { $trim: { input: '$parts.partName' } } },
        partName: { $first: '$parts.partName' },
        lastAmount: { $first: '$parts.amount' },
        lastUsedAt: { $first: '$updatedAt' },
      },
    },
    { $sort: { partName: 1 } },
    { $limit: safeLimit },
  ];

  const rows = await Claim.aggregate(pipeline);
  return {
    parts: rows.map((r) => ({
      partName: String(r.partName || '').trim(),
      lastAmount:
        typeof r.lastAmount === 'number' && !Number.isNaN(r.lastAmount) ? r.lastAmount : Number(r.lastAmount) || 0,
      lastUsedAt: r.lastUsedAt ? new Date(r.lastUsedAt).toISOString() : null,
    })),
  };
}
