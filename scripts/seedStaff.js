import '../src/loadEnv.js';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { StaffUser } from '../src/models/StaffUser.js';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('Set MONGODB_URI in .env');
  process.exit(1);
}

/** Matches horizon-admin-app demo accounts. */
const DEFAULT_STAFF = [
  {
    email: 'admin@horizon.smash',
    password: 'admin123',
    role: 'admin',
    displayName: 'Alex Rivera',
  },
  {
    email: 'moderator@horizon.smash',
    password: 'mod123',
    role: 'moderator',
    displayName: 'Jordan Lee',
  },
];

async function run() {
  await mongoose.connect(uri);
  for (const row of DEFAULT_STAFF) {
    const hash = await bcrypt.hash(row.password, 10);
    await StaffUser.findOneAndUpdate(
      { email: row.email },
      {
        $set: {
          email: row.email,
          passwordHash: hash,
          role: row.role,
          displayName: row.displayName,
          active: true,
        },
      },
      { upsert: true, new: true }
    );
    console.log(`Upserted: ${row.email} (${row.role})`);
  }
  await mongoose.disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
