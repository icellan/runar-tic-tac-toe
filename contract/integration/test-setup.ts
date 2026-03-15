/**
 * Polyfill globalThis.crypto for @bsv/sdk's Random module.
 * Vitest's VM may not expose it before module initialization.
 */
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) {
  (globalThis as any).crypto = webcrypto;
}
