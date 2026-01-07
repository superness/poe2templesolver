/**
 * A* Search Algorithm for Temple Solving
 */

import {
  SolverGoal,
  SolverOptions,
  Solution,
  PlacementAction,
  SolutionStep,
  coordKey,
} from '../domain/types.js';
import { DEFAULT_SOLVER_OPTIONS } from '../domain/constants.js';
import { getRoomName, getRoomValue, triggersSynergy } from '../domain/room-rules.js';
import {
  TempleState,
  cloneState,
  placeRoom,
  placePath,
  updateConnectivity,
  countRoomType,
  countT3Rooms,
  getAdjacentOccupied,
  getRoomTypeAt,
} from '../state/temple-state.js';
import { hashState, isSymmetricDuplicate } from '../state/state-hash.js';
import { SearchNode, PriorityQueue, createSearchNode, extractActionPath } from './search-node.js';
import { evaluateHeuristic, actionCost, isGoalState } from './heuristics.js';
import { generateValidActions, prioritizeActions, createUnlimitedPool } from './action-generator.js';
import { RoomPool } from '../domain/types.js';

/**
 * A* Search implementation for temple solving
 */
export function astarSolve(
  initialState: TempleState,
  roomPool: RoomPool,
  goal: SolverGoal,
  options: Partial<SolverOptions> = {}
): Solution {
  const opts: SolverOptions = { ...DEFAULT_SOLVER_OPTIONS, ...options };
  const startTime = Date.now();

  const openSet = new PriorityQueue<SearchNode>();
  const closedSet = new Set<string>();

  // Initial node
  const startNode = createSearchNode(
    initialState,
    null,
    null,
    0,
    evaluateHeuristic(initialState, goal)
  );

  openSet.push(startNode);

  let nodesExplored = 0;
  let bestNode: SearchNode = startNode;
  let bestValue = -Infinity;

  while (!openSet.isEmpty()) {
    // Check time limit
    if (Date.now() - startTime > opts.maxTime) {
      break;
    }

    // Check iteration limit
    if (nodesExplored >= opts.maxIterations) {
      break;
    }

    const current = openSet.pop()!;
    nodesExplored++;

    // Goal check
    if (isGoalState(current.state, goal)) {
      return buildSolution(current, goal, nodesExplored, Date.now() - startTime, true);
    }

    // Track best node seen (for partial solutions)
    const currentValue = evaluateStateForBest(current.state, goal);
    if (currentValue > bestValue) {
      bestValue = currentValue;
      bestNode = current;
    }

    const stateHash = hashState(current.state);

    // Skip if already visited
    if (closedSet.has(stateHash)) continue;
    closedSet.add(stateHash);

    // Symmetry pruning
    if (opts.pruneAggressive && isSymmetricDuplicate(current.state, closedSet)) {
      continue;
    }

    // Generate and expand valid actions
    const actions = generateValidActions(current.state, roomPool);
    const prioritizedActions = prioritizeActions(actions, current.state);

    // Limit branching in FAST mode
    const actionsToExpand = opts.strategy === 'FAST'
      ? prioritizedActions.slice(0, 10)
      : prioritizedActions;

    for (const action of actionsToExpand) {
      const newState = applyAction(current.state, action);
      const newCost = current.cost + actionCost(action);
      const newHeuristic = evaluateHeuristic(newState, goal);

      const childNode = createSearchNode(
        newState,
        current,
        action,
        newCost,
        newHeuristic
      );

      openSet.push(childNode);
    }
  }

  // Return best partial solution if goal not reached
  return buildSolution(bestNode, goal, nodesExplored, Date.now() - startTime, false);
}

/**
 * Apply a placement action to a state
 */
function applyAction(state: TempleState, action: PlacementAction): TempleState {
  const newState = cloneState(state);

  if (action.type === 'PLACE_PATH') {
    placePath(newState, action.position);
  } else if (action.type === 'PLACE_ROOM' && action.roomType && action.tier) {
    placeRoom(newState, action.roomType, action.tier, action.position);
  }

  updateConnectivity(newState);

  return newState;
}

/**
 * Evaluate a state for "best so far" tracking
 */
function evaluateStateForBest(state: TempleState, goal: SolverGoal): number {
  let value = 0;

  // Rooms placed
  value += state.rooms.size * 5;

  // High-value rooms
  value += countRoomType(state, 'SPYMASTER') * 20;
  value += countRoomType(state, 'CORRUPTION_CHAMBER') * 25;

  // T3 rooms
  value += countT3Rooms(state) * 15;

  // Connectivity bonus
  if (state.connectedToArchitect.size > 0) {
    value += 100;
  }

  // Progress toward goal
  if (goal.achieveBestTemple) {
    const spyProgress = Math.min(countRoomType(state, 'SPYMASTER') / 8, 1);
    const corrProgress = Math.min(countRoomType(state, 'CORRUPTION_CHAMBER') / 6, 1);
    value += (spyProgress + corrProgress) * 50;
  }

  return value;
}

/**
 * Build a Solution object from a search node
 */
