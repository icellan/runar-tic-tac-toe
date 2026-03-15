/**
 * Debugger demo — shows how to use ScriptVM to step through contract execution.
 *
 * This is the programmatic equivalent of `runar debug`. Use it when you want
 * to inspect stack state at specific points or automate debugging in tests.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'runar-compiler';
import { ScriptVM, SourceMapResolver, ALICE, BOB } from 'runar-testing';
import { RunarContract } from 'runar-sdk';
import type { RunarArtifact } from 'runar-ir-schema';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, 'TicTacToe.runar.ts'), 'utf8');

function compileWithSourceMap(): RunarArtifact {
  const result = compile(source, { fileName: 'TicTacToe.runar.ts' });
  if (!result.artifact) throw new Error('Compile failed');
  return result.artifact;
}

describe('TicTacToe debugger', () => {
  it('steps through a move and inspects stack state', () => {
    const artifact = compileWithSourceMap();

    // Set up a contract in "playing" state: ALICE is playerX, turn=1
    const contract = new RunarContract(artifact, [ALICE.pubKey, 1000n]);
    contract.setState({
      playerO: BOB.pubKey,
      c0: 0n, c1: 0n, c2: 0n,
      c3: 0n, c4: 0n, c5: 0n,
      c6: 0n, c7: 0n, c8: 0n,
      turn: 1n,
      status: 1n,
    });

    // Build the unlocking script for: move(position=4, player=ALICE, sig=placeholder)
    const unlockingHex = contract.buildUnlockingScript('move', [
      4n,             // position: center cell
      ALICE.pubKey,   // player pubkey
      '00',           // sig placeholder (not verified in VM without OP_PUSH_TX)
    ]);
    const lockingHex = contract.getLockingScript();

    // Step through execution with ScriptVM
    const vm = new ScriptVM();
    vm.loadHex(unlockingHex, lockingHex);

    const steps: Array<{ opcode: string; context: string; stackDepth: number }> = [];
    while (!vm.isComplete) {
      const result = vm.step();
      if (!result) break;
      steps.push({
        opcode: result.opcode,
        context: result.context,
        stackDepth: result.mainStack.length,
      });
      if (result.error) break;
    }

    // Verify execution completed
    expect(steps.length).toBeGreaterThan(0);
    console.log(`Executed ${steps.length} opcodes`);

    // Show unlocking vs locking phase split
    const unlockingSteps = steps.filter(s => s.context === 'unlocking');
    const lockingSteps = steps.filter(s => s.context === 'locking');
    console.log(`  Unlocking phase: ${unlockingSteps.length} opcodes`);
    console.log(`  Locking phase:   ${lockingSteps.length} opcodes`);
  });

  it('uses SourceMapResolver to map opcodes to source lines', () => {
    const artifact = compileWithSourceMap();
    expect(artifact.sourceMap).toBeDefined();

    const resolver = new SourceMapResolver(artifact.sourceMap!);
    expect(resolver.isEmpty).toBe(false);
    expect(resolver.sourceFiles).toContain('TicTacToe.runar.ts');

    // Find which opcodes map to the `move` method's assertCorrectPlayer call (line 78)
    const opcodes = resolver.reverseResolve('TicTacToe.runar.ts', 78);
    expect(opcodes.length).toBeGreaterThan(0);
    console.log(`Line 78 (assertCorrectPlayer) maps to opcodes: ${opcodes.join(', ')}`);

    // Forward resolve: check that the first mapped opcode points back to our file
    const loc = resolver.resolve(opcodes[0]!);
    expect(loc).toBeDefined();
    expect(loc!.file).toBe('TicTacToe.runar.ts');
    expect(loc!.line).toBe(78);
  });
});
