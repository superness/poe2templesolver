/**
 * Room connection rules and synergy upgrade definitions
 */

import { RoomType } from './types.js';

// Which room types can connect to which other room types
// PATH connects to everything (automatic)
// Rooms connect only to rooms they have upgrade interactions with
// Only GARRISON and GENERATOR explicitly connect back to PATH
export const CONNECTION_RULES: Record<RoomType, RoomType[] | '*'> = {
  PATH: '*', // Paths connect to anything
  GARRISON: ['PATH', 'COMMANDER', 'ARMOURY', 'SYNTHFLESH', 'SPYMASTER'],
  SPYMASTER: ['GARRISON'],
  COMMANDER: ['GARRISON', 'ARMOURY'],
  ARMOURY: ['GARRISON', 'COMMANDER', 'ALCHEMY_LAB', 'THAUMATURGE', 'SMITHY', 'LEGION_BARRACKS'],
  ALCHEMY_LAB: ['ARMOURY', 'THAUMATURGE', 'CORRUPTION_CHAMBER', 'SACRIFICIAL_CHAMBER'],
  SMITHY: ['ARMOURY', 'GOLEM_WORKS', 'SACRIFICIAL_CHAMBER'],
  CORRUPTION_CHAMBER: ['ALCHEMY_LAB', 'THAUMATURGE'],
  SACRIFICIAL_CHAMBER: ['SMITHY', 'ALCHEMY_LAB'],
  THAUMATURGE: ['ARMOURY', 'ALCHEMY_LAB', 'CORRUPTION_CHAMBER', 'GENERATOR'],
  GENERATOR: ['PATH', 'THAUMATURGE', 'GOLEM_WORKS'],
  GOLEM_WORKS: ['SMITHY', 'GENERATOR', 'SYNTHFLESH'],
  FLESH_SURGEON: ['SYNTHFLESH'],
  SYNTHFLESH: ['GARRISON', 'GOLEM_WORKS', 'FLESH_SURGEON'],
  LEGION_BARRACKS: ['ARMOURY', 'SPYMASTER'],
};

// Which room types trigger upgrades when adjacent
export const SYNERGY_UPGRADES: Partial<Record<RoomType, RoomType[]>> = {
  GARRISON: ['COMMANDER', 'ARMOURY'],
  ARMOURY: ['SMITHY', 'ALCHEMY_LAB'],
  SMITHY: ['GOLEM_WORKS'],
  COMMANDER: ['GARRISON'], // Needs 3+ Garrisons for full upgrade
  THAUMATURGE: ['SACRIFICIAL_CHAMBER', 'GENERATOR'],
  SYNTHFLESH: ['FLESH_SURGEON'],
  LEGION_BARRACKS: ['ARMOURY', 'SPYMASTER'],
  FLESH_SURGEON: ['SYNTHFLESH'],
};

// Room value scores for optimization
export const ROOM_VALUES: Record<RoomType, { base: number; t1: number; t2: number; t3: number }> = {
  SPYMASTER: { base: 20, t1: 20, t2: 35, t3: 50 },
  CORRUPTION_CHAMBER: { base: 25, t1: 25, t2: 45, t3: 70 },
  SACRIFICIAL_CHAMBER: { base: 30, t1: 30, t2: 50, t3: 80 },
  THAUMATURGE: { base: 15, t1: 15, t2: 30, t3: 50 },
  GARRISON: { base: 8, t1: 8, t2: 12, t3: 18 },
  COMMANDER: { base: 12, t1: 12, t2: 20, t3: 35 },
  ARMOURY: { base: 10, t1: 10, t2: 18, t3: 28 },
  SMITHY: { base: 12, t1: 12, t2: 22, t3: 38 },
  ALCHEMY_LAB: { base: 14, t1: 14, t2: 24, t3: 40 },
  GENERATOR: { base: 10, t1: 10, t2: 18, t3: 30 },
  GOLEM_WORKS: { base: 8, t1: 8, t2: 14, t3: 22 },
  FLESH_SURGEON: { base: 15, t1: 15, t2: 28, t3: 45 },
  SYNTHFLESH: { base: 10, t1: 10, t2: 18, t3: 28 },
  LEGION_BARRACKS: { base: 12, t1: 12, t2: 22, t3: 35 },
  PATH: { base: 1, t1: 1, t2: 1, t3: 1 },
};

