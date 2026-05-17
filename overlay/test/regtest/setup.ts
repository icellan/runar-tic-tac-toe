import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) {
  (globalThis as unknown as { crypto: typeof webcrypto }).crypto = webcrypto;
}
