/**
 * Parse temple state from various input formats
 */

import { Coord, RoomType, Tier } from '../domain/types.js';
import { Buffer } from 'buffer';
import { TempleState, createEmptyState, placeRoom, placePath, updateConnectivity, getCell } from '../state/temple-state.js';

/**
 * Input format for temple state
 */
export interface TempleInput {
  architect: Coord;
  rooms?: {
    type: RoomType;
    tier: Tier;
    position: Coord;
    locked?: boolean;
  }[];
  paths?: Coord[];
}

/**
 * Parse JSON input into a temple state
 */
export function parseTempleFromJSON(json: string): TempleState {
  const input = JSON.parse(json) as TempleInput;
  return createTempleFromInput(input);
}

/**
 * Create a temple state from structured input
 */
export function createTempleFromInput(input: TempleInput): TempleState {
  const state = createEmptyState(input.architect);

  // Place rooms
  if (input.rooms) {
    for (const roomInput of input.rooms) {
      const room = placeRoom(state, roomInput.type, roomInput.tier, roomInput.position);
      if (roomInput.locked) {
        state.locks.add(room.id);
        room.locked = true;
      }
    }
  }

  // Place paths
  if (input.paths) {
    for (const pathPos of input.paths) {
      placePath(state, pathPos);
    }
  }

  updateConnectivity(state);

  return state;
}

/**
 * Parse a simple text-based grid representation
 * Format:
 * ```
 * . . . . A . . . .
 * . . . . . . . . .
 * ...
 * . . . . F . . . .
 * ```
 * Where:
 * - F = Foyer
 * - A = Atziri
 * - R = Architect
 * - G = Garrison
 * - S = Spymaster
 * - C = Commander
 * - P = Path
 * - . = Empty
 */
export function parseTextGrid(text: string, architectPos: Coord): TempleState {
  const state = createEmptyState(architectPos);
  const lines = text.trim().split('\n').reverse(); // Bottom to top

  const roomCodes: Record<string, RoomType> = {
    'G': 'GARRISON',
    'S': 'SPYMASTER',
    'C': 'COMMANDER',
    'A': 'ARMOURY',
    'L': 'ALCHEMY_LAB',
    'M': 'SMITHY',
    'X': 'CORRUPTION_CHAMBER',
    'V': 'SACRIFICIAL_CHAMBER',
    'T': 'THAUMATURGE',
    'E': 'GENERATOR',
    'W': 'GOLEM_WORKS',
    'U': 'FLESH_SURGEON',
    'Y': 'SYNTHFLESH',
    'B': 'LEGION_BARRACKS',
    'P': 'PATH',
  };

  for (let y = 0; y < lines.length && y < 9; y++) {
    const cells = lines[y].trim().split(/\s+/);

    for (let x = 0; x < cells.length && x < 9; x++) {
      const cell = cells[x].toUpperCase();
      const position = { x: x + 1, y: y + 1 };

      // Skip special cells and empty
      if (cell === '.' || cell === 'F' || cell === 'Z' || cell === 'R') {
        continue;
      }

      if (cell === 'P') {
        placePath(state, position);
      } else {
        // Check for tier suffix (e.g., G1, G2, G3)
        const code = cell[0];
        const tier = (parseInt(cell[1]) || 1) as Tier;

        const roomType = roomCodes[code];
        if (roomType && roomType !== 'PATH') {
          placeRoom(state, roomType, tier, position);
        }
      }
    }
  }

  updateConnectivity(state);

  return state;
}

// ============================================
// SULOZOR URL PARSER
// Based on Sulozor's serialization.ts format
// ============================================

