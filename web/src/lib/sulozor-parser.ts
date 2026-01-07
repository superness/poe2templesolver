/**
 * Sulozor URL Parser and Exporter
 * Standalone version for web app
 */

import type { Coord, Room, TempleState, Tier } from '../solver/types';
import { GRID_SIZE } from '../solver/types';

// Sulozor room index mapping (5 bits = 0-31)
const SULOZOR_ROOM_INDEX: Record<number, string> = {
  0: 'empty',
  1: 'path',
  2: 'guardhouse',
  3: 'transcendent_barrack',
  4: 'legion_barrack',
  5: 'commanders_chamber',
  6: 'armoury',
  7: 'bronzeworks',
  8: 'dynamo',
  9: 'spymasters_study',
  10: 'synthflesh_lab',
  11: 'surgeons_ward',
  12: 'workshop',
  13: 'chamber_of_souls',
  14: 'thaumaturges_laboratory',
  15: 'crimson_hall',
  16: 'altar_of_sacrifice',
  17: 'reward_room',
  18: 'sealed_vault',
  19: 'architect',
  20: 'sacrifice_room',
};

// Map Sulozor room names to our RoomType
const SULOZOR_TO_ROOMTYPE: Record<string, string> = {
  empty: 'EMPTY',
  path: 'PATH',
  guardhouse: 'GARRISON',
  transcendent_barrack: 'LEGION_BARRACKS',
  legion_barrack: 'LEGION_BARRACKS',
  commanders_chamber: 'COMMANDER',
  armoury: 'ARMOURY',
  bronzeworks: 'SMITHY',
  dynamo: 'GENERATOR',
  spymasters_study: 'SPYMASTER',
  synthflesh_lab: 'SYNTHFLESH',
  surgeons_ward: 'FLESH_SURGEON',
  workshop: 'GOLEM_WORKS',
  chamber_of_souls: 'ALCHEMY_LAB',
  thaumaturges_laboratory: 'THAUMATURGE',
  crimson_hall: 'CORRUPTION_CHAMBER',
  altar_of_sacrifice: 'SACRIFICIAL_CHAMBER',
  reward_room: 'EMPTY',
  sealed_vault: 'EMPTY',
  architect: 'ARCHITECT',
  sacrifice_room: 'SACRIFICIAL_CHAMBER',
};

// Reverse mapping for export
const ROOMTYPE_TO_SULOZOR_INDEX: Record<string, number> = {
  EMPTY: 0,
  PATH: 1,
  GARRISON: 2,
  LEGION_BARRACKS: 4,
  COMMANDER: 5,
  ARMOURY: 6,
  SMITHY: 7,
  GENERATOR: 8,
  SPYMASTER: 9,
  SYNTHFLESH: 10,
  FLESH_SURGEON: 11,
  GOLEM_WORKS: 12,
  ALCHEMY_LAB: 13,
  THAUMATURGE: 14,
  CORRUPTION_CHAMBER: 15,
  SACRIFICIAL_CHAMBER: 16,
  ARCHITECT: 19,
};

// Base64URL alphabet
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_DECODE: Record<string, number> = {};
for (let i = 0; i < B64.length; i++) {
  B64_DECODE[B64[i]] = i;
}

function fromBase64Url(str: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i += 4) {
    const c0 = B64_DECODE[str[i]] ?? 0;
    const c1 = B64_DECODE[str[i + 1]] ?? 0;
    const c2 = B64_DECODE[str[i + 2]] ?? 0;
    const c3 = B64_DECODE[str[i + 3]] ?? 0;

    bytes.push((c0 << 2) | (c1 >> 4));
    if (str[i + 2] !== undefined) bytes.push(((c1 << 4) | (c2 >> 2)) & 0xff);
    if (str[i + 3] !== undefined) bytes.push(((c2 << 6) | c3) & 0xff);
  }
  return bytes;
}

function toBase64Url(bytes: number[]): string {
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;

    result += B64[(b0 >> 2) & 0x3f];
    result += B64[((b0 << 4) | (b1 >> 4)) & 0x3f];
    if (i + 1 < bytes.length) result += B64[((b1 << 2) | (b2 >> 6)) & 0x3f];
    if (i + 2 < bytes.length) result += B64[b2 & 0x3f];
  }
  return result;
}

