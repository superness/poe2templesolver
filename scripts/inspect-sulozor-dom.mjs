#!/usr/bin/env node
/**
 * Inspect Sulozor DOM structure to understand how rooms are represented
 */
import puppeteer from 'puppeteer';

const url = process.argv[2] || 'https://sulozor.github.io/?t=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

async function inspectSulozor(url) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

  // Wait for Vue app to render
  await new Promise(r => setTimeout(r, 3000));

  // Dump DOM structure
  const domInfo = await page.evaluate(() => {
    const result = {
      gridContainer: null,
      cells: [],
      roomElements: [],
      structure: [],
    };

    // Look for the main grid container
    const allDivs = document.querySelectorAll('div');
    for (const div of allDivs) {
      const children = div.children.length;
      // Grid should have ~81 cells (9x9)
      if (children >= 70 && children <= 100) {
        const firstChildRect = div.children[0]?.getBoundingClientRect();
        if (firstChildRect && firstChildRect.width > 20 && firstChildRect.width < 100) {
          result.gridContainer = {
            tagName: div.tagName,
            className: div.className,
            id: div.id,
            childCount: children,
            rect: div.getBoundingClientRect(),
          };

          // Analyze each cell
          for (let i = 0; i < div.children.length; i++) {
            const cell = div.children[i];
            const rect = cell.getBoundingClientRect();
            const style = window.getComputedStyle(cell);

            // Get all data attributes
            const dataAttrs = {};
            for (const attr of cell.attributes) {
              if (attr.name.startsWith('data-')) {
                dataAttrs[attr.name] = attr.value;
              }
            }

            // Check for images inside
            const imgs = cell.querySelectorAll('img');
            const imgSrcs = Array.from(imgs).map(img => ({
              src: img.src,
              alt: img.alt,
              title: img.title,
            }));

            // Get text content
            const textContent = cell.textContent?.trim();

            // Get CSS that might indicate state
            const borderColor = style.borderColor;
            const backgroundColor = style.backgroundColor;
            const boxShadow = style.boxShadow;
            const outline = style.outline;

            result.cells.push({
              index: i,
              className: cell.className,
              dataAttrs,
              rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
              borderColor,
              backgroundColor,
              boxShadow: boxShadow !== 'none' ? boxShadow : null,
              outline: outline !== 'none' ? outline : null,
              imgSrcs,
              textContent: textContent || null,
              innerHTML: cell.innerHTML.substring(0, 200),
            });
          }
          break;
        }
      }
    }

    // Also look for Vue data
    const vueApp = document.querySelector('#app')?.__vue__;
    if (vueApp) {
      result.vueData = {
        hasVue: true,
        dataKeys: Object.keys(vueApp.$data || {}),
      };
    }

    // Check for any elements with room-related classes
    const roomClasses = ['room', 'cell', 'tile', 'grid-item', 'temple'];
    for (const cls of roomClasses) {
      const els = document.querySelectorAll(`[class*="${cls}"]`);
      if (els.length > 0) {
        result.roomElements.push({
          searchClass: cls,
          count: els.length,
          samples: Array.from(els).slice(0, 3).map(el => ({
            tagName: el.tagName,
            className: el.className,
            id: el.id,
          })),
        });
      }
    }

    return result;
  });

  console.log('=== SULOZOR DOM INSPECTION ===\n');

  if (domInfo.gridContainer) {
    console.log('Grid Container Found:');
    console.log(`  Tag: ${domInfo.gridContainer.tagName}`);
    console.log(`  Class: ${domInfo.gridContainer.className}`);
    console.log(`  Children: ${domInfo.gridContainer.childCount}`);
    console.log('');
  }

  console.log(`Total cells analyzed: ${domInfo.cells.length}\n`);

  // Group cells by their characteristics
  const cellsByClass = {};
  const cellsWithImages = [];
  const cellsWithText = [];
  const cellsWithBorders = [];

  for (const cell of domInfo.cells) {
    // Group by class
    const cls = cell.className || '(no class)';
    if (!cellsByClass[cls]) cellsByClass[cls] = [];
    cellsByClass[cls].push(cell.index);

    if (cell.imgSrcs.length > 0) cellsWithImages.push(cell);
    if (cell.textContent) cellsWithText.push(cell);
    if (cell.boxShadow || (cell.borderColor && cell.borderColor !== 'rgb(0, 0, 0)')) {
      cellsWithBorders.push(cell);
    }
  }

  console.log('Cells grouped by class:');
  for (const [cls, indices] of Object.entries(cellsByClass)) {
    console.log(`  "${cls}": ${indices.length} cells`);
  }
  console.log('');

  console.log(`Cells with images: ${cellsWithImages.length}`);
  if (cellsWithImages.length > 0) {
    console.log('Sample image sources:');
    const uniqueSrcs = new Set();
    for (const cell of cellsWithImages.slice(0, 10)) {
      for (const img of cell.imgSrcs) {
        const srcName = img.src.split('/').pop();
        if (!uniqueSrcs.has(srcName)) {
          uniqueSrcs.add(srcName);
          console.log(`  ${srcName}`);
        }
      }
    }
  }
  console.log('');

  console.log(`Cells with text content: ${cellsWithText.length}`);
  if (cellsWithText.length > 0) {
    const textSamples = cellsWithText.slice(0, 10).map(c => c.textContent);
    console.log('Sample text:', textSamples);
  }
  console.log('');

  console.log(`Cells with special borders/shadows: ${cellsWithBorders.length}`);
  if (cellsWithBorders.length > 0) {
    console.log('Border samples:');
    for (const cell of cellsWithBorders.slice(0, 5)) {
      console.log(`  [${cell.index}] border: ${cell.borderColor}, shadow: ${cell.boxShadow}`);
    }
  }
  console.log('');

  // Show a few complete cell examples
  console.log('=== SAMPLE CELL DETAILS ===\n');
  const sampleIndices = [0, 40, 80]; // First, middle, last
  for (const idx of sampleIndices) {
    const cell = domInfo.cells[idx];
    if (cell) {
      console.log(`Cell ${idx}:`);
      console.log(`  Class: ${cell.className}`);
      console.log(`  Data attrs: ${JSON.stringify(cell.dataAttrs)}`);
      console.log(`  Position: (${Math.round(cell.rect.x)}, ${Math.round(cell.rect.y)})`);
      console.log(`  Size: ${Math.round(cell.rect.w)}x${Math.round(cell.rect.h)}`);
      console.log(`  Images: ${cell.imgSrcs.length}`);
      console.log(`  Text: ${cell.textContent || '(none)'}`);
      console.log(`  innerHTML preview: ${cell.innerHTML.substring(0, 100)}...`);
      console.log('');
    }
  }

  if (domInfo.roomElements.length > 0) {
    console.log('=== ROOM-RELATED ELEMENTS ===\n');
    for (const re of domInfo.roomElements) {
      console.log(`Elements with "${re.searchClass}" in class: ${re.count}`);
    }
  }

  await browser.close();
  return domInfo;
}

inspectSulozor(url).catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
