#!/usr/bin/env node
/**
 * Debug Sulozor DOM to understand room detection issues
 */
import puppeteer from 'puppeteer';

const url = process.argv[2] || 'https://sulozor.github.io/?t=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACpKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIQAAAAAAAAA';

async function debugSulozor(url) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  const debug = await page.evaluate(() => {
    const result = {
      allImages: [],
      nonEmptyCells: [],
      allCellClasses: new Set(),
    };

    // Find ALL images on the page
    const imgs = document.querySelectorAll('img');
    for (const img of imgs) {
      result.allImages.push({
        src: img.src,
        alt: img.alt,
        parent: img.parentElement?.className,
      });
    }

    // Find the grid and analyze cells
    const gridContainer = document.querySelector('[class*="_grid_"]');
    if (gridContainer) {
      const cells = gridContainer.querySelectorAll(':scope > *');
      result.totalCells = cells.length;

      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        result.allCellClasses.add(cell.className);

        // Check if this cell has any content
        const hasContent = cell.innerHTML.length > 100 ||
                          cell.querySelector('img') ||
                          !cell.className.includes('_empty_');

        if (hasContent || !cell.className.includes('_empty_')) {
          result.nonEmptyCells.push({
            index: i,
            className: cell.className,
            innerHTML: cell.innerHTML.substring(0, 500),
            innerText: cell.innerText?.substring(0, 100),
            hasImg: !!cell.querySelector('img'),
          });
        }
      }
    }

    result.allCellClasses = Array.from(result.allCellClasses);
    return result;
  });

  console.log('=== DEBUG OUTPUT ===\n');

  console.log(`Total images on page: ${debug.allImages.length}`);
  if (debug.allImages.length > 0) {
    console.log('Image sources:');
    for (const img of debug.allImages) {
      console.log(`  ${img.src}`);
      console.log(`    parent class: ${img.parent}`);
    }
  }
  console.log('');

  console.log(`Total cells: ${debug.totalCells}`);
  console.log(`Non-empty cells: ${debug.nonEmptyCells.length}`);
  console.log('');

  console.log('All cell classes:');
  for (const cls of debug.allCellClasses) {
    console.log(`  ${cls}`);
  }
  console.log('');

  if (debug.nonEmptyCells.length > 0) {
    console.log('Non-empty cell details:');
    for (const cell of debug.nonEmptyCells.slice(0, 10)) {
      console.log(`\nCell ${cell.index}:`);
      console.log(`  Class: ${cell.className}`);
      console.log(`  Has img: ${cell.hasImg}`);
      console.log(`  Text: ${cell.innerText || '(none)'}`);
      console.log(`  HTML: ${cell.innerHTML.substring(0, 200)}...`);
    }
  }

  await browser.close();
}

debugSulozor(url).catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