// Sulozor room index mapping (5 bits = 0-31)
const SULOZOR_ROOM_INDEX: Record<number, string> = {
  0: 'empty',
  1: 'path',
  2: 'guardhouse',           // Garrison
  3: 'transcendent_barrack', // Transcendent Barracks
  4: 'legion_barrack',       // Legion Barracks
  5: 'commanders_chamber',   // Commander
  6: 'armoury',              // Armoury
  7: 'bronzeworks',          // Smithy
  8: 'dynamo',               // Generator
  9: 'spymasters_study',     // Spymaster
  10: 'synthflesh_lab',      // Synthflesh
  11: 'surgeons_ward',       // Flesh Surgeon
  12: 'workshop',            // Golem Works
  13: 'chamber_of_souls',    // Alchemy Lab
  14: 'thaumaturges_laboratory', // Thaumaturge
  15: 'crimson_hall',        // Corruption Chamber
  16: 'altar_of_sacrifice',  // Sacrificial Chamber
  17: 'reward_room',
  18: 'sealed_vault',
  19: 'architect',
  20: 'sacrifice_room',
};

// Map Sulozor room names to our RoomType
const SULOZOR_TO_ROOMTYPE: Record<string, RoomType | 'PATH' | 'ARCHITECT' | 'EMPTY'> = {
  'empty': 'EMPTY',
  'path': 'PATH',
  'guardhouse': 'GARRISON',
  'transcendent_barrack': 'LEGION_BARRACKS', // Close enough - Transcendent Barracks
  'legion_barrack': 'LEGION_BARRACKS',
  'commanders_chamber': 'COMMANDER',
  'armoury': 'ARMOURY',
  'bronzeworks': 'SMITHY',
  'dynamo': 'GENERATOR',
  'spymasters_study': 'SPYMASTER',
  'synthflesh_lab': 'SYNTHFLESH',
  'surgeons_ward': 'FLESH_SURGEON',
  'workshop': 'GOLEM_WORKS',
  'chamber_of_souls': 'ALCHEMY_LAB',
  'thaumaturges_laboratory': 'THAUMATURGE',
  'crimson_hall': 'CORRUPTION_CHAMBER',
  'altar_of_sacrifice': 'SACRIFICIAL_CHAMBER',
  'reward_room': 'EMPTY', // Not a placeable room in our model
  'sealed_vault': 'EMPTY', // Not in our model yet
  'architect': 'ARCHITECT',
  'sacrifice_room': 'SACRIFICIAL_CHAMBER',
};

// Base64URL alphabet (URL-safe, no padding)
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_DECODE: Record<string, number> = {};
for (let i = 0; i < B64.length; i++) {
  B64_DECODE[B64[i]] = i;
}

/**
 * Decode base64url to bytes (Sulozor format)
 */
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

/**
 * Unpack Sulozor cell byte: 5 bits room index + 3 bits tier
 */
function unpackSulozorCell(byte: number): { room: string; tier: Tier } {
  const roomIdx = (byte >> 3) & 0x1f;
  const tierIdx = byte & 0x7;
  return {
    room: SULOZOR_ROOM_INDEX[roomIdx] || 'empty',
    tier: Math.max(1, Math.min(3, tierIdx + 1)) as Tier,
  };
}

/**
 * Parse Sulozor temple planner URL
 * URL format: https://sulozor.github.io/?t=<base64url>#/atziri-temple
 *
 * The format uses compact binary encoding:
 * - Byte 0: version flags (bit 0 = hasManual, bit 1 = hasMedallion)
 * - Bytes 1-81: 81 cells (9x9 grid), each packed as 5 bits room + 3 bits tier
 * - Optional: manual tier flags and medallion flags
 */
