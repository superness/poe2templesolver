/**
 * Heuristic functions for A* search
 */

import { Coord, SolverGoal, manhattanDistance, coordKey } from '../domain/types.js';
import { VICTORY_CONDITIONS, HEURISTIC_WEIGHTS, ATZIRI_POSITION } from '../domain/constants.js';
import { TempleState, countRoomType, getChainTips } from '../state/temple-state.js';

/**
 * Main heuristic evaluation function
 * Estimates the minimum cost to reach the goal state
 * Must be admissible (never overestimate) for A* optimality
 */
export function evaluateHeuristic(
  state: TempleState,
  goal: SolverGoal
): number {
  let h = 0;

  // H1: Distance to Architect
  if (goal.reachArchitect && !state.connectedToArchitect.has(coordKey(state.architect))) {
    const tips = getChainTips(state);
    if (tips.length > 0) {
      const minDist = Math.min(...tips.map(t => manhattanDistance(t, state.architect)));
      h += minDist * HEURISTIC_WEIGHTS.DISTANCE_TO_ARCHITECT;
    } else {
      // Start from Foyer
      h += manhattanDistance({ x: 5, y: 1 }, state.architect) * HEURISTIC_WEIGHTS.DISTANCE_TO_ARCHITECT;
    }
  }

  // H2: Distance to Atziri (after reaching Architect)
  if (goal.reachAtziri && state.connectedToArchitect.has(coordKey(state.architect))) {
    if (!state.connectedToArchitect.has(coordKey(ATZIRI_POSITION))) {
      const distToAtziri = manhattanDistance(state.architect, ATZIRI_POSITION);
      h += distToAtziri * HEURISTIC_WEIGHTS.DISTANCE_TO_ATZIRI;
    }
  }

  // H3: Spymaster deficit
  if (goal.achieveBestTemple || goal.maximizeSpymasters) {
    const spymasterCount = countRoomType(state, 'SPYMASTER');
    const targetSpymasters = goal.minSpymasters ?? VICTORY_CONDITIONS.MIN_SPYMASTERS;
    const deficit = Math.max(0, targetSpymasters - spymasterCount);
    // Each Spymaster needs at least 2 rooms (itself + Garrison connection)
    h += deficit * 2 * HEURISTIC_WEIGHTS.SPYMASTER_DEFICIT;
  }

  // H4: Corruption chamber deficit
  if (goal.achieveBestTemple || goal.maximizeCorruption) {
    const corruptionCount = countRoomType(state, 'CORRUPTION_CHAMBER');
    const targetCorruption = goal.minCorruptionChambers ?? VICTORY_CONDITIONS.MIN_CORRUPTION_CHAMBERS;
    const deficit = Math.max(0, targetCorruption - corruptionCount);
    // Corruption chambers need longer chains (Alchemy Lab -> Thaumaturge -> Corruption)
    h += deficit * 3 * HEURISTIC_WEIGHTS.CORRUPTION_DEFICIT;
  }

  // H5: Custom room requirements
  if (goal.roomRequirements) {
    for (const req of goal.roomRequirements) {
      const currentCount = countRoomType(state, req.type);
      const deficit = Math.max(0, req.minCount - currentCount);
      h += deficit * 2 * HEURISTIC_WEIGHTS.SPYMASTER_DEFICIT; // Use generic weight
    }
  }

  return h;
}

/**
 * Calculate the cost of an action
 * Lower cost = better action
 */
export function actionCost(action: { roomType?: string; tier?: number }): number {
  // Paths have low base cost
  if (action.roomType === 'PATH') {
    return 1 + HEURISTIC_WEIGHTS.PATH_PENALTY;
  }

  // Rooms have higher base cost but provide more value
  let cost = 1;

  // T3 rooms are more valuable (lower effective cost)
  if (action.tier === 3) {
    cost -= HEURISTIC_WEIGHTS.T3_BONUS * 0.1;
  }

  return Math.max(0.1, cost);
}

