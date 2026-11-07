import { realpathSync } from 'node:fs';
const entry = process.argv[1];
const filename = import.meta.filename;
let match = false;
let error = '';
try {
  match = !!entry && !!filename && realpathSync(entry) === filename;
} catch (caught) {
  error = caught instanceof Error ? caught.message : String(caught);
}
console.log(JSON.stringify({ filename, argv1: entry ?? null, match, error, main: import.meta.main }));
