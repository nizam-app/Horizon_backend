import 'dotenv/config';
import { createApp } from './app.js';
import { connectDb } from './config/db.js';

const port = Number(process.env.PORT) || 3000;

async function main() {
  await connectDb();
  const app = createApp();
  app.listen(port, '127.0.0.1', () => {
    console.log(`horizon-backend listening on http://127.0.0.1:${port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
