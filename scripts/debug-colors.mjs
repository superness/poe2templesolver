#!/usr/bin/env node
/**
 * Debug color detection for connected rooms
 */
import puppeteer from 'puppeteer';

// Test URL with connected chain: FOYER -> GARRISON -> SPYMASTER
const url = 'https://sulozor.github.io/?t=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABIAAAAAAAAAAAQAAAAAAAAAAAIAAAAAA==';

async function debugColors() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  const data = await page.evaluate(() => {
    const results = [];

    const cells = document.querySelectorAll('[class*="_cell_"][class*="_1v2jo_"]');

    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const img = cell.querySelector('[class*="_cellContent_"] img');
      if (!img) continue;

      const gridY = 9 - Math.floor(i / 9);
      const gridX = (i % 9) + 1;

      const cellInfo = {
        domIndex: i,
        gridX,
        gridY,
        imageName: img.src.split('/').pop(),
        tierElements: [],
        allSpans: [],
        allColors: [],
      };

      // Get ALL spans and divs in the cell
      const elements = cell.querySelectorAll('span, div');
      for (const el of elements) {
        const text = el.innerText?.trim();
        const style = window.getComputedStyle(el);
        const color = style.color;
        const bgColor = style.backgroundColor;
        const className = el.className;

        cellInfo.allSpans.push({
          text: text?.substring(0, 20),
          color,
          bgColor,
          className: className?.substring(0, 50),
        });

        // Check if this looks like a tier indicator
        if (/^(I{1,3}|[123])$/.test(text)) {
          cellInfo.tierElements.push({
            text,
            color,
            bgColor,
            className,
          });
        }
      }

      // Also check the cell itself
      const cellStyle = window.getComputedStyle(cell);
      cellInfo.cellBorder = cellStyle.borderColor;
      cellInfo.cellBg = cellStyle.backgroundColor;
      cellInfo.cellBoxShadow = cellStyle.boxShadow;

      results.push(cellInfo);
    }

    return results;
  });

  console.log('=== COLOR DEBUG OUTPUT ===\n');

  for (const cell of data) {
    console.log(`Cell at (${cell.gridX}, ${cell.gridY}) - DOM ${cell.domIndex}`);
    console.log(`  Image: ${cell.imageName}`);
    console.log(`  Cell border: ${cell.cellBorder}`);
    console.log(`  Cell background: ${cell.cellBg}`);

    if (cell.tierElements.length > 0) {
      console.log('  Tier elements:');
      for (const t of cell.tierElements) {
        console.log(`    "${t.text}" - color: ${t.color}, bg: ${t.bgColor}`);
      }
    } else {
      console.log('  No tier elements found');
    }

    if (cell.allSpans.length > 0) {
      console.log(`  All spans/divs (${cell.allSpans.length}):`);
      for (const s of cell.allSpans.slice(0, 5)) {
        if (s.text) {
          console.log(`    "${s.text}" - color: ${s.color}`);
        }
      }
    }

    console.log('');
  }

  await browser.close();
}

debugColors().catch(console.error);
