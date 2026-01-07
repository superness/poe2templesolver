# POE2 Temple of Atziri - Full Solver Specification

## Problem Statement

**Given a player's current temple state, compute an optimal complete solution.**

This is a constraint satisfaction + optimization problem:
- **Constraints**: Room connection rules, no loops, single Architect connection
- **Optimization**: Maximize value (synergies, T3 rooms, high-value chambers) while minimizing destabilization risk

### What "Solve" Means

```
INPUT:
  - Current grid state (existing rooms, paths, locks)
  - Architect position
  - Player's available room pool (what they can potentially place)
  - Player's goals (reach Atziri? maximize Spymasters? protect specific rooms?)

OUTPUT:
  - Complete placement sequence from current state to goal
  - "Place Garrison at (4,2), then Commander at (4,3), then..."
  - Expected final temple value/score
  - Protection strategy (which rooms to lock and when)
```

---

## The Solving Challenge

### Why This Is Hard

1. **Massive state space**: 81 cells, 15+ room types, 3 tiers = enormous combinations
2. **Dependent decisions**: Placing room A affects what can go at positions B, C, D
3. **Connection constraints**: Not all rooms can connect to each other
4. **Loop prohibition**: Must maintain tree structure (no cycles)
5. **Path to goals**: Must connect Foyer → Architect → Atziri
6. **Synergy chaining**: Optimal requires planning multi-room synergy clusters
7. **Destabilization planning**: Must consider what survives after boss fights

### Solving Approaches

#### Approach A: Constraint Propagation + Backtracking Search
- Model as CSP (Constraint Satisfaction Problem)
- Use arc consistency to prune invalid placements
- Backtrack when stuck
- Good for: Finding ANY valid solution

#### Approach B: Heuristic Search (A* / Best-First)
- Define heuristic: estimated value to goal state
- Expand most promising states first
- Good for: Finding GOOD solutions quickly

#### Approach C: Monte Carlo Tree Search
- Random playouts to evaluate positions
- UCB1 for exploration/exploitation balance
- Good for: Large state spaces with unclear heuristics

#### Approach D: Dynamic Programming on DAG
- Temple is a DAG (directed acyclic graph) from Foyer
- Compute optimal subtrees bottom-up
- Good for: Optimal solutions when structure is clear

**Recommended: Hybrid of A + B** - CSP for validity, heuristic search for optimization

---

## Domain Model

### Grid Topology

```
     1   2   3   4   5   6   7   8   9
   +---+---+---+---+---+---+---+---+---+
 9 |   |   |   |   |ATZ|   |   |   |   |  ← Atziri (fixed, goal)
   +---+---+---+---+---+---+---+---+---+
 8 |   |   |   |   |   |   |   |   |   |
   +---+---+---+---+---+---+---+---+---+
 7 |   |   |   |   |   |   |   |   |   |
   +---+---+---+---+---+---+---+---+---+
 6 |   |   |   |   |   |   |   |   |   |
   +---+---+---+---+---+---+---+---+---+
 5 |   |   |   |   |   |   |   |   |   |
   +---+---+---+---+---+---+---+---+---+
 4 |   |   |   |   |   |   |ARC|   |   |  ← Architect (random, must reach)
   +---+---+---+---+---+---+---+---+---+
 3 |   |   |   |   |   |   |   |   |   |
   +---+---+---+---+---+---+---+---+---+
 2 |   |   |   |   |   |   |   |   |   |
   +---+---+---+---+---+---+---+---+---+
 1 |   |   |   |   |FOY|   |   |   |   |  ← Foyer (fixed, start)
   +---+---+---+---+---+---+---+---+---+

Adjacency: 4-connected (N/S/E/W only, no diagonals)
```

### Room Connection Matrix

This is the core constraint. Room A can connect to Room B only if allowed.

