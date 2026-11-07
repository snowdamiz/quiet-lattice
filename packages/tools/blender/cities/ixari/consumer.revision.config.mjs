import process from 'node:process';
import base from './consumer.config.mjs';

if (!process.env.IXARI_TEST_CACHE_DIR) throw new Error('A fresh owned Vitest cache path is required');

export default { ...base, cacheDir: process.env.IXARI_TEST_CACHE_DIR };
