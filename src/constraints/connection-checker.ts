/**
 * Room connection validation
 */

import { Coord, RoomType, coordKey, getAdjacentCoords } from '../domain/types.js';
import { canConnect } from '../domain/room-rules.js';
import { TempleState, getCell, getRoomTypeAt, isPath } from '../state/temple-state.js';

/**
 * Check if a room type can be placed at a position given its adjacent rooms
 */
export function checkConnectionRules(
  state: TempleState,
  roomType: RoomType,
  position: Coord
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const adjacent = getAdjacentCoords(position);
  let hasValidConnection = false;

  for (const adjCoord of adjacent) {
    const cell = getCell(state, adjCoord);
    if (!cell || cell.content === null) continue;

    // Check special cells (Foyer, Architect, Atziri)
    if (typeof cell.content === 'string') {
      if (cell.content === 'FOYER' || cell.content === 'ARCHITECT' || cell.content === 'ATZIRI') {
        // Most rooms can connect directly to FOYER/PATH.
        // Only SPYMASTER, GOLEM_WORKS, and THAUMATURGE require specific parent rooms.
        // Discovered empirically via Sulozor testing.
        if (roomType === 'PATH') {
          hasValidConnection = true;
        } else {
          // Rooms that CANNOT connect directly to PATH/FOYER
          const roomsRequiringParent: RoomType[] = ['SPYMASTER', 'GOLEM_WORKS', 'THAUMATURGE'];
          if (!roomsRequiringParent.includes(roomType)) {
            hasValidConnection = true;
          } else {
            errors.push(
              `${roomType} cannot connect directly to ${cell.content} - requires specific parent room`
            );
          }
        }
      }
      continue;
    }

    // Check room/path connections
    if ('type' in cell.content) {
      // It's a room
      const adjRoomType = cell.content.type;
      if (canConnect(roomType, adjRoomType)) {
        hasValidConnection = true;
      } else {
        errors.push(
          `${roomType} cannot connect to ${adjRoomType} at (${adjCoord.x}, ${adjCoord.y})`
        );
      }
    } else {
      // It's a path - paths can connect to anything
      hasValidConnection = true;
    }
  }

  if (!hasValidConnection && adjacent.some(c => {
    const cell = getCell(state, c);
    return cell && cell.content !== null;
  })) {
    errors.push(`${roomType} has no valid connections at (${position.x}, ${position.y})`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get all adjacent room types for a position
 */
export function getAdjacentRoomTypes(state: TempleState, position: Coord): RoomType[] {
  const types: RoomType[] = [];

  for (const adjCoord of getAdjacentCoords(position)) {
    const type = getRoomTypeAt(state, adjCoord);
    if (type) {
      types.push(type);
    } else if (isPath(state, adjCoord)) {
      types.push('PATH');
    }
  }

  return types;
}

/**
 * Check if placing a room would create a valid connection to the existing temple
 */
export function hasConnectionToTemple(
  state: TempleState,
  position: Coord
): boolean {
  const adjacent = getAdjacentCoords(position);

  for (const adjCoord of adjacent) {
    const key = coordKey(adjCoord);
    if (state.connectedToFoyer.has(key)) {
      return true;
    }
  }

  return false;
}

/**
 * Count connections to Architect
 */
export function countArchitectConnections(state: TempleState): number {
  const adjacent = getAdjacentCoords(state.architect);
  let count = 0;

  for (const adjCoord of adjacent) {
    const cell = getCell(state, adjCoord);
    if (cell && cell.content !== null && typeof cell.content !== 'string') {
      count++;
    }
  }

  return count;
}

/**
 * Check if placing at a position would create another connection to Architect
 */
export function wouldExceedArchitectConnections(
  state: TempleState,
  position: Coord,
  maxConnections: number = 1
): boolean {
  const adjacent = getAdjacentCoords(position);
  const isAdjacentToArchitect = adjacent.some(c =>
    c.x === state.architect.x && c.y === state.architect.y
  );

  if (!isAdjacentToArchitect) {
    return false;
  }

  const currentConnections = countArchitectConnections(state);
  return currentConnections >= maxConnections;
}