```typescript
const CONNECTION_RULES: Record<RoomType, RoomType[]> = {
  // Room Type         → Can connect to these types
  GARRISON:            ['PATH', 'COMMANDER', 'ARMOURY', 'SYNTHFLESH', 'SPYMASTER'],
  SPYMASTER:           ['GARRISON'],
  COMMANDER:           ['GARRISON', 'ARMOURY'],
  ARMOURY:             ['GARRISON', 'COMMANDER', 'ALCHEMY_LAB', 'THAUMATURGE'],
  ALCHEMY_LAB:         ['ARMOURY', 'THAUMATURGE', 'CORRUPTION_CHAMBER'],
  SMITHY:              ['ARMOURY', 'GOLEM_WORKS'],
  CORRUPTION_CHAMBER:  ['ALCHEMY_LAB', 'THAUMATURGE'],
  SACRIFICIAL_CHAMBER: ['GENERATOR', 'THAUMATURGE'],
  THAUMATURGE:         ['ARMOURY', 'ALCHEMY_LAB', 'CORRUPTION_CHAMBER', 'GENERATOR', 'SACRIFICIAL_CHAMBER'],
  GENERATOR:           ['PATH', 'THAUMATURGE', 'SACRIFICIAL_CHAMBER'],
  GOLEM_WORKS:         ['SMITHY', 'GENERATOR', 'SYNTHFLESH'],
  FLESH_SURGEON:       ['SYNTHFLESH'],
  SYNTHFLESH:          ['GARRISON', 'GOLEM_WORKS', 'FLESH_SURGEON'],
  LEGION_BARRACKS:     ['ARMOURY', 'SPYMASTER'],
  PATH:                ['*'],  // Paths connect to anything
};
```

### Synergy Upgrade Rules

When Room A is adjacent to Room B, Room A may upgrade in tier.

```typescript
const SYNERGY_UPGRADES: Record<RoomType, RoomType[]> = {
  // Room Type         → Upgrades when adjacent to these
  GARRISON:            ['COMMANDER', 'ARMOURY'],
  ARMOURY:             ['SMITHY', 'ALCHEMY_LAB'],
  SMITHY:              ['GOLEM_WORKS'],
  COMMANDER:           ['GARRISON'],  // Needs 3+ Garrisons for full upgrade
  THAUMATURGE:         ['SACRIFICIAL_CHAMBER', 'GENERATOR'],
  SYNTHFLESH:          ['FLESH_SURGEON'],
  LEGION_BARRACKS:     ['ARMOURY', 'SPYMASTER'],
  // Others don't upgrade via adjacency
};
```

### Special Constraints

```typescript
const SPECIAL_RULES = {
  // Commander blocks Spymaster placement downstream in the same chain
  COMMANDER_BLOCKS_SPYMASTER: true,

  // Generator powers rooms within range (affects tier bonuses)
  GENERATOR_POWER_RANGE: { T1: 3, T2: 4, T3: 5 },

  // Sacrificial Chamber is unique (only one per temple)
  UNIQUE_ROOMS: ['SACRIFICIAL_CHAMBER'],

  // Architect can only have exactly 1 room connection
  ARCHITECT_MAX_CONNECTIONS: 1,

  // Temple must be a tree (no cycles)
  NO_LOOPS: true,
};
```

### Victory Conditions ("Best Temple")

```typescript
const VICTORY_CONDITIONS = {
  MIN_SPYMASTERS: 8,
  MIN_CORRUPTION_CHAMBERS: 6,
  MAX_PATHS_PER_DIRECTION: 2,  // Max 2 paths going N, 2 going S, etc.
  ARCHITECT_CONNECTIONS: 1,     // Exactly 1
  NO_LOOPS: true,
};
```

---

## Solver Architecture

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            SOLVER PIPELINE                               │
│                                                                          │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐          │
│  │  State   │ => │  Goal    │ => │  Search  │ => │ Solution │          │
│  │  Input   │    │ Analysis │    │  Engine  │    │ Extractor│          │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘          │
│       │               │               │               │                  │
│       ▼               ▼               ▼               ▼                  │
│  Parse grid,    Determine what   Find optimal    Extract step-by-step   │
│  validate       needs to happen  path through    placement sequence     │
│  current state  to "win"         state space                            │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Core Components

#### 1. State Representation

