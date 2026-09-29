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
    email: 'superadmin@horizon.smash',
    password: 'super123',
    role: 'super_admin',
    displayName: 'Sam Chen',
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
  const migrated = await StaffUser.updateMany({ role: 'moderator' }, { $set: { role: 'admin' } });
  if (migrated.modifiedCount) {
    console.log(`Migrated ${migrated.modifiedCount} legacy moderator account(s) to admin`);
  }
  const removed = await StaffUser.deleteOne({ email: 'moderator@horizon.smash' });
  if (removed.deletedCount) {
    console.log('Removed demo moderator@horizon.smash account');
  }
  await mongoose.disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
