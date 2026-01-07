/**
 * Tests for constraint validation
 */

import { describe, it, assert } from 'node:test';
import { createEmptyState, placeRoom, placePath, updateConnectivity } from '../../src/state/temple-state.js';
import { validatePlacement, checkVictoryConditions, getValidPlacements } from '../../src/constraints/validator.js';
import { wouldCreateLoop, hasLoop } from '../../src/constraints/loop-detector.js';
import { PlacementAction } from '../../src/domain/types.js';

describe('Placement Validation', () => {
  it('should reject placement outside grid', () => {
    const state = createEmptyState({ x: 7, y: 4 });

    const action: PlacementAction = {
      type: 'PLACE_ROOM',
      roomType: 'GARRISON',
      tier: 1,
      position: { x: 10, y: 5 },
      connections: [],
    };

    const result = validatePlacement(state, action);

    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('outside the grid')));
  });

  it('should reject placement on occupied cell', () => {
    const state = createEmptyState({ x: 7, y: 4 });

    // Try to place on Foyer
    const action: PlacementAction = {
      type: 'PLACE_ROOM',
      roomType: 'GARRISON',
      tier: 1,
      position: { x: 5, y: 1 }, // Foyer position
      connections: [],
    };

    const result = validatePlacement(state, action);

    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('FOYER')));
  });

  it('should reject placement not adjacent to temple', () => {
    const state = createEmptyState({ x: 7, y: 4 });

    // Try to place far from Foyer
    const action: PlacementAction = {
      type: 'PLACE_ROOM',
      roomType: 'GARRISON',
      tier: 1,
      position: { x: 1, y: 9 }, // Far corner
      connections: [],
    };

    const result = validatePlacement(state, action);

    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('not adjacent')));
  });

  it('should accept valid placement adjacent to Foyer', () => {
    const state = createEmptyState({ x: 7, y: 4 });

    const action: PlacementAction = {
      type: 'PLACE_ROOM',
      roomType: 'GARRISON',
      tier: 1,
      position: { x: 5, y: 2 }, // Above Foyer
      connections: [{ x: 5, y: 1 }],
    };

    const result = validatePlacement(state, action);

    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.errors.length, 0);
  });

  it('should accept PATH placement adjacent to any room', () => {
    const state = createEmptyState({ x: 7, y: 4 });
    placeRoom(state, 'GARRISON', 1, { x: 5, y: 2 });
    updateConnectivity(state);

    const action: PlacementAction = {
      type: 'PLACE_PATH',
      position: { x: 5, y: 3 },
      connections: [{ x: 5, y: 2 }],
    };

    const result = validatePlacement(state, action);

    assert.strictEqual(result.valid, true);
  });
});

describe('Loop Detection', () => {
  it('should not detect loop in linear chain', () => {
    const state = createEmptyState({ x: 7, y: 4 });

    // Build linear chain
    placeRoom(state, 'GARRISON', 1, { x: 5, y: 2 });
    placeRoom(state, 'GARRISON', 1, { x: 5, y: 3 });
    placeRoom(state, 'GARRISON', 1, { x: 5, y: 4 });
    updateConnectivity(state);

    assert.strictEqual(hasLoop(state), false);
  });

  it('should detect loop in square formation', () => {
    const state = createEmptyState({ x: 7, y: 4 });

    // Build a square (creates loop)
    placePath(state, { x: 5, y: 2 });
    placePath(state, { x: 6, y: 2 });
    placePath(state, { x: 6, y: 1 });
    // This completes the loop: Foyer -> (5,2) -> (6,2) -> (6,1) -> Foyer
    updateConnectivity(state);

    assert.strictEqual(hasLoop(state), true);
  });

  it('should predict loop creation', () => {
    const state = createEmptyState({ x: 7, y: 4 });

    // Build three sides of a square
    placePath(state, { x: 5, y: 2 });
    placePath(state, { x: 6, y: 2 });
    placePath(state, { x: 6, y: 1 });
    updateConnectivity(state);

    // The fourth corner (4,1) would NOT create a loop (not connected)
    // But (4,2) would if it connected back
    assert.strictEqual(wouldCreateLoop(state, { x: 4, y: 2 }), false); // No loop

    // Placing at a position that would close a loop
    placePath(state, { x: 4, y: 1 });
    updateConnectivity(state);

    // Now (4,2) would create a loop
    assert.strictEqual(wouldCreateLoop(state, { x: 4, y: 2 }), true);
  });
});

describe('Victory Conditions', () => {
  it('should not meet conditions with empty temple', () => {
    const state = createEmptyState({ x: 7, y: 4 });

    const result = checkVictoryConditions(state);

    assert.strictEqual(result.met, false);
  });

  it('should track Spymaster requirement', () => {
    const state = createEmptyState({ x: 7, y: 4 });

    // Add some Spymasters
    placeRoom(state, 'SPYMASTER', 1, { x: 5, y: 2 });
    placeRoom(state, 'SPYMASTER', 2, { x: 4, y: 2 });
    updateConnectivity(state);

    const result = checkVictoryConditions(state);

    const spymasterCondition = result.conditions.find(c => c.name === 'Minimum Spymasters');
    assert.ok(spymasterCondition);
    assert.strictEqual(spymasterCondition.current, 2);
    assert.strictEqual(spymasterCondition.required, 8);
    assert.strictEqual(spymasterCondition.met, false);
  });

  it('should track Corruption Chamber requirement', () => {
    const state = createEmptyState({ x: 7, y: 4 });

    placeRoom(state, 'CORRUPTION_CHAMBER', 1, { x: 5, y: 2 });
    updateConnectivity(state);

    const result = checkVictoryConditions(state);

    const corrCondition = result.conditions.find(c => c.name === 'Minimum Corruption Chambers');
    assert.ok(corrCondition);
    assert.strictEqual(corrCondition.current, 1);
    assert.strictEqual(corrCondition.required, 6);
    assert.strictEqual(corrCondition.met, false);
  });
});

describe('Valid Placement Generation', () => {
  it('should find valid placements adjacent to Foyer', () => {
    const state = createEmptyState({ x: 7, y: 4 });

    const validPositions = getValidPlacements(state, 'PATH');

    // Should include positions adjacent to Foyer: (4,1), (6,1), (5,2)
    assert.ok(validPositions.some(p => p.x === 4 && p.y === 1));
    assert.ok(validPositions.some(p => p.x === 6 && p.y === 1));
    assert.ok(validPositions.some(p => p.x === 5 && p.y === 2));
  });

  it('should expand valid positions as temple grows', () => {
    const state = createEmptyState({ x: 7, y: 4 });

    const initialPositions = getValidPlacements(state, 'PATH');

    placeRoom(state, 'GARRISON', 1, { x: 5, y: 2 });
    updateConnectivity(state);

    const newPositions = getValidPlacements(state, 'PATH');

    // Should now include positions adjacent to (5,2): (5,3), (4,2), (6,2)
    assert.ok(newPositions.some(p => p.x === 5 && p.y === 3));
    assert.ok(newPositions.length > initialPositions.length);
  });
});
