/**
 * Core type definitions for POE2 Temple of Atziri Solver
 */

// Room type enumeration
export type RoomType =
  | 'GARRISON'
  | 'SPYMASTER'
  | 'COMMANDER'
  | 'ARMOURY'
  | 'ALCHEMY_LAB'
  | 'SMITHY'
  | 'CORRUPTION_CHAMBER'
  | 'SACRIFICIAL_CHAMBER'
  | 'THAUMATURGE'
  | 'GENERATOR'
  | 'GOLEM_WORKS'
  | 'FLESH_SURGEON'
  | 'SYNTHFLESH'
  | 'LEGION_BARRACKS'
  | 'PATH';

// Special cell types
export type SpecialCellType = 'FOYER' | 'ATZIRI' | 'ARCHITECT' | 'EMPTY';

// Room tier (1-3)
export type Tier = 1 | 2 | 3;

// Coordinate on the grid
export interface Coord {
  x: number; // 1-9 (column)
  y: number; // 1-9 (row)
}

// A placed room
export interface Room {
  id: string;
  type: RoomType;
  tier: Tier;
  position: Coord;
  locked: boolean;
}

// A path tile
export interface Path {
  id: string;
  position: Coord;
}

// Grid cell content
export type CellContent = Room | Path | SpecialCellType;

// Grid cell
export interface GridCell {
  position: Coord;
  content: CellContent | null;
}

// Available rooms pool
export interface RoomPool {
  available: Map<RoomType, { tier: Tier; count: number }[]>;
  unlimitedPaths: boolean;
}

// Solver goal specification
export interface SolverGoal {
  reachArchitect: boolean;
  reachAtziri: boolean;
  maximizeSpymasters: boolean;
  maximizeCorruption: boolean;
  maximizeSynergies: boolean;
  minimizePaths: boolean;
  protectRooms: string[];
  avoidRoomTypes: RoomType[];
  achieveBestTemple: boolean;

  // Configurable room count requirements (overrides defaults when set)
  minSpymasters?: number;
  minCorruptionChambers?: number;

  // Configurable room count targets for any room type
  roomRequirements?: { type: RoomType; minCount: number }[];
}

// Placement action
export interface PlacementAction {
  type: 'PLACE_ROOM' | 'PLACE_PATH' | 'LOCK_ROOM';
  roomType?: RoomType;
  tier?: Tier;
  position: Coord;
  connections: Coord[];
}

// Validation result
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// Solution step with explanation
export interface SolutionStep {
  stepNumber: number;
  action: 'PLACE' | 'LOCK';
  roomType: RoomType | 'PATH';
  tier?: Tier;
  position: Coord;
  connectsTo: Coord[];
  reason: string;
  synergiesActivated: string[];
  warnings: string[];
}

// Search statistics
export interface SearchStats {
  nodesExplored: number;
  timeTaken: number;
  optimalityGuarantee: boolean;
}

// Temple metrics
export interface TempleMetrics {
  totalRooms: number;
  totalPaths: number;
  spymasterCount: number;
  corruptionCount: number;
  t3RoomCount: number;
  estimatedValue: number;
  meetsVictoryConditions: boolean;
  // Target requirements for display
  targetSpymasters?: number;
  targetCorruptionChambers?: number;
}

// Solver options
export interface SolverOptions {
  maxIterations: number;
  maxTime: number;
  strategy: 'OPTIMAL' | 'FAST' | 'BALANCED';
  pruneAggressive: boolean;
}

// Complete solution (TempleState imported from state module)
export interface Solution {
  found: boolean;
  actions: PlacementAction[];
  steps: SolutionStep[];
  finalState: any; // TempleState - using any to avoid circular dependency
  metrics: TempleMetrics;
  stats: SearchStats;
  summary: string;
  excludedRooms?: { type: string; tier: number; x: number; y: number }[];
}

// TempleState is defined in state/temple-state.ts to avoid circular dependencies
// Import from there when needed

// Helper type for coordinate key
export function coordKey(c: Coord): string {
  return `${c.x},${c.y}`;
}

export function parseCoordKey(key: string): Coord {
  const [x, y] = key.split(',').map(Number);
  return { x, y };
}

export function coordsEqual(a: Coord, b: Coord): boolean {
  return a.x === b.x && a.y === b.y;
}

export function manhattanDistance(a: Coord, b: Coord): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function getAdjacentCoords(c: Coord): Coord[] {
  const adjacent: Coord[] = [];
  if (c.y < 9) adjacent.push({ x: c.x, y: c.y + 1 }); // North
  if (c.y > 1) adjacent.push({ x: c.x, y: c.y - 1 }); // South
  if (c.x < 9) adjacent.push({ x: c.x + 1, y: c.y }); // East
  if (c.x > 1) adjacent.push({ x: c.x - 1, y: c.y }); // West
  return adjacent;
}
