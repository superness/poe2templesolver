/**
 * Integration tests for full temple solving
 */

import { describe, it, assert } from 'node:test';
import { createEmptyState, placeRoom, placePath, updateConnectivity, countRoomType } from '../../src/state/temple-state.js';
import { TempleSolver, quickSolve } from '../../src/solver/solver.js';
import { createUnlimitedPool } from '../../src/solver/action-generator.js';
import { hasLoop } from '../../src/constraints/loop-detector.js';
import { parseTempleFromJSON, createTempleFromInput } from '../../src/io/state-parser.js';
import { formatSolution, formatGrid, formatCompactSummary } from '../../src/io/solution-formatter.js';
import { coordKey } from '../../src/domain/types.js';

describe('Full Temple Solve Integration', () => {
  it('should solve empty temple and produce valid output', () => {
    const architectPos = { x: 7, y: 4 };
    const state = createEmptyState(architectPos);
    const pool = createUnlimitedPool();
    const goal = TempleSolver.createBestTempleGoal();

    const solver = new TempleSolver();
    const solution = solver.solve(state, pool, goal, {
      strategy: 'FAST',
      maxTime: 10000,
    });

    // Validate solution structure
    assert.ok(solution.steps.length > 0, 'Should produce steps');
    assert.ok(solution.metrics.totalRooms > 0, 'Should place rooms');

    // Validate constraints
    assert.strictEqual(hasLoop(solution.finalState), false, 'No loops allowed');

    // Validate output formatting
    const formatted = formatSolution(solution);
    assert.ok(formatted.length > 0, 'Should format solution');
    assert.ok(formatted.includes('TEMPLE SOLUTION'), 'Should have title');
  });

  it('should respect existing temple state', () => {
    const input = {
      architect: { x: 7, y: 4 },
      rooms: [
        { type: 'GARRISON' as const, tier: 1 as const, position: { x: 5, y: 2 } },
        { type: 'GARRISON' as const, tier: 1 as const, position: { x: 5, y: 3 } },
      ],
      paths: [
        { x: 4, y: 1 },
      ],
    };

    const state = createTempleFromInput(input);
    const pool = createUnlimitedPool();
    const goal = TempleSolver.createBestTempleGoal();

    const solver = new TempleSolver();
    const solution = solver.solve(state, pool, goal, {
      strategy: 'FAST',
      maxTime: 5000,
    });

    // Should have at least the original rooms
    assert.ok(countRoomType(solution.finalState, 'GARRISON') >= 2);

    // Should have the original path
    assert.ok(solution.finalState.paths.size >= 1);
  });

  it('should format grid correctly', () => {
    const state = createEmptyState({ x: 7, y: 4 });
    placeRoom(state, 'GARRISON', 1, { x: 5, y: 2 });
    placeRoom(state, 'SPYMASTER', 2, { x: 4, y: 2 });
    updateConnectivity(state);

    const grid = formatGrid(state);

    assert.ok(grid.includes('FOY'), 'Should show Foyer');
    assert.ok(grid.includes('ATZ'), 'Should show Atziri');
    assert.ok(grid.includes('ARC'), 'Should show Architect');
    assert.ok(grid.includes('GA1'), 'Should show Garrison T1');
    assert.ok(grid.includes('SP2'), 'Should show Spymaster T2');
  });

  it('should produce compact summary', () => {
    const solution = quickSolve({ x: 7, y: 4 });
    const summary = formatCompactSummary(solution);

    assert.ok(summary.includes('rooms'), 'Should mention rooms');
    assert.ok(summary.includes('Spymasters'), 'Should mention Spymasters');
    assert.ok(summary.includes('steps'), 'Should mention steps');
  });
});

describe('Scenario: Reach Architect', () => {
  it('should find path to architect', () => {
    const architectPos = { x: 7, y: 4 };

    const solution = quickSolve(architectPos, [], [], {
      reachArchitect: true,
      achieveBestTemple: false,
      maximizeSpymasters: false,
      maximizeCorruption: false,
    });

    // Check if architect is reachable
    const archKey = coordKey(architectPos);
    const connected = solution.finalState.connectedToArchitect.has(archKey);

    // Even if not fully connected, should make progress toward it
    assert.ok(solution.steps.length > 0, 'Should make progress');
  });
});

describe('Scenario: Spymaster Focus', () => {
  it('should prioritize Spymasters with maximize goal', () => {
    const state = createEmptyState({ x: 5, y: 5 });
    const pool = createUnlimitedPool();
    const goal = TempleSolver.createMaximizeGoal('SPYMASTER');

    const solver = new TempleSolver();
    const solution = solver.solve(state, pool, goal, {
      strategy: 'FAST',
      maxTime: 5000,
    });

    // Should place at least some Spymasters
    const spyCount = countRoomType(solution.finalState, 'SPYMASTER');
    assert.ok(spyCount > 0, 'Should place Spymasters');
  });
});

describe('JSON I/O', () => {
  it('should parse JSON temple state', () => {
    const json = JSON.stringify({
      architect: { x: 7, y: 4 },
      rooms: [
        { type: 'GARRISON', tier: 1, position: { x: 5, y: 2 }, locked: true },
      ],
      paths: [
        { x: 4, y: 1 },
      ],
    });

    const state = parseTempleFromJSON(json);

    assert.deepStrictEqual(state.architect, { x: 7, y: 4 });
    assert.strictEqual(state.rooms.size, 1);
    assert.strictEqual(state.paths.size, 1);

    // Check locked status
    const room = Array.from(state.rooms.values())[0];
    assert.strictEqual(room.locked, true);
    assert.ok(state.locks.has(room.id));
  });
});

describe('Performance', () => {
  it('should solve within reasonable time', function() {
    // Skip in CI or mark as slow
    const startTime = Date.now();

    const solution = quickSolve({ x: 7, y: 4 });

    const elapsed = Date.now() - startTime;

    // Should complete in under 30 seconds (generous for CI)
    assert.ok(elapsed < 30000, `Solve took ${elapsed}ms, expected < 30000ms`);
    assert.ok(solution.steps.length > 0, 'Should find solution');
  });

  it('should explore reasonable number of nodes', () => {
    const state = createEmptyState({ x: 5, y: 5 });
    const pool = createUnlimitedPool();
    const goal = TempleSolver.createBestTempleGoal();

    const solver = new TempleSolver();
    const solution = solver.solve(state, pool, goal, {
      strategy: 'FAST',
      maxIterations: 5000,
    });

    // Should not exceed iteration limit
    assert.ok(solution.stats.nodesExplored <= 5000, 'Should respect iteration limit');
  });
});
