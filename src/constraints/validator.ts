/**
 * Combined validation for all placement constraints
 */

import { Coord, RoomType, PlacementAction, ValidationResult, coordKey } from '../domain/types.js';
import { TempleState, getCell, isCellEmpty } from '../state/temple-state.js';
import {
  checkConnectionRules,
  hasConnectionToTemple,
  wouldExceedArchitectConnections,
} from './connection-checker.js';
import { wouldCreateLoop } from './loop-detector.js';
import { checkCommanderBlocking, checkUniqueRooms, checkArchitectLimit } from './special-rules.js';

/**
 * Validate a placement action
 */
export function validatePlacement(
  state: TempleState,
  action: PlacementAction
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const { position, type, roomType, tier } = action;

  // Check 1: Position is within grid
  if (position.x < 1 || position.x > 9 || position.y < 1 || position.y > 9) {
    errors.push(`Position (${position.x}, ${position.y}) is outside the grid`);
    return { valid: false, errors, warnings };
  }

  // Check 2: Cell is empty
  if (!isCellEmpty(state, position)) {
    const cell = getCell(state, position);
    const content = cell?.content;
    const description = typeof content === 'string' ? content : 'occupied';
    errors.push(`Position (${position.x}, ${position.y}) is ${description}`);
    return { valid: false, errors, warnings };
  }

  // Check 3: Has connection to existing temple
  if (!hasConnectionToTemple(state, position)) {
    errors.push(`Position (${position.x}, ${position.y}) is not adjacent to the temple`);
    return { valid: false, errors, warnings };
  }

  // For room placement, check additional constraints
  if (type === 'PLACE_ROOM' && roomType) {
    // Check 4: Connection rules (applies to all rooms including PATH)
    const connectionCheck = checkConnectionRules(state, roomType, position);
    if (!connectionCheck.valid) {
      errors.push(...connectionCheck.errors);
    }

    // Check 5: Commander blocking Spymaster (not for PATH)
    if (roomType !== 'PATH') {
      const commanderCheck = checkCommanderBlocking(state, position, roomType);
      if (!commanderCheck.valid && commanderCheck.error) {
        errors.push(commanderCheck.error);
      }
    }

    // Check 6: Unique room constraints (not for PATH)
    if (roomType !== 'PATH') {
      const uniqueCheck = checkUniqueRooms(state, roomType);
      if (!uniqueCheck.valid && uniqueCheck.error) {
        errors.push(uniqueCheck.error);
      }
    }
  }

  // For PATH placement (PLACE_PATH action type), also check connection rules
  if (type === 'PLACE_PATH') {
    const connectionCheck = checkConnectionRules(state, 'PATH', position);
    if (!connectionCheck.valid) {
      errors.push(...connectionCheck.errors);
    }
  }

  // Check 7: Architect connection limit
  const architectCheck = checkArchitectLimit(state, position);
  if (!architectCheck.valid && architectCheck.error) {
    errors.push(architectCheck.error);
  }

  // Check 8: Would create loop
  if (wouldCreateLoop(state, position)) {
    errors.push('Placement would create a loop (cycle) in the temple');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Check if the current temple state meets victory conditions
 */
export function checkVictoryConditions(state: TempleState): {
  met: boolean;
  conditions: { name: string; met: boolean; current: number; required: number }[];
} {
  const conditions: { name: string; met: boolean; current: number; required: number }[] = [];

  // Count Spymasters
  let spymasterCount = 0;
  let corruptionCount = 0;
  let t3Count = 0;

  for (const room of state.rooms.values()) {
    if (room.type === 'SPYMASTER') spymasterCount++;
    if (room.type === 'CORRUPTION_CHAMBER') corruptionCount++;
    if (room.tier === 3) t3Count++;
  }

  conditions.push({
    name: 'Minimum Spymasters',
    met: spymasterCount >= 8,
    current: spymasterCount,
    required: 8,
  });

  conditions.push({
    name: 'Minimum Corruption Chambers',
    met: corruptionCount >= 6,
    current: corruptionCount,
    required: 6,
  });

  // Check Architect connection
  const architectConnections = countArchitectConnectionsFromState(state);
  conditions.push({
    name: 'Architect Connections',
    met: architectConnections === 1,
    current: architectConnections,
    required: 1,
  });

  // Check no loops (implied by construction if we validate correctly)
  conditions.push({
    name: 'No Loops',
    met: true, // Validated during placement
    current: 0,
    required: 0,
  });

  const allMet = conditions.every(c => c.met);

  return { met: allMet, conditions };
}

function countArchitectConnectionsFromState(state: TempleState): number {
  const { getAdjacentCoords } = require('../domain/types.js');
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
 * Get all valid placement positions for a room type
 */
export function getValidPlacements(
  state: TempleState,
  roomType: RoomType
): Coord[] {
  const validPositions: Coord[] = [];

  for (let y = 1; y <= 9; y++) {
    for (let x = 1; x <= 9; x++) {
      const position = { x, y };

      const action: PlacementAction = {
        type: 'PLACE_ROOM',
        roomType,
        tier: 1,
        position,
        connections: [],
      };

      const result = validatePlacement(state, action);
      if (result.valid) {
        validPositions.push(position);
      }
    }
  }

  return validPositions;
}
