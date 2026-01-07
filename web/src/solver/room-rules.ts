/**
 * Room connection rules - empirically discovered via Sulozor testing
 */

// Which rooms can be parents and what children they can have
export const VALID_CHILDREN: Record<string, string[]> = {
  GARRISON: ['ARMOURY', 'SPYMASTER'],
  LEGION_BARRACKS: ['ARMOURY', 'SPYMASTER'],
  ARMOURY: ['GARRISON', 'LEGION_BARRACKS', 'SMITHY', 'ALCHEMY_LAB'],
  SMITHY: ['ARMOURY', 'GOLEM_WORKS'],
  ALCHEMY_LAB: ['ARMOURY', 'THAUMATURGE'],
  SPYMASTER: ['GARRISON', 'LEGION_BARRACKS'],
  GENERATOR: ['THAUMATURGE', 'SACRIFICIAL_CHAMBER'],
  CORRUPTION_CHAMBER: ['THAUMATURGE'],
  SACRIFICIAL_CHAMBER: ['THAUMATURGE'],
};

// Rooms that require specific parents (cannot connect directly to PATH/FOYER)
export const REQUIRED_PARENTS: Record<string, string[]> = {
  SPYMASTER: ['GARRISON', 'LEGION_BARRACKS'],
  GOLEM_WORKS: ['SMITHY'],
  THAUMATURGE: ['GENERATOR', 'ALCHEMY_LAB', 'CORRUPTION_CHAMBER', 'SACRIFICIAL_CHAMBER'],
};

// Leaf rooms - can connect to FOYER or be children but cannot have children
export const LEAF_ROOMS = new Set([
  'THAUMATURGE',
  'GOLEM_WORKS',
  'COMMANDER',
  'SYNTHFLESH',
  'FLESH_SURGEON',
]);

// Unique rooms (only one allowed per temple)
export const UNIQUE_ROOMS = new Set(['SACRIFICIAL_CHAMBER']);

// Room values by tier [T1, T2, T3]
export const ROOM_VALUES: Record<string, [number, number, number]> = {
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

// Room display names by tier
export const ROOM_NAMES: Record<string, [string, string, string]> = {
  GARRISON: ['Guardhouse', 'Barracks', 'Hall of War'],
  SPYMASTER: ["Spymaster's Study", 'Hall of Shadows', 'Omnipresent Panopticon'],
  COMMANDER: ["Commander's Chamber", "Commander's Hall", "Commander's HQ"],
  ARMOURY: ['Armoury Depot', 'Armoury Arsenal', 'Armoury Gallery'],
  ALCHEMY_LAB: ['Chamber of Souls', 'Core Machinarium', 'Grand Phylactory'],
  SMITHY: ['Bronzeworks', 'Chamber of Iron', 'Golden Forge'],
  CORRUPTION_CHAMBER: ['Crimson Hall', 'Catalyst of Corruption', 'Locus of Corruption'],
  SACRIFICIAL_CHAMBER: ['Sealed Vault', 'Altar of Sacrifice', 'Apex of Oblation'],
  THAUMATURGE: ['Laboratory', 'Cuttery', 'Cathedral'],
  GENERATOR: ['Dynamo', 'Shrine of Empowerment', 'Solar Nexus'],
  GOLEM_WORKS: ['Workshop', 'Automaton Lab', 'Stone Legion'],
  FLESH_SURGEON: ["Surgeon's Ward", "Surgeon's Theatre", "Surgeon's Symphony"],
  SYNTHFLESH: ['Synthflesh Research', 'Synthflesh Sanctum', 'Crucible of Transcendence'],
  LEGION_BARRACKS: ['Legion Barracks', "Viper's Loyals", 'Elite Legion'],
  PATH: ['Path', 'Path', 'Path'],
};

// Room abbreviations for grid display
export const ROOM_ABBREV: Record<string, string> = {
  EMPTY: '   ',
  PATH: ' P ',
  GARRISON: 'GA',
  SPYMASTER: 'SP',
  COMMANDER: 'CO',
  ARMOURY: 'AR',
  ALCHEMY_LAB: 'AL',
  SMITHY: 'SM',
  CORRUPTION_CHAMBER: 'CC',
  SACRIFICIAL_CHAMBER: 'SA',
  THAUMATURGE: 'TH',
  GENERATOR: 'GE',
  GOLEM_WORKS: 'GO',
  FLESH_SURGEON: 'FS',
  SYNTHFLESH: 'SY',
  LEGION_BARRACKS: 'LE',
  FOYER: 'FOY',
  ATZIRI: 'ATZ',
  ARCHITECT: 'ARC',
};

/**
 * Check if a parent room type can have a child of given type
 */
export function canBeParentOf(parentType: string, childType: string): boolean {
  if (childType === 'EMPTY' || parentType === 'EMPTY') {
    return false;
  }

  // Normalize special cells to PATH
  if (['FOYER', 'ARCHITECT', 'ATZIRI'].includes(parentType)) {
    parentType = 'PATH';
  }

  // PATH/FOYER can be parent of rooms that don't require specific parents
  if (parentType === 'PATH') {
    if (childType in REQUIRED_PARENTS) {
      return false;
    }
    return true;
  }

  // Leaf rooms cannot have any children
  if (LEAF_ROOMS.has(parentType)) {
    return false;
  }

  // Check if parent can have this specific child
  if (parentType in VALID_CHILDREN) {
    return VALID_CHILDREN[parentType].includes(childType);
  }

  // Rooms not in VALID_CHILDREN cannot have children
  return false;
}

/**
 * Check if two room types can be adjacent in the temple tree
 */
export function canConnect(typeA: string, typeB: string): boolean {
  if (typeA === 'EMPTY' || typeB === 'EMPTY') {
    return false;
  }

  // Normalize special cells
  if (['FOYER', 'ARCHITECT', 'ATZIRI'].includes(typeA)) {
    typeA = 'PATH';
  }
  if (['FOYER', 'ARCHITECT', 'ATZIRI'].includes(typeB)) {
    typeB = 'PATH';
  }

  // Most rooms can connect freely - the parent-child direction is checked separately
  return true;
}
