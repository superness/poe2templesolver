/**
 * Temple state representation and management
 */

import {
  Coord,
  GridCell,
  Room,
  Path,
  RoomType,
  Tier,
  CellContent,
  coordKey,
  getAdjacentCoords,
  coordsEqual,
} from '../domain/types.js';
import { GRID_SIZE, FOYER_POSITION, ATZIRI_POSITION } from '../domain/constants.js';
import { canConnect } from '../domain/room-rules.js';

export interface TempleState {
  grid: GridCell[][];
  rooms: Map<string, Room>;
  paths: Map<string, Path>;
  architect: Coord;
  locks: Set<string>;
  connectedToFoyer: Set<string>;
  connectedToArchitect: Set<string>;
}

/**
 * Create an empty temple state
 */
export function createEmptyState(architectPosition: Coord): TempleState {
  const grid: GridCell[][] = [];

  for (let y = 0; y < GRID_SIZE; y++) {
    const row: GridCell[] = [];
    for (let x = 0; x < GRID_SIZE; x++) {
      const position: Coord = { x: x + 1, y: y + 1 };
      let content: CellContent | null = null;

      // Set fixed positions
      if (coordsEqual(position, FOYER_POSITION)) {
        content = 'FOYER';
      } else if (coordsEqual(position, ATZIRI_POSITION)) {
        content = 'ATZIRI';
      } else if (coordsEqual(position, architectPosition)) {
        content = 'ARCHITECT';
      }

      row.push({ position, content });
    }
    grid.push(row);
  }

  return {
    grid,
    rooms: new Map(),
    paths: new Map(),
    architect: architectPosition,
    locks: new Set(),
    connectedToFoyer: new Set([coordKey(FOYER_POSITION)]),
    connectedToArchitect: new Set(),
  };
}

/**
 * Get the cell at a coordinate
 */
export function getCell(state: TempleState, coord: Coord): GridCell | null {
  if (coord.x < 1 || coord.x > GRID_SIZE || coord.y < 1 || coord.y > GRID_SIZE) {
    return null;
  }
  return state.grid[coord.y - 1][coord.x - 1];
}

/**
 * Set the content of a cell
 */
export function setCell(state: TempleState, coord: Coord, content: CellContent | null): void {
  if (coord.x < 1 || coord.x > GRID_SIZE || coord.y < 1 || coord.y > GRID_SIZE) {
    return;
  }
  state.grid[coord.y - 1][coord.x - 1].content = content;
}

/**
 * Check if a cell is empty
 */
export function isCellEmpty(state: TempleState, coord: Coord): boolean {
  const cell = getCell(state, coord);
  return cell !== null && cell.content === null;
}

/**
 * Check if a cell contains a room or path (traversable)
 */
export function isCellTraversable(state: TempleState, coord: Coord): boolean {
  const cell = getCell(state, coord);
  if (!cell || cell.content === null) return false;

  if (typeof cell.content === 'string') {
    return cell.content === 'FOYER' || cell.content === 'ARCHITECT' || cell.content === 'ATZIRI';
  }

  return true; // Room or Path
}

/**
 * Get the room type at a coordinate, if any
 */
export function getRoomTypeAt(state: TempleState, coord: Coord): RoomType | null {
  const cell = getCell(state, coord);
  if (!cell || cell.content === null) return null;

  if (typeof cell.content === 'object' && 'type' in cell.content) {
    return cell.content.type;
  }

  return null;
}

/**
 * Check if position is a path
 */
export function isPath(state: TempleState, coord: Coord): boolean {
  const cell = getCell(state, coord);
  if (!cell || cell.content === null) return false;
  return typeof cell.content === 'object' && 'id' in cell.content && !('type' in cell.content);
}

/**
 * Place a room on the grid
 */
export function placeRoom(
  state: TempleState,
  type: RoomType,
  tier: Tier,
  position: Coord
): Room {
  const id = `room_${coordKey(position)}`;
  const room: Room = { id, type, tier, position, locked: false };

  state.rooms.set(id, room);
  setCell(state, position, room);

  return room;
}

/**
 * Place a path on the grid
 */
export function placePath(state: TempleState, position: Coord): Path {
  const id = `path_${coordKey(position)}`;
  const path: Path = { id, position };

  state.paths.set(id, path);
  setCell(state, position, path);

  return path;
}

/**
 * Clone a temple state (deep copy)
 */
export function cloneState(state: TempleState): TempleState {
  const newGrid: GridCell[][] = [];

  for (const row of state.grid) {
    const newRow: GridCell[] = [];
    for (const cell of row) {
      newRow.push({
        position: { ...cell.position },
        content: cloneCellContent(cell.content),
      });
    }
    newGrid.push(newRow);
  }

  const newRooms = new Map<string, Room>();
  for (const [id, room] of state.rooms) {
    newRooms.set(id, { ...room, position: { ...room.position } });
  }

  const newPaths = new Map<string, Path>();
  for (const [id, path] of state.paths) {
    newPaths.set(id, { ...path, position: { ...path.position } });
  }

  return {
    grid: newGrid,
    rooms: newRooms,
    paths: newPaths,
    architect: { ...state.architect },
    locks: new Set(state.locks),
    connectedToFoyer: new Set(state.connectedToFoyer),
    connectedToArchitect: new Set(state.connectedToArchitect),
  };
}

