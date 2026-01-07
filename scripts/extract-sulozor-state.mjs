#!/usr/bin/env node
/**
 * Extract complete temple state from Sulozor by scraping the rendered page
 */
import puppeteer from 'puppeteer';

const url = process.argv[2];
const outputJson = process.argv.includes('--json');
const debugMode = process.argv.includes('--debug');

if (!url) {
  console.log('Usage: node scripts/extract-sulozor-state.mjs <sulozor-url> [--json] [--debug]');
  process.exit(1);
}

// Map Sulozor image names to room types
// Names based on actual Sulozor icon filenames
const IMAGE_TO_ROOM = {
  'IconGarrison': 'GARRISON',
  'IconViperSpymaster': 'SPYMASTER',
  'IconCommander': 'COMMANDER',
  'IconArmoury': 'ARMOURY',
  'IconAlchemyLab': 'ALCHEMY_LAB',
  'IconSmithy': 'SMITHY',
  'IconCorruption': 'CORRUPTION_CHAMBER',
  'IconSacrificialChamber': 'SACRIFICIAL_CHAMBER',
  'IconThaumaturge': 'THAUMATURGE',
  'IconGenerator': 'GENERATOR',
  'IconGolemWorks': 'GOLEM_WORKS',
  'IconFleshSurgeon': 'FLESH_SURGEON',
  'IconSynthflesh': 'SYNTHFLESH',
  'IconLegionBarracks': 'LEGION_BARRACKS',
  'IconVault': 'PATH',
  'IconPath': 'PATH',
  'IconArchitect': 'ARCHITECT',
  // Additional icon name variants
  'IconSpymaster': 'SPYMASTER',
  'IconCorruptionChamber': 'CORRUPTION_CHAMBER',
};

