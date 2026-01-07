/**
 * Constants for the Temple of Atziri solver
 */

import { Coord } from './types.js';

// Grid dimensions
export const GRID_SIZE = 9;

// Fixed positions
export const FOYER_POSITION: Coord = { x: 5, y: 1 };
export const ATZIRI_POSITION: Coord = { x: 5, y: 9 };

// Victory conditions for "Best Temple"
export const VICTORY_CONDITIONS = {
  MIN_SPYMASTERS: 8,
  MIN_CORRUPTION_CHAMBERS: 6,
  MAX_PATHS_PER_DIRECTION: 2,
  ARCHITECT_MAX_CONNECTIONS: 1,
  NO_LOOPS: true,
};

// Special rules
export const SPECIAL_RULES = {
  // Commander blocks Spymaster placement downstream in the same chain
  COMMANDER_BLOCKS_SPYMASTER: true,

  // Generator power range by tier
  GENERATOR_POWER_RANGE: { 1: 3, 2: 4, 3: 5 } as Record<number, number>,

  // Unique rooms (only one per temple)
  UNIQUE_ROOMS: ['SACRIFICIAL_CHAMBER'] as const,

  // Architect can only have exactly 1 room connection
  ARCHITECT_MAX_CONNECTIONS: 1,

  // Temple must be a tree (no cycles)
  NO_LOOPS: true,
};

// Default solver options
export const DEFAULT_SOLVER_OPTIONS = {
  maxIterations: 100000,
  maxTime: 30000, // 30 seconds
  strategy: 'BALANCED' as const,
  pruneAggressive: false,
};

// Heuristic weights for scoring
export const HEURISTIC_WEIGHTS = {
  DISTANCE_TO_ARCHITECT: 1.0,
  DISTANCE_TO_ATZIRI: 0.5,
  SPYMASTER_DEFICIT: 3.0,
  CORRUPTION_DEFICIT: 4.0,
  SYNERGY_BONUS: 2.0,
  PATH_PENALTY: 0.5,
  T3_BONUS: 5.0,
};
