#!/usr/bin/env node
/**
 * Debug visual cell ordering to understand scraping issues
 */
import puppeteer from 'puppeteer';

const url = process.argv[2] || 'https://sulozor.github.io/?t=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASgAAAAAAAAASAAAAAAAAAAAIAAAAAA==';

async function debugVisualOrder() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  const data = await page.evaluate(() => {
    const cells = document.querySelectorAll('[class*="_cell_"][class*="_1v2jo_"]');
    const result = [];

    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const rect = cell.getBoundingClientRect();
      const img = cell.querySelector('[class*="_cellContent_"] img');

      result.push({
        domIndex: i,
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        centerX: Math.round(rect.x + rect.width/2),
        centerY: Math.round(rect.y + rect.height/2),
        hasRoom: img ? img.src.split('/').pop() : null,
      });
    }

    return result;
  });

  // Find cells with rooms
  const roomCells = data.filter(c => c.hasRoom);
  console.log('Cells with rooms (DOM order):');
  for (const c of roomCells) {
    console.log(`  DOM index ${c.domIndex}: pixel (${c.centerX}, ${c.centerY}) - ${c.hasRoom}`);
  }

  // Sort all cells by visual position
  const sorted = [...data].sort((a, b) => {
    const yDiff = a.centerY - b.centerY;
    if (Math.abs(yDiff) > 20) return yDiff;
    return a.centerX - b.centerX;
  });

  // Find room cells in sorted order
  console.log('\nCells with rooms (sorted visual order):');
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];
    if (c.hasRoom) {
      console.log(`  Sorted index ${i}: pixel (${c.centerX}, ${c.centerY}) - ${c.hasRoom}`);
    }
  }

  // Group into visual rows
  const rows = [];
  let currentRow = [];
  let lastY = null;
  for (const cell of sorted) {
    if (lastY === null || Math.abs(cell.centerY - lastY) < 25) {
      currentRow.push(cell);
      lastY = cell.centerY;
    } else {
      rows.push(currentRow);
      currentRow = [cell];
      lastY = cell.centerY;
    }
  }
  if (currentRow.length > 0) rows.push(currentRow);

  // Find rooms in visual rows
  console.log('\nRooms by visual row:');
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    row.sort((a, b) => a.centerX - b.centerX);
    for (let p = 0; p < row.length; p++) {
      if (row[p].hasRoom) {
        console.log(`  Row ${r}, Pos ${p} (of ${row.length}): ${row[p].hasRoom}`);
        console.log(`    Pixel: (${row[p].centerX}, ${row[p].centerY})`);
        console.log(`    DOM index: ${row[p].domIndex}`);
      }
    }
  }

  // Let's also check the expected formula
  console.log('\nExpected positions based on encoding:');
  console.log('  (5,2) GARRISON: d = 4 + 7 = 11, should be row 11, pos 4');
  console.log('  (6,3) SPYMASTER: d = 5 + 6 = 11, should be row 11, pos 3');
  console.log('  (5,1) PATH: d = 4 + 8 = 12, should be row 12, pos 4');

  await browser.close();
}

debugVisualOrder().catch(console.error);