async function extractSulozorState(url) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  const rawData = await page.evaluate(() => {
    const result = { cells: [], debug: {} };

    // Get cells in DOM order - this matches Sulozor's byte array order (row-major)
    const allCells = document.querySelectorAll('[class*="_cell_"][class*="_1v2jo_"]');
    result.debug.totalCellsFound = allCells.length;

    for (let i = 0; i < allCells.length; i++) {
      const cell = allCells[i];
      const rect = cell.getBoundingClientRect();
      const style = window.getComputedStyle(cell);
      const className = cell.className;
      const isEmpty = className.includes('_empty_');

      const cellContent = cell.querySelector('[class*="_cellContent_"]');
      const img = cellContent?.querySelector('img');
      let roomImageName = null;
      if (img && img.src) {
        const match = img.src.match(/\/([^\/]+)\.webp/);
        if (match) roomImageName = match[1];
      }

      let tier = 0;
      let tierConnected = false;
      const tierElements = cell.querySelectorAll('span, div');
      for (const el of tierElements) {
        const text = el.innerText?.trim();
        if (/^(I{1,3}|[123])$/.test(text)) {
          const t = text;
          if (t === 'I' || t === '1') tier = 1;
          else if (t === 'II' || t === '2') tier = 2;
          else if (t === 'III' || t === '3') tier = 3;

          const elStyle = window.getComputedStyle(el);
          const color = elStyle.color;
          const m = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)/);
          if (m) {
            const [_, r, g, b] = m.map(Number);
            tierConnected = g > 100 && g > r * 1.2 && g > b * 1.2;
          }
          break;
        }
      }

      const borderColor = style.borderColor;
      const boxShadow = style.boxShadow;
      let hasGoldenBorder = false;
      const isGolden = (c) => {
        if (!c || c === 'none') return false;
        const m = c.match(/rgb\((\d+),\s*(\d+),\s*(\d+)/);
        if (m) {
          const [_, r, g, b] = m.map(Number);
          return r > 150 && g > 100 && b < 100;
        }
        return false;
      };
      if (isGolden(borderColor)) hasGoldenBorder = true;
      if (boxShadow && boxShadow !== 'none') {
        const colors = boxShadow.match(/rgb\(\d+,\s*\d+,\s*\d+\)/g) || [];
        for (const c of colors) {
          if (isGolden(c)) { hasGoldenBorder = true; break; }
        }
      }

      // DOM index directly maps to grid coordinates:
      // cellIdx = domIndex
      // y = 9 - floor(cellIdx / 9)
      // x = (cellIdx % 9) + 1
      const gridY = 9 - Math.floor(i / 9);
      const gridX = (i % 9) + 1;

      result.cells.push({
        domIndex: i,
        gridX,
        gridY,
        isEmpty,
        roomImageName,
        tier,
        tierConnected,
        hasGoldenBorder,
      });
    }

    return result;
  });

  const cells = rawData.cells;
  if (cells.length === 0) {
    console.error('No cells found in DOM');
    await browser.close();
    return null;
  }

  if (cells.length !== 81) {
    console.error(`Expected 81 cells, got ${cells.length}`);
  }

  // DOM index directly maps to grid coordinates (row-major order):
  // cellIdx = domIndex
  // y = 9 - floor(cellIdx / 9)  (top row is y=9, bottom row is y=1)
  // x = (cellIdx % 9) + 1       (left column is x=1, right column is x=9)

  const state = {
    grid: {},
    rooms: [],
    connected: [],
    disconnected: [],
    architect: null,
    foyer: { x: 5, y: 1 },
    debug: { rawCells: [] },
  };

  // Initialize empty grid
  for (let y = 1; y <= 9; y++) {
    for (let x = 1; x <= 9; x++) {
      state.grid[`${x},${y}`] = { type: 'EMPTY', tier: 0, connected: false };
    }
  }

  // Process each cell using DOM index mapping
  for (const cell of cells) {
    const { gridX, gridY, roomImageName, tier, tierConnected, hasGoldenBorder, domIndex } = cell;

    if (debugMode) {
      state.debug.rawCells.push({
        domIndex,
        gridX,
        gridY,
        roomImageName,
        tier,
      });
    }

    // Determine room type from image name
    let roomType = 'EMPTY';
    if (roomImageName) {
      for (const [imgName, type] of Object.entries(IMAGE_TO_ROOM)) {
        if (roomImageName.includes(imgName)) {
          roomType = type;
          break;
        }
      }
      if (roomType === 'EMPTY' && roomImageName) {
        roomType = 'UNKNOWN';
        state.debug.unknownImage = roomImageName;
      }
    }

    const connected = hasGoldenBorder || tierConnected;
    const roomTier = tier || (roomType !== 'EMPTY' && roomType !== 'UNKNOWN' ? 1 : 0);

    state.grid[`${gridX},${gridY}`] = { type: roomType, tier: roomTier, connected };

    if (roomType !== 'EMPTY' && roomType !== 'UNKNOWN') {
      const roomInfo = { type: roomType, tier: roomTier, x: gridX, y: gridY, connected };
      state.rooms.push(roomInfo);
      if (connected) state.connected.push(roomInfo);
      else state.disconnected.push(roomInfo);
      if (roomType === 'ARCHITECT') state.architect = { x: gridX, y: gridY };
    }
  }

  await page.screenshot({
    path: '/mnt/c/github/poe2templerobbit/sulozor-state.png',
    fullPage: false
  });

  await browser.close();

  if (outputJson) {
    console.log(JSON.stringify(state, null, 2));
  } else {
    console.log('=== EXTRACTED SULOZOR STATE ===\n');
    console.log(`Total cells: ${cells.length}`);
    console.log(`Total rooms: ${state.rooms.length}`);
    console.log(`Connected: ${state.connected.length}`);
    console.log(`Disconnected: ${state.disconnected.length}`);
    console.log(`Architect: ${state.architect ? `(${state.architect.x}, ${state.architect.y})` : 'not found'}`);
    console.log('');

    console.log('Grid (. = empty, X = room, C = connected):');
    console.log('    1 2 3 4 5 6 7 8 9');
    for (let y = 9; y >= 1; y--) {
      let row = `${y}   `;
      for (let x = 1; x <= 9; x++) {
        const cell = state.grid[`${x},${y}`];
        if (!cell || cell.type === 'EMPTY') row += '. ';
        else if (cell.connected) row += 'C ';
        else row += 'X ';
      }
      console.log(row);
    }
    console.log('');

    if (state.rooms.length > 0) {
      console.log('Rooms:');
      for (const room of state.rooms) {
        const status = room.connected ? '[CONNECTED]' : '[disconnected]';
        console.log(`  (${room.x},${room.y}) ${room.type} T${room.tier} ${status}`);
      }
    }

    if (debugMode && state.debug.rawCells) {
      console.log('\nDebug - cells with rooms:');
      for (const c of state.debug.rawCells.filter(c => c.roomImageName)) {
        console.log(`  DOM ${c.domIndex} -> (${c.gridX},${c.gridY}) ${c.roomImageName}`);
      }
    }

    if (state.debug.unknownImage) {
      console.log(`\nWarning: Unknown image: ${state.debug.unknownImage}`);
    }
  }

  return state;
}

extractSulozorState(url).catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