```typescript
interface TempleState {
  grid: GridCell[][];           // 9x9 grid
  rooms: Map<string, Room>;     // roomId -> Room
  paths: Map<string, Path>;     // pathId -> Path
  connections: Graph;           // Adjacency graph
  architect: Coord;
  locks: Set<string>;           // Locked room IDs

  // Derived (cached)
  connectedToFoyer: Set<string>;
  connectedToArchitect: Set<string>;
  hasLoops: boolean;
  chainTips: Coord[];           // Endpoints of chains
}

interface GridCell {
  position: Coord;
  content: Room | Path | 'FOYER' | 'ATZIRI' | 'ARCHITECT' | null;
}
```

#### 2. Goal Specification

```typescript
interface SolverGoal {
  // Required objectives
  reachArchitect: boolean;      // Must connect Foyer to Architect
  reachAtziri: boolean;         // Must connect Architect to Atziri

  // Optimization targets
  maximizeSpymasters: boolean;
  maximizeCorruption: boolean;
  maximizeSynergies: boolean;
  minimizePaths: boolean;

  // Constraints
  protectRooms: string[];       // Room IDs that must survive destabilization
  avoidRoomTypes: RoomType[];   // Don't use these room types

  // Victory condition
  achieveBestTemple: boolean;   // Meet all victory conditions
}
```

#### 3. Search State

```typescript
interface SearchNode {
  state: TempleState;
  parent: SearchNode | null;
  action: PlacementAction | null;  // Action that led to this state
  depth: number;
  cost: number;                    // g(n) - cost so far
  heuristic: number;               // h(n) - estimated cost to goal
  priority: number;                // f(n) = g(n) + h(n)
}

interface PlacementAction {
  type: 'PLACE_ROOM' | 'PLACE_PATH' | 'LOCK_ROOM';
  roomType?: RoomType;
  tier?: 1 | 2 | 3;
  position: Coord;
  connections: Coord[];
}
```

#### 4. Constraint Checker

```typescript
class ConstraintChecker {
  // Check if a placement is legal
  isValidPlacement(state: TempleState, action: PlacementAction): ValidationResult;

  // Check specific constraints
  checkConnectionRules(room: RoomType, adjacentRooms: RoomType[]): boolean;
  checkNoLoop(state: TempleState, newConnections: Coord[]): boolean;
  checkArchitectLimit(state: TempleState, position: Coord): boolean;
  checkUniqueRooms(state: TempleState, roomType: RoomType): boolean;
  checkCommanderBlocking(state: TempleState, position: Coord): boolean;

  // Get all valid placements from current state
  getValidActions(state: TempleState, availableRooms: RoomPool): PlacementAction[];
}
```

#### 5. Heuristic Evaluator

```typescript
class HeuristicEvaluator {
  // Estimate cost/value to reach goal from current state
  evaluate(state: TempleState, goal: SolverGoal): number;

  // Component heuristics
  distanceToArchitect(state: TempleState): number;
  distanceToAtziri(state: TempleState): number;
  synergyPotential(state: TempleState): number;
  destabilizationRisk(state: TempleState): number;
  victoryProgress(state: TempleState): number;
}
```

#### 6. Search Engine

```typescript
class TempleSolver {
  solve(
    initialState: TempleState,
    availableRooms: RoomPool,
    goal: SolverGoal,
    options: SolverOptions
  ): Solution;
}

interface SolverOptions {
  maxIterations: number;        // Prevent infinite search
  maxTime: number;              // Time limit in ms
  strategy: 'OPTIMAL' | 'FAST' | 'BALANCED';
  pruneAggressive: boolean;     // Trade optimality for speed
}

interface Solution {
  found: boolean;
  actions: PlacementAction[];   // Ordered sequence of placements
  finalState: TempleState;
  stats: {
    nodesExplored: number;
    timeTaken: number;
    optimalityGuarantee: boolean;
  };
  explanation: string[];        // Human-readable explanation
}
```

---

## Search Algorithm

### A* with Domain-Specific Heuristics

