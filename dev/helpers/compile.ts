/**
 * Compile helper — compiles the TicTacToe contract for dev tests.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { compile } from 'runar-compiler';
import type { RunarArtifact } from 'runar-ir-schema';

export function compileContract(): RunarArtifact {
  const absPath = resolve(import.meta.dirname, '..', '..', 'contract', 'TicTacToe.runar.ts');
  const source = readFileSync(absPath, 'utf-8');
  const result = compile(source, { fileName: 'TicTacToe.runar.ts' });
  if (!result.artifact) {
    throw new Error(`Compile failed: ${JSON.stringify(result.diagnostics)}`);
  }
  return result.artifact;
}