export function parseSulozorUrl(url: string): { state: TempleState; warnings: string[] } {
  const warnings: string[] = [];

  // Extract the 't' parameter
  const urlObj = new URL(url);
  const encoded = urlObj.searchParams.get('t');

  if (!encoded) {
    throw new Error('No temple data found in URL (missing t= parameter)');
  }

  // Decode base64url
  const bytes = fromBase64Url(encoded);

  if (bytes.length < 2) {
    throw new Error('Invalid URL data: too short');
  }

  const version = bytes[0];
  const hasManual = (version & 1) !== 0;
  const hasMedallion = (version & 2) !== 0;

  if (hasManual) warnings.push('Temple has manual tier overrides');
  if (hasMedallion) warnings.push('Temple has medallion markers');

  const gridSize = 9; // POE2 uses 9x9
  const cellBytes = bytes.slice(1, 1 + gridSize * gridSize);

  if (cellBytes.length < gridSize * gridSize) {
    warnings.push(`Grid data incomplete: ${cellBytes.length}/${gridSize * gridSize} cells`);
  }

  // Find architect position first
  let architectPos: Coord = { x: 5, y: 5 }; // Default

  for (let cellIdx = 0; cellIdx < cellBytes.length; cellIdx++) {
    const byte = cellBytes[cellIdx] ?? 0;
    const { room } = unpackSulozorCell(byte);

    if (room === 'architect') {
      // Sulozor stores top-to-bottom (row 0 = y=9, row 8 = y=1)
      const y = gridSize - Math.floor(cellIdx / gridSize);
      const x = (cellIdx % gridSize) + 1;
      architectPos = { x, y };
      break;
    }
  }

  const state = createEmptyState(architectPos);

  // Parse all cells
  for (let cellIdx = 0; cellIdx < cellBytes.length; cellIdx++) {
    const byte = cellBytes[cellIdx] ?? 0;
    const { room, tier } = unpackSulozorCell(byte);
    // Sulozor stores top-to-bottom (row 0 = y=9, row 8 = y=1)
    const y = gridSize - Math.floor(cellIdx / gridSize);
    const x = (cellIdx % gridSize) + 1;
    const position = { x, y };

    // Skip Foyer (5,1) and Atziri (5,9) - these are fixed
    if ((x === 5 && y === 1) || (x === 5 && y === 9)) {
      continue;
    }

    // Skip Architect position
    if (x === architectPos.x && y === architectPos.y) {
      continue;
    }

    const roomType = SULOZOR_TO_ROOMTYPE[room];

    if (!roomType || roomType === 'EMPTY' || roomType === 'ARCHITECT') {
      continue;
    }

    if (roomType === 'PATH') {
      placePath(state, position);
    } else {
      placeRoom(state, roomType, tier, position);
    }
  }

  updateConnectivity(state);

  const totalPlaced = state.rooms.size + state.paths.size;
  if (totalPlaced === 0) {
    warnings.push('No rooms or paths detected - temple may be empty or format mismatch');
  } else {
    warnings.push(`Imported ${state.rooms.size} rooms and ${state.paths.size} paths`);
  }

  return { state, warnings };
}

/**
 * Parse Sulozor URL with manual architect position override
 */
export function parseSulozorUrlWithArchitect(
  url: string,
  architectPos: Coord
): { state: TempleState; warnings: string[] } {
  const warnings: string[] = [];

  const urlObj = new URL(url);
  const encoded = urlObj.searchParams.get('t');

  if (!encoded) {
    throw new Error('No temple data found in URL (missing t= parameter)');
  }

  const bytes = fromBase64Url(encoded);
  const gridSize = 9;
  const cellBytes = bytes.slice(1, 1 + gridSize * gridSize);

  const state = createEmptyState(architectPos);

  for (let cellIdx = 0; cellIdx < cellBytes.length; cellIdx++) {
    const byte = cellBytes[cellIdx] ?? 0;
    const { room, tier } = unpackSulozorCell(byte);
    // Sulozor stores top-to-bottom (row 0 = y=9, row 8 = y=1)
    const y = gridSize - Math.floor(cellIdx / gridSize);
    const x = (cellIdx % gridSize) + 1;
    const position = { x, y };

    if ((x === 5 && y === 1) || (x === 5 && y === 9)) continue;
    if (x === architectPos.x && y === architectPos.y) continue;

    const roomType = SULOZOR_TO_ROOMTYPE[room];
    if (!roomType || roomType === 'EMPTY' || roomType === 'ARCHITECT') continue;

    if (roomType === 'PATH') {
      placePath(state, position);
    } else {
      placeRoom(state, roomType, tier, position);
    }
  }

  updateConnectivity(state);

  warnings.push(`Imported ${state.rooms.size} rooms and ${state.paths.size} paths`);

  return { state, warnings };
}