```typescript
function solve(initial: TempleState, rooms: RoomPool, goal: SolverGoal): Solution {
  const openSet = new PriorityQueue<SearchNode>();
  const closedSet = new Set<string>();  // State hashes

  const startNode: SearchNode = {
    state: initial,
    parent: null,
    action: null,
    depth: 0,
    cost: 0,
    heuristic: evaluateHeuristic(initial, goal),
    priority: evaluateHeuristic(initial, goal),
  };

  openSet.push(startNode);

  while (!openSet.isEmpty()) {
    const current = openSet.pop();

    // Goal test
    if (isGoalState(current.state, goal)) {
      return extractSolution(current);
    }

    const stateHash = hashState(current.state);
    if (closedSet.has(stateHash)) continue;
    closedSet.add(stateHash);

    // Expand node
    const validActions = getValidActions(current.state, rooms);

    for (const action of validActions) {
      const newState = applyAction(current.state, action);
      const newCost = current.cost + actionCost(action);
      const newHeuristic = evaluateHeuristic(newState, goal);

      const childNode: SearchNode = {
        state: newState,
        parent: current,
        action: action,
        depth: current.depth + 1,
        cost: newCost,
        heuristic: newHeuristic,
        priority: newCost + newHeuristic,
      };

      openSet.push(childNode);
    }
  }

  return { found: false, actions: [], /* ... */ };
}
```

### Heuristic Function

The heuristic must be **admissible** (never overestimate) for A* optimality.

```typescript
function evaluateHeuristic(state: TempleState, goal: SolverGoal): number {
  let h = 0;

  // H1: Minimum rooms needed to reach Architect
  if (goal.reachArchitect && !state.connectedToArchitect.size) {
    const distToArch = manhattanDistance(nearestChainTip(state), state.architect);
    h += distToArch;  // At minimum, need this many placements
  }

  // H2: Minimum rooms needed to reach Atziri
  if (goal.reachAtziri && !isConnectedToAtziri(state)) {
    const distToAtziri = manhattanDistance(state.architect, ATZIRI_POS);
    h += distToAtziri;
  }

  // H3: Spymaster deficit
  if (goal.achieveBestTemple) {
    const spymasterCount = countRoomType(state, 'SPYMASTER');
    const deficit = Math.max(0, VICTORY_CONDITIONS.MIN_SPYMASTERS - spymasterCount);
    h += deficit * 2;  // Each Spymaster needs at least 2 rooms (itself + Garrison)
  }

  // H4: Corruption chamber deficit
  if (goal.achieveBestTemple) {
    const corruptionCount = countRoomType(state, 'CORRUPTION_CHAMBER');
    const deficit = Math.max(0, VICTORY_CONDITIONS.MIN_CORRUPTION_CHAMBERS - corruptionCount);
    h += deficit * 3;  // Corruption chains are longer
  }

  return h;
}
```

### State Hashing (for duplicate detection)

```typescript
function hashState(state: TempleState): string {
  // Create canonical representation
  const cells: string[] = [];

  for (let y = 1; y <= 9; y++) {
    for (let x = 1; x <= 9; x++) {
      const cell = state.grid[y-1][x-1];
      if (cell.content === null) {
        cells.push('_');
      } else if (cell.content === 'FOYER' || cell.content === 'ATZIRI' || cell.content === 'ARCHITECT') {
        cells.push(cell.content[0]);
      } else if ('type' in cell.content) {
        cells.push(`${cell.content.type[0]}${cell.content.tier}`);
      } else {
        cells.push('P');  // Path
      }
    }
  }

  return cells.join('');
}
```

---

## Optimizations

### 1. Symmetry Breaking

The grid has vertical symmetry. If we're building from Foyer (5,1), placements to (4,2) and (6,2) are often equivalent. Prune symmetric states.

```typescript
function isSymmetricDuplicate(state: TempleState, closedSet: Set<string>): boolean {
  const mirroredHash = hashState(mirrorState(state));
  return closedSet.has(mirroredHash);
}
```

### 2. Constraint Propagation

Before searching, propagate constraints to reduce branching factor.

