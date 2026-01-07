#!/usr/bin/env node
/**
 * Batch comparison of visual indicators across different connection states
 * Collects colors, borders, shadows for connected vs disconnected rooms
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

// Test scenarios with expected connection states
const SCENARIOS = [
  {
    name: 'CONNECTED: GARRISON adjacent to FOYER',
    placements: [
      { x: 5, y: 1, room: 'PATH', tier: 1 },
      { x: 5, y: 2, room: 'GARRISON', tier: 1 },
    ],
    checkRoom: { x: 5, y: 2, expectedConnected: true },
  },
  {
    name: 'DISCONNECTED: GARRISON isolated at (8,8)',
    placements: [
      { x: 5, y: 1, room: 'PATH', tier: 1 },
      { x: 8, y: 8, room: 'GARRISON', tier: 1 },
    ],
    checkRoom: { x: 8, y: 8, expectedConnected: false },
  },
  {
    name: 'CONNECTED: GARRISON->SPYMASTER chain',
    placements: [
      { x: 5, y: 1, room: 'PATH', tier: 1 },
      { x: 5, y: 2, room: 'GARRISON', tier: 1 },
      { x: 5, y: 3, room: 'SPYMASTER', tier: 1 },
    ],
    checkRoom: { x: 5, y: 3, expectedConnected: true },
  },
  {
    name: 'DISCONNECTED: SPYMASTER directly on FOYER (invalid)',
    placements: [
      { x: 5, y: 1, room: 'PATH', tier: 1 },
      { x: 5, y: 2, room: 'SPYMASTER', tier: 1 },
    ],
    checkRoom: { x: 5, y: 2, expectedConnected: false },
  },
  {
    name: 'CONNECTED: GENERATOR adjacent to FOYER',
    placements: [
      { x: 5, y: 1, room: 'PATH', tier: 1 },
      { x: 5, y: 2, room: 'GENERATOR', tier: 1 },
    ],
    checkRoom: { x: 5, y: 2, expectedConnected: true },
  },
  {
    name: 'DISCONNECTED: ARMOURY directly on FOYER (needs GARRISON)',
    placements: [
      { x: 5, y: 1, room: 'PATH', tier: 1 },
      { x: 5, y: 2, room: 'ARMOURY', tier: 1 },
    ],
    checkRoom: { x: 5, y: 2, expectedConnected: false },
  },
  {
    name: 'CONNECTED: T3 GARRISON adjacent to FOYER',
    placements: [
      { x: 5, y: 1, room: 'PATH', tier: 1 },
      { x: 5, y: 2, room: 'GARRISON', tier: 3 },
    ],
    checkRoom: { x: 5, y: 2, expectedConnected: true },
  },
  {
    name: 'CONNECTED: horizontal adjacent GARRISON at (4,1)',
    placements: [
      { x: 5, y: 1, room: 'PATH', tier: 1 },
      { x: 4, y: 1, room: 'GARRISON', tier: 1 },
    ],
    checkRoom: { x: 4, y: 1, expectedConnected: true },
  },
  {
    name: 'DISCONNECTED: diagonal GARRISON at (6,2)',
    placements: [
      { x: 5, y: 1, room: 'PATH', tier: 1 },
      { x: 6, y: 2, room: 'GARRISON', tier: 1 },
    ],
    checkRoom: { x: 6, y: 2, expectedConnected: false },
  },
];

async function extractVisualData(page, url) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2500));

  return await page.evaluate(() => {
    const result = {
      hasChains: false,
      chainCount: 0,
      hasActiveBonuses: false,
      cells: [],
    };

    const pageText = document.body.innerText;
    result.hasActiveBonuses = !pageText.includes('Place rooms to see effects');
    const chainMatch = pageText.match(/CHAINS?\s*\((\d+)\)/i);
    if (chainMatch) {
      result.hasChains = true;
      result.chainCount = parseInt(chainMatch[1]);
    }

    const cells = document.querySelectorAll('[class*="_cell_"][class*="_1v2jo_"]');

    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const img = cell.querySelector('[class*="_cellContent_"] img');
      if (!img) continue;

      const gridY = 9 - Math.floor(i / 9);
      const gridX = (i % 9) + 1;

      const cellStyle = window.getComputedStyle(cell);
      const cellData = {
        x: gridX,
        y: gridY,
        image: img.src.split('/').pop(),
        cellBorder: cellStyle.borderColor,
        cellBg: cellStyle.backgroundColor,
        cellBoxShadow: cellStyle.boxShadow,
        tierColors: [],
        allElementColors: [],
      };

      // Get ALL color info from tier elements
      const elements = cell.querySelectorAll('span, div');
      for (const el of elements) {
        const text = el.innerText?.trim();
        const style = window.getComputedStyle(el);

        if (/^(I{1,3}|[123])$/.test(text)) {
          cellData.tierColors.push({
            text,
            color: style.color,
            bgColor: style.backgroundColor,
          });
        }

        // Collect all non-trivial colors
        if (text && style.color !== 'rgb(0, 0, 0)') {
          cellData.allElementColors.push({
            text: text.substring(0, 15),
            color: style.color,
          });
        }
      }

      result.cells.push(cellData);
    }

    return result;
  });
}

function parseRgb(colorStr) {
  const m = colorStr?.match(/rgb[a]?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) return { r: parseInt(m[1]), g: parseInt(m[2]), b: parseInt(m[3]) };
  return null;
}

async function main() {
  console.log('=== BATCH COLOR COMPARISON ===\n');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });

  const results = [];

  for (const scenario of SCENARIOS) {
    const url = createSulozorUrl(scenario.placements);
    const data = await extractVisualData(page, url);

    const targetCell = data.cells.find(
      c => c.x === scenario.checkRoom.x && c.y === scenario.checkRoom.y
    );

    results.push({
      name: scenario.name,
      expected: scenario.checkRoom.expectedConnected ? 'CONNECTED' : 'DISCONNECTED',
      hasChains: data.hasChains,
      chainCount: data.chainCount,
      hasActiveBonuses: data.hasActiveBonuses,
      cell: targetCell,
    });
  }

  await browser.close();

  // Display results grouped by expected state
  console.log('=== EXPECTED CONNECTED ===\n');
  for (const r of results.filter(r => r.expected === 'CONNECTED')) {
    console.log(`${r.name}`);
    console.log(`  Chains: ${r.hasChains ? r.chainCount : 'none'}, Active bonuses: ${r.hasActiveBonuses ? 'YES' : 'no'}`);
    if (r.cell) {
      console.log(`  Cell border: ${r.cell.cellBorder}`);
      console.log(`  Cell boxShadow: ${r.cell.cellBoxShadow?.substring(0, 80) || 'none'}`);
      console.log(`  Tier colors:`);
      for (const tc of r.cell.tierColors) {
        const rgb = parseRgb(tc.color);
        console.log(`    "${tc.text}" -> ${tc.color} (R=${rgb?.r}, G=${rgb?.g}, B=${rgb?.b})`);
      }
    }
    console.log('');
  }

  console.log('\n=== EXPECTED DISCONNECTED ===\n');
  for (const r of results.filter(r => r.expected === 'DISCONNECTED')) {
    console.log(`${r.name}`);
    console.log(`  Chains: ${r.hasChains ? r.chainCount : 'none'}, Active bonuses: ${r.hasActiveBonuses ? 'YES' : 'no'}`);
    if (r.cell) {
      console.log(`  Cell border: ${r.cell.cellBorder}`);
      console.log(`  Cell boxShadow: ${r.cell.cellBoxShadow?.substring(0, 80) || 'none'}`);
      console.log(`  Tier colors:`);
      for (const tc of r.cell.tierColors) {
        const rgb = parseRgb(tc.color);
        console.log(`    "${tc.text}" -> ${tc.color} (R=${rgb?.r}, G=${rgb?.g}, B=${rgb?.b})`);
      }
    }
    console.log('');
  }

  // Summary comparison
  console.log('\n=== COLOR SUMMARY ===\n');

  const connectedColors = new Set();
  const disconnectedColors = new Set();

  for (const r of results) {
    if (r.cell) {
      for (const tc of r.cell.tierColors) {
        if (r.expected === 'CONNECTED') {
          connectedColors.add(tc.color);
        } else {
          disconnectedColors.add(tc.color);
        }
      }
    }
  }

  console.log('Colors found in CONNECTED rooms:');
  for (const c of connectedColors) {
    const rgb = parseRgb(c);
    console.log(`  ${c} (R=${rgb?.r}, G=${rgb?.g}, B=${rgb?.b})`);
  }

  console.log('\nColors found in DISCONNECTED rooms:');
  for (const c of disconnectedColors) {
    const rgb = parseRgb(c);
    console.log(`  ${c} (R=${rgb?.r}, G=${rgb?.g}, B=${rgb?.b})`);
  }

  // Find unique colors
  const onlyConnected = [...connectedColors].filter(c => !disconnectedColors.has(c));
  const onlyDisconnected = [...disconnectedColors].filter(c => !connectedColors.has(c));

  console.log('\nColors ONLY in connected rooms:');
  for (const c of onlyConnected) {
    const rgb = parseRgb(c);
    console.log(`  ${c} (R=${rgb?.r}, G=${rgb?.g}, B=${rgb?.b})`);
  }

  console.log('\nColors ONLY in disconnected rooms:');
  for (const c of onlyDisconnected) {
    const rgb = parseRgb(c);
    console.log(`  ${c} (R=${rgb?.r}, G=${rgb?.g}, B=${rgb?.b})`);
  }
}

main().catch(console.error);