// ============================================
// SULOZOR URL EXPORTER
// ============================================

// Reverse mapping: our RoomType to Sulozor room index
const ROOMTYPE_TO_SULOZOR_INDEX: Record<string, number> = {
  'EMPTY': 0,
  'PATH': 1,
  'GARRISON': 2,
  'LEGION_BARRACKS': 4,
  'COMMANDER': 5,
  'ARMOURY': 6,
  'SMITHY': 7,
  'GENERATOR': 8,
  'SPYMASTER': 9,
  'SYNTHFLESH': 10,
  'FLESH_SURGEON': 11,
  'GOLEM_WORKS': 12,
  'ALCHEMY_LAB': 13,
  'THAUMATURGE': 14,
  'CORRUPTION_CHAMBER': 15,
  'SACRIFICIAL_CHAMBER': 16,
  'ARCHITECT': 19,
};

/**
 * Encode bytes to base64url (Sulozor format, no padding)
 */
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

/**
 * Pack cell into Sulozor byte format: 5 bits room + 3 bits tier
 */
function packSulozorCell(roomType: string | null, tier: number): number {
  const roomIdx = roomType ? (ROOMTYPE_TO_SULOZOR_INDEX[roomType] ?? 0) : 0;
  const tierIdx = Math.max(0, Math.min(7, tier - 1));
  return (roomIdx << 3) | tierIdx;
}

/**
 * Export temple state to Sulozor URL format
 */
export function exportToSulozorUrl(state: TempleState): string {
  const gridSize = 9;
  const cellBytes: number[] = [];

  // Version byte (0 = no manual tiers, no medallions)
  const versionByte = 0;

  // Pack each cell row by row, top-to-bottom (y=9 to y=1, x=1 to x=9) to match Sulozor format
  for (let y = gridSize; y >= 1; y--) {
    for (let x = 1; x <= gridSize; x++) {
      const cell = getCell(state, { x, y });

      if (!cell || cell.content === null) {
        cellBytes.push(packSulozorCell(null, 1));
      } else if (typeof cell.content === 'string') {
        // Fixed cells
        if (cell.content === 'ARCHITECT') {
          cellBytes.push(packSulozorCell('ARCHITECT', 1));
        } else if (cell.content === 'FOYER') {
          // Foyer at (5,1) must be encoded as PATH for Sulozor to show connections
          cellBytes.push(packSulozorCell('PATH', 1));
        } else {
          // Atziri - encode as empty
          cellBytes.push(packSulozorCell(null, 1));
        }
      } else if ('type' in cell.content) {
        // Room
        cellBytes.push(packSulozorCell(cell.content.type, cell.content.tier));
      } else {
        // Path
        cellBytes.push(packSulozorCell('PATH', 1));
      }
    }
  }

  const bytes = [versionByte, ...cellBytes];
  const encoded = toBase64Url(bytes);

  return `https://sulozor.github.io/?t=${encoded}#/atziri-temple`;
}

/**
 * Export state to JSON format
 */
export function exportStateToJSON(state: TempleState): string {
  const output: TempleInput = {
    architect: state.architect,
    rooms: [],
    paths: [],
  };

  for (const room of state.rooms.values()) {
    output.rooms!.push({
      type: room.type,
      tier: room.tier,
      position: room.position,
      locked: room.locked,
    });
  }

  for (const path of state.paths.values()) {
    output.paths!.push(path.position);
  }

  return JSON.stringify(output, null, 2);
}
