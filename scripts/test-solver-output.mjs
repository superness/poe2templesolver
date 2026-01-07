#!/usr/bin/env node
/**
 * Test solver output by running solutions through Sulozor verification
 */
import puppeteer from 'puppeteer';

const GRID_SIZE = 9;

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

function createSulozorUrl(placements) {
  const bytes = [0];
  for (let i = 0; i < 81; i++) bytes.push(0);

  for (const p of placements) {
    const cellIdx = (GRID_SIZE - p.y) * GRID_SIZE + (p.x - 1);
    const byteIdx = 1 + cellIdx;
    const roomIdx = ROOM_INDICES[p.room] ?? 0;
    const tierIdx = (p.tier || 1) - 1;
    bytes[byteIdx] = (roomIdx << 3) | tierIdx;
  }

  return `https://sulozor.github.io/?t=${Buffer.from(bytes).toString('base64')}`;
}

async function verifyInSulozor(page, placements, testName) {
  const url = createSulozorUrl(placements);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  const data = await page.evaluate(() => {
    const text = document.body.innerText;
    return {
      hasPlaceRooms: text.includes('Place rooms to see effects'),
      chainMatch: text.match(/CHAINS?\s*\((\d+)\)/i),
      roomCountMatch: text.match(/(\d+)\s*rooms?\s*\+/),
    };
  });

  const roomCount = placements.filter(p => p.room !== 'PATH').length;
  const connectedCount = data.roomCountMatch ? parseInt(data.roomCountMatch[1]) : 0;
  const allConnected = !data.hasPlaceRooms && connectedCount === roomCount;

  console.log(`\n${testName}:`);
  console.log(`  URL: ${url}`);
  console.log(`  Rooms: ${roomCount}, Connected: ${connectedCount}`);
  console.log(`  Status: ${allConnected ? '✓ ALL CONNECTED' : '✗ DISCONNECTED ROOMS'}`);

  return allConnected;
}

async function main() {
  console.log('=== SOLVER OUTPUT VERIFICATION ===\n');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });

  // Test cases representing typical solver output patterns
  const testCases = [
    // === VALID CHAINS ===
    {
      name: 'Simple chain: GARRISON -> SPYMASTER',
      placements: [
        { x: 5, y: 1, room: 'PATH', tier: 1 },
        { x: 5, y: 2, room: 'GARRISON', tier: 1 },
        { x: 5, y: 3, room: 'SPYMASTER', tier: 1 },
      ],
    },
    {
      name: 'SMITHY -> GOLEM_WORKS chain',
      placements: [
        { x: 5, y: 1, room: 'PATH', tier: 1 },
        { x: 5, y: 2, room: 'SMITHY', tier: 1 },
        { x: 5, y: 3, room: 'GOLEM_WORKS', tier: 1 },
      ],
    },
    {
      name: 'GENERATOR -> THAUMATURGE chain',
      placements: [
        { x: 5, y: 1, room: 'PATH', tier: 1 },
        { x: 5, y: 2, room: 'GENERATOR', tier: 1 },
        { x: 5, y: 3, room: 'THAUMATURGE', tier: 1 },
      ],
    },
    {
      name: 'Long linear chain: GARRISON -> ARMOURY -> SMITHY',
      placements: [
        { x: 5, y: 1, room: 'PATH', tier: 1 },
        { x: 5, y: 2, room: 'GARRISON', tier: 1 },
        { x: 5, y: 3, room: 'ARMOURY', tier: 1 },
        { x: 5, y: 4, room: 'SMITHY', tier: 1 },
      ],
    },
    {
      name: 'Long linear chain: GARRISON -> ARMOURY -> SMITHY -> GOLEM_WORKS',
      placements: [
        { x: 5, y: 1, room: 'PATH', tier: 1 },
        { x: 5, y: 2, room: 'GARRISON', tier: 1 },
        { x: 5, y: 3, room: 'ARMOURY', tier: 1 },
        { x: 5, y: 4, room: 'SMITHY', tier: 1 },
        { x: 5, y: 5, room: 'GOLEM_WORKS', tier: 1 },
      ],
    },
    {
      name: 'T3 rooms',
      placements: [
        { x: 5, y: 1, room: 'PATH', tier: 1 },
        { x: 5, y: 2, room: 'GARRISON', tier: 3 },
        { x: 5, y: 3, room: 'SPYMASTER', tier: 3 },
      ],
    },
    // === LEAF ROOMS AT FOYER (should connect) ===
    {
      name: 'Single CORRUPTION at FOYER',
      placements: [
        { x: 5, y: 1, room: 'PATH', tier: 1 },
        { x: 5, y: 2, room: 'CORRUPTION_CHAMBER', tier: 3 },
      ],
    },
    {
      name: 'Single SACRIFICIAL at FOYER',
      placements: [
        { x: 5, y: 1, room: 'PATH', tier: 1 },
        { x: 5, y: 2, room: 'SACRIFICIAL_CHAMBER', tier: 3 },
      ],
    },
    {
      name: 'Single ALCHEMY_LAB at FOYER',
      placements: [
        { x: 5, y: 1, room: 'PATH', tier: 1 },
        { x: 5, y: 2, room: 'ALCHEMY_LAB', tier: 3 },
      ],
    },
    // === LEAF ROOMS CANNOT CHAIN (second room should disconnect) ===
    {
      name: 'CORRUPTION -> CORRUPTION (leaf cant chain)',
      expectFail: true,
      placements: [
        { x: 5, y: 1, room: 'PATH', tier: 1 },
        { x: 5, y: 2, room: 'CORRUPTION_CHAMBER', tier: 1 },
        { x: 5, y: 3, room: 'CORRUPTION_CHAMBER', tier: 1 },
      ],
    },
    {
      name: 'ALCHEMY_LAB -> CORRUPTION (leaf cant chain)',
      expectFail: true,
      placements: [
        { x: 5, y: 1, room: 'PATH', tier: 1 },
        { x: 5, y: 2, room: 'ALCHEMY_LAB', tier: 1 },
        { x: 5, y: 3, room: 'CORRUPTION_CHAMBER', tier: 1 },
      ],
    },
    // === VALID THAUMATURGE PARENTS ===
    {
      name: 'CORRUPTION -> THAUMATURGE (valid)',
      placements: [
        { x: 5, y: 1, room: 'PATH', tier: 1 },
        { x: 5, y: 2, room: 'CORRUPTION_CHAMBER', tier: 1 },
        { x: 5, y: 3, room: 'THAUMATURGE', tier: 1 },
      ],
    },
    {
      name: 'ALCHEMY_LAB -> THAUMATURGE (valid)',
      placements: [
        { x: 5, y: 1, room: 'PATH', tier: 1 },
        { x: 5, y: 2, room: 'ALCHEMY_LAB', tier: 1 },
        { x: 5, y: 3, room: 'THAUMATURGE', tier: 1 },
      ],
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    const allConnected = await verifyInSulozor(page, testCase.placements, testCase.name);
    const expectedToFail = testCase.expectFail === true;

    // For expectFail tests, we expect NOT all connected
    const success = expectedToFail ? !allConnected : allConnected;

    if (expectedToFail) {
      console.log(`  Expected: ${expectedToFail ? 'FAIL' : 'PASS'} - ${success ? '✓ CORRECT' : '✗ WRONG'}`);
    }

    if (success) passed++;
    else failed++;
  }

  await browser.close();

  console.log('\n=== SUMMARY ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);
