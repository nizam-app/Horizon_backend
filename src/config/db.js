import dns from 'node:dns';
import mongoose from 'mongoose';
import { ensureSalaryPayrollIndexes } from '../models/SalaryRecord.js';

function applyMongoDnsServers() {
  const raw = process.env.MONGODB_DNS_SERVERS?.trim();
  if (!raw) return;
  const servers = raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  if (servers.length) {
    dns.setServers(servers);
  }
}

export async function connectDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set');
  }
  applyMongoDnsServers();
  mongoose.set('strictQuery', true);

  const conn = mongoose.connection;
  conn.on('disconnected', () => {
    console.warn('[mongodb] disconnected');
  });
  conn.on('reconnected', () => {
    console.log('[mongodb] reconnected');
  });

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 15_000,
  });

  const dbName = conn.db?.databaseName || 'unknown';
  console.log(`[mongodb] connected (${dbName})`);
  await ensureSalaryPayrollIndexes();
  return conn;
}
