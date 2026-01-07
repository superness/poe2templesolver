/**
 * Loop/cycle detection in the temple graph
 */

import { Coord, coordKey, getAdjacentCoords, coordsEqual } from '../domain/types.js';
import { TempleState, getCell } from '../state/temple-state.js';
import { FOYER_POSITION } from '../domain/constants.js';

/**
 * Check if the temple has any loops (cycles)
 * A valid temple must be a tree - no cycles allowed
 */
export function hasLoop(state: TempleState): boolean {
  const visited = new Set<string>();
  const parent = new Map<string, string>();

  // Start BFS from Foyer
  const queue: Coord[] = [FOYER_POSITION];
  parent.set(coordKey(FOYER_POSITION), '');

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentKey = coordKey(current);

    if (visited.has(currentKey)) continue;
    visited.add(currentKey);

    const adjacent = getAdjacentCoords(current);

    for (const neighbor of adjacent) {
      const cell = getCell(state, neighbor);
      if (!cell || cell.content === null) continue;

      const neighborKey = coordKey(neighbor);
      const parentKey = parent.get(currentKey);

      // If we've visited this neighbor and it's not our parent, we have a cycle
      if (visited.has(neighborKey) && neighborKey !== parentKey) {
        return true;
      }

      if (!visited.has(neighborKey)) {
        parent.set(neighborKey, currentKey);
        queue.push(neighbor);
      }
    }
  }

  return false;
}

/**
 * Check if adding a room/path at position would create a loop
 */
export function wouldCreateLoop(
  state: TempleState,
  position: Coord
): boolean {
  // Get adjacent occupied cells
  const adjacent = getAdjacentCoords(position);
  const occupiedAdjacent: Coord[] = [];

  for (const adjCoord of adjacent) {
    const cell = getCell(state, adjCoord);
    if (cell && cell.content !== null) {
      occupiedAdjacent.push(adjCoord);
    }
  }

  // If only 0 or 1 adjacent cells are occupied, no loop possible
  if (occupiedAdjacent.length <= 1) {
    return false;
  }

  // If 2+ adjacent cells are occupied, check if they're already connected
  // (If they're connected, placing here would create a loop)
  return areConnected(state, occupiedAdjacent[0], occupiedAdjacent[1], position);
}

/**
 * Check if two cells are connected without going through a specific position
 */
function areConnected(
  state: TempleState,
  start: Coord,
  end: Coord,
  exclude: Coord
): boolean {
  const visited = new Set<string>();
  const excludeKey = coordKey(exclude);
  const endKey = coordKey(end);

  const queue: Coord[] = [start];
  visited.add(coordKey(start));

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentKey = coordKey(current);

    if (currentKey === endKey) {
      return true;
    }

    const adjacent = getAdjacentCoords(current);

    for (const neighbor of adjacent) {
      const neighborKey = coordKey(neighbor);

      // Skip the excluded cell
      if (neighborKey === excludeKey) continue;

      const cell = getCell(state, neighbor);
      if (!cell || cell.content === null) continue;

      if (!visited.has(neighborKey)) {
        visited.add(neighborKey);
        queue.push(neighbor);
      }
    }
  }

  return false;
}

/**
 * Find all positions that would create a loop if a room was placed there
 */
export function findLoopCreatingPositions(state: TempleState): Coord[] {
  const loopPositions: Coord[] = [];

  for (let y = 1; y <= 9; y++) {
    for (let x = 1; x <= 9; x++) {
      const position = { x, y };
      const cell = getCell(state, position);

      // Only check empty cells
      if (cell && cell.content === null) {
        if (wouldCreateLoop(state, position)) {
          loopPositions.push(position);
        }
      }
    }
  }

  return loopPositions;
}
