/**
 * Tests for temple state management
 */

import { describe, it, assert } from 'node:test';
import {
  createEmptyState,
  getCell,
  isCellEmpty,
  placeRoom,
  placePath,
  cloneState,
  updateConnectivity,
  countRoomType,
  getChainTips,
} from '../../src/state/temple-state.js';
import { coordKey } from '../../src/domain/types.js';
import { FOYER_POSITION, ATZIRI_POSITION } from '../../src/domain/constants.js';

describe('Temple State Creation', () => {
  it('should create a 9x9 grid', () => {
    const state = createEmptyState({ x: 7, y: 4 });

    assert.strictEqual(state.grid.length, 9);
    assert.strictEqual(state.grid[0].length, 9);
  });

  it('should have Foyer at (5, 1)', () => {
    const state = createEmptyState({ x: 7, y: 4 });
    const cell = getCell(state, FOYER_POSITION);

    assert.strictEqual(cell?.content, 'FOYER');
  });

  it('should have Atziri at (5, 9)', () => {
    const state = createEmptyState({ x: 7, y: 4 });
    const cell = getCell(state, ATZIRI_POSITION);

    assert.strictEqual(cell?.content, 'ATZIRI');
  });

  it('should have Architect at specified position', () => {
    const architectPos = { x: 7, y: 4 };
    const state = createEmptyState(architectPos);
    const cell = getCell(state, architectPos);

    assert.strictEqual(cell?.content, 'ARCHITECT');
    assert.deepStrictEqual(state.architect, architectPos);
  });

  it('should have Foyer connected initially', () => {
    const state = createEmptyState({ x: 7, y: 4 });

    assert.ok(state.connectedToFoyer.has(coordKey(FOYER_POSITION)));
  });
});

describe('Cell Operations', () => {
  it('should return null for out-of-bounds coordinates', () => {
    const state = createEmptyState({ x: 7, y: 4 });

    assert.strictEqual(getCell(state, { x: 0, y: 1 }), null);
    assert.strictEqual(getCell(state, { x: 10, y: 1 }), null);
    assert.strictEqual(getCell(state, { x: 1, y: 0 }), null);
    assert.strictEqual(getCell(state, { x: 1, y: 10 }), null);
  });

  it('should identify empty cells correctly', () => {
    const state = createEmptyState({ x: 7, y: 4 });

    // Empty cell
    assert.strictEqual(isCellEmpty(state, { x: 1, y: 1 }), true);

    // Foyer is not empty
    assert.strictEqual(isCellEmpty(state, FOYER_POSITION), false);

    // Architect is not empty
    assert.strictEqual(isCellEmpty(state, { x: 7, y: 4 }), false);
  });
});

describe('Room Placement', () => {
  it('should place a room correctly', () => {
    const state = createEmptyState({ x: 7, y: 4 });
    const position = { x: 5, y: 2 };

    const room = placeRoom(state, 'GARRISON', 1, position);

    assert.strictEqual(room.type, 'GARRISON');
    assert.strictEqual(room.tier, 1);
    assert.deepStrictEqual(room.position, position);
    assert.strictEqual(room.locked, false);

    // Check it's in the grid
    const cell = getCell(state, position);
    assert.strictEqual(cell?.content, room);

    // Check it's in the rooms map
    assert.ok(state.rooms.has(room.id));
  });

  it('should place a path correctly', () => {
    const state = createEmptyState({ x: 7, y: 4 });
    const position = { x: 4, y: 2 };

    const path = placePath(state, position);

    assert.deepStrictEqual(path.position, position);

    // Check it's in the grid
    const cell = getCell(state, position);
    assert.strictEqual(cell?.content, path);

    // Check it's in the paths map
    assert.ok(state.paths.has(path.id));
  });

  it('should count room types correctly', () => {
    const state = createEmptyState({ x: 7, y: 4 });

    placeRoom(state, 'GARRISON', 1, { x: 5, y: 2 });
    placeRoom(state, 'GARRISON', 2, { x: 4, y: 2 });
    placeRoom(state, 'SPYMASTER', 1, { x: 3, y: 2 });

    assert.strictEqual(countRoomType(state, 'GARRISON'), 2);
    assert.strictEqual(countRoomType(state, 'SPYMASTER'), 1);
    assert.strictEqual(countRoomType(state, 'COMMANDER'), 0);
  });
});

describe('State Cloning', () => {
  it('should create a deep copy', () => {
    const state = createEmptyState({ x: 7, y: 4 });
    placeRoom(state, 'GARRISON', 1, { x: 5, y: 2 });

    const clone = cloneState(state);

    // Modify original
    placeRoom(state, 'SPYMASTER', 1, { x: 4, y: 2 });

    // Clone should not be affected
    assert.strictEqual(countRoomType(state, 'SPYMASTER'), 1);
    assert.strictEqual(countRoomType(clone, 'SPYMASTER'), 0);
  });

  it('should preserve all properties in clone', () => {
    const state = createEmptyState({ x: 7, y: 4 });
    placeRoom(state, 'GARRISON', 1, { x: 5, y: 2 });
    placePath(state, { x: 6, y: 2 });
    state.locks.add('test_lock');
    updateConnectivity(state);

    const clone = cloneState(state);

    assert.deepStrictEqual(clone.architect, state.architect);
    assert.strictEqual(clone.rooms.size, state.rooms.size);
    assert.strictEqual(clone.paths.size, state.paths.size);
    assert.ok(clone.locks.has('test_lock'));
  });
});

describe('Connectivity', () => {
  it('should update connectivity after placing rooms', () => {
    const state = createEmptyState({ x: 7, y: 4 });

    // Place rooms adjacent to Foyer
    placeRoom(state, 'GARRISON', 1, { x: 5, y: 2 });
    updateConnectivity(state);

    assert.ok(state.connectedToFoyer.has(coordKey({ x: 5, y: 2 })));
  });

  it('should find chain tips correctly', () => {
    const state = createEmptyState({ x: 7, y: 4 });

    // Build a small chain: Foyer -> (5,2) -> (5,3)
    placeRoom(state, 'GARRISON', 1, { x: 5, y: 2 });
    placeRoom(state, 'GARRISON', 1, { x: 5, y: 3 });
    updateConnectivity(state);

    const tips = getChainTips(state);

    // Should have one tip at (5, 3)
    assert.strictEqual(tips.length, 1);
    assert.deepStrictEqual(tips[0], { x: 5, y: 3 });
  });

  it('should find multiple chain tips for branching', () => {
    const state = createEmptyState({ x: 7, y: 4 });

    // Build two branches from Foyer
    placeRoom(state, 'GARRISON', 1, { x: 4, y: 1 }); // West of Foyer
    placeRoom(state, 'GARRISON', 1, { x: 6, y: 1 }); // East of Foyer
    updateConnectivity(state);

    const tips = getChainTips(state);

    assert.strictEqual(tips.length, 2);
  });
});
