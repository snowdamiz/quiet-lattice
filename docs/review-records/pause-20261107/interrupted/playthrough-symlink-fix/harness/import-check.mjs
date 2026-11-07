import { pathToFileURL } from 'node:url';
const mod = await import(pathToFileURL(process.env.REVIEW_TARGET).href);
if (globalThis.__playthroughReview.trace.length) throw new Error('Import started resources');
if (typeof mod.runPlaythrough !== 'function') throw new Error('Missing exported runner');
console.log('import is inert');
