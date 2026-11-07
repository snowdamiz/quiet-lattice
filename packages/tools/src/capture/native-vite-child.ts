// Thin owned-process entry point. The standard capture startup and rendered scene remain unchanged.
import { startVite } from './capture.ts';

const root = process.argv[2];
if (!root) throw new Error('Native Vite child requires its exact checkout root');
const server = await startVite(root);
console.log(`NATIVE_VITE_READY ${server.url}`);
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  server.stop().then(
    () => process.exit(0),
    (error) => {
      console.error(error);
      process.exit(1);
    },
  );
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