// Room tier names for display
export const ROOM_TIER_NAMES: Record<RoomType, { t1: string; t2: string; t3: string }> = {
  GARRISON: { t1: 'Guardhouse', t2: 'Barracks', t3: 'Hall of War' },
  SPYMASTER: { t1: "Spymaster's Study", t2: 'Hall of Shadows', t3: 'Omnipresent Panopticon' },
  COMMANDER: { t1: "Commander's Chamber", t2: "Commander's Hall", t3: "Commander's Headquarters" },
  ARMOURY: { t1: 'Armoury Depot', t2: 'Armoury Arsenal', t3: 'Armoury Gallery' },
  ALCHEMY_LAB: { t1: 'Chamber of Souls', t2: 'Core Machinarium', t3: 'Grand Phylactory' },
  SMITHY: { t1: 'Bronzeworks', t2: 'Chamber of Iron', t3: 'Golden Forge' },
  CORRUPTION_CHAMBER: { t1: 'Crimson Hall', t2: 'Catalyst of Corruption', t3: 'Locus of Corruption' },
  SACRIFICIAL_CHAMBER: { t1: 'Sealed Vault', t2: 'Altar of Sacrifice', t3: 'Apex of Oblation' },
  THAUMATURGE: { t1: 'Laboratory', t2: 'Cuttery', t3: 'Cathedral' },
  GENERATOR: { t1: 'Dynamo', t2: 'Shrine of Empowerment', t3: 'Solar Nexus' },
  GOLEM_WORKS: { t1: 'Workshop', t2: 'Automaton Lab', t3: 'Stone Legion' },
  FLESH_SURGEON: { t1: "Surgeon's Ward", t2: "Surgeon's Theatre", t3: "Surgeon's Symphony" },
  SYNTHFLESH: { t1: 'Synthflesh Research', t2: 'Synthflesh Sanctum', t3: 'Crucible of Transcendence' },
  LEGION_BARRACKS: { t1: 'Legion Barracks', t2: "Viper's Loyals", t3: 'Elite Legion' },
  PATH: { t1: 'Path', t2: 'Path', t3: 'Path' },
};

/**
 * Required parent rooms for rooms that can't connect directly to PATH.
 * Discovered empirically via Sulozor testing.
 */
const REQUIRED_PARENTS: Partial<Record<RoomType, RoomType[]>> = {
  SPYMASTER: ['GARRISON', 'LEGION_BARRACKS'],
  GOLEM_WORKS: ['SMITHY'],
  THAUMATURGE: ['GENERATOR', 'ALCHEMY_LAB', 'CORRUPTION_CHAMBER', 'SACRIFICIAL_CHAMBER'],
};

/**
 * Check if roomA can connect to roomB for TREE purposes.
 *
 * Most rooms can connect to each other freely for tree connectivity.
 * However, some rooms (SPYMASTER, GOLEM_WORKS, THAUMATURGE) can only
 * connect via specific parent rooms.
 *
 * Discovered empirically via Sulozor testing.
 */
export function canConnect(roomA: RoomType, roomB: RoomType): boolean {
  // Check if roomA requires specific parents
  const aRequires = REQUIRED_PARENTS[roomA];
  if (aRequires && !aRequires.includes(roomB)) {
    return false;
  }

  // Check if roomB requires specific parents
  const bRequires = REQUIRED_PARENTS[roomB];
  if (bRequires && !bRequires.includes(roomA)) {
    return false;
  }

  return true;
}

/**
 * Check if roomA and roomB have an upgrade interaction (bidirectional).
 * Used for scoring/synergy purposes, separate from tree connectivity.
 */
export function canUpgrade(roomA: RoomType, roomB: RoomType): boolean {
  const rulesA = CONNECTION_RULES[roomA];
  const rulesB = CONNECTION_RULES[roomB];

  // Check if A allows B: either A has '*' (PATH), or A's list includes B
  const aAllowsB = rulesA === '*' || rulesA.includes(roomB);

  // Check if B allows A: either B has '*' (PATH), or B's list includes A
  const bAllowsA = rulesB === '*' || rulesB.includes(roomA);

  // Both must allow for upgrade interaction
  return aAllowsB && bAllowsA;
}

/**
 * Check if adjacency triggers a synergy upgrade
 */
export function triggersSynergy(roomType: RoomType, adjacentType: RoomType): boolean {
  const synergies = SYNERGY_UPGRADES[roomType];
  return synergies !== undefined && synergies.includes(adjacentType);
}

/**
 * Get the display name for a room at a given tier
 */
export function getRoomName(type: RoomType, tier: 1 | 2 | 3): string {
  const names = ROOM_TIER_NAMES[type];
  switch (tier) {
    case 1: return names.t1;
    case 2: return names.t2;
    case 3: return names.t3;
  }
}

/**
 * Get the value score for a room
 */
export function getRoomValue(type: RoomType, tier: 1 | 2 | 3): number {
  const values = ROOM_VALUES[type];
  switch (tier) {
    case 1: return values.t1;
    case 2: return values.t2;
    case 3: return values.t3;
  }
}
