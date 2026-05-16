import './loadEnv.js';
import { createApp } from './app.js';
import { connectDb } from './config/db.js';

const port = Number(process.env.PORT) || 3000;
/** Render and most hosts require 0.0.0.0; override with HOST=127.0.0.1 for local lockdown. */
const host = (process.env.HOST || '0.0.0.0').trim();

async function main() {
  await connectDb();
  const app = createApp();
  app.listen(port, host, () => {
    console.log(`horizon-backend listening on http://${host}:${port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