function cloneCellContent(content: CellContent | null): CellContent | null {
  if (content === null) return null;
  if (typeof content === 'string') return content;

  if ('type' in content) {
    // Room
    return { ...content, position: { ...content.position } };
  } else {
    // Path
    return { ...content, position: { ...content.position } };
  }
}

/**
 * Get adjacent occupied cells
 */
export function getAdjacentOccupied(state: TempleState, coord: Coord): Coord[] {
  return getAdjacentCoords(coord).filter(c => {
    const cell = getCell(state, c);
    return cell && cell.content !== null;
  });
}

/**
 * Get all chain tips (endpoints of chains from Foyer)
 */
export function getChainTips(state: TempleState): Coord[] {
  const tips: Coord[] = [];
  const visited = new Set<string>();

  // BFS from Foyer
  const queue: Coord[] = [FOYER_POSITION];
  const parent = new Map<string, string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    const key = coordKey(current);

    if (visited.has(key)) continue;
    visited.add(key);

    const adjacent = getAdjacentOccupied(state, current);
    const unvisitedNeighbors = adjacent.filter(a => !visited.has(coordKey(a)));

    if (unvisitedNeighbors.length === 0 && !coordsEqual(current, FOYER_POSITION)) {
      // This is a tip - no unvisited neighbors
      tips.push(current);
    }

    for (const neighbor of unvisitedNeighbors) {
      parent.set(coordKey(neighbor), key);
      queue.push(neighbor);
    }
  }

  return tips;
}

/**
 * Get the effective room type of a cell for connection checking.
 * Special cells (FOYER, ARCHITECT, ATZIRI) act like PATH nodes.
 */
function getCellRoomType(cell: GridCell | null): RoomType | null {
  if (!cell || cell.content === null) return null;

  if (typeof cell.content === 'string') {
    // Special cells act like PATH for connection purposes
    if (cell.content === 'FOYER' || cell.content === 'ARCHITECT' || cell.content === 'ATZIRI') {
      return 'PATH';
    }
    return null;
  }

  if ('type' in cell.content) {
    // It's a room
    return cell.content.type;
  }

  // It's a path
  return 'PATH';
}

/**
 * Check if two adjacent cells can actually connect per room rules
 */
function cellsCanConnect(state: TempleState, coordA: Coord, coordB: Coord): boolean {
  const cellA = getCell(state, coordA);
  const cellB = getCell(state, coordB);

  const typeA = getCellRoomType(cellA);
  const typeB = getCellRoomType(cellB);

  if (!typeA || !typeB) return false;

  return canConnect(typeA, typeB);
}

/**
 * Update connectivity sets (run after placing rooms)
 * Only traverses between cells that can actually connect per room rules.
 */
export function updateConnectivity(state: TempleState): void {
  // BFS from Foyer to find all connected cells (respecting room connection rules)
  const connectedToFoyer = new Set<string>();
  const visited = new Set<string>();
  const queue: Coord[] = [FOYER_POSITION];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const key = coordKey(current);

    if (visited.has(key)) continue;
    visited.add(key);

    const cell = getCell(state, current);
    if (!cell || cell.content === null) continue;

    connectedToFoyer.add(key);

    const adjacent = getAdjacentCoords(current);
    for (const neighbor of adjacent) {
      const nCell = getCell(state, neighbor);
      if (nCell && nCell.content !== null && !visited.has(coordKey(neighbor))) {
        // Only traverse if rooms can actually connect
        if (cellsCanConnect(state, current, neighbor)) {
          queue.push(neighbor);
        }
      }
    }
  }

  state.connectedToFoyer = connectedToFoyer;

  // Check if Architect is connected
  state.connectedToArchitect = new Set();
  if (connectedToFoyer.has(coordKey(state.architect))) {
    // BFS from Architect (also respecting connection rules)
    const archVisited = new Set<string>();
    const archQueue: Coord[] = [state.architect];

    while (archQueue.length > 0) {
      const current = archQueue.shift()!;
      const key = coordKey(current);

      if (archVisited.has(key)) continue;
      archVisited.add(key);

      state.connectedToArchitect.add(key);

      const adjacent = getAdjacentCoords(current);
      for (const neighbor of adjacent) {
        const nCell = getCell(state, neighbor);
        if (nCell && nCell.content !== null && !archVisited.has(coordKey(neighbor))) {
          if (cellsCanConnect(state, current, neighbor)) {
            archQueue.push(neighbor);
          }
        }
      }
    }
  }
}

/**
 * Count rooms of a specific type
 */
export function countRoomType(state: TempleState, type: RoomType): number {
  let count = 0;
  for (const room of state.rooms.values()) {
    if (room.type === type) count++;
  }
  return count;
}

/**
 * Count rooms at tier 3
 */
export function countT3Rooms(state: TempleState): number {
  let count = 0;
  for (const room of state.rooms.values()) {
    if (room.tier === 3) count++;
  }
  return count;
}

/**
 * Get total value of placed rooms
 */
export function calculateTempleValue(state: TempleState): number {
  const { getRoomValue } = require('../domain/room-rules.js');
  let value = 0;

  for (const room of state.rooms.values()) {
    value += getRoomValue(room.type, room.tier);
  }

  return value;
}
