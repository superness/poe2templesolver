#!/usr/bin/env node
/**
 * Test connection rules by creating Sulozor URLs and verifying connectivity
 */
import puppeteer from 'puppeteer';

const GRID_SIZE = 9;

// Sulozor room indices (from state-parser.ts)
const ROOM_INDICES = {
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
 * Create a Sulozor URL from room placements
 */
function createSulozorUrl(placements) {
  const bytes = [0]; // Version byte
  for (let i = 0; i < 81; i++) bytes.push(0);

  for (const p of placements) {
    const cellIdx = (GRID_SIZE - p.y) * GRID_SIZE + (p.x - 1);
    const byteIdx = 1 + cellIdx;
    const roomIdx = ROOM_INDICES[p.room] ?? 0;
    const tierIdx = (p.tier || 1) - 1;
    bytes[byteIdx] = (roomIdx << 3) | tierIdx;
  }

  const buffer = Buffer.from(bytes);
  return `https://sulozor.github.io/?t=${buffer.toString('base64')}`;
}

/**
 * Extract connection state from Sulozor
 *
 * Detection method: Check for "Place rooms to see effects" text.
 * If present, at least one room is NOT contributing bonuses.
 * The chain count shows how many rooms are connected.
 */
async function extractConnectionState(page, url) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  return await page.evaluate(() => {
    const result = {
      rooms: [],
      hasActiveBonuses: false,
      chainCount: 0,
      connectedRoomCount: 0,
    };

    const pageText = document.body.innerText;

    // "Place rooms to see effects" means no bonuses are active
    result.hasActiveBonuses = !pageText.includes('Place rooms to see effects');

    // Chain count from "CHAINS (N)"
    const chainMatch = pageText.match(/CHAINS?\s*\((\d+)\)/i);
    if (chainMatch) result.chainCount = parseInt(chainMatch[1]);

    // Connected room count from "N rooms +"
    const roomCountMatch = pageText.match(/(\d+)\s*rooms?\s*\+/);
    if (roomCountMatch) result.connectedRoomCount = parseInt(roomCountMatch[1]);

    // Get all room cells
    const cells = document.querySelectorAll('[class*="_cell_"][class*="_1v2jo_"]');

    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const img = cell.querySelector('[class*="_cellContent_"] img');
      if (!img) continue;

      const gridY = 9 - Math.floor(i / 9);
      const gridX = (i % 9) + 1;

      result.rooms.push({
        x: gridX,
        y: gridY,
        imageName: img.src.split('/').pop(),
      });
    }

    return result;
  });
}

/**
 * Run a single test case
 *
 * New approach: Instead of checking per-room colors, we check:
 * - hasActiveBonuses: true means ALL placed rooms are connected
 * - connectedRoomCount: how many rooms are in the chain
 * - Expected connected count must match actual connected count
 */
async function runTest(page, testCase) {
  const url = createSulozorUrl(testCase.placements);
  const state = await extractConnectionState(page, url);

  const results = {
    name: testCase.name,
    url,
    passed: true,
    details: [],
  };

  // Count expected connected rooms (excluding FOYER/PATH)
  const expectedConnected = testCase.expected.filter(e => e.connected).length;
  const expectedDisconnected = testCase.expected.filter(e => !e.connected).length;

  // If we expect all rooms connected, hasActiveBonuses should be true
  // and connectedRoomCount should match expected
  if (expectedDisconnected === 0 && expectedConnected > 0) {
    // All rooms should be connected
    if (!state.hasActiveBonuses) {
      results.passed = false;
      results.details.push(`Expected all rooms connected, but "Place rooms to see effects" shown`);
    } else if (state.connectedRoomCount !== expectedConnected) {
      results.passed = false;
      results.details.push(`Expected ${expectedConnected} connected rooms, got ${state.connectedRoomCount}`);
    } else {
      results.details.push(`All ${expectedConnected} rooms connected ✓`);
    }
  } else if (expectedDisconnected > 0 && expectedConnected === 0) {
    // All tested rooms should be disconnected
    if (state.hasActiveBonuses && state.connectedRoomCount > 0) {
      results.passed = false;
      results.details.push(`Expected disconnected, but ${state.connectedRoomCount} rooms are connected`);
    } else {
      results.details.push(`Room(s) correctly disconnected ✓`);
    }
  } else if (expectedConnected > 0 && expectedDisconnected > 0) {
    // Mixed case: some connected, some not
    // hasActiveBonuses might be true or false depending on test structure
    // Check if connected count matches expected
    if (state.connectedRoomCount === expectedConnected) {
      results.details.push(`${expectedConnected} connected, ${expectedDisconnected} disconnected ✓`);
    } else {
      results.passed = false;
      results.details.push(`Expected ${expectedConnected} connected, got ${state.connectedRoomCount}`);
    }
  }

  // Additional state info
  results.hasActiveBonuses = state.hasActiveBonuses;
  results.chainCount = state.chainCount;
  results.connectedRoomCount = state.connectedRoomCount;
  results.roomCount = state.rooms.length;

  return results;
}

