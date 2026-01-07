/**
 * Rule Explorer Page
 *
 * Systematically test ALL possible room connection rules.
 * Each test generates a Sulozor URL for manual verification.
 */

import { useState } from 'react';
import { exportToSulozorUrl } from '../lib/sulozor-parser';
import type { Room, Edge, TempleState } from '../solver/types';

// All room types we need to test
const ALL_ROOM_TYPES: Room['type'][] = [
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
];

// Short names for display
const SHORT_NAMES: Record<string, string> = {
  GARRISON: 'GAR',
  SPYMASTER: 'SPY',
  COMMANDER: 'CMD',
  ARMOURY: 'ARM',
  ALCHEMY_LAB: 'ALC',
  SMITHY: 'SMI',
  CORRUPTION_CHAMBER: 'COR',
  SACRIFICIAL_CHAMBER: 'SAC',
  THAUMATURGE: 'THA',
  GENERATOR: 'GEN',
  GOLEM_WORKS: 'GOL',
  FLESH_SURGEON: 'FLE',
  SYNTHFLESH: 'SYN',
  LEGION_BARRACKS: 'LEG',
};

function room(type: Room['type'], tier: 1 | 2 | 3, x: number, y: number): Room {
  return { type, tier, position: { x, y } };
}

function edge(fx: number, fy: number, tx: number, ty: number): Edge {
  return { from: { x: fx, y: fy }, to: { x: tx, y: ty } };
}

// Test 1: Can room type X connect directly to FOYER?
function createFoyerTest(roomType: Room['type']): TempleState {
  return {
    architect: { x: 5, y: 5 },
    rooms: [
      room(roomType, 3, 5, 2),
    ],
    paths: [],
    edges: [
      edge(5, 1, 5, 2),  // FOYER -> room
      edge(5, 2, 5, 5),  // room -> ARCHITECT
    ],
  };
}

// Test 2: Can two rooms of type X be adjacent?
function createSelfAdjacencyTest(roomType: Room['type']): TempleState {
  return {
    architect: { x: 5, y: 5 },
    rooms: [
      room(roomType, 3, 5, 2),
      room(roomType, 3, 5, 3),
    ],
    paths: [],
    edges: [
      edge(5, 1, 5, 2),
      edge(5, 2, 5, 3),
      edge(5, 3, 5, 5),
    ],
  };
}

// Test 3: Can room type X have a child (using GARRISON as generic child)?
function createCanHaveChildTest(roomType: Room['type']): TempleState {
  // Use a room that we know can be a child (GARRISON has no parent requirements)
  const childType: Room['type'] = roomType === 'GARRISON' ? 'ARMOURY' : 'GARRISON';
  return {
    architect: { x: 5, y: 5 },
    rooms: [
      room(roomType, 3, 5, 2),
      room(childType, 3, 5, 3),
    ],
    paths: [],
    edges: [
      edge(5, 1, 5, 2),
      edge(5, 2, 5, 3),  // roomType -> childType
      edge(5, 3, 5, 5),
    ],
  };
}

// Test 4: Can room A be adjacent to room B?
function createPairAdjacencyTest(roomA: Room['type'], roomB: Room['type']): TempleState {
  return {
    architect: { x: 5, y: 5 },
    rooms: [
      room(roomA, 3, 5, 2),
      room(roomB, 3, 5, 3),
    ],
    paths: [],
    edges: [
      edge(5, 1, 5, 2),
      edge(5, 2, 5, 3),
      edge(5, 3, 5, 5),
    ],
  };
}

// =============================================================================
// ADVANCED RULES TESTS
// =============================================================================

// Test 5: ARMOURY with 2 SMITHY adjacent (max 1 allowed?)
function createArmouryTwoSmithyTest(): TempleState {
  return {
    architect: { x: 5, y: 6 },
    rooms: [
      room('ARMOURY', 3, 5, 3),
      room('SMITHY', 3, 4, 3),  // left of armoury
      room('SMITHY', 3, 6, 3),  // right of armoury
    ],
    paths: [],
    edges: [
      edge(5, 1, 5, 2),
      edge(5, 2, 5, 3),  // path to armoury
      edge(5, 3, 4, 3),  // armoury -> smithy left
      edge(5, 3, 6, 3),  // armoury -> smithy right
      edge(5, 3, 5, 6),  // armoury -> architect
    ],
  };
}

// Test 6: ALCHEMY_LAB with 3 THAUMATURGE adjacent (max 2 allowed?)
function createAlchemyThreeThauTest(): TempleState {
  return {
    architect: { x: 5, y: 6 },
    rooms: [
      room('ALCHEMY_LAB', 3, 5, 3),
      room('THAUMATURGE', 3, 4, 3),  // left
      room('THAUMATURGE', 3, 6, 3),  // right
      room('THAUMATURGE', 3, 5, 4),  // below
    ],
    paths: [],
    edges: [
      edge(5, 1, 5, 2),
      edge(5, 2, 5, 3),
      edge(5, 3, 4, 3),
      edge(5, 3, 6, 3),
      edge(5, 3, 5, 4),
      edge(5, 4, 5, 6),
    ],
  };
}

