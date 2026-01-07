/**
 * Temple MIP Model
 *
 * Formulates the temple optimization problem as a Mixed Integer Program
 * for solving with HiGHS.
 */

import type { MIPProblem, Variable, Constraint } from './highs-solver';
import { solveMIP, roomVar, tierVar, inTempleVar } from './highs-solver';
import type { Coord, Room, TempleState, SolverConfig, SolverResult } from './types';
import {
  GRID_SIZE,
  FOYER_POS,
  ATZIRI_POS,
  ROOM_TYPES,
  ROOM_TYPE_TO_IDX,
  EMPTY_IDX,
  PATH_IDX,
  getNeighbors,
  coordKey,
} from './types';
import { UNIQUE_ROOMS, ROOM_VALUES } from './room-rules';

const BIG_M = 10; // Reduced to avoid numerical issues

/**
 * Build and solve the temple MIP model
 */
export async function solveTemple(
  initialState: TempleState,
  config: SolverConfig
): Promise<SolverResult> {
  console.log('=== solveTemple called v7 (no flow vars) ===');
  console.log('Config:', config);
  console.log('Initial state rooms:', initialState.rooms.length);

  const variables: Variable[] = [];
  const constraints: Constraint[] = [];

  const architectPos = initialState.architect;

  // Track existing rooms/paths
  const existingRooms = new Map<string, Room>();
  const existingPaths = new Set<string>();

  for (const room of initialState.rooms) {
    existingRooms.set(coordKey(room.position), room);
  }
  for (const path of initialState.paths) {
    existingPaths.add(coordKey(path));
  }

  // ==========================================================================
  // VARIABLES
  // ==========================================================================

  // room[x,y,t] - binary: is room type t at position (x,y)?
  // Only create variables for non-fixed positions
  for (let x = 1; x <= GRID_SIZE; x++) {
    for (let y = 1; y <= GRID_SIZE; y++) {
      // Skip fixed positions
      if ((x === FOYER_POS.x && y === FOYER_POS.y) ||
          (x === ATZIRI_POS.x && y === ATZIRI_POS.y) ||
          (x === architectPos.x && y === architectPos.y)) {
        continue;
      }

      // Room type variables (EMPTY=0, PATH=1, then actual rooms)
      for (let t = 0; t < ROOM_TYPES.length; t++) {
        variables.push({
          name: roomVar(x, y, t),
          type: 'binary',
        });
      }

      // Tier variables for rooms (1, 2, 3 - 0 for empty/path)
      for (let k = 0; k <= 3; k++) {
        variables.push({
          name: tierVar(x, y, k),
          type: 'binary',
        });
      }

      // in_temple[x,y] - is this cell part of the temple?
      variables.push({
        name: inTempleVar(x, y),
        type: 'binary',
      });
    }
  }

  // NOTE: Flow variables removed to reduce model size
  // Connectivity is ensured by simpler neighbor constraints instead

  // ==========================================================================
  // CONSTRAINTS
  // ==========================================================================

  // --- Exactly one room type per cell ---
  for (let x = 1; x <= GRID_SIZE; x++) {
    for (let y = 1; y <= GRID_SIZE; y++) {
      if ((x === FOYER_POS.x && y === FOYER_POS.y) ||
          (x === ATZIRI_POS.x && y === ATZIRI_POS.y) ||
          (x === architectPos.x && y === architectPos.y)) {
        continue;
      }

      // Sum of all room type vars = 1
      constraints.push({
        name: `one_type_${x}_${y}`,
        terms: ROOM_TYPES.map((_, t) => ({ var: roomVar(x, y, t), coef: 1 })),
        sense: '=',
        rhs: 1,
      });
    }
  }

  // --- Exactly one tier per cell ---
  for (let x = 1; x <= GRID_SIZE; x++) {
    for (let y = 1; y <= GRID_SIZE; y++) {
      if ((x === FOYER_POS.x && y === FOYER_POS.y) ||
          (x === ATZIRI_POS.x && y === ATZIRI_POS.y) ||
          (x === architectPos.x && y === architectPos.y)) {
        continue;
      }

      // Sum of tier vars = 1
      constraints.push({
        name: `one_tier_${x}_${y}`,
        terms: [0, 1, 2, 3].map((k) => ({ var: tierVar(x, y, k), coef: 1 })),
        sense: '=',
        rhs: 1,
      });
    }
  }

  // --- in_temple links to room type ---
  for (let x = 1; x <= GRID_SIZE; x++) {
    for (let y = 1; y <= GRID_SIZE; y++) {
      if ((x === FOYER_POS.x && y === FOYER_POS.y) ||
          (x === ATZIRI_POS.x && y === ATZIRI_POS.y) ||
          (x === architectPos.x && y === architectPos.y)) {
        continue;
      }

      // in_temple = 1 - room[EMPTY]
      // i.e., in_temple + room[EMPTY] = 1
      constraints.push({
        name: `in_temple_${x}_${y}`,
        terms: [
          { var: inTempleVar(x, y), coef: 1 },
          { var: roomVar(x, y, EMPTY_IDX), coef: 1 },
        ],
        sense: '=',
        rhs: 1,
      });

      // If EMPTY, tier must be 0
      // tier[0] >= room[EMPTY]
      constraints.push({
        name: `empty_tier_${x}_${y}`,
        terms: [
          { var: tierVar(x, y, 0), coef: 1 },
          { var: roomVar(x, y, EMPTY_IDX), coef: -1 },
        ],
        sense: '>=',
        rhs: 0,
      });

      // If PATH, tier must be 1 (actually tier[1])
      // tier[1] >= room[PATH]
      constraints.push({
        name: `path_tier_${x}_${y}`,
        terms: [
          { var: tierVar(x, y, 1), coef: 1 },
          { var: roomVar(x, y, PATH_IDX), coef: -1 },
        ],
        sense: '>=',
        rhs: 0,
      });

      // If room (not EMPTY, not PATH), tier must be >= 1
      // tier[1] + tier[2] + tier[3] >= 1 - room[EMPTY] - room[PATH]
      // Rearranged: tier[1] + tier[2] + tier[3] + room[EMPTY] + room[PATH] >= 1
      constraints.push({
        name: `room_tier_${x}_${y}`,
        terms: [
          { var: tierVar(x, y, 1), coef: 1 },
          { var: tierVar(x, y, 2), coef: 1 },
          { var: tierVar(x, y, 3), coef: 1 },
          { var: roomVar(x, y, EMPTY_IDX), coef: 1 },
          { var: roomVar(x, y, PATH_IDX), coef: 1 },
        ],
        sense: '>=',
        rhs: 1,
      });
    }
  }

  // --- Connectivity: each non-fixed in_temple cell must have at least 1 in_temple neighbor ---
  // This ensures connectivity without flow variables (simpler for HiGHS WASM)
  for (let x = 1; x <= GRID_SIZE; x++) {
    for (let y = 1; y <= GRID_SIZE; y++) {
      // Skip fixed positions
      if ((x === FOYER_POS.x && y === FOYER_POS.y) ||
          (x === ATZIRI_POS.x && y === ATZIRI_POS.y) ||
          (x === architectPos.x && y === architectPos.y)) {
        continue;
      }

      const neighbors = getNeighbors(x, y);
      const neighborTerms: { var: string; coef: number }[] = [];
      let fixedNeighborCount = 0;

      for (const n of neighbors) {
        if (n.x === FOYER_POS.x && n.y === FOYER_POS.y) {
          fixedNeighborCount++; // FOYER always in temple
        } else if (n.x === architectPos.x && n.y === architectPos.y) {
          fixedNeighborCount++; // ARCHITECT always in temple
        } else if (n.x === ATZIRI_POS.x && n.y === ATZIRI_POS.y) {
          // ATZIRI not in temple
        } else {
          neighborTerms.push({ var: inTempleVar(n.x, n.y), coef: 1 });
        }
      }

      // If in_temple[x,y] = 1, then sum(neighbors in temple) >= 1
      // Linearized: sum(neighbors) >= in_temple[x,y] - fixedNeighborCount
      // But we need: sum(neighbors) + fixedNeighborCount >= 1 when in_temple = 1
      // => sum(neighbors) >= in_temple - fixedNeighborCount
      if (neighborTerms.length > 0 || fixedNeighborCount > 0) {
        constraints.push({
          name: `connected_${x}_${y}`,
          terms: [
            ...neighborTerms,
            { var: inTempleVar(x, y), coef: -1 },
          ],
          sense: '>=',
          rhs: -fixedNeighborCount,
        });
      }
    }
  }

  // --- Minimum room counts ---
  // Min spymasters
  const spymasterIdx = ROOM_TYPE_TO_IDX['SPYMASTER'];
  const spymasterTerms: { var: string; coef: number }[] = [];
  for (let x = 1; x <= GRID_SIZE; x++) {
    for (let y = 1; y <= GRID_SIZE; y++) {
      if ((x === FOYER_POS.x && y === FOYER_POS.y) ||
          (x === ATZIRI_POS.x && y === ATZIRI_POS.y) ||
          (x === architectPos.x && y === architectPos.y)) {
        continue;
      }
      spymasterTerms.push({ var: roomVar(x, y, spymasterIdx), coef: 1 });
    }
  }
  constraints.push({
    name: 'min_spymasters',
    terms: spymasterTerms,
    sense: '>=',
    rhs: config.minSpymasters,
  });

  // Min corruption chambers
  const corruptionIdx = ROOM_TYPE_TO_IDX['CORRUPTION_CHAMBER'];
  const corruptionTerms: { var: string; coef: number }[] = [];
  for (let x = 1; x <= GRID_SIZE; x++) {
    for (let y = 1; y <= GRID_SIZE; y++) {
      if ((x === FOYER_POS.x && y === FOYER_POS.y) ||
          (x === ATZIRI_POS.x && y === ATZIRI_POS.y) ||
          (x === architectPos.x && y === architectPos.y)) {
        continue;
      }
      corruptionTerms.push({ var: roomVar(x, y, corruptionIdx), coef: 1 });
    }
  }
  constraints.push({
    name: 'min_corruption',
    terms: corruptionTerms,
    sense: '>=',
    rhs: config.minCorruptionChambers,
  });

  // --- Max paths ---
  if (config.maxPaths < GRID_SIZE * GRID_SIZE) {
    const pathTerms: { var: string; coef: number }[] = [];
    for (let x = 1; x <= GRID_SIZE; x++) {
      for (let y = 1; y <= GRID_SIZE; y++) {
        if ((x === FOYER_POS.x && y === FOYER_POS.y) ||
            (x === ATZIRI_POS.x && y === ATZIRI_POS.y) ||
            (x === architectPos.x && y === architectPos.y)) {
          continue;
        }
        pathTerms.push({ var: roomVar(x, y, PATH_IDX), coef: 1 });
      }
    }
    constraints.push({
      name: 'max_paths',
      terms: pathTerms,
      sense: '<=',
      rhs: config.maxPaths,
    });
  }

  // --- Unique rooms (at most 1) ---
  for (const uniqueRoom of UNIQUE_ROOMS) {
    const idx = ROOM_TYPE_TO_IDX[uniqueRoom];
    if (idx === undefined) continue;

    const terms: { var: string; coef: number }[] = [];
    for (let x = 1; x <= GRID_SIZE; x++) {
      for (let y = 1; y <= GRID_SIZE; y++) {
        if ((x === FOYER_POS.x && y === FOYER_POS.y) ||
            (x === ATZIRI_POS.x && y === ATZIRI_POS.y) ||
            (x === architectPos.x && y === architectPos.y)) {
          continue;
        }
        terms.push({ var: roomVar(x, y, idx), coef: 1 });
      }
    }
    constraints.push({
      name: `unique_${uniqueRoom}`,
      terms,
      sense: '<=',
      rhs: 1,
    });
  }

  // --- Architect must have exactly 1 neighbor in temple ---
  const archNeighbors = getNeighbors(architectPos.x, architectPos.y);
  const archNeighborTerms: { var: string; coef: number }[] = [];
  for (const n of archNeighbors) {
    if ((n.x === FOYER_POS.x && n.y === FOYER_POS.y) ||
        (n.x === ATZIRI_POS.x && n.y === ATZIRI_POS.y)) {
      // FOYER is always in temple, ATZIRI is never
      if (n.x === FOYER_POS.x && n.y === FOYER_POS.y) {
        // Add constant 1 to RHS instead
        continue;
      }
    } else {
      archNeighborTerms.push({ var: inTempleVar(n.x, n.y), coef: 1 });
    }
  }
  const foyerNeighbor = archNeighbors.some(n => n.x === FOYER_POS.x && n.y === FOYER_POS.y);
  constraints.push({
    name: 'architect_one_neighbor',
    terms: archNeighborTerms,
    sense: '=',
    rhs: foyerNeighbor ? 0 : 1, // If FOYER is neighbor, it counts as 1 already
  });

  // --- Snake constraint: each cell in temple has at most 2 neighbors in temple ---
  // This prevents junctions/crosses and enforces a linear path
  for (let x = 1; x <= GRID_SIZE; x++) {
    for (let y = 1; y <= GRID_SIZE; y++) {
      // Skip fixed positions
      if ((x === FOYER_POS.x && y === FOYER_POS.y) ||
          (x === ATZIRI_POS.x && y === ATZIRI_POS.y) ||
          (x === architectPos.x && y === architectPos.y)) {
        continue;
      }

      const neighbors = getNeighbors(x, y);
      const neighborTerms: { var: string; coef: number }[] = [];
      let fixedNeighborCount = 0;

      for (const n of neighbors) {
        if (n.x === FOYER_POS.x && n.y === FOYER_POS.y) {
          fixedNeighborCount++; // FOYER always in temple
        } else if (n.x === architectPos.x && n.y === architectPos.y) {
          fixedNeighborCount++; // ARCHITECT always in temple
        } else if (n.x === ATZIRI_POS.x && n.y === ATZIRI_POS.y) {
          // ATZIRI not in temple, skip
        } else {
          neighborTerms.push({ var: inTempleVar(n.x, n.y), coef: 1 });
        }
      }

      // If this cell is in temple, it has at most 2 neighbors in temple
      // sum(neighbors in temple) <= 2 when in_temple[x,y] = 1
      // We use: sum(neighbors) - 2 * in_temple <= 2 - 2 = 0 doesn't work
      // Better: sum(neighbors) <= 2 + BIG_M * (1 - in_temple)
      // Rearranged: sum(neighbors) + BIG_M * in_temple <= 2 + BIG_M
      // Or simpler: if cell is not in temple, constraint is trivially satisfied
      // If cell IS in temple: sum(neighbors) <= 2
      // Use indicator: sum(neighbors) <= 2 + BIG_M * (1 - in_temple)
      // => sum(neighbors) - BIG_M + BIG_M * in_temple <= 2
      // => sum(neighbors) + BIG_M * in_temple <= 2 + BIG_M
      if (neighborTerms.length > 0) {
        constraints.push({
          name: `snake_${x}_${y}`,
          terms: [
            ...neighborTerms,
            { var: inTempleVar(x, y), coef: BIG_M },
          ],
          sense: '<=',
          rhs: 2 - fixedNeighborCount + BIG_M,
        });
      }
    }
  }

  // --- FOYER can have 1-2 neighbors (supports 1 or 2 chains) ---
  const foyerNeighbors = getNeighbors(FOYER_POS.x, FOYER_POS.y);
  const foyerNeighborTerms: { var: string; coef: number }[] = [];
  let foyerFixedNeighbors = 0;
  for (const n of foyerNeighbors) {
    if (n.x === architectPos.x && n.y === architectPos.y) {
      foyerFixedNeighbors++; // ARCHITECT always in temple
    } else if (n.x === ATZIRI_POS.x && n.y === ATZIRI_POS.y) {
      // ATZIRI not counted
    } else {
      foyerNeighborTerms.push({ var: inTempleVar(n.x, n.y), coef: 1 });
    }
  }
  // At least 1 neighbor
  constraints.push({
    name: 'foyer_min_neighbor',
    terms: foyerNeighborTerms,
    sense: '>=',
    rhs: 1 - foyerFixedNeighbors,
  });
  // At most 2 neighbors (for 2-chain layout)
  constraints.push({
    name: 'foyer_max_neighbor',
    terms: foyerNeighborTerms,
    sense: '<=',
    rhs: 2 - foyerFixedNeighbors,
  });

  // --- Lock existing rooms if configured ---
  if (config.lockExisting) {
    for (const [, room] of existingRooms) {
      const { x, y } = room.position;
      const typeIdx = ROOM_TYPE_TO_IDX[room.type];
      if (typeIdx === undefined) continue;

      // Force this room type
      constraints.push({
        name: `lock_room_${x}_${y}`,
        terms: [{ var: roomVar(x, y, typeIdx), coef: 1 }],
        sense: '=',
        rhs: 1,
      });

      // Force this tier
      constraints.push({
        name: `lock_tier_${x}_${y}`,
        terms: [{ var: tierVar(x, y, room.tier), coef: 1 }],
        sense: '=',
        rhs: 1,
      });
    }

    for (const key of existingPaths) {
      const [xs, ys] = key.split(',');
      const x = parseInt(xs);
      const y = parseInt(ys);

      constraints.push({
        name: `lock_path_${x}_${y}`,
        terms: [{ var: roomVar(x, y, PATH_IDX), coef: 1 }],
        sense: '=',
        rhs: 1,
      });
    }
  }

  // ==========================================================================
  // OBJECTIVE: Maximize room value
  // ==========================================================================

  // Set objective coefficients on room variables
  for (let x = 1; x <= GRID_SIZE; x++) {
    for (let y = 1; y <= GRID_SIZE; y++) {
      if ((x === FOYER_POS.x && y === FOYER_POS.y) ||
          (x === ATZIRI_POS.x && y === ATZIRI_POS.y) ||
          (x === architectPos.x && y === architectPos.y)) {
        continue;
      }

      // For simplicity, we use T3 values in objective
      // A more accurate model would use auxiliary variables for tier*value
      for (let t = 2; t < ROOM_TYPES.length; t++) {
        const roomType = ROOM_TYPES[t];
        const value = ROOM_VALUES[roomType]?.[2] ?? 0; // T3 value
        const v = variables.find(v => v.name === roomVar(x, y, t));
        if (v) {
          v.obj = value;
        }
      }
    }
  }

  // ==========================================================================
  // SOLVE
  // ==========================================================================

  const problem: MIPProblem = {
    name: 'temple',
    sense: 'maximize',
    variables,
    constraints,
  };

  console.log(`MIP: ${variables.length} variables, ${constraints.length} constraints`);

  // Filter out constraints with no terms (they cause HiGHS issues)
  const validConstraints = constraints.filter(c => c.terms.length > 0);
  console.log(`Valid constraints: ${validConstraints.length} (removed ${constraints.length - validConstraints.length} empty)`);

  const filteredProblem: MIPProblem = {
    ...problem,
    constraints: validConstraints,
  };

  const result = await solveMIP(filteredProblem, {
    timeLimit: config.maxTimeSeconds,
    verbose: true, // Enable verbose to debug
  });

  // ==========================================================================
  // EXTRACT SOLUTION
  // ==========================================================================

  const rooms: Room[] = [];
  const paths: Coord[] = [];

  if (result.status === 'Optimal' || result.status === 'Time limit reached') {
    for (let x = 1; x <= GRID_SIZE; x++) {
      for (let y = 1; y <= GRID_SIZE; y++) {
        if ((x === FOYER_POS.x && y === FOYER_POS.y) ||
            (x === ATZIRI_POS.x && y === ATZIRI_POS.y) ||
            (x === architectPos.x && y === architectPos.y)) {
          continue;
        }

        // Find which room type is selected
        let selectedType = -1;
        for (let t = 0; t < ROOM_TYPES.length; t++) {
          const val = result.variables[roomVar(x, y, t)] ?? 0;
          if (val > 0.5) {
            selectedType = t;
            break;
          }
        }

        if (selectedType === EMPTY_IDX) continue;

        // Find tier
        let selectedTier = 1;
        for (let k = 1; k <= 3; k++) {
          const val = result.variables[tierVar(x, y, k)] ?? 0;
          if (val > 0.5) {
            selectedTier = k;
            break;
          }
        }

        if (selectedType === PATH_IDX) {
          paths.push({ x, y });
        } else {
          rooms.push({
            type: ROOM_TYPES[selectedType] as Room['type'],
            tier: selectedTier as Room['tier'],
            position: { x, y },
          });
        }
      }
    }
  }

  return {
    success: result.status === 'Optimal' || result.status === 'Time limit reached',
    optimal: result.status === 'Optimal',
    score: Math.round(result.objectiveValue),
    rooms,
    paths,
    stats: {
      status: result.status,
      timeSeconds: result.timeSeconds ?? 0,
    },
    error: result.status === 'Infeasible' ? 'No feasible solution found' : undefined,
  };
}