// ============================================
// TEST CASES
// ============================================

const TEST_CASES = [
  // === BASIC FOYER CONNECTION TESTS ===
  {
    name: 'PATH at FOYER position only',
    placements: [
      { x: 5, y: 1, room: 'PATH', tier: 1 },
    ],
    expected: [],  // No rooms to test (PATH is FOYER itself)
  },
  {
    name: 'GARRISON adjacent to FOYER (5,2)',
    placements: [
      { x: 5, y: 1, room: 'PATH', tier: 1 },
      { x: 5, y: 2, room: 'GARRISON', tier: 1 },
    ],
    expected: [
      { x: 5, y: 2, connected: true },
    ],
  },
  {
    name: 'GARRISON diagonal to FOYER (6,2) - should NOT connect',
    placements: [
      { x: 5, y: 1, room: 'PATH', tier: 1 },
      { x: 6, y: 2, room: 'GARRISON', tier: 1 },
    ],
    expected: [
      { x: 6, y: 2, connected: false },
    ],
  },
  {
    name: 'GARRISON at (4,1) - horizontal adjacent to FOYER',
    placements: [
      { x: 5, y: 1, room: 'PATH', tier: 1 },
      { x: 4, y: 1, room: 'GARRISON', tier: 1 },
    ],
    expected: [
      { x: 4, y: 1, connected: true },
    ],
  },

  // === ROOMS THAT CONNECT DIRECTLY TO PATH ===
  {
    name: 'ARMOURY connects directly to PATH',
    placements: [
      { x: 5, y: 1, room: 'PATH', tier: 1 },
      { x: 5, y: 2, room: 'ARMOURY', tier: 1 },
    ],
    expected: [
      { x: 5, y: 2, connected: true },  // ARMOURY CAN connect to PATH
    ],
  },
  {
    name: 'COMMANDER connects directly to PATH',
    placements: [
      { x: 5, y: 1, room: 'PATH', tier: 1 },
      { x: 5, y: 2, room: 'COMMANDER', tier: 1 },
    ],
    expected: [
      { x: 5, y: 2, connected: true },  // COMMANDER CAN connect to PATH
    ],
  },
  {
    name: 'GENERATOR connects directly to PATH',
    placements: [
      { x: 5, y: 1, room: 'PATH', tier: 1 },
      { x: 5, y: 2, room: 'GENERATOR', tier: 1 },
    ],
    expected: [
      { x: 5, y: 2, connected: true },
    ],
  },
  {
    name: 'SMITHY connects directly to PATH',
    placements: [
      { x: 5, y: 1, room: 'PATH', tier: 1 },
      { x: 5, y: 2, room: 'SMITHY', tier: 1 },
    ],
    expected: [
      { x: 5, y: 2, connected: true },
    ],
  },
  {
    name: 'ALCHEMY_LAB connects directly to PATH',
    placements: [
      { x: 5, y: 1, room: 'PATH', tier: 1 },
      { x: 5, y: 2, room: 'ALCHEMY_LAB', tier: 1 },
    ],
    expected: [
      { x: 5, y: 2, connected: true },
    ],
  },

  // === ROOMS THAT CANNOT CONNECT TO PATH ===
  {
    name: 'SPYMASTER cannot connect directly to PATH',
    placements: [
      { x: 5, y: 1, room: 'PATH', tier: 1 },
      { x: 5, y: 2, room: 'SPYMASTER', tier: 1 },
    ],
    expected: [
      { x: 5, y: 2, connected: false },  // SPYMASTER needs GARRISON or LEGION_BARRACKS
    ],
  },
  {
    name: 'GOLEM_WORKS cannot connect directly to PATH',
    placements: [
      { x: 5, y: 1, room: 'PATH', tier: 1 },
      { x: 5, y: 2, room: 'GOLEM_WORKS', tier: 1 },
    ],
    expected: [
      { x: 5, y: 2, connected: false },  // GOLEM_WORKS needs SMITHY
    ],
  },
  {
    name: 'THAUMATURGE cannot connect directly to PATH',
    placements: [
      { x: 5, y: 1, room: 'PATH', tier: 1 },
      { x: 5, y: 2, room: 'THAUMATURGE', tier: 1 },
    ],
    expected: [
      { x: 5, y: 2, connected: false },  // THAUMATURGE needs GENERATOR/ALCHEMY_LAB/etc.
    ],
  },

  // === CHAIN CONNECTIVITY TESTS ===
  {
    name: 'Chain: PATH -> GARRISON -> SPYMASTER',
    placements: [
      { x: 5, y: 1, room: 'PATH', tier: 1 },
      { x: 5, y: 2, room: 'GARRISON', tier: 1 },
      { x: 5, y: 3, room: 'SPYMASTER', tier: 1 },
    ],
    expected: [
      { x: 5, y: 2, connected: true },
      { x: 5, y: 3, connected: true },
    ],
  },
  {
    name: 'Chain: PATH -> GARRISON -> COMMANDER',
    placements: [
      { x: 5, y: 1, room: 'PATH', tier: 1 },
      { x: 5, y: 2, room: 'GARRISON', tier: 1 },
      { x: 5, y: 3, room: 'COMMANDER', tier: 1 },
    ],
    expected: [
      { x: 5, y: 2, connected: true },
      { x: 5, y: 3, connected: true },
    ],
  },
  {
    name: 'Chain: PATH -> SMITHY -> GOLEM_WORKS',
    placements: [
      { x: 5, y: 1, room: 'PATH', tier: 1 },
      { x: 5, y: 2, room: 'SMITHY', tier: 1 },
      { x: 5, y: 3, room: 'GOLEM_WORKS', tier: 1 },
    ],
    expected: [
      { x: 5, y: 2, connected: true },
      { x: 5, y: 3, connected: true },
    ],
  },
  {
    name: 'Chain: PATH -> GENERATOR -> THAUMATURGE',
    placements: [
      { x: 5, y: 1, room: 'PATH', tier: 1 },
      { x: 5, y: 2, room: 'GENERATOR', tier: 1 },
      { x: 5, y: 3, room: 'THAUMATURGE', tier: 1 },
    ],
    expected: [
      { x: 5, y: 2, connected: true },
      { x: 5, y: 3, connected: true },
    ],
  },
  {
    name: 'Chain: PATH -> ALCHEMY_LAB -> THAUMATURGE',
    placements: [
      { x: 5, y: 1, room: 'PATH', tier: 1 },
      { x: 5, y: 2, room: 'ALCHEMY_LAB', tier: 1 },
      { x: 5, y: 3, room: 'THAUMATURGE', tier: 1 },
    ],
    expected: [
      { x: 5, y: 2, connected: true },
      { x: 5, y: 3, connected: true },
    ],
  },

  // === GARRISON CHILDREN ===
  {
    name: 'GARRISON -> ARMOURY chain',
    placements: [
      { x: 5, y: 1, room: 'PATH', tier: 1 },
      { x: 5, y: 2, room: 'GARRISON', tier: 1 },
      { x: 5, y: 3, room: 'ARMOURY', tier: 1 },
    ],
    expected: [
      { x: 5, y: 2, connected: true },
      { x: 5, y: 3, connected: true },
    ],
  },
  {
    name: 'GARRISON -> SYNTHFLESH chain',
    placements: [
      { x: 5, y: 1, room: 'PATH', tier: 1 },
      { x: 5, y: 2, room: 'GARRISON', tier: 1 },
      { x: 5, y: 3, room: 'SYNTHFLESH', tier: 1 },
    ],
    expected: [
      { x: 5, y: 2, connected: true },
      { x: 5, y: 3, connected: true },
    ],
  },

  // === ISOLATED ROOM TEST ===
  {
    name: 'Isolated room (no connection to FOYER)',
    placements: [
      { x: 5, y: 1, room: 'PATH', tier: 1 },
      { x: 8, y: 8, room: 'GARRISON', tier: 1 },
    ],
    expected: [
      { x: 8, y: 8, connected: false },
    ],
  },

  // === INVALID PARENT TEST ===
  {
    name: 'GOLEM_WORKS with wrong parent (GENERATOR instead of SMITHY)',
    placements: [
      { x: 5, y: 1, room: 'PATH', tier: 1 },
      { x: 5, y: 2, room: 'GENERATOR', tier: 1 },
      { x: 5, y: 3, room: 'GOLEM_WORKS', tier: 1 },
    ],
    expected: [
      { x: 5, y: 2, connected: true },
      { x: 5, y: 3, connected: false },  // GOLEM_WORKS only connects via SMITHY
    ],
  },
];

// ============================================
// MAIN
// ============================================

async function main() {
  console.log('=== SULOZOR CONNECTION RULES TEST ===\n');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });

  let passed = 0;
  let failed = 0;

  for (const testCase of TEST_CASES) {
    try {
      const result = await runTest(page, testCase);

      if (result.passed) {
        console.log(`✓ ${result.name}`);
        passed++;
      } else {
        console.log(`✗ ${result.name}`);
        failed++;
      }

      for (const detail of result.details) {
        console.log(`    ${detail}`);
      }

      console.log(`    [Bonuses: ${result.hasActiveBonuses ? 'active' : 'inactive'}, Chains: ${result.chainCount}, Connected: ${result.connectedRoomCount}]`)

      console.log('');
    } catch (err) {
      console.log(`✗ ${testCase.name} - ERROR: ${err.message}\n`);
      failed++;
    }
  }

  await browser.close();

  console.log('=== SUMMARY ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total: ${passed + failed}`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