// Test 6b: ALCHEMY_LAB with exactly 2 THAUMATURGE (should be valid)
function createAlchemyTwoThauTest(): TempleState {
  return {
    architect: { x: 5, y: 6 },
    rooms: [
      room('ALCHEMY_LAB', 3, 5, 3),
      room('THAUMATURGE', 3, 4, 3),  // left
      room('THAUMATURGE', 3, 6, 3),  // right
    ],
    paths: [],
    edges: [
      edge(5, 1, 5, 2),
      edge(5, 2, 5, 3),
      edge(5, 3, 4, 3),
      edge(5, 3, 6, 3),
      edge(5, 3, 5, 6),
    ],
  };
}

// Test 7: SPYMASTER and COMMANDER in linear chain (should be banned)
function createSpyCmdLinearChainTest(): TempleState {
  return {
    architect: { x: 5, y: 6 },
    rooms: [
      room('GARRISON', 3, 5, 2),
      room('SPYMASTER', 3, 5, 3),
      room('COMMANDER', 3, 5, 4),  // linear chain: GAR -> SPY -> CMD
    ],
    paths: [],
    edges: [
      edge(5, 1, 5, 2),
      edge(5, 2, 5, 3),
      edge(5, 3, 5, 4),
      edge(5, 4, 5, 6),
    ],
  };
}

// Test 7b: SPYMASTER and COMMANDER NOT in linear chain (branching - should be valid)
function createSpyCmdBranchTest(): TempleState {
  return {
    architect: { x: 5, y: 6 },
    rooms: [
      room('GARRISON', 3, 5, 3),
      room('SPYMASTER', 3, 4, 3),  // branch left
      room('COMMANDER', 3, 6, 3),  // branch right
    ],
    paths: [],
    edges: [
      edge(5, 1, 5, 2),
      edge(5, 2, 5, 3),
      edge(5, 3, 4, 3),  // garrison -> spymaster
      edge(5, 3, 6, 3),  // garrison -> commander
      edge(5, 3, 5, 6),
    ],
  };
}

// Test 8: GENERATOR without PATH (should fail per v1.4.1)
function createGeneratorNoPathTest(): TempleState {
  return {
    architect: { x: 5, y: 6 },
    rooms: [
      room('SACRIFICIAL_CHAMBER', 3, 5, 3),
      room('GENERATOR', 3, 5, 4),
    ],
    paths: [],
    edges: [
      edge(5, 1, 5, 2),
      edge(5, 2, 5, 3),
      edge(5, 3, 5, 4),
      edge(5, 4, 5, 6),
    ],
  };
}

// Test 8b: GENERATOR with PATH (should be valid)
function createGeneratorWithPathTest(): TempleState {
  return {
    architect: { x: 5, y: 6 },
    rooms: [
      room('SACRIFICIAL_CHAMBER', 3, 5, 3),
      room('GENERATOR', 3, 5, 4),
    ],
    paths: [{ x: 5, y: 5 }],  // PATH between generator and architect
    edges: [
      edge(5, 1, 5, 2),
      edge(5, 2, 5, 3),
      edge(5, 3, 5, 4),
      edge(5, 4, 5, 5),  // generator -> path
      edge(5, 5, 5, 6),  // path -> architect
    ],
  };
}

// =============================================================================
// CHAIN BAN TESTS (from Sulozor source)
// =============================================================================

// ARM→GAR→ARM chain ban
function createArmGarArmChainTest(): TempleState {
  return {
    architect: { x: 5, y: 6 },
    rooms: [
      room('ARMOURY', 3, 5, 2),
      room('GARRISON', 3, 5, 3),
      room('ARMOURY', 3, 5, 4),  // ARM→GAR→ARM
    ],
    paths: [],
    edges: [
      edge(5, 1, 5, 2),
      edge(5, 2, 5, 3),
      edge(5, 3, 5, 4),
      edge(5, 4, 5, 6),
    ],
  };
}

// ALC→ARM→ALC chain ban
function createAlcArmAlcChainTest(): TempleState {
  return {
    architect: { x: 5, y: 6 },
    rooms: [
      room('ALCHEMY_LAB', 3, 5, 2),
      room('ARMOURY', 3, 5, 3),
      room('ALCHEMY_LAB', 3, 5, 4),  // ALC→ARM→ALC
    ],
    paths: [],
    edges: [
      edge(5, 1, 5, 2),
      edge(5, 2, 5, 3),
      edge(5, 3, 5, 4),
      edge(5, 4, 5, 6),
    ],
  };
}

// THAU→COR→THAU chain ban
function createThauCorThauChainTest(): TempleState {
  return {
    architect: { x: 5, y: 6 },
    rooms: [
      room('THAUMATURGE', 3, 5, 2),
      room('CORRUPTION_CHAMBER', 3, 5, 3),
      room('THAUMATURGE', 3, 5, 4),  // THAU→COR→THAU
    ],
    paths: [],
    edges: [
      edge(5, 1, 5, 2),
      edge(5, 2, 5, 3),
      edge(5, 3, 5, 4),
      edge(5, 4, 5, 6),
    ],
  };
}

