/**
 * Vitest globalSetup — checks regtest node + overlay availability.
 */

import { isNodeAvailable, getBlockCount, mine, rpcCall } from './helpers/node.js';

const OVERLAY_URL = process.env.OVERLAY_URL ?? 'http://localhost:8081';

export default async function setup() {
  // Check regtest node
  const nodeAvailable = await isNodeAvailable();
  if (!nodeAvailable) {
    console.error('Regtest node not running. Start with: cd runar/integration && ./regtest.sh start');
    process.exit(1);
  }

  const height = await getBlockCount();
  if (height < 101) {
    console.log(`Mining ${101 - height} blocks...`);
    await mine(101 - height);
  }

  const balance = (await rpcCall('getbalance')) as number;
  if (balance < 1) {
    console.error('Regtest wallet balance too low. Reset: cd runar/integration && ./regtest.sh clean && ./regtest.sh start');
    process.exit(1);
  }

  // Check overlay
  try {
    const resp = await fetch(`${OVERLAY_URL}/stats`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    console.log(`Overlay running at ${OVERLAY_URL}`);
  } catch {
    console.error(`Overlay not running at ${OVERLAY_URL}`);
    console.error('Start with: cd overlay && npm run dev:regtest');
    process.exit(1);
  }
}