```typescript
function propagateConstraints(state: TempleState, rooms: RoomPool): RoomPool {
  // If we need 8 Spymasters and have 3, we MUST place 5 more
  // Spymasters can ONLY connect to Garrisons
  // Therefore we need at least 5 Garrisons available

  // If Commander is in chain, Spymaster cannot be downstream
  // Prune Spymaster from available rooms for those positions

  // etc.
}
```

### 3. Iterative Deepening

For fast "good enough" solutions:

```typescript
function iterativeDeepeningSolve(initial: TempleState, goal: SolverGoal): Solution {
  for (let maxDepth = 10; maxDepth <= 50; maxDepth += 5) {
    const solution = depthLimitedSearch(initial, goal, maxDepth);
    if (solution.found) return solution;
  }
  return { found: false, /* ... */ };
}
```

### 4. Beam Search

Keep only top-K most promising states at each depth:

```typescript
function beamSearch(initial: TempleState, goal: SolverGoal, beamWidth: number): Solution {
  let beam = [initial];

  while (!beam.some(s => isGoalState(s, goal))) {
    const candidates = beam.flatMap(s => expandState(s));
    candidates.sort((a, b) => evaluate(b) - evaluate(a));
    beam = candidates.slice(0, beamWidth);
  }

  return extractSolution(beam.find(s => isGoalState(s, goal)));
}
```

---

## Room Pool Modeling

The player doesn't have infinite rooms. Model what's available:

```typescript
interface RoomPool {
  // Available room cards by type and tier
  available: Map<RoomType, { tier: 1 | 2 | 3; count: number }[]>;

  // Unlimited paths (usually)
  unlimitedPaths: boolean;

  // Methods
  hasRoom(type: RoomType, tier?: number): boolean;
  takeRoom(type: RoomType, tier: number): boolean;  // Decrements count
  returnRoom(type: RoomType, tier: number): void;   // For backtracking
}
```

### Input Modes

1. **Exact inventory**: Player specifies exactly what cards they have
2. **Unlimited mode**: Assume player can get any room (for planning)
3. **Probabilistic**: Model expected rooms based on drop rates

---

## Output Format

### Solution Structure

```typescript
interface CompleteSolution {
  // Step-by-step instructions
  steps: SolutionStep[];

  // Final temple state
  finalTemple: TempleState;

  // Metrics
  metrics: {
    totalRooms: number;
    totalPaths: number;
    spymasterCount: number;
    corruptionCount: number;
    t3RoomCount: number;
    estimatedValue: number;
    meetsVictoryConditions: boolean;
  };

  // Human-readable summary
  summary: string;
}

interface SolutionStep {
  stepNumber: number;
  action: 'PLACE' | 'LOCK';
  roomType: RoomType | 'PATH';
  tier?: 1 | 2 | 3;
  position: Coord;
  connectsTo: Coord[];

  // Explanation
  reason: string;
  synergiesActivated: string[];
  warnings: string[];
}
```

### Example Output

```
=== TEMPLE SOLUTION ===

Starting from current state with 4 rooms placed.
Goal: Reach Atziri with Best Temple conditions.

Step 1: Place GARRISON (T1) at (4, 2)
        Connects to: Foyer (5, 1)
        Reason: Establishes western chain for Spymaster network

Step 2: Place SPYMASTER (T1) at (3, 2)
        Connects to: Garrison (4, 2)
        Reason: First Spymaster, generates medallions

Step 3: Place GARRISON (T1) at (4, 3)
        Connects to: Garrison (4, 2)
        Synergy: Garrison at (4,2) upgrades to T2

Step 4: Place COMMANDER (T1) at (4, 4)
        Connects to: Garrison (4, 3)
        Synergy: Garrison at (4,3) upgrades to T2
        Warning: Blocks Spymaster downstream on this chain

... (continues) ...

Step 23: Place PATH at (6, 4)
         Connects to: Architect (7, 4)
         Reason: Final connection to Architect

=== FINAL METRICS ===
Total Rooms: 19
Total Paths: 4
Spymasters: 8 ✓
Corruption Chambers: 6 ✓
Loops: None ✓
Architect Connections: 1 ✓

VERDICT: Best Temple achieved!
```

---

## Implementation Phases