// GOL→SMI→GOL chain ban
function createGolSmiGolChainTest(): TempleState {
  return {
    architect: { x: 5, y: 6 },
    rooms: [
      room('GOLEM_WORKS', 3, 5, 2),
      room('SMITHY', 3, 5, 3),
      room('GOLEM_WORKS', 3, 5, 4),  // GOL→SMI→GOL
    ],
    paths: [],
    edges: [
      edge(5, 1, 5, 2),
      edge(5, 2, 5, 3),
      edge(5, 3, 5, 4),
      edge(5, 4, 5, 6),
    ],
  };
}

// SPY→LEG→SPY chain ban
function createSpyLegSpyChainTest(): TempleState {
  return {
    architect: { x: 5, y: 6 },
    rooms: [
      room('SPYMASTER', 3, 5, 2),
      room('LEGION_BARRACKS', 3, 5, 3),
      room('SPYMASTER', 3, 5, 4),  // SPY→LEG→SPY
    ],
    paths: [],
    edges: [
      edge(5, 1, 5, 2),
      edge(5, 2, 5, 3),
      edge(5, 3, 5, 4),
      edge(5, 4, 5, 6),
    ],
  };
}

// LEG→SPY→LEG chain ban
function createLegSpyLegChainTest(): TempleState {
  return {
    architect: { x: 5, y: 6 },
    rooms: [
      room('GARRISON', 3, 5, 2),  // Need GAR to connect to SPY
      room('LEGION_BARRACKS', 3, 4, 2),
      room('SPYMASTER', 3, 5, 3),
      room('LEGION_BARRACKS', 3, 5, 4),  // LEG→SPY→LEG
    ],
    paths: [],
    edges: [
      edge(5, 1, 5, 2),
      edge(5, 2, 4, 2),  // GAR → LEG
      edge(5, 2, 5, 3),  // GAR → SPY
      edge(5, 3, 5, 4),  // SPY → LEG
      edge(5, 2, 5, 6),
    ],
  };
}

// CMD cannot connect to LEGION_BARRACKS directly
function createCmdLegDirectTest(): TempleState {
  return {
    architect: { x: 5, y: 6 },
    rooms: [
      room('GARRISON', 3, 5, 2),
      room('COMMANDER', 3, 5, 3),
      room('LEGION_BARRACKS', 3, 5, 4),  // CMD→LEG direct
    ],
    paths: [],
    edges: [
      edge(5, 1, 5, 2),
      edge(5, 2, 5, 3),
      edge(5, 3, 5, 4),  // CMD→LEG - should fail!
      edge(5, 4, 5, 6),
    ],
  };
}

// =============================================================================
// SPECIAL RULES TESTS
// =============================================================================

// Only ONE Sacrificial Chamber allowed
function createTwoSacTest(): TempleState {
  return {
    architect: { x: 5, y: 6 },
    rooms: [
      room('CORRUPTION_CHAMBER', 3, 5, 2),
      room('SACRIFICIAL_CHAMBER', 3, 5, 3),
      room('CORRUPTION_CHAMBER', 3, 5, 4),
      room('SACRIFICIAL_CHAMBER', 3, 4, 4),  // Second SAC
    ],
    paths: [],
    edges: [
      edge(5, 1, 5, 2),
      edge(5, 2, 5, 3),
      edge(5, 3, 5, 4),
      edge(5, 4, 4, 4),
      edge(5, 4, 5, 6),
    ],
  };
}

// SYNTHFLESH cannot connect to LEGION_BARRACKS
function createSynLegTest(): TempleState {
  return {
    architect: { x: 5, y: 6 },
    rooms: [
      room('GARRISON', 3, 5, 2),
      room('SYNTHFLESH', 3, 5, 3),
      room('LEGION_BARRACKS', 3, 5, 4),  // SYN→LEG
    ],
    paths: [],
    edges: [
      edge(5, 1, 5, 2),
      edge(5, 2, 5, 3),
      edge(5, 3, 5, 4),
      edge(5, 4, 5, 6),
    ],
  };
}

type TestCategory = 'foyer' | 'self-adj' | 'can-child' | 'pairs' | 'limits' | 'chains' | 'path-req' | 'special';

