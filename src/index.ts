import { env } from './config/env';
import { createServer } from './api/server';

const app = createServer();

app.listen(env.port, () => {
  console.log(`PetPro Connect API listening on port ${env.port}`);
});
