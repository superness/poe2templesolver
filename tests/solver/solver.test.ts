/**
 * Tests for the A* solver
 */

import { describe, it, assert } from 'node:test';
import { createEmptyState, placeRoom, placePath, updateConnectivity, countRoomType } from '../../src/state/temple-state.js';
import { TempleSolver, quickSolve, analyzeTemple } from '../../src/solver/solver.js';
import { createUnlimitedPool } from '../../src/solver/action-generator.js';
import { hasLoop } from '../../src/constraints/loop-detector.js';
import { SolverGoal } from '../../src/domain/types.js';

describe('Quick Solve', () => {
  it('should find a solution for empty temple', () => {
    const solution = quickSolve({ x: 5, y: 5 });

    // Should return some steps
    assert.ok(solution.steps.length > 0, 'Should have solution steps');

    // Solution should not contain loops
    assert.strictEqual(hasLoop(solution.finalState), false, 'Solution should not create loops');
  });

  it('should produce valid placements', () => {
    const solution = quickSolve({ x: 7, y: 4 });

    // Each step should have a valid position
    for (const step of solution.steps) {
      assert.ok(step.position.x >= 1 && step.position.x <= 9, 'X should be in grid');
      assert.ok(step.position.y >= 1 && step.position.y <= 9, 'Y should be in grid');
    }
  });

  it('should respect existing rooms', () => {
    const existingRooms = [
      { type: 'GARRISON' as const, tier: 1 as const, position: { x: 5, y: 2 } },
    ];

    const solution = quickSolve({ x: 7, y: 4 }, existingRooms);

    // Final state should include the existing room
    assert.ok(countRoomType(solution.finalState, 'GARRISON') >= 1);
  });
});

describe('Temple Solver', () => {
  it('should create Best Temple goal correctly', () => {
    const goal = TempleSolver.createBestTempleGoal();

    assert.strictEqual(goal.reachArchitect, true);
    assert.strictEqual(goal.maximizeSpymasters, true);
    assert.strictEqual(goal.maximizeCorruption, true);
    assert.strictEqual(goal.achieveBestTemple, true);
  });

  it('should create Speed goal correctly', () => {
    const goal = TempleSolver.createSpeedGoal({ x: 7, y: 4 });

    assert.strictEqual(goal.reachArchitect, true);
    assert.strictEqual(goal.achieveBestTemple, false);
  });

  it('should solve with FAST strategy', () => {
    const state = createEmptyState({ x: 5, y: 5 });
    const pool = createUnlimitedPool();
    const goal = TempleSolver.createBestTempleGoal();

    const solver = new TempleSolver();
    const solution = solver.solve(state, pool, goal, {
      strategy: 'FAST',
      maxTime: 5000,
      maxIterations: 1000,
    });

    // Should complete quickly
    assert.ok(solution.stats.timeTaken < 5000, 'Should complete within time limit');
    assert.ok(solution.steps.length > 0, 'Should produce some steps');
  });

  it('should report search statistics', () => {
    const state = createEmptyState({ x: 7, y: 4 });
    const pool = createUnlimitedPool();
    const goal: SolverGoal = {
      reachArchitect: false,
      reachAtziri: false,
      maximizeSpymasters: false,
      maximizeCorruption: false,
      maximizeSynergies: false,
      minimizePaths: false,
      protectRooms: [],
      avoidRoomTypes: [],
      achieveBestTemple: false,
    };

    const solver = new TempleSolver();
    const solution = solver.solve(state, pool, goal, { maxIterations: 100 });

    assert.ok(solution.stats.nodesExplored > 0, 'Should explore nodes');
    assert.ok(solution.stats.timeTaken >= 0, 'Should report time');
  });
});

describe('Temple Analysis', () => {
  it('should analyze empty temple', () => {
    const state = createEmptyState({ x: 7, y: 4 });

    const analysis = analyzeTemple(state);

    assert.strictEqual(analysis.totalRooms, 0);
    assert.ok(analysis.suggestions.length > 0, 'Should have suggestions for empty temple');
  });

  it('should count rooms correctly', () => {
    const state = createEmptyState({ x: 7, y: 4 });
    placeRoom(state, 'SPYMASTER', 1, { x: 5, y: 2 });
    placeRoom(state, 'SPYMASTER', 2, { x: 4, y: 2 });
    placeRoom(state, 'GARRISON', 1, { x: 6, y: 2 });
    updateConnectivity(state);

    const analysis = analyzeTemple(state);

    assert.strictEqual(analysis.totalRooms, 3);
    assert.ok('SPYMASTER_T1' in analysis.roomCounts);
    assert.ok('SPYMASTER_T2' in analysis.roomCounts);
    assert.ok('GARRISON_T1' in analysis.roomCounts);
  });

  it('should suggest Spymasters when below 8', () => {
    const state = createEmptyState({ x: 7, y: 4 });
    placeRoom(state, 'SPYMASTER', 1, { x: 5, y: 2 });
    updateConnectivity(state);

    const analysis = analyzeTemple(state);

    assert.ok(analysis.suggestions.some(s => s.includes('Spymaster')));
  });
});

describe('Solution Quality', () => {
  it('should not create loops in solution', () => {
    const solution = quickSolve({ x: 5, y: 5 });

    assert.strictEqual(hasLoop(solution.finalState), false);
  });

  it('should maintain tree structure', () => {
    const solution = quickSolve({ x: 7, y: 4 }, [], [], {
      achieveBestTemple: false,
      reachArchitect: true,
    });

    // Each room should be reachable from Foyer
    for (const room of solution.finalState.rooms.values()) {
      const key = `${room.position.x},${room.position.y}`;
      assert.ok(
        solution.finalState.connectedToFoyer.has(key),
        `Room at ${key} should be connected to Foyer`
      );
    }
  });

  it('should provide step explanations', () => {
    const solution = quickSolve({ x: 7, y: 4 });

    for (const step of solution.steps) {
      assert.ok(step.reason.length > 0, 'Each step should have a reason');
      assert.ok(step.stepNumber > 0, 'Step numbers should be positive');
    }
  });
});

describe('Edge Cases', () => {
  it('should handle architect near Foyer', () => {
    // Architect very close to Foyer
    const solution = quickSolve({ x: 5, y: 3 });

    assert.ok(solution.steps.length >= 0, 'Should handle close architect');
  });

  it('should handle architect in corner', () => {
    const solution = quickSolve({ x: 1, y: 8 });

    assert.ok(solution.steps.length >= 0, 'Should handle corner architect');
  });

  it('should respect time limit', () => {
    const state = createEmptyState({ x: 7, y: 4 });
    const pool = createUnlimitedPool();
    const goal = TempleSolver.createBestTempleGoal();

    const solver = new TempleSolver();
    const solution = solver.solve(state, pool, goal, {
      maxTime: 1000, // 1 second limit
      maxIterations: 1000000,
    });

    assert.ok(solution.stats.timeTaken <= 2000, 'Should respect approximate time limit');
  });
});
