/**
 * Combined vitest setup for integration tests.
 *
 * Referenced twice by vitest.config.ts:
 *   - `setupFiles`: evaluated in each test worker. Side-effect polyfills
 *     globalThis.crypto for @bsv/sdk's Random module before tests run.
 *   - `globalSetup`: invoked once in a separate Node process before all
 *     tests. The default-exported `setup()` checks node availability and
 *     mines initial blocks.
 */

import { webcrypto } from 'node:crypto';
import {
  isNodeAvailable,
  getBlockCount,
  mineBlocks,
  rpcCall,
} from 'runar-overlay-express/regtest';

if (!globalThis.crypto) {
  (globalThis as any).crypto = webcrypto;
}

export default async function setup() {
  const available = await isNodeAvailable();
  if (!available) {
    console.error('Regtest node not running. Skipping integration tests.');
    console.error('Start with: cd runar/integration && ./regtest.sh start');
    process.exit(0);
  }

  const height = await getBlockCount();
  const target = 101;
  const needed = target - height;
  if (needed > 0) {
    console.error(`Mining ${needed} blocks (current: ${height}, target: ${target})...`);
    await mineBlocks(needed);
  }

  const balance = (await rpcCall('getbalance')) as number;
  if (balance < 10) {
    console.error('');
    console.error(`WARNING: Regtest wallet balance is only ${balance} BTC.`);
    console.error('BSV regtest exhausts coinbase rewards after ~150 halvings.');
    console.error('To reset: cd runar/integration && ./regtest.sh clean && ./regtest.sh start');
    console.error('');
    if (balance < 1) {
      console.error('Balance too low to run integration tests. Exiting.');
      process.exit(1);
    }
  }
}
