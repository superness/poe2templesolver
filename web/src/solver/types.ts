/**
 * Core type definitions for Temple Solver
 */

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

export type SpecialCellType = 'FOYER' | 'ATZIRI' | 'ARCHITECT' | 'EMPTY';

export type Tier = 1 | 2 | 3;

export interface Coord {
  x: number; // 1-9
  y: number; // 1-9
}

export interface Room {
  type: RoomType;
  tier: Tier;
  position: Coord;
}

export interface Edge {
  from: Coord;
  to: Coord;
}

export interface TempleState {
  architect: Coord;
  rooms: Room[];
  paths: Coord[];
  edges?: Edge[];  // Tree edges from solver
}

export interface SolverConfig {
  minSpymasters: number;
  minCorruptionChambers: number;
  maxPaths: number;
  snakeMode: boolean;
  maxEndpoints: number;
  maxTimeSeconds: number;
  lockExisting: boolean;
  // Snake mode tuning
  junctionPenalty: number;  // Points deducted per room with 3+ neighbors (0 = no penalty)
  maxNeighbors: number;     // Hard limit on neighbors per room (2 = strict snake, 4 = no limit)
  emptyPenalty: number;     // Points deducted per empty cell (encourages filling)
  // Room values
  roomValues?: RoomValues;  // Custom room values (optional, uses DEFAULT_ROOM_VALUES if not set)
  // Chain configurations
  chains?: ChainConfig[];   // Define what room types each branch should contain
}

// Preset chain configurations
export const CHAIN_PRESETS: Record<string, ChainConfig[]> = {
  'spymaster-focus': [
    {
      name: 'Spymaster Chain',
      roomTypes: ['SPYMASTER', 'GARRISON', 'LEGION_BARRACKS', 'COMMANDER'],
      roomCounts: { SPYMASTER: { min: 10, max: 12 } },
    },
    {
      name: 'Corruption Chain',
      roomTypes: ['CORRUPTION_CHAMBER', 'THAUMATURGE', 'SACRIFICIAL_CHAMBER', 'ALCHEMY_LAB'],
      roomCounts: { CORRUPTION_CHAMBER: { min: 4, max: 6 }, THAUMATURGE: { min: 2 } },
    },
  ],
  'golem-corruption': [
    {
      name: 'Spymaster Chain',
      roomTypes: ['SPYMASTER', 'GARRISON', 'LEGION_BARRACKS', 'COMMANDER'],
      roomCounts: { SPYMASTER: { min: 10, max: 11 } },
    },
    {
      name: 'Golem/Corruption Chain',
      roomTypes: ['GOLEM_WORKS', 'SMITHY', 'THAUMATURGE', 'CORRUPTION_CHAMBER', 'ALCHEMY_LAB', 'ARMOURY'],
      roomCounts: { GOLEM_WORKS: { min: 2 }, CORRUPTION_CHAMBER: { min: 3 }, THAUMATURGE: { min: 2 } },
      startingRoom: 'THAUMATURGE',
    },
    {
      name: 'Generator',
      roomTypes: ['GENERATOR'],
      roomCounts: { GENERATOR: { min: 1, max: 1 } },
      startingRoom: 'GENERATOR',
    },
  ],
  'balanced': [
    {
      name: 'Chain 1',
      roomTypes: ['SPYMASTER', 'GARRISON', 'LEGION_BARRACKS', 'COMMANDER', 'ARMOURY'],
      roomCounts: { SPYMASTER: { min: 4 } },
    },
    {
      name: 'Chain 2',
      roomTypes: ['CORRUPTION_CHAMBER', 'THAUMATURGE', 'SACRIFICIAL_CHAMBER', 'ALCHEMY_LAB'],
      roomCounts: { CORRUPTION_CHAMBER: { min: 3 } },
    },
    {
      name: 'Chain 3',
      roomTypes: ['GOLEM_WORKS', 'SMITHY', 'FLESH_SURGEON', 'SYNTHFLESH', 'GENERATOR'],
    },
  ],
};

export interface RoomWithChain extends Room {
  chain?: number;
}

export interface CoordWithChain extends Coord {
  chain?: number;
}

export interface SolverResult {
  success: boolean;
  optimal: boolean;
  score: number;
  rooms: RoomWithChain[];
  paths: CoordWithChain[];
  stats: {
    status: string;
    timeSeconds: number;
  };
  error?: string;
  chainNames?: string[];
}

// Room values by tier [T1, T2, T3]
export type RoomValues = Record<RoomType | 'EMPTY', [number, number, number]>;

// Chain configuration - defines what room types should be in each branch
export interface ChainConfig {
  name: string;
  roomTypes: RoomType[];  // Allowed room types for this chain
  minRooms?: number;      // Minimum total rooms in chain
  maxRooms?: number;      // Maximum total rooms in chain
  roomCounts?: Partial<Record<RoomType, { min?: number; max?: number }>>;  // Per-type min/max
  startingRoom?: RoomType;  // Optional: specific room to start the chain
}

export const DEFAULT_ROOM_VALUES: RoomValues = {
  EMPTY: [0, 0, 0],
  PATH: [1, 1, 1],
  GARRISON: [8, 12, 18],
  SPYMASTER: [20, 35, 50],
  COMMANDER: [12, 20, 35],
  ARMOURY: [10, 18, 28],
  ALCHEMY_LAB: [14, 24, 40],
  SMITHY: [12, 22, 38],
  CORRUPTION_CHAMBER: [25, 45, 70],
  SACRIFICIAL_CHAMBER: [30, 50, 80],
  THAUMATURGE: [15, 30, 50],
  GENERATOR: [10, 18, 30],
  GOLEM_WORKS: [8, 14, 22],
  FLESH_SURGEON: [15, 28, 45],
  SYNTHFLESH: [10, 18, 28],
  LEGION_BARRACKS: [12, 22, 35],
};

// Constants
export const GRID_SIZE = 9;
export const FOYER_POS: Coord = { x: 5, y: 1 };
export const ATZIRI_POS: Coord = { x: 5, y: 9 };

// Room type indices for solver
export const ROOM_TYPES = [
  'EMPTY',
  'PATH',
  'GARRISON',
  'SPYMASTER',
  'COMMANDER',
  'ARMOURY',
  'ALCHEMY_LAB',
  'SMITHY',
  'CORRUPTION_CHAMBER',
  'SACRIFICIAL_CHAMBER',
  'THAUMATURGE',
  'GENERATOR',
  'GOLEM_WORKS',
  'FLESH_SURGEON',
  'SYNTHFLESH',
  'LEGION_BARRACKS',
] as const;

export const ROOM_TYPE_TO_IDX: Record<string, number> = Object.fromEntries(
  ROOM_TYPES.map((name, idx) => [name, idx])
);

export const EMPTY_IDX = 0;
export const PATH_IDX = 1;

// Helper functions
export function coordKey(c: Coord): string {
  return `${c.x},${c.y}`;
}

export function parseCoordKey(key: string): Coord {
  const [x, y] = key.split(',').map(Number);
  return { x, y };
}

export function getNeighbors(x: number, y: number): Coord[] {
  const neighbors: Coord[] = [];
  if (y < GRID_SIZE) neighbors.push({ x, y: y + 1 });
  if (y > 1) neighbors.push({ x, y: y - 1 });
  if (x < GRID_SIZE) neighbors.push({ x: x + 1, y });
  if (x > 1) neighbors.push({ x: x - 1, y });
  return neighbors;
}
