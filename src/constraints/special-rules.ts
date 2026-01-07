/**
 * Special game-specific rules for temple placement
 */

import { Coord, RoomType, coordKey, getAdjacentCoords } from '../domain/types.js';
import { SPECIAL_RULES, FOYER_POSITION } from '../domain/constants.js';
import { TempleState, getCell, countRoomType } from '../state/temple-state.js';

/**
 * Check if Commander blocks Spymaster placement
 * When Commander is in a chain, Spymaster cannot be placed downstream
 */
export function checkCommanderBlocking(
  state: TempleState,
  position: Coord,
  roomType: RoomType
): { valid: boolean; error: string | null } {
  if (!SPECIAL_RULES.COMMANDER_BLOCKS_SPYMASTER) {
    return { valid: true, error: null };
  }

  if (roomType !== 'SPYMASTER') {
    return { valid: true, error: null };
  }

  // Check if there's a Commander upstream in the path from Foyer to this position
  const hasCommanderUpstream = checkUpstreamForRoom(state, position, 'COMMANDER');

  if (hasCommanderUpstream) {
    return {
      valid: false,
      error: 'Cannot place Spymaster downstream of Commander in the same chain',
    };
  }

  return { valid: true, error: null };
}

/**
 * Check if a specific room type exists upstream (closer to Foyer) from a position
 */
function checkUpstreamForRoom(
  state: TempleState,
  position: Coord,
  targetType: RoomType
): boolean {
  // BFS from Foyer, track path to position
  const visited = new Set<string>();
  const parent = new Map<string, Coord | null>();

  const queue: Coord[] = [FOYER_POSITION];
  parent.set(coordKey(FOYER_POSITION), null);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentKey = coordKey(current);

    if (visited.has(currentKey)) continue;
    visited.add(currentKey);

    // Found the target position
    if (current.x === position.x && current.y === position.y) {
      // Walk back through parents looking for targetType
      let node: Coord | null | undefined = parent.get(currentKey) ?? null;
      while (node) {
        const cell = getCell(state, node);
        if (cell && cell.content && typeof cell.content === 'object' && 'type' in cell.content) {
          if (cell.content.type === targetType) {
            return true;
          }
        }
        node = parent.get(coordKey(node)) ?? null;
      }
      return false;
    }

    const adjacent = getAdjacentCoords(current);
    for (const neighbor of adjacent) {
      const cell = getCell(state, neighbor);
      if (!cell || cell.content === null) continue;

      const neighborKey = coordKey(neighbor);
      if (!visited.has(neighborKey)) {
        parent.set(neighborKey, current);
        queue.push(neighbor);
      }
    }
  }

  return false;
}

/**
 * Check unique room constraints (e.g., only one Sacrificial Chamber)
 */
export function checkUniqueRooms(
  state: TempleState,
  roomType: RoomType
): { valid: boolean; error: string | null } {
  const uniqueRooms = SPECIAL_RULES.UNIQUE_ROOMS as readonly string[];

  if (!uniqueRooms.includes(roomType)) {
    return { valid: true, error: null };
  }

  const existingCount = countRoomType(state, roomType);

  if (existingCount > 0) {
    return {
      valid: false,
      error: `${roomType} is unique and one already exists in the temple`,
    };
  }

  return { valid: true, error: null };
}

/**
 * Check Architect connection limit
 */
export function checkArchitectLimit(
  state: TempleState,
  position: Coord
): { valid: boolean; error: string | null } {
  const adjacent = getAdjacentCoords(position);
  const isAdjacentToArchitect = adjacent.some(
    c => c.x === state.architect.x && c.y === state.architect.y
  );

  if (!isAdjacentToArchitect) {
    return { valid: true, error: null };
  }

  // Count existing connections to Architect
  const architectAdjacent = getAdjacentCoords(state.architect);
  let existingConnections = 0;

  for (const adj of architectAdjacent) {
    const cell = getCell(state, adj);
    if (cell && cell.content !== null && typeof cell.content !== 'string') {
      existingConnections++;
    }
  }

  if (existingConnections >= SPECIAL_RULES.ARCHITECT_MAX_CONNECTIONS) {
    return {
      valid: false,
      error: `Architect already has maximum connections (${SPECIAL_RULES.ARCHITECT_MAX_CONNECTIONS})`,
    };
  }

  return { valid: true, error: null };
}

/**
 * Check if a position is within Generator power range
 */
export function isInGeneratorRange(
  state: TempleState,
  position: Coord
): { powered: boolean; generators: Coord[] } {
  const generators: Coord[] = [];

  for (const room of state.rooms.values()) {
    if (room.type === 'GENERATOR') {
      const range = SPECIAL_RULES.GENERATOR_POWER_RANGE[room.tier] || 3;
      const distance = Math.abs(room.position.x - position.x) +
                       Math.abs(room.position.y - position.y);

      if (distance <= range) {
        generators.push(room.position);
      }
    }
  }

  return {
    powered: generators.length > 0,
    generators,
  };
}
