/**
 * Generate valid placement actions from current state
 */

import {
  Coord,
  RoomType,
  Tier,
  PlacementAction,
  RoomPool,
  getAdjacentCoords,
  coordKey,
} from '../domain/types.js';
import { TempleState, getCell, isCellEmpty } from '../state/temple-state.js';
import { validatePlacement } from '../constraints/validator.js';

// All placeable room types (excluding PATH which is separate)
const ROOM_TYPES: RoomType[] = [
  'GARRISON',
  'SPYMASTER',
  'COMMANDER',
  'ARMOURY',
  'ALCHEMY_LAB',
  'SMITHY',
  'CORRUPTION_CHAMBER',
  'SACRIFICIAL_CHAMBER',
  'THAUMATURGE',
  'GENERATOR',
  'GOLEM_WORKS',
  'FLESH_SURGEON',
  'SYNTHFLESH',
  'LEGION_BARRACKS',
];

/**
 * Generate all valid placement actions from the current state
 */
export function generateValidActions(
  state: TempleState,
  roomPool: RoomPool
): PlacementAction[] {
  const actions: PlacementAction[] = [];

  // Find all positions adjacent to the current temple
  const candidatePositions = findCandidatePositions(state);

  for (const position of candidatePositions) {
    // Try placing a PATH
    if (roomPool.unlimitedPaths || hasPathInPool(roomPool)) {
      const pathAction: PlacementAction = {
        type: 'PLACE_PATH',
        position,
        connections: getConnections(state, position),
      };

      const validation = validatePlacement(state, pathAction);
      if (validation.valid) {
        actions.push(pathAction);
      }
    }

    // Try placing each room type
    for (const roomType of ROOM_TYPES) {
      const tiers = getAvailableTiers(roomPool, roomType);

      for (const tier of tiers) {
        const roomAction: PlacementAction = {
          type: 'PLACE_ROOM',
          roomType,
          tier,
          position,
          connections: getConnections(state, position),
        };

        const validation = validatePlacement(state, roomAction);
        if (validation.valid) {
          actions.push(roomAction);
        }
      }
    }
  }

  return actions;
}

/**
 * Find positions adjacent to the current temple that are empty
 */
function findCandidatePositions(state: TempleState): Coord[] {
  const candidates = new Set<string>();

  // For each cell connected to Foyer, add empty adjacent cells
  for (const key of state.connectedToFoyer) {
    const [x, y] = key.split(',').map(Number);
    const coord = { x, y };

    for (const adjacent of getAdjacentCoords(coord)) {
      if (isCellEmpty(state, adjacent)) {
        candidates.add(coordKey(adjacent));
      }
    }
  }

  return Array.from(candidates).map(key => {
    const [x, y] = key.split(',').map(Number);
    return { x, y };
  });
}

/**
 * Get the coordinates this position connects to
 */
function getConnections(state: TempleState, position: Coord): Coord[] {
  const connections: Coord[] = [];

  for (const adjacent of getAdjacentCoords(position)) {
    const cell = getCell(state, adjacent);
    if (cell && cell.content !== null) {
      connections.push(adjacent);
    }
  }

  return connections;
}

/**
 * Check if pool has paths available
 */
function hasPathInPool(roomPool: RoomPool): boolean {
  return roomPool.unlimitedPaths || (roomPool.available.get('PATH')?.some(p => p.count > 0) ?? false);
}

/**
 * Get available tiers for a room type from the pool
 */
function getAvailableTiers(roomPool: RoomPool, roomType: RoomType): Tier[] {
  const entries = roomPool.available.get(roomType);
  if (!entries) return [1]; // Default to tier 1 if unlimited mode

  return entries.filter(e => e.count > 0).map(e => e.tier);
}

/**
 * Create an unlimited room pool (for planning mode)
 */
export function createUnlimitedPool(): RoomPool {
  const available = new Map<RoomType, { tier: Tier; count: number }[]>();

  for (const roomType of ROOM_TYPES) {
    available.set(roomType, [
      { tier: 1, count: 999 },
      { tier: 2, count: 999 },
      { tier: 3, count: 999 },
    ]);
  }

  return {
    available,
    unlimitedPaths: true,
  };
}

/**
 * Create a room pool from a specific inventory
 */
export function createPoolFromInventory(
  inventory: { type: RoomType; tier: Tier; count: number }[]
): RoomPool {
  const available = new Map<RoomType, { tier: Tier; count: number }[]>();

  for (const item of inventory) {
    const existing = available.get(item.type) || [];
    existing.push({ tier: item.tier, count: item.count });
    available.set(item.type, existing);
  }

  return {
    available,
    unlimitedPaths: true, // Paths are usually unlimited
  };
}

/**
 * Prioritize actions for better search performance
 * Returns actions sorted by estimated value (best first)
 */
export function prioritizeActions(
  actions: PlacementAction[],
  state: TempleState
): PlacementAction[] {
  return actions.sort((a, b) => {
    // Prefer rooms over paths
    if (a.type === 'PLACE_PATH' && b.type !== 'PLACE_PATH') return 1;
    if (a.type !== 'PLACE_PATH' && b.type === 'PLACE_PATH') return -1;

    // Prefer valuable rooms
    const valueA = getRoomTypePriority(a.roomType);
    const valueB = getRoomTypePriority(b.roomType);
    if (valueA !== valueB) return valueB - valueA;

    // Prefer higher tiers
    const tierA = a.tier || 1;
    const tierB = b.tier || 1;
    return tierB - tierA;
  });
}

/**
 * Get priority score for a room type (higher = better)
 */
function getRoomTypePriority(roomType?: RoomType): number {
  if (!roomType) return 0;

  const priorities: Record<RoomType, number> = {
    SPYMASTER: 100,
    CORRUPTION_CHAMBER: 95,
    SACRIFICIAL_CHAMBER: 90,
    THAUMATURGE: 80,
    GARRISON: 70, // High because it enables Spymasters
    ALCHEMY_LAB: 65,
    ARMOURY: 60,
    COMMANDER: 55,
    GENERATOR: 50,
    SMITHY: 45,
    GOLEM_WORKS: 40,
    FLESH_SURGEON: 35,
    SYNTHFLESH: 30,
    LEGION_BARRACKS: 25,
    PATH: 10,
  };

  return priorities[roomType] || 0;
}