function unpackSulozorCell(byte: number): { room: string; tier: Tier } {
  const roomIdx = (byte >> 3) & 0x1f;
  const tierIdx = byte & 0x7;
  return {
    room: SULOZOR_ROOM_INDEX[roomIdx] || 'empty',
    tier: Math.max(1, Math.min(3, tierIdx + 1)) as Tier,
  };
}

function packSulozorCell(roomType: string | null, tier: number): number {
  const roomIdx = roomType ? (ROOMTYPE_TO_SULOZOR_INDEX[roomType] ?? 0) : 0;
  const tierIdx = Math.max(0, Math.min(7, tier - 1));
  return (roomIdx << 3) | tierIdx;
}

export interface ParseResult {
  state: TempleState;
  warnings: string[];
}

/**
 * Parse a Sulozor temple planner URL
 */
export function parseSulozorUrl(url: string): ParseResult {
  const warnings: string[] = [];

  // Extract the 't' parameter
  let encoded: string | null = null;
  try {
    const urlObj = new URL(url);
    encoded = urlObj.searchParams.get('t');
  } catch {
    // Try to extract t= directly if URL parsing fails
    const match = url.match(/[?&]t=([^&#]+)/);
    encoded = match ? match[1] : null;
  }

  if (!encoded) {
    throw new Error('No temple data found in URL (missing t= parameter)');
  }

  const bytes = fromBase64Url(encoded);

  if (bytes.length < 2) {
    throw new Error('Invalid URL data: too short');
  }

  const cellBytes = bytes.slice(1, 1 + GRID_SIZE * GRID_SIZE);

  // Find architect position
  let architectPos: Coord = { x: 5, y: 5 };
  for (let cellIdx = 0; cellIdx < cellBytes.length; cellIdx++) {
    const byte = cellBytes[cellIdx] ?? 0;
    const { room } = unpackSulozorCell(byte);
    if (room === 'architect') {
      const y = GRID_SIZE - Math.floor(cellIdx / GRID_SIZE);
      const x = (cellIdx % GRID_SIZE) + 1;
      architectPos = { x, y };
      break;
    }
  }

  const rooms: Room[] = [];
  const paths: Coord[] = [];

  // Parse all cells
  for (let cellIdx = 0; cellIdx < cellBytes.length; cellIdx++) {
    const byte = cellBytes[cellIdx] ?? 0;
    const { room, tier } = unpackSulozorCell(byte);
    const y = GRID_SIZE - Math.floor(cellIdx / GRID_SIZE);
    const x = (cellIdx % GRID_SIZE) + 1;
    const position = { x, y };

    // Skip fixed positions (only FOYER at 5,1 - position 5,9 is a regular cell!)
    if (x === 5 && y === 1) continue;
    if (x === architectPos.x && y === architectPos.y) continue;

    const roomType = SULOZOR_TO_ROOMTYPE[room];
    if (!roomType || roomType === 'EMPTY' || roomType === 'ARCHITECT') continue;

    if (roomType === 'PATH') {
      paths.push(position);
    } else {
      rooms.push({
        type: roomType as Room['type'],
        tier,
        position,
      });
    }
  }

  // Parse edges from the remaining bytes (20 bytes = 160 bits)
  const edges: { from: Coord; to: Coord }[] = [];
  const edgeStartIdx = 1 + GRID_SIZE * GRID_SIZE; // After version byte and cell bytes
  const edgeBytes = bytes.slice(edgeStartIdx, edgeStartIdx + 20);

  if (edgeBytes.length >= 20) {
    // Convert bytes to bits
    const edgeBits: number[] = [];
    for (const byte of edgeBytes) {
      for (let j = 7; j >= 0; j--) {
        edgeBits.push((byte >> j) & 1);
      }
    }

    // First 72 bits: vertical edges (between rows), 9 edges per row gap × 8 row gaps
    let bitIdx = 0;
    for (let y = 9; y >= 2; y--) {
      for (let x = 1; x <= 9; x++) {
        if (edgeBits[bitIdx]) {
          edges.push({
            from: { x, y },
            to: { x, y: y - 1 },
          });
        }
        bitIdx++;
      }
    }

    // Next 72 bits: horizontal edges (between cols), 8 edges per row × 9 rows
    for (let y = 9; y >= 1; y--) {
      for (let x = 1; x <= 8; x++) {
        if (edgeBits[bitIdx]) {
          edges.push({
            from: { x, y },
            to: { x: x + 1, y },
          });
        }
        bitIdx++;
      }
    }
  }

  warnings.push(`Imported ${rooms.length} rooms, ${paths.length} paths, and ${edges.length} edges`);

  return {
    state: { architect: architectPos, rooms, paths, edges },
    warnings,
  };
}

/**
 * Export temple state to Sulozor URL
 */
export function exportToSulozorUrl(state: TempleState): string {
  const cellBytes: number[] = [];
  const versionByte = 0;

  // Create a lookup for quick room/path finding
  const roomMap = new Map<string, Room>();
  const pathSet = new Set<string>();

  for (const room of state.rooms) {
    roomMap.set(`${room.position.x},${room.position.y}`, room);
  }
  for (const path of state.paths) {
    pathSet.add(`${path.x},${path.y}`);
  }

  // Pack cells top-to-bottom (y=9 to y=1)
  for (let y = GRID_SIZE; y >= 1; y--) {
    for (let x = 1; x <= GRID_SIZE; x++) {
      const key = `${x},${y}`;

      if (x === state.architect.x && y === state.architect.y) {
        cellBytes.push(packSulozorCell('ARCHITECT', 1));
      } else if (x === 5 && y === 1) {
        // Foyer - encode as PATH
        cellBytes.push(packSulozorCell('PATH', 1));
      } else if (roomMap.has(key)) {
        // Position (5,9) is a regular cell - no special handling!
        const room = roomMap.get(key)!;
        cellBytes.push(packSulozorCell(room.type, room.tier));
      } else if (pathSet.has(key)) {
        cellBytes.push(packSulozorCell('PATH', 1));
      } else {
        cellBytes.push(packSulozorCell(null, 1));
      }
    }
  }

  // Build edge set - generate ALL valid connections between adjacent rooms
  // (not just tree edges, but all rooms that CAN connect)
  const edgeSet = new Set<string>();

  // Valid adjacency rules (which room types can connect)
  const VALID_ADJACENCY: Record<string, Set<string>> = {
    GARRISON: new Set(['COMMANDER', 'ARMOURY', 'SPYMASTER', 'SYNTHFLESH', 'PATH']),
    LEGION_BARRACKS: new Set(['COMMANDER', 'ARMOURY', 'SPYMASTER', 'PATH']),
    COMMANDER: new Set(['GARRISON', 'LEGION_BARRACKS', 'PATH']),
    SPYMASTER: new Set(['GARRISON', 'LEGION_BARRACKS', 'PATH']),
    ARMOURY: new Set(['GARRISON', 'LEGION_BARRACKS', 'SMITHY', 'ALCHEMY_LAB', 'PATH']),
    SMITHY: new Set(['ARMOURY', 'GOLEM_WORKS', 'PATH']),
    GOLEM_WORKS: new Set(['SMITHY', 'PATH']),
    GENERATOR: new Set(['THAUMATURGE', 'SACRIFICIAL_CHAMBER', 'PATH']),
    SYNTHFLESH: new Set(['GARRISON', 'FLESH_SURGEON', 'PATH']),
    FLESH_SURGEON: new Set(['SYNTHFLESH', 'PATH']),
    ALCHEMY_LAB: new Set(['ARMOURY', 'THAUMATURGE', 'PATH']),
    THAUMATURGE: new Set(['ALCHEMY_LAB', 'SACRIFICIAL_CHAMBER', 'CORRUPTION_CHAMBER', 'GENERATOR', 'PATH']),
    CORRUPTION_CHAMBER: new Set(['THAUMATURGE', 'SACRIFICIAL_CHAMBER', 'PATH']),
    SACRIFICIAL_CHAMBER: new Set(['THAUMATURGE', 'CORRUPTION_CHAMBER', 'GENERATOR', 'PATH']),
    PATH: new Set(['GARRISON', 'LEGION_BARRACKS', 'COMMANDER', 'SPYMASTER', 'ARMOURY', 'SMITHY', 'GOLEM_WORKS',
                   'GENERATOR', 'SYNTHFLESH', 'FLESH_SURGEON', 'ALCHEMY_LAB', 'THAUMATURGE',
                   'CORRUPTION_CHAMBER', 'SACRIFICIAL_CHAMBER', 'PATH']),
  };

  const canConnect = (typeA: string | null, typeB: string | null): boolean => {
    if (!typeA || !typeB) return false;
    if (typeA === 'EMPTY' || typeB === 'EMPTY') return false;
    const adjSet = VALID_ADJACENCY[typeA];
    return adjSet ? adjSet.has(typeB) : false;
  };

  // Build a map of room types at each position
  const typeAt = new Map<string, string>();
  for (const room of state.rooms) {
    typeAt.set(`${room.position.x},${room.position.y}`, room.type);
  }
  for (const path of state.paths) {
    typeAt.set(`${path.x},${path.y}`, 'PATH');
  }
  // Add architect and foyer as PATH for connection purposes
  typeAt.set(`${state.architect.x},${state.architect.y}`, 'PATH');
  typeAt.set('5,1', 'PATH'); // FOYER

  // Check all adjacent pairs and add edges where rooms can connect
  for (let y = 1; y <= GRID_SIZE; y++) {
    for (let x = 1; x <= GRID_SIZE; x++) {
      const typeA = typeAt.get(`${x},${y}`);
      if (!typeA) continue;

      // Check right neighbor
      if (x < GRID_SIZE) {
        const typeB = typeAt.get(`${x + 1},${y}`);
        if (typeB && canConnect(typeA, typeB)) {
          edgeSet.add(`${x},${y}-${x + 1},${y}`);
        }
      }
      // Check neighbor below
      if (y > 1) {
        const typeB = typeAt.get(`${x},${y - 1}`);
        if (typeB && canConnect(typeA, typeB)) {
          edgeSet.add(`${x},${y}-${x},${y - 1}`);
        }
      }
    }
  }

  // Encode edge bits (20 bytes = 160 bits)
  // Format discovered from great temple:
  // - First 72 bits: vertical edges (between rows), 9 edges per row gap × 8 row gaps
  // - Next 72 bits: horizontal edges (between cols), 8 edges per row × 9 rows
  // - Remaining 16 bits: padding/unknown
  const edgeBits: number[] = [];

  // Vertical edges: between (x, y) and (x, y-1), from top to bottom
  for (let y = 9; y >= 2; y--) {
    for (let x = 1; x <= 9; x++) {
      const hasEdge = edgeSet.has(`${x},${y}-${x},${y-1}`) || edgeSet.has(`${x},${y-1}-${x},${y}`);
      edgeBits.push(hasEdge ? 1 : 0);
    }
  }

  // Horizontal edges: between (x, y) and (x+1, y), from top to bottom
  for (let y = 9; y >= 1; y--) {
    for (let x = 1; x <= 8; x++) {
      const hasEdge = edgeSet.has(`${x},${y}-${x+1},${y}`) || edgeSet.has(`${x+1},${y}-${x},${y}`);
      edgeBits.push(hasEdge ? 1 : 0);
    }
  }

  // Pad to 160 bits
  while (edgeBits.length < 160) {
    edgeBits.push(0);
  }

  // Convert bits to bytes (reverse bit order within bytes to match Sulozor format)
  const edgeBytes: number[] = [];
  for (let i = 0; i < 160; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) {
      if (edgeBits[i + j]) {
        byte |= (1 << (7 - j));  // MSB first
      }
    }
    edgeBytes.push(byte);
  }

  const bytes = [versionByte, ...cellBytes, ...edgeBytes];
  const encoded = toBase64Url(bytes);

  return `https://sulozor.github.io/?t=${encoded}#/atziri-temple`;
}