function buildSolution(
  node: SearchNode,
  goal: SolverGoal,
  nodesExplored: number,
  timeTaken: number,
  goalReached: boolean
): Solution {
  const actions = extractActionPath(node);
  const steps = actionsToSteps(actions, node.state);

  const { VICTORY_CONDITIONS } = require('../domain/constants.js');
  const targetSpymasters = goal.minSpymasters ?? VICTORY_CONDITIONS.MIN_SPYMASTERS;
  const targetCorruption = goal.minCorruptionChambers ?? VICTORY_CONDITIONS.MIN_CORRUPTION_CHAMBERS;

  const metrics = {
    totalRooms: node.state.rooms.size,
    totalPaths: node.state.paths.size,
    spymasterCount: countRoomType(node.state, 'SPYMASTER'),
    corruptionCount: countRoomType(node.state, 'CORRUPTION_CHAMBER'),
    t3RoomCount: countT3Rooms(node.state),
    estimatedValue: calculateTotalValue(node.state),
    meetsVictoryConditions: isGoalState(node.state, goal),
    targetSpymasters,
    targetCorruptionChambers: targetCorruption,
  };

  const summary = goalReached
    ? generateSuccessSummary(metrics)
    : generatePartialSummary(metrics, goal);

  return {
    found: goalReached,
    actions,
    steps,
    finalState: node.state,
    metrics,
    stats: {
      nodesExplored,
      timeTaken,
      optimalityGuarantee: goalReached && nodesExplored < 50000,
    },
    summary,
  };
}

/**
 * Convert actions to human-readable steps
 */
function actionsToSteps(actions: PlacementAction[], finalState: TempleState): SolutionStep[] {
  const steps: SolutionStep[] = [];

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const stepNumber = i + 1;

    const step: SolutionStep = {
      stepNumber,
      action: action.type === 'LOCK_ROOM' ? 'LOCK' : 'PLACE',
      roomType: action.roomType || 'PATH',
      tier: action.tier,
      position: action.position,
      connectsTo: action.connections,
      reason: generateReason(action, i, actions),
      synergiesActivated: detectSynergies(action, finalState),
      warnings: detectWarnings(action),
    };

    steps.push(step);
  }

  return steps;
}

/**
 * Generate a reason for a placement
 */
function generateReason(action: PlacementAction, index: number, allActions: PlacementAction[]): string {
  if (action.type === 'PLACE_PATH') {
    return 'Extends temple path';
  }

  const roomType = action.roomType!;

  switch (roomType) {
    case 'SPYMASTER':
      return 'Generates medallions for chain protection';
    case 'GARRISON':
      return 'Enables Spymaster placement and pack size bonus';
    case 'CORRUPTION_CHAMBER':
      return 'High-value modifier room';
    case 'COMMANDER':
      return 'Boosts rare monster effectiveness';
    case 'ARMOURY':
      return 'Provides equipment bonuses';
    case 'ALCHEMY_LAB':
      return 'Increases item rarity';
    case 'THAUMATURGE':
      return 'Gem corruption capabilities';
    case 'SACRIFICIAL_CHAMBER':
      return 'High-value unique room with Vaal Cultivation Orb';
    case 'GENERATOR':
      return 'Powers nearby rooms';
    default:
      return `Places ${roomType} for temple value`;
  }
}

/**
 * Detect synergies activated by a placement
 */
function detectSynergies(action: PlacementAction, state: TempleState): string[] {
  const synergies: string[] = [];

  if (action.type !== 'PLACE_ROOM' || !action.roomType) {
    return synergies;
  }

  const adjacent = getAdjacentOccupied(state, action.position);

  for (const adjCoord of adjacent) {
    const adjType = getRoomTypeAt(state, adjCoord);
    if (adjType && triggersSynergy(action.roomType, adjType)) {
      synergies.push(`${action.roomType} synergy with ${adjType}`);
    }
  }

  return synergies;
}

/**
 * Detect warnings for a placement
 */
function detectWarnings(action: PlacementAction): string[] {
  const warnings: string[] = [];

  if (action.roomType === 'COMMANDER') {
    warnings.push('Blocks Spymaster placement downstream in this chain');
  }

  return warnings;
}

/**
 * Calculate total value of placed rooms
 */
function calculateTotalValue(state: TempleState): number {
  let value = 0;

  for (const room of state.rooms.values()) {
    value += getRoomValue(room.type, room.tier);
  }

  return value;
}

/**
 * Generate success summary
 */
function generateSuccessSummary(metrics: Solution['metrics']): string {
  return `=== TEMPLE SOLUTION ===

VERDICT: Best Temple achieved!

Total Rooms: ${metrics.totalRooms}
Total Paths: ${metrics.totalPaths}
Spymasters: ${metrics.spymasterCount} ✓
Corruption Chambers: ${metrics.corruptionCount} ✓
Tier 3 Rooms: ${metrics.t3RoomCount}
Estimated Value: ${metrics.estimatedValue}`;
}

/**
 * Generate partial solution summary
 */
function generatePartialSummary(metrics: Solution['metrics'], goal: SolverGoal): string {
  const issues: string[] = [];
  const { VICTORY_CONDITIONS } = require('../domain/constants.js');

  if (goal.achieveBestTemple) {
    const targetSpymasters = goal.minSpymasters ?? VICTORY_CONDITIONS.MIN_SPYMASTERS;
    const targetCorruption = goal.minCorruptionChambers ?? VICTORY_CONDITIONS.MIN_CORRUPTION_CHAMBERS;

    if (metrics.spymasterCount < targetSpymasters) {
      issues.push(`Spymasters: ${metrics.spymasterCount}/${targetSpymasters}`);
    }
    if (metrics.corruptionCount < targetCorruption) {
      issues.push(`Corruption Chambers: ${metrics.corruptionCount}/${targetCorruption}`);
    }
  }

  return `=== PARTIAL SOLUTION ===

Best achievable state found.

Total Rooms: ${metrics.totalRooms}
Total Paths: ${metrics.totalPaths}
Spymasters: ${metrics.spymasterCount}
Corruption Chambers: ${metrics.corruptionCount}
Tier 3 Rooms: ${metrics.t3RoomCount}

Missing requirements:
${issues.map(i => `  - ${i}`).join('\n')}`;
}
