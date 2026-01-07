/**
 * Main Solver Interface
 */

import { Solution, SolverGoal, SolverOptions, Coord, RoomPool, RoomType, Tier } from '../domain/types.js';
import { DEFAULT_SOLVER_OPTIONS } from '../domain/constants.js';
import { TempleState, createEmptyState, placeRoom, placePath, updateConnectivity } from '../state/temple-state.js';
import { astarSolve } from './astar.js';
import { createUnlimitedPool } from './action-generator.js';

/**
 * Main Temple Solver class
 */
export class TempleSolver {
  /**
   * Solve a temple from the given state
   */
  solve(
    initialState: TempleState,
    roomPool: RoomPool,
    goal: SolverGoal,
    options: Partial<SolverOptions> = {}
  ): Solution {
    return astarSolve(initialState, roomPool, goal, options);
  }

  /**
   * Create a default goal for "Best Temple"
   */
  static createBestTempleGoal(): SolverGoal {
    return {
      reachArchitect: true,
      reachAtziri: false, // Optional - focus on Best Temple first
      maximizeSpymasters: true,
      maximizeCorruption: true,
      maximizeSynergies: true,
      minimizePaths: true,
      protectRooms: [],
      avoidRoomTypes: [],
      achieveBestTemple: true,
    };
  }

  /**
   * Create a goal focused on reaching Architect quickly
   */
  static createSpeedGoal(architectPos: Coord): SolverGoal {
    return {
      reachArchitect: true,
      reachAtziri: false,
      maximizeSpymasters: false,
      maximizeCorruption: false,
      maximizeSynergies: false,
      minimizePaths: false,
      protectRooms: [],
      avoidRoomTypes: [],
      achieveBestTemple: false,
    };
  }

  /**
   * Create a goal focused on maximizing a specific room type
   */
  static createMaximizeGoal(roomType: 'SPYMASTER' | 'CORRUPTION_CHAMBER'): SolverGoal {
    return {
      reachArchitect: true,
      reachAtziri: false,
      maximizeSpymasters: roomType === 'SPYMASTER',
      maximizeCorruption: roomType === 'CORRUPTION_CHAMBER',
      maximizeSynergies: true,
      minimizePaths: true,
      protectRooms: [],
      avoidRoomTypes: [],
      achieveBestTemple: false,
    };
  }
}

/**
 * Quick solve function for simple cases
 */
export function quickSolve(
  architectPosition: Coord,
  existingRooms: { type: RoomType; tier: Tier; position: Coord }[] = [],
  existingPaths: Coord[] = [],
  goal?: Partial<SolverGoal>
): Solution {
  // Create initial state
  const state = createEmptyState(architectPosition);

  // Place existing rooms
  for (const room of existingRooms) {
    placeRoom(state, room.type, room.tier, room.position);
  }

  // Place existing paths
  for (const pathPos of existingPaths) {
    placePath(state, pathPos);
  }

  // Update connectivity
  updateConnectivity(state);

  // Create goal
  const fullGoal: SolverGoal = {
    reachArchitect: true,
    reachAtziri: false,
    maximizeSpymasters: true,
    maximizeCorruption: true,
    maximizeSynergies: true,
    minimizePaths: true,
    protectRooms: [],
    avoidRoomTypes: [],
    achieveBestTemple: true,
    ...goal,
  };

  // Create unlimited pool for planning
  const pool = createUnlimitedPool();

  // Solve
  const solver = new TempleSolver();
  return solver.solve(state, pool, fullGoal);
}

/**
 * Analyze a temple state without solving
 */
export function analyzeTemple(state: TempleState): {
  totalRooms: number;
  roomCounts: Record<string, number>;
  connectivity: {
    connectedToFoyer: number;
    connectedToArchitect: number;
  };
  chainTips: Coord[];
  suggestions: string[];
} {
  const roomCounts: Record<string, number> = {};

  for (const room of state.rooms.values()) {
    const key = `${room.type}_T${room.tier}`;
    roomCounts[key] = (roomCounts[key] || 0) + 1;
  }

  const { getChainTips, countRoomType } = require('../state/temple-state.js');
  const tips = getChainTips(state);

  const suggestions: string[] = [];

  // Check Spymaster count
  const spymasters = countRoomType(state, 'SPYMASTER');
  if (spymasters < 8) {
    suggestions.push(`Need ${8 - spymasters} more Spymasters for Best Temple`);
  }

  // Check Corruption count
  const corruptions = countRoomType(state, 'CORRUPTION_CHAMBER');
  if (corruptions < 6) {
    suggestions.push(`Need ${6 - corruptions} more Corruption Chambers for Best Temple`);
  }

  // Check connectivity
  if (state.connectedToArchitect.size === 0) {
    suggestions.push('Temple not yet connected to Architect');
  }

  return {
    totalRooms: state.rooms.size,
    roomCounts,
    connectivity: {
      connectedToFoyer: state.connectedToFoyer.size,
      connectedToArchitect: state.connectedToArchitect.size,
    },
    chainTips: tips,
    suggestions,
  };
}
