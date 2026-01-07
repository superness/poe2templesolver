/**
 * State hashing for duplicate detection during search
 */

import { TempleState, getCell } from './temple-state.js';
import { GRID_SIZE } from '../domain/constants.js';

/**
 * Create a hash string for a temple state
 * Used for detecting duplicate states during search
 */
export function hashState(state: TempleState): string {
  const cells: string[] = [];

  for (let y = 1; y <= GRID_SIZE; y++) {
    for (let x = 1; x <= GRID_SIZE; x++) {
      const cell = getCell(state, { x, y });

      if (!cell || cell.content === null) {
        cells.push('_');
      } else if (typeof cell.content === 'string') {
        // Special cell type
        cells.push(cell.content[0]); // F, A, or Z
      } else if ('type' in cell.content) {
        // Room
        cells.push(`${cell.content.type.slice(0, 2)}${cell.content.tier}`);
      } else {
        // Path
        cells.push('P');
      }
    }
  }

  return cells.join('');
}

/**
 * Create a mirrored hash for symmetry detection
 * The grid has vertical symmetry around x=5
 */
export function hashMirroredState(state: TempleState): string {
  const cells: string[] = [];

  for (let y = 1; y <= GRID_SIZE; y++) {
    for (let x = 1; x <= GRID_SIZE; x++) {
      // Mirror x coordinate around x=5
      const mirroredX = GRID_SIZE + 1 - x;
      const cell = getCell(state, { x: mirroredX, y });

      if (!cell || cell.content === null) {
        cells.push('_');
      } else if (typeof cell.content === 'string') {
        cells.push(cell.content[0]);
      } else if ('type' in cell.content) {
        cells.push(`${cell.content.type.slice(0, 2)}${cell.content.tier}`);
      } else {
        cells.push('P');
      }
    }
  }

  return cells.join('');
}

/**
 * Check if a state is a symmetric duplicate of one we've seen
 */
export function isSymmetricDuplicate(state: TempleState, closedSet: Set<string>): boolean {
  const mirroredHash = hashMirroredState(state);
  return closedSet.has(mirroredHash);
}

/**
 * Create a compact fingerprint for quick comparison
 */
export function fingerprintState(state: TempleState): string {
  // Quick fingerprint based on room counts and positions
  const roomCounts = new Map<string, number>();

  for (const room of state.rooms.values()) {
    const key = `${room.type}_${room.tier}`;
    roomCounts.set(key, (roomCounts.get(key) || 0) + 1);
  }

  const pathCount = state.paths.size;

  const parts = [
    `R${state.rooms.size}`,
    `P${pathCount}`,
    `C${state.connectedToFoyer.size}`,
  ];

  for (const [key, count] of roomCounts) {
    parts.push(`${key}:${count}`);
  }

  return parts.sort().join('|');
}
