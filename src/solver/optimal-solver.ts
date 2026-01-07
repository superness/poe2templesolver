/**
 * Bridge to OR-Tools Python solver for optimal temple solutions.
 *
 * This module calls the Python CP-SAT solver to find provably optimal
 * (or near-optimal) temple layouts that maximize score while meeting
 * all constraints.
 */

import { spawn } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Coord, RoomType, Tier, Solution, PlacementAction, SolutionStep } from '../domain/types.js';
import { TempleState, createEmptyState, placeRoom, placePath, updateConnectivity } from '../state/temple-state.js';
import { getRoomName, getRoomValue } from '../domain/room-rules.js';

// Path to Python solver (relative to project root)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PYTHON_SOLVER_PATH = path.join(__dirname, '../../solver-python/temple_solver.py');

interface PythonSolverInput {
  architect: [number, number];
  min_spymasters: number;
  min_corruption_chambers: number;
  max_time_seconds: number;
  existing_rooms: { type: string; tier: number; x: number; y: number }[];
  existing_paths: [number, number][];
  lock_existing: boolean;  // If true, existing rooms MUST be kept (game mode); if false, they're optional (planning mode)
}

interface PythonSolverOutput {
  success: boolean;
  optimal: boolean;
  score: number;
  rooms: { type: string; tier: number; x: number; y: number }[];
  paths: { x: number; y: number }[];
  stats: {
    status: string;
    time_seconds: number;
    branches?: number;
    conflicts?: number;
  };
  error?: string;
  excluded_rooms?: { type: string; tier: number; x: number; y: number }[];
}

export interface OptimalSolverOptions {
  minSpymasters?: number;
  minCorruptionChambers?: number;
  maxTimeSeconds?: number;
  lockExisting?: boolean;  // If true, existing rooms must be kept; if false, they can be excluded (default: false for planning)
}

/**
 * Call the Python OR-Tools solver to find optimal temple layout.
 */
export async function solveOptimal(
  initialState: TempleState,
  options: OptimalSolverOptions = {}
): Promise<Solution> {
  const {
    minSpymasters = 8,
    minCorruptionChambers = 6,
    maxTimeSeconds = 60,
    lockExisting = true,  // Default: game mode (existing rooms MUST stay - you can't remove rooms in the game)
  } = options;

  // Build input for Python solver
  const existingRooms: PythonSolverInput['existing_rooms'] = [];
  const existingPaths: PythonSolverInput['existing_paths'] = [];

  for (const room of initialState.rooms.values()) {
    existingRooms.push({
      type: room.type,
      tier: room.tier,
      x: room.position.x,
      y: room.position.y,
    });
  }

  for (const p of initialState.paths.values()) {
    existingPaths.push([p.position.x, p.position.y]);
  }

  const input: PythonSolverInput = {
    architect: [initialState.architect.x, initialState.architect.y],
    min_spymasters: minSpymasters,
    min_corruption_chambers: minCorruptionChambers,
    max_time_seconds: maxTimeSeconds,
    existing_rooms: existingRooms,
    existing_paths: existingPaths,
    lock_existing: lockExisting,
  };

  // Call Python solver
  const startTime = Date.now();
  const result = await callPythonSolver(input);
  const elapsed = Date.now() - startTime;

  if (!result.success) {
    return createFailedSolution(initialState, result.error || 'Solver failed', elapsed);
  }

  // Build final state from solution
  const finalState = createEmptyState(initialState.architect);

  // Place all rooms from solution
  for (const room of result.rooms) {
    placeRoom(finalState, room.type as RoomType, room.tier as Tier, { x: room.x, y: room.y });
  }

  // Place all paths from solution
  for (const p of result.paths) {
    placePath(finalState, { x: p.x, y: p.y });
  }

  updateConnectivity(finalState);

  // Build solution steps (placement order doesn't matter for optimal, but we can order by position)
  const steps = buildSteps(result.rooms, result.paths, finalState);

  // Count metrics
  let spymasterCount = 0;
  let corruptionCount = 0;
  let t3Count = 0;

  for (const room of result.rooms) {
    if (room.type === 'SPYMASTER') spymasterCount++;
    if (room.type === 'CORRUPTION_CHAMBER') corruptionCount++;
    if (room.tier === 3) t3Count++;
  }

  const meetsVictory = spymasterCount >= minSpymasters && corruptionCount >= minCorruptionChambers;

  return {
    found: result.success,
    actions: steps.map(s => ({
      type: s.roomType === 'PATH' ? 'PLACE_PATH' : 'PLACE_ROOM',
      roomType: s.roomType === 'PATH' ? undefined : s.roomType as RoomType,
      tier: s.tier,
      position: s.position,
      connections: s.connectsTo,
    } as PlacementAction)),
    steps,
    finalState,
    metrics: {
      totalRooms: result.rooms.length,
      totalPaths: result.paths.length,
      spymasterCount,
      corruptionCount,
      t3RoomCount: t3Count,
      estimatedValue: result.score,
      meetsVictoryConditions: meetsVictory,
      targetSpymasters: minSpymasters,
      targetCorruptionChambers: minCorruptionChambers,
    },
    stats: {
      nodesExplored: result.stats.branches || 0,
      timeTaken: elapsed,
      optimalityGuarantee: result.optimal,
    },
    summary: buildSummary(result, minSpymasters, minCorruptionChambers),
    excludedRooms: result.excluded_rooms,
  };
}

/**
 * Call the Python solver process.
 */