/**
 * Evaluate the current state's value (for greedy components)
 * Higher is better
 */
export function evaluateStateValue(state: TempleState): number {
  let value = 0;

  // Count valuable rooms
  const spymasters = countRoomType(state, 'SPYMASTER');
  const corruptions = countRoomType(state, 'CORRUPTION_CHAMBER');
  const sacrificial = countRoomType(state, 'SACRIFICIAL_CHAMBER');

  value += spymasters * 20;
  value += corruptions * 25;
  value += sacrificial * 30;

  // Count other rooms
  for (const room of state.rooms.values()) {
    if (room.tier === 3) value += 10;
    else if (room.tier === 2) value += 5;
    else value += 2;
  }

  // Penalize excessive paths
  value -= state.paths.size * 0.5;

  // Bonus for connectivity
  value += state.connectedToFoyer.size * 0.5;

  // Bonus for reaching Architect
  if (state.connectedToArchitect.size > 0) {
    value += 50;
  }

  return value;
}

/**
 * Check if a state is a goal state
 */
export function isGoalState(state: TempleState, goal: SolverGoal): boolean {
  // Must reach Architect if required
  if (goal.reachArchitect) {
    if (!state.connectedToArchitect.has(coordKey(state.architect))) {
      return false;
    }
  }

  // Must reach Atziri if required
  if (goal.reachAtziri) {
    if (!state.connectedToArchitect.has(coordKey(ATZIRI_POSITION))) {
      return false;
    }
  }

  // Check victory conditions if required
  if (goal.achieveBestTemple) {
    const spymasters = countRoomType(state, 'SPYMASTER');
    const targetSpymasters = goal.minSpymasters ?? VICTORY_CONDITIONS.MIN_SPYMASTERS;
    if (spymasters < targetSpymasters) {
      return false;
    }

    const corruptions = countRoomType(state, 'CORRUPTION_CHAMBER');
    const targetCorruption = goal.minCorruptionChambers ?? VICTORY_CONDITIONS.MIN_CORRUPTION_CHAMBERS;
    if (corruptions < targetCorruption) {
      return false;
    }
  }

  // Check custom room requirements
  if (goal.roomRequirements) {
    for (const req of goal.roomRequirements) {
      const currentCount = countRoomType(state, req.type);
      if (currentCount < req.minCount) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Estimate remaining rooms needed to complete the goal
 */
export function estimateRemainingRooms(state: TempleState, goal: SolverGoal): number {
  let remaining = 0;

  // Rooms needed for Spymasters
  if (goal.achieveBestTemple || goal.maximizeSpymasters) {
    const current = countRoomType(state, 'SPYMASTER');
    const targetSpymasters = goal.minSpymasters ?? VICTORY_CONDITIONS.MIN_SPYMASTERS;
    const deficit = Math.max(0, targetSpymasters - current);
    remaining += deficit * 2; // Each Spymaster needs a Garrison
  }

  // Rooms needed for Corruption
  if (goal.achieveBestTemple || goal.maximizeCorruption) {
    const current = countRoomType(state, 'CORRUPTION_CHAMBER');
    const targetCorruption = goal.minCorruptionChambers ?? VICTORY_CONDITIONS.MIN_CORRUPTION_CHAMBERS;
    const deficit = Math.max(0, targetCorruption - current);
    remaining += deficit * 3; // Corruption chains are longer
  }

  // Rooms needed for custom requirements
  if (goal.roomRequirements) {
    for (const req of goal.roomRequirements) {
      const current = countRoomType(state, req.type);
      const deficit = Math.max(0, req.minCount - current);
      remaining += deficit * 2;
    }
  }

  // Rooms needed to reach Architect
  if (goal.reachArchitect && !state.connectedToArchitect.has(coordKey(state.architect))) {
    const tips = getChainTips(state);
    if (tips.length > 0) {
      remaining += Math.min(...tips.map(t => manhattanDistance(t, state.architect)));
    }
  }

  return remaining;
}