export default function RuleExplorer() {
  const [category, setCategory] = useState<TestCategory>('foyer');
  const [results, setResults] = useState<Record<string, { valid: boolean; notes: string }>>({});
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  const copyUrl = async (url: string) => {
    await navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 1500);
  };

  const markResult = (key: string, valid: boolean, notes: string = '') => {
    setResults(prev => ({ ...prev, [key]: { valid, notes } }));
  };

  const exportResults = () => {
    const data = JSON.stringify(results, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'temple-rules-results.json';
    a.click();
  };

  const renderFoyerTests = () => (
    <div>
      <h3>Test: Can each room type connect directly to FOYER?</h3>
      <p style={{ color: '#888', marginBottom: '16px' }}>
        Click each link to open in Sulozor. If the temple shows as valid/connected, mark VALID.
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #444' }}>
            <th style={{ textAlign: 'left', padding: '8px' }}>Room Type</th>
            <th style={{ textAlign: 'left', padding: '8px' }}>Test Link</th>
            <th style={{ textAlign: 'center', padding: '8px' }}>Result</th>
            <th style={{ textAlign: 'left', padding: '8px' }}>Notes</th>
          </tr>
        </thead>
        <tbody>
          {ALL_ROOM_TYPES.map(roomType => {
            const key = `foyer-${roomType}`;
            const state = createFoyerTest(roomType);
            const url = exportToSulozorUrl(state);
            const result = results[key];

            return (
              <tr key={key} style={{ borderBottom: '1px solid #333' }}>
                <td style={{ padding: '8px' }}>
                  <strong>{SHORT_NAMES[roomType]}</strong> ({roomType})
                </td>
                <td style={{ padding: '8px' }}>
                  <a href={url} target="_blank" rel="noopener noreferrer"
                     style={{ color: '#88f', marginRight: '8px' }}>
                    Open in Sulozor
                  </a>
                  <button onClick={() => copyUrl(url)}
                          style={{ fontSize: '0.8em', padding: '2px 6px' }}>
                    {copiedUrl === url ? 'Copied!' : 'Copy'}
                  </button>
                </td>
                <td style={{ padding: '8px', textAlign: 'center' }}>
                  <button
                    onClick={() => markResult(key, true)}
                    style={{
                      marginRight: '4px',
                      padding: '4px 8px',
                      backgroundColor: result?.valid === true ? '#4a4' : '#333',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '4px',
                    }}>
                    VALID
                  </button>
                  <button
                    onClick={() => markResult(key, false)}
                    style={{
                      padding: '4px 8px',
                      backgroundColor: result?.valid === false ? '#a44' : '#333',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '4px',
                    }}>
                    INVALID
                  </button>
                </td>
                <td style={{ padding: '8px' }}>
                  <input
                    type="text"
                    placeholder="Notes..."
                    value={result?.notes || ''}
                    onChange={(e) => markResult(key, result?.valid ?? true, e.target.value)}
                    style={{
                      width: '100%',
                      padding: '4px',
                      backgroundColor: '#222',
                      border: '1px solid #444',
                      color: '#fff',
                    }}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const renderSelfAdjacencyTests = () => (
    <div>
      <h3>Test: Can each room type be adjacent to itself?</h3>
      <p style={{ color: '#888', marginBottom: '16px' }}>
        Tests if two rooms of the same type can be placed next to each other.
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #444' }}>
            <th style={{ textAlign: 'left', padding: '8px' }}>Room Type</th>
            <th style={{ textAlign: 'left', padding: '8px' }}>Test Link</th>
            <th style={{ textAlign: 'center', padding: '8px' }}>Result</th>
            <th style={{ textAlign: 'left', padding: '8px' }}>Notes</th>
          </tr>
        </thead>
        <tbody>
          {ALL_ROOM_TYPES.map(roomType => {
            const key = `self-${roomType}`;
            const state = createSelfAdjacencyTest(roomType);
            const url = exportToSulozorUrl(state);
            const result = results[key];

            return (
              <tr key={key} style={{ borderBottom: '1px solid #333' }}>
                <td style={{ padding: '8px' }}>
                  <strong>{SHORT_NAMES[roomType]}</strong> adjacent to <strong>{SHORT_NAMES[roomType]}</strong>
                </td>
                <td style={{ padding: '8px' }}>
                  <a href={url} target="_blank" rel="noopener noreferrer"
                     style={{ color: '#88f', marginRight: '8px' }}>
                    Open in Sulozor
                  </a>
                  <button onClick={() => copyUrl(url)}
                          style={{ fontSize: '0.8em', padding: '2px 6px' }}>
                    {copiedUrl === url ? 'Copied!' : 'Copy'}
                  </button>
                </td>
                <td style={{ padding: '8px', textAlign: 'center' }}>
                  <button
                    onClick={() => markResult(key, true)}
                    style={{
                      marginRight: '4px',
                      padding: '4px 8px',
                      backgroundColor: result?.valid === true ? '#4a4' : '#333',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '4px',
                    }}>
                    CAN
                  </button>
                  <button
                    onClick={() => markResult(key, false)}
                    style={{
                      padding: '4px 8px',
                      backgroundColor: result?.valid === false ? '#a44' : '#333',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '4px',
                    }}>
                    CANNOT
                  </button>
                </td>
                <td style={{ padding: '8px' }}>
                  <input
                    type="text"
                    placeholder="Notes..."
                    value={result?.notes || ''}
                    onChange={(e) => markResult(key, result?.valid ?? true, e.target.value)}
                    style={{
                      width: '100%',
                      padding: '4px',
                      backgroundColor: '#222',
                      border: '1px solid #444',
                      color: '#fff',
                    }}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const renderCanChildTests = () => (
    <div>
      <h3>Test: Can each room type have children?</h3>
      <p style={{ color: '#888', marginBottom: '16px' }}>
        Tests if a room can be a parent in the tree (have rooms connected after it).
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #444' }}>
            <th style={{ textAlign: 'left', padding: '8px' }}>Room Type</th>
            <th style={{ textAlign: 'left', padding: '8px' }}>Test Link</th>
            <th style={{ textAlign: 'center', padding: '8px' }}>Result</th>
            <th style={{ textAlign: 'left', padding: '8px' }}>Notes</th>
          </tr>
        </thead>
        <tbody>
          {ALL_ROOM_TYPES.map(roomType => {
            const key = `child-${roomType}`;
            const state = createCanHaveChildTest(roomType);
            const url = exportToSulozorUrl(state);
            const result = results[key];
            const childType = roomType === 'GARRISON' ? 'ARMOURY' : 'GARRISON';

            return (
              <tr key={key} style={{ borderBottom: '1px solid #333' }}>
                <td style={{ padding: '8px' }}>
                  <strong>{SHORT_NAMES[roomType]}</strong> → {SHORT_NAMES[childType]}
                </td>
                <td style={{ padding: '8px' }}>
                  <a href={url} target="_blank" rel="noopener noreferrer"
                     style={{ color: '#88f', marginRight: '8px' }}>
                    Open in Sulozor
                  </a>
                  <button onClick={() => copyUrl(url)}
                          style={{ fontSize: '0.8em', padding: '2px 6px' }}>
                    {copiedUrl === url ? 'Copied!' : 'Copy'}
                  </button>
                </td>
                <td style={{ padding: '8px', textAlign: 'center' }}>
                  <button
                    onClick={() => markResult(key, true)}
                    style={{
                      marginRight: '4px',
                      padding: '4px 8px',
                      backgroundColor: result?.valid === true ? '#4a4' : '#333',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '4px',
                    }}>
                    CAN
                  </button>
                  <button
                    onClick={() => markResult(key, false)}
                    style={{
                      padding: '4px 8px',
                      backgroundColor: result?.valid === false ? '#a44' : '#333',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '4px',
                    }}>
                    CANNOT
                  </button>
                </td>
                <td style={{ padding: '8px' }}>
                  <input
                    type="text"
                    placeholder="Notes..."
                    value={result?.notes || ''}
                    onChange={(e) => markResult(key, result?.valid ?? true, e.target.value)}
                    style={{
                      width: '100%',
                      padding: '4px',
                      backgroundColor: '#222',
                      border: '1px solid #444',
                      color: '#fff',
                    }}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const renderPairTests = () => {
    // Create all unique pairs
    const pairs: [Room['type'], Room['type']][] = [];
    for (let i = 0; i < ALL_ROOM_TYPES.length; i++) {
      for (let j = i + 1; j < ALL_ROOM_TYPES.length; j++) {
        pairs.push([ALL_ROOM_TYPES[i], ALL_ROOM_TYPES[j]]);
      }
    }

    return (
      <div>
        <h3>Test: Can different room types be adjacent?</h3>
        <p style={{ color: '#888', marginBottom: '16px' }}>
          Tests all unique pairs of different room types. ({pairs.length} combinations)
        </p>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #444' }}>
              <th style={{ textAlign: 'left', padding: '8px' }}>Room A</th>
              <th style={{ textAlign: 'left', padding: '8px' }}>Room B</th>
              <th style={{ textAlign: 'left', padding: '8px' }}>Test Link</th>
              <th style={{ textAlign: 'center', padding: '8px' }}>Result</th>
            </tr>
          </thead>
          <tbody>
            {pairs.map(([roomA, roomB]) => {
              const key = `pair-${roomA}-${roomB}`;
              const state = createPairAdjacencyTest(roomA, roomB);
              const url = exportToSulozorUrl(state);
              const result = results[key];

              return (
                <tr key={key} style={{ borderBottom: '1px solid #333' }}>
                  <td style={{ padding: '8px' }}>
                    <strong>{SHORT_NAMES[roomA]}</strong>
                  </td>
                  <td style={{ padding: '8px' }}>
                    <strong>{SHORT_NAMES[roomB]}</strong>
                  </td>
                  <td style={{ padding: '8px' }}>
                    <a href={url} target="_blank" rel="noopener noreferrer"
                       style={{ color: '#88f', marginRight: '8px' }}>
                      Open
                    </a>
                    <button onClick={() => copyUrl(url)}
                            style={{ fontSize: '0.8em', padding: '2px 6px' }}>
                      {copiedUrl === url ? '✓' : 'Copy'}
                    </button>
                  </td>
                  <td style={{ padding: '8px', textAlign: 'center' }}>
                    <button
                      onClick={() => markResult(key, true)}
                      style={{
                        marginRight: '4px',
                        padding: '4px 8px',
                        backgroundColor: result?.valid === true ? '#4a4' : '#333',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                      }}>
                      OK
                    </button>
                    <button
                      onClick={() => markResult(key, false)}
                      style={{
                        padding: '4px 8px',
                        backgroundColor: result?.valid === false ? '#a44' : '#333',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                      }}>
                      NO
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  // =========================================================================
  // NEW ADVANCED TESTS
  // =========================================================================

  const renderLimitsTests = () => {
    const tests = [
      {
        key: 'armoury-2smithy',
        name: 'ARMOURY with 2 SMITHY adjacent',
        description: 'Changelog v1.23 says Armoury max 1 Smithy. This tests 2 Smithy adjacent.',
        state: createArmouryTwoSmithyTest(),
        expectedValid: false,
      },
      {
        key: 'alchemy-2thau',
        name: 'ALCHEMY_LAB with 2 THAUMATURGE',
        description: 'Should be valid (max is 2)',
        state: createAlchemyTwoThauTest(),
        expectedValid: true,
      },
      {
        key: 'alchemy-3thau',
        name: 'ALCHEMY_LAB with 3 THAUMATURGE',
        description: 'Changelog v1.12 says Alchemy Lab max 2 Thau. This tests 3.',
        state: createAlchemyThreeThauTest(),
        expectedValid: false,
      },
    ];

    return (
      <div>
        <h3>Test: Adjacency Limits</h3>
        <p style={{ color: '#888', marginBottom: '16px' }}>
          Some rooms have limits on how many of a specific type can be adjacent.
        </p>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #444' }}>
              <th style={{ textAlign: 'left', padding: '8px' }}>Test</th>
              <th style={{ textAlign: 'left', padding: '8px' }}>Expected</th>
              <th style={{ textAlign: 'left', padding: '8px' }}>Link</th>
              <th style={{ textAlign: 'center', padding: '8px' }}>Result</th>
            </tr>
          </thead>
          <tbody>
            {tests.map(test => {
              const url = exportToSulozorUrl(test.state);
              const result = results[test.key];

              return (
                <tr key={test.key} style={{ borderBottom: '1px solid #333' }}>
                  <td style={{ padding: '8px' }}>
                    <strong>{test.name}</strong>
                    <div style={{ fontSize: '0.85em', color: '#888' }}>{test.description}</div>
                  </td>
                  <td style={{ padding: '8px', color: test.expectedValid ? '#4a4' : '#a44' }}>
                    {test.expectedValid ? 'VALID' : 'INVALID'}
                  </td>
                  <td style={{ padding: '8px' }}>
                    <a href={url} target="_blank" rel="noopener noreferrer"
                       style={{ color: '#88f', marginRight: '8px' }}>
                      Open in Sulozor
                    </a>
                  </td>
                  <td style={{ padding: '8px', textAlign: 'center' }}>
                    <button
                      onClick={() => markResult(test.key, true)}
                      style={{
                        marginRight: '4px',
                        padding: '4px 8px',
                        backgroundColor: result?.valid === true ? '#4a4' : '#333',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                      }}>
                      VALID
                    </button>
                    <button
                      onClick={() => markResult(test.key, false)}
                      style={{
                        padding: '4px 8px',
                        backgroundColor: result?.valid === false ? '#a44' : '#333',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                      }}>
                      INVALID
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const renderChainTests = () => {
    const tests = [
      {
        key: 'arm-gar-arm',
        name: 'ARM → GAR → ARM chain',
        description: 'Sulozor: "Armoury → Garrison → Armoury not allowed"',
        state: createArmGarArmChainTest(),
        expectedValid: false,
      },
      {
        key: 'alc-arm-alc',
        name: 'ALC → ARM → ALC chain',
        description: 'Sulozor: "Alchemy Lab → Armoury → Alchemy Lab → Armoury not allowed"',
        state: createAlcArmAlcChainTest(),
        expectedValid: false,
      },
      {
        key: 'thau-cor-thau',
        name: 'THAU → COR → THAU chain',
        description: 'Sulozor: "Thaumaturge → Corruption → Thaumaturge not allowed"',
        state: createThauCorThauChainTest(),
        expectedValid: false,
      },
      {
        key: 'gol-smi-gol',
        name: 'GOL → SMI → GOL chain',
        description: 'Sulozor: "Golem → Smithy → Golem not allowed"',
        state: createGolSmiGolChainTest(),
        expectedValid: false,
      },
      {
        key: 'spy-leg-spy',
        name: 'SPY → LEG → SPY chain',
        description: 'Sulozor: "Spymaster → Legion Barrack → Spymaster → Legion Barrack not allowed"',
        state: createSpyLegSpyChainTest(),
        expectedValid: false,
      },
      {
        key: 'leg-spy-leg',
        name: 'LEG → SPY → LEG chain',
        description: 'Sulozor: "Legion Barrack → Spymaster → Legion Barrack → Spymaster not allowed"',
        state: createLegSpyLegChainTest(),
        expectedValid: false,
      },
      {
        key: 'cmd-leg-direct',
        name: 'CMD → LEG direct connection',
        description: 'Sulozor: "Commander must be adjacent to Path, Garrison, or Transcendent Barrack (not Legion Barrack)"',
        state: createCmdLegDirectTest(),
        expectedValid: false,
      },
      {
        key: 'spy-cmd-linear',
        name: 'SPY → CMD Linear Chain',
        description: 'Sulozor: "Spymaster cannot be in a linear chain with Commander"',
        state: createSpyCmdLinearChainTest(),
        expectedValid: false,
      },
      {
        key: 'spy-cmd-branch',
        name: 'SPY + CMD Branching (not linear)',
        description: 'Spymaster and Commander as siblings from Garrison (not in chain). Should be valid.',
        state: createSpyCmdBranchTest(),
        expectedValid: true,
      },
    ];

    return (
      <div>
        <h3>Test: Chain Restrictions</h3>
        <p style={{ color: '#888', marginBottom: '16px' }}>
          Some room combinations have restrictions on how they can be chained together.
        </p>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #444' }}>
              <th style={{ textAlign: 'left', padding: '8px' }}>Test</th>
              <th style={{ textAlign: 'left', padding: '8px' }}>Expected</th>
              <th style={{ textAlign: 'left', padding: '8px' }}>Link</th>
              <th style={{ textAlign: 'center', padding: '8px' }}>Result</th>
            </tr>
          </thead>
          <tbody>
            {tests.map(test => {
              const url = exportToSulozorUrl(test.state);
              const result = results[test.key];

              return (
                <tr key={test.key} style={{ borderBottom: '1px solid #333' }}>
                  <td style={{ padding: '8px' }}>
                    <strong>{test.name}</strong>
                    <div style={{ fontSize: '0.85em', color: '#888' }}>{test.description}</div>
                  </td>
                  <td style={{ padding: '8px', color: test.expectedValid ? '#4a4' : '#a44' }}>
                    {test.expectedValid ? 'VALID' : 'INVALID'}
                  </td>
                  <td style={{ padding: '8px' }}>
                    <a href={url} target="_blank" rel="noopener noreferrer"
                       style={{ color: '#88f', marginRight: '8px' }}>
                      Open in Sulozor
                    </a>
                  </td>
                  <td style={{ padding: '8px', textAlign: 'center' }}>
                    <button
                      onClick={() => markResult(test.key, true)}
                      style={{
                        marginRight: '4px',
                        padding: '4px 8px',
                        backgroundColor: result?.valid === true ? '#4a4' : '#333',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                      }}>
                      VALID
                    </button>
                    <button
                      onClick={() => markResult(test.key, false)}
                      style={{
                        padding: '4px 8px',
                        backgroundColor: result?.valid === false ? '#a44' : '#333',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                      }}>
                      INVALID
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const renderPathReqTests = () => {
    const tests = [
      {
        key: 'gen-no-path',
        name: 'GENERATOR without PATH',
        description: 'Sulozor: "Generator must be connected to a Path"',
        state: createGeneratorNoPathTest(),
        expectedValid: false,
      },
      {
        key: 'gen-with-path',
        name: 'GENERATOR with PATH',
        description: 'Generator with PATH tile adjacent. Should be valid.',
        state: createGeneratorWithPathTest(),
        expectedValid: true,
      },
    ];

    return (
      <div>
        <h3>Test: PATH Requirements</h3>
        <p style={{ color: '#888', marginBottom: '16px' }}>
          Some rooms require PATH tiles to be adjacent.
        </p>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #444' }}>
              <th style={{ textAlign: 'left', padding: '8px' }}>Test</th>
              <th style={{ textAlign: 'left', padding: '8px' }}>Expected</th>
              <th style={{ textAlign: 'left', padding: '8px' }}>Link</th>
              <th style={{ textAlign: 'center', padding: '8px' }}>Result</th>
            </tr>
          </thead>
          <tbody>
            {tests.map(test => {
              const url = exportToSulozorUrl(test.state);
              const result = results[test.key];

              return (
                <tr key={test.key} style={{ borderBottom: '1px solid #333' }}>
                  <td style={{ padding: '8px' }}>
                    <strong>{test.name}</strong>
                    <div style={{ fontSize: '0.85em', color: '#888' }}>{test.description}</div>
                  </td>
                  <td style={{ padding: '8px', color: test.expectedValid ? '#4a4' : '#a44' }}>
                    {test.expectedValid ? 'VALID' : 'INVALID'}
                  </td>
                  <td style={{ padding: '8px' }}>
                    <a href={url} target="_blank" rel="noopener noreferrer"
                       style={{ color: '#88f', marginRight: '8px' }}>
                      Open in Sulozor
                    </a>
                  </td>
                  <td style={{ padding: '8px', textAlign: 'center' }}>
                    <button
                      onClick={() => markResult(test.key, true)}
                      style={{
                        marginRight: '4px',
                        padding: '4px 8px',
                        backgroundColor: result?.valid === true ? '#4a4' : '#333',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                      }}>
                      VALID
                    </button>
                    <button
                      onClick={() => markResult(test.key, false)}
                      style={{
                        padding: '4px 8px',
                        backgroundColor: result?.valid === false ? '#a44' : '#333',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                      }}>
                      INVALID
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const renderSpecialTests = () => {
    const tests = [
      {
        key: 'two-sac',
        name: 'Two SACRIFICIAL_CHAMBER',
        description: 'Sulozor: "Only one Sacrificial Chamber allowed"',
        state: createTwoSacTest(),
        expectedValid: false,
      },
      {
        key: 'syn-leg',
        name: 'SYNTHFLESH → LEGION_BARRACKS',
        description: 'Sulozor: "Synth Lab must be adjacent to Path, Flesh Surgeon, Garrison, or Transcendent Barrack (not Legion Barrack)"',
        state: createSynLegTest(),
        expectedValid: false,
      },
    ];

    return (
      <div>
        <h3>Test: Special Rules</h3>
        <p style={{ color: '#888', marginBottom: '16px' }}>
          Unique constraints from Sulozor validation.
        </p>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #444' }}>
              <th style={{ textAlign: 'left', padding: '8px' }}>Test</th>
              <th style={{ textAlign: 'left', padding: '8px' }}>Expected</th>
              <th style={{ textAlign: 'left', padding: '8px' }}>Link</th>
              <th style={{ textAlign: 'center', padding: '8px' }}>Result</th>
            </tr>
          </thead>
          <tbody>
            {tests.map(test => {
              const url = exportToSulozorUrl(test.state);
              const result = results[test.key];

              return (
                <tr key={test.key} style={{ borderBottom: '1px solid #333' }}>
                  <td style={{ padding: '8px' }}>
                    <strong>{test.name}</strong>
                    <div style={{ fontSize: '0.85em', color: '#888' }}>{test.description}</div>
                  </td>
                  <td style={{ padding: '8px', color: test.expectedValid ? '#4a4' : '#a44' }}>
                    {test.expectedValid ? 'VALID' : 'INVALID'}
                  </td>
                  <td style={{ padding: '8px' }}>
                    <a href={url} target="_blank" rel="noopener noreferrer"
                       style={{ color: '#88f', marginRight: '8px' }}>
                      Open in Sulozor
                    </a>
                  </td>
                  <td style={{ padding: '8px', textAlign: 'center' }}>
                    <button
                      onClick={() => markResult(test.key, true)}
                      style={{
                        marginRight: '4px',
                        padding: '4px 8px',
                        backgroundColor: result?.valid === true ? '#4a4' : '#333',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                      }}>
                      VALID
                    </button>
                    <button
                      onClick={() => markResult(test.key, false)}
                      style={{
                        padding: '4px 8px',
                        backgroundColor: result?.valid === false ? '#a44' : '#333',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                      }}>
                      INVALID
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const completedCount = Object.keys(results).length;

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <h1>Temple Rule Explorer</h1>
      <p style={{ color: '#888', marginBottom: '20px' }}>
        Systematically test and verify ALL possible room connection rules.
        <br />
        Click each link to open in Sulozor, then mark the result.
      </p>

      <div style={{ marginBottom: '20px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button
          onClick={() => setCategory('foyer')}
          style={{
            padding: '8px 16px',
            backgroundColor: category === 'foyer' ? '#446' : '#333',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
          }}>
          FOYER Connection (14)
        </button>
        <button
          onClick={() => setCategory('self-adj')}
          style={{
            padding: '8px 16px',
            backgroundColor: category === 'self-adj' ? '#446' : '#333',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
          }}>
          Self-Adjacency (14)
        </button>
        <button
          onClick={() => setCategory('can-child')}
          style={{
            padding: '8px 16px',
            backgroundColor: category === 'can-child' ? '#446' : '#333',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
          }}>
          Can Have Children (14)
        </button>
        <button
          onClick={() => setCategory('pairs')}
          style={{
            padding: '8px 16px',
            backgroundColor: category === 'pairs' ? '#446' : '#333',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
          }}>
          All Pairs (91)
        </button>
        <button
          onClick={() => setCategory('limits')}
          style={{
            padding: '8px 16px',
            backgroundColor: category === 'limits' ? '#864' : '#533',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
          }}>
          Adjacency Limits (3)
        </button>
        <button
          onClick={() => setCategory('chains')}
          style={{
            padding: '8px 16px',
            backgroundColor: category === 'chains' ? '#864' : '#533',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
          }}>
          Chain Rules (9)
        </button>
        <button
          onClick={() => setCategory('path-req')}
          style={{
            padding: '8px 16px',
            backgroundColor: category === 'path-req' ? '#864' : '#533',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
          }}>
          PATH Requirements (2)
        </button>
        <button
          onClick={() => setCategory('special')}
          style={{
            padding: '8px 16px',
            backgroundColor: category === 'special' ? '#864' : '#533',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
          }}>
          Special Rules (2)
        </button>
      </div>

      <div style={{ marginBottom: '20px', display: 'flex', gap: '16px', alignItems: 'center' }}>
        <span>Progress: {completedCount} tests completed</span>
        <button onClick={exportResults} style={{ padding: '8px 16px' }}>
          Export Results (JSON)
        </button>
        <button onClick={() => setResults({})} style={{ padding: '8px 16px', backgroundColor: '#633' }}>
          Clear All Results
        </button>
      </div>

      <div style={{ backgroundColor: '#1a1a1a', padding: '20px', borderRadius: '8px' }}>
        {category === 'foyer' && renderFoyerTests()}
        {category === 'self-adj' && renderSelfAdjacencyTests()}
        {category === 'can-child' && renderCanChildTests()}
        {category === 'pairs' && renderPairTests()}
        {category === 'limits' && renderLimitsTests()}
        {category === 'chains' && renderChainTests()}
        {category === 'path-req' && renderPathReqTests()}
        {category === 'special' && renderSpecialTests()}
      </div>

      <div style={{ marginTop: '40px', padding: '20px', backgroundColor: '#222', borderRadius: '8px' }}>
        <h2>Current Test Results Summary</h2>
        {Object.keys(results).length === 0 ? (
          <p style={{ color: '#888' }}>No tests completed yet. Start testing above!</p>
        ) : (
          <div>
            <h4 style={{ color: '#a44' }}>INVALID/CANNOT connections found:</h4>
            <ul>
              {Object.entries(results)
                .filter(([_, r]) => r.valid === false)
                .map(([key, r]) => (
                  <li key={key}>{key} {r.notes && `- ${r.notes}`}</li>
                ))}
              {Object.entries(results).filter(([_, r]) => r.valid === false).length === 0 && (
                <li style={{ color: '#888' }}>None found yet</li>
              )}
            </ul>
          </div>
        )}
      </div>

      <div style={{ marginTop: '20px', textAlign: 'center' }}>
        <a href="#/" style={{ color: '#88f', marginRight: '20px' }}>Back to Solver</a>
        <a href="#/rules" style={{ color: '#88f' }}>View Confirmed Rules</a>
      </div>
    </div>
  );
}