### Phase 1: Core Domain
- [ ] Room type definitions with connection rules
- [ ] Synergy upgrade rules
- [ ] Grid and state data structures
- [ ] Constraint validation functions
- [ ] Unit tests for all rules

### Phase 2: State Management
- [ ] State creation and cloning
- [ ] Action application (place room, place path, lock)
- [ ] State hashing for duplicate detection
- [ ] Connectivity analysis (BFS from Foyer)
- [ ] Loop detection

### Phase 3: Search Infrastructure
- [ ] Priority queue implementation
- [ ] Search node structure
- [ ] Action enumeration (get all valid placements)
- [ ] Basic BFS/DFS search

### Phase 4: Heuristics & A*
- [ ] Heuristic function components
- [ ] A* search implementation
- [ ] Solution extraction from search tree

### Phase 5: Optimizations
- [ ] Symmetry breaking
- [ ] Constraint propagation
- [ ] Beam search alternative
- [ ] Performance benchmarking

### Phase 6: User Interface
- [ ] CLI input for temple state
- [ ] CLI input for room pool
- [ ] Solution output formatting
- [ ] Interactive mode ("what if I place X here?")

### Phase 7: Advanced Features
- [ ] Multiple goal profiles (speed, completionist, etc.)
- [ ] Destabilization survival analysis
- [ ] Lock strategy recommendations
- [ ] Partial solutions (when full solution impossible)

---

## File Structure

```
poe2-temple-solver/
├── src/
│   ├── domain/
│   │   ├── types.ts              # Core type definitions
│   │   ├── room-rules.ts         # Connection & synergy rules
│   │   ├── constants.ts          # Victory conditions, grid size
│   │   └── index.ts
│   ├── state/
│   │   ├── temple-state.ts       # State representation
│   │   ├── grid.ts               # Grid operations
│   │   ├── graph.ts              # Connection graph
│   │   ├── state-hash.ts         # State hashing
│   │   └── index.ts
│   ├── constraints/
│   │   ├── connection-checker.ts # Room connection validation
│   │   ├── loop-detector.ts      # Cycle detection
│   │   ├── special-rules.ts      # Commander blocking, etc.
│   │   ├── validator.ts          # Combined validation
│   │   └── index.ts
│   ├── solver/
│   │   ├── search-node.ts        # Search tree node
│   │   ├── heuristics.ts         # Heuristic functions
│   │   ├── action-generator.ts   # Valid action enumeration
│   │   ├── astar.ts              # A* search implementation
│   │   ├── beam-search.ts        # Beam search alternative
│   │   ├── solver.ts             # Main solver interface
│   │   └── index.ts
│   ├── io/
│   │   ├── state-parser.ts       # Parse temple state from input
│   │   ├── solution-formatter.ts # Format solution for output
│   │   └── index.ts
│   ├── cli/
│   │   ├── commands.ts           # CLI commands
│   │   ├── interactive.ts        # Interactive mode
│   │   └── index.ts
│   └── index.ts                  # Library entry point
├── tests/
│   ├── domain/
│   ├── state/
│   ├── constraints/
│   ├── solver/
│   └── integration/
├── examples/
│   ├── sample-temples/           # Example temple states
│   └── sample-solutions/         # Expected solutions
├── package.json
├── tsconfig.json
└── README.md
```

---

## Success Criteria

1. **Correctness**: Solutions are valid (no rule violations)
2. **Completeness**: Finds solution if one exists
3. **Optimality**: Solutions are near-optimal for value
4. **Performance**: Solves typical temples in <30 seconds
5. **Usability**: Clear input format, actionable output

---

## Open Questions

1. **How do players input their temple state?**
   - JSON file? Interactive grid editor? Screenshot parsing?

2. **What room pool assumptions?**
   - Player specifies exact cards? Or "unlimited planning mode"?

3. **Multi-objective optimization?**
   - How to balance Spymasters vs Corruption vs speed?

4. **Partial solutions?**
   - If Best Temple impossible, what's the "best achievable" state?

---

*This specification frames the POE2 Temple solver as a constraint satisfaction + search optimization problem. The solver finds a complete, optimal placement sequence given current state and available resources.*
