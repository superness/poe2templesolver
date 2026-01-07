#!/usr/bin/env node
/**
 * Debug grid mapping by finding a known room position
 */
import puppeteer from 'puppeteer';

// Test URL with GARRISON T3 at (5,2)
const url = 'https://sulozor.github.io/?t=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABMAAAAAAAAAAAAAAAAA';

async function debugGridMapping() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  const data = await page.evaluate(() => {
    const allCells = document.querySelectorAll('[class*="_cell_"][class*="_1v2jo_"]');
    const cells = [];

    for (let i = 0; i < allCells.length; i++) {
      const cell = allCells[i];
      const rect = cell.getBoundingClientRect();
      const img = cell.querySelector('[class*="_cellContent_"] img');

      cells.push({
        domIndex: i,
        centerX: Math.round(rect.x + rect.width / 2),
        centerY: Math.round(rect.y + rect.height / 2),
        hasRoom: img ? img.src.split('/').pop() : null,
      });
    }

    return cells;
  });

  // Sort by Y then X
  data.sort((a, b) => {
    const yDiff = a.centerY - b.centerY;
    if (Math.abs(yDiff) > 20) return yDiff;
    return a.centerX - b.centerX;
  });

  // Find the cell with a room
  const roomCell = data.find(c => c.hasRoom);
  console.log('Room found at DOM index:', roomCell?.domIndex);
  console.log('Room pixel position:', roomCell?.centerX, roomCell?.centerY);
  console.log('Room image:', roomCell?.hasRoom);

  // Find sorted index and row/position
  const sortedIndex = data.indexOf(roomCell);
  console.log('Sorted index:', sortedIndex);

  // Group into rows
  let rows = [];
  let currentRow = [];
  let lastY = null;

  for (const cell of data) {
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

  // Find room's row and position
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    row.sort((a, b) => a.centerX - b.centerX);
    for (let p = 0; p < row.length; p++) {
      if (row[p].hasRoom) {
        console.log(`Room at visual row ${r}, position ${p}`);
        console.log(`Row ${r} has ${row.length} cells`);
      }
    }
  }

  console.log('\nRow sizes:', rows.map(r => r.length).join(','));

  // Also print pixel Y values for each row
  console.log('\nRow Y positions:');
  for (let r = 0; r < rows.length; r++) {
    const avgY = Math.round(rows[r].reduce((s, c) => s + c.centerY, 0) / rows[r].length);
    console.log(`  Row ${r}: avgY=${avgY}, cells=${rows[r].length}`);
  }

  // Try to find the correct mapping
  // For GARRISON at (5,2), find what visual row/position it's in
  // Then work backwards to the correct formula

  console.log('\n--- Computing expected visual position for (5,2) ---');
  // Using d = (x-1) + (9-y) formula:
  const x = 5, y = 2;
  const d = (x - 1) + (9 - y);
  console.log(`d = (${x}-1) + (9-${y}) = ${d}`);

  // Cells in row d=11: x = y + 3, for valid y in [1,9] and x in [1,9]
  console.log('Cells in diagonal d=' + d + ':');
  const cellsInDiag = [];
  for (let testY = 9; testY >= 1; testY--) {
    const testX = testY + (d - 8);
    if (testX >= 1 && testX <= 9) {
      cellsInDiag.push({ x: testX, y: testY });
    }
  }
  console.log(cellsInDiag.map(c => `(${c.x},${c.y})`).join(', '));
  const posInDiag = cellsInDiag.findIndex(c => c.x === x && c.y === y);
  console.log(`(5,2) is at position ${posInDiag} in diagonal ${d}`);

  await browser.close();
}

debugGridMapping().catch(console.error);