function callPythonSolver(input: PythonSolverInput): Promise<PythonSolverOutput> {
  return new Promise((resolve, reject) => {
    const pythonProcess = spawn('python3', [PYTHON_SOLVER_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        // Try to parse any JSON output even on error
        try {
          const result = JSON.parse(stdout);
          resolve(result);
        } catch {
          resolve({
            success: false,
            optimal: false,
            score: 0,
            rooms: [],
            paths: [],
            stats: { status: 'ERROR', time_seconds: 0 },
            error: stderr || `Python process exited with code ${code}`,
          });
        }
        return;
      }

      try {
        // Find the JSON output (skip solver logs)
        // JSON output starts with { followed by newline and "success"
        let jsonStart = stdout.indexOf('{\n  "success"');
        if (jsonStart === -1) {
          // Try compact JSON format
          jsonStart = stdout.indexOf('{"success"');
        }
        if (jsonStart === -1) {
          // Try finding the last complete JSON object
          jsonStart = stdout.lastIndexOf('\n{');
          if (jsonStart !== -1) jsonStart++;
        }
        if (jsonStart === -1) {
          throw new Error('Could not find JSON output start');
        }
        const jsonStr = stdout.slice(jsonStart);
        const result = JSON.parse(jsonStr);
        resolve(result);
      } catch (e) {
        resolve({
          success: false,
          optimal: false,
          score: 0,
          rooms: [],
          paths: [],
          stats: { status: 'PARSE_ERROR', time_seconds: 0 },
          error: `Failed to parse solver output: ${e}`,
        });
      }
    });

    pythonProcess.on('error', (err) => {
      resolve({
        success: false,
        optimal: false,
        score: 0,
        rooms: [],
        paths: [],
        stats: { status: 'SPAWN_ERROR', time_seconds: 0 },
        error: `Failed to spawn Python process: ${err.message}`,
      });
    });

    // Send input
    pythonProcess.stdin.write(JSON.stringify(input));
    pythonProcess.stdin.end();
  });
}

/**
 * Build solution steps from rooms and paths.
 */
function buildSteps(
  rooms: PythonSolverOutput['rooms'],
  paths: PythonSolverOutput['paths'],
  finalState: TempleState
): SolutionStep[] {
  const steps: SolutionStep[] = [];
  let stepNum = 1;

  // Sort by position for deterministic output
  const sortedRooms = [...rooms].sort((a, b) => a.y - b.y || a.x - b.x);
  const sortedPaths = [...paths].sort((a, b) => a.y - b.y || a.x - b.x);

  for (const room of sortedRooms) {
    steps.push({
      stepNumber: stepNum++,
      action: 'PLACE',
      roomType: room.type as RoomType,
      tier: room.tier as Tier,
      position: { x: room.x, y: room.y },
      connectsTo: [], // Could compute from finalState if needed
      reason: `Optimal placement: ${getRoomName(room.type as RoomType, room.tier as Tier)} (${getRoomValue(room.type as RoomType, room.tier as Tier)} pts)`,
      synergiesActivated: [],
      warnings: [],
    });
  }

  for (const p of sortedPaths) {
    steps.push({
      stepNumber: stepNum++,
      action: 'PLACE',
      roomType: 'PATH',
      position: { x: p.x, y: p.y },
      connectsTo: [],
      reason: 'Optimal path placement',
      synergiesActivated: [],
      warnings: [],
    });
  }

  return steps;
}

/**
 * Build summary text.
 */
function buildSummary(
  result: PythonSolverOutput,
  targetSpy: number,
  targetCorr: number
): string {
  const status = result.optimal ? 'OPTIMAL' : 'FEASIBLE (time limit)';

  let spyCount = 0;
  let corrCount = 0;
  for (const room of result.rooms) {
    if (room.type === 'SPYMASTER') spyCount++;
    if (room.type === 'CORRUPTION_CHAMBER') corrCount++;
  }

  let excludedInfo = '';
  if (result.excluded_rooms && result.excluded_rooms.length > 0) {
    excludedInfo = `\n\n⚠️ EXCLUDED ROOMS (cannot connect to temple tree):
${result.excluded_rooms.map(r => `  - ${r.type} T${r.tier} at (${r.x}, ${r.y})`).join('\n')}

Note: These rooms cannot form part of a connected tree because their
room types don't have valid connection paths to the Foyer.`;
  }

  return `=== OPTIMAL SOLVER RESULT ===

Status: ${status}
Score: ${result.score} points

Rooms placed: ${result.rooms.length}
Paths placed: ${result.paths.length}
Spymasters: ${spyCount}/${targetSpy} ${spyCount >= targetSpy ? '✓' : '✗'}
Corruption Chambers: ${corrCount}/${targetCorr} ${corrCount >= targetCorr ? '✓' : '✗'}
${excludedInfo}

Solver stats:
  Status: ${result.stats.status}
  Time: ${result.stats.time_seconds.toFixed(2)}s
  Branches: ${result.stats.branches || 'N/A'}
  Conflicts: ${result.stats.conflicts || 'N/A'}

${result.optimal ? '🏆 PROVABLY OPTIMAL SOLUTION' : '⏱️ Best solution found within time limit'}`;
}

/**
 * Create a failed solution response.
 */
function createFailedSolution(state: TempleState, error: string, elapsed: number): Solution {
  return {
    found: false,
    actions: [],
    steps: [],
    finalState: state,
    metrics: {
      totalRooms: 0,
      totalPaths: 0,
      spymasterCount: 0,
      corruptionCount: 0,
      t3RoomCount: 0,
      estimatedValue: 0,
      meetsVictoryConditions: false,
    },
    stats: {
      nodesExplored: 0,
      timeTaken: elapsed,
      optimalityGuarantee: false,
    },
    summary: `=== SOLVER FAILED ===\n\nError: ${error}`,
  };
}
