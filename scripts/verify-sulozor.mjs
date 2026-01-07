#!/usr/bin/env node
/**
 * Verify temple connectivity by rendering Sulozor URL with Puppeteer
 * Scrapes the actual rendered grid to extract room positions and connection status
 */
import puppeteer from 'puppeteer';

const url = process.argv[2];
const jsonOutput = process.argv.includes('--json');

if (!url) {
  console.log('Usage: node scripts/verify-sulozor.mjs <sulozor-url> [--json]');
  process.exit(1);
}

async function verifySulozor(url) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 900 });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

  // Wait for Vue app to render
  await new Promise(r => setTimeout(r, 3000));

  // Extract grid data by analyzing the rendered DOM
  const gridData = await page.evaluate(() => {
    const result = {
      grid: [], // 9x9 grid of rooms
      connectedRooms: [],
      disconnectedRooms: [],
      summary: {},
    };

    // Initialize 9x9 grid
    for (let y = 0; y < 9; y++) {
      result.grid[y] = [];
      for (let x = 0; x < 9; x++) {
        result.grid[y][x] = { type: 'EMPTY', tier: 0, connected: false };
      }
    }

    // Find elements with images (room icons)
    const images = document.querySelectorAll('img');
    const roomImages = [];

    for (const img of images) {
      const src = img.src || '';
      const alt = img.alt || '';

      // Skip non-room images
      if (src.includes('icon') || src.includes('room') || alt) {
        const rect = img.getBoundingClientRect();
        if (rect.width > 20 && rect.width < 100) {
          roomImages.push({
            src: src.split('/').pop(),
            alt,
            x: rect.x,
            y: rect.y,
            width: rect.width,
          });
        }
      }
    }

    // Find tier indicators (numbers 1, 2, 3, or I)
    const tierElements = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    while (walker.nextNode()) {
      const text = walker.currentNode.textContent.trim();
      if (/^[123I]$/.test(text)) {
        const parent = walker.currentNode.parentElement;
        if (parent) {
          const rect = parent.getBoundingClientRect();
          const style = window.getComputedStyle(parent);

          // Check for green coloring (connected)
          const color = style.color;
          const bgColor = style.backgroundColor;
          const borderColor = style.borderColor;

          const isGreenish = (c) => {
            if (!c) return false;
            const m = c.match(/rgb\((\d+),\s*(\d+),\s*(\d+)/);
            if (m) {
              const [_, r, g, b] = m.map(Number);
              return g > 80 && g > r && g > b;
            }
            return false;
          };

          tierElements.push({
            tier: text === 'I' ? 1 : parseInt(text),
            x: rect.x,
            y: rect.y,
            isConnected: isGreenish(color) || isGreenish(borderColor),
            color,
            borderColor,
          });
        }
      }
    }

    // Look for elements with golden/yellow borders (connected indicator)
    // Sulozor uses golden borders for connected rooms
    const allElements = document.querySelectorAll('*');
    const connectedElements = [];

    for (const el of allElements) {
      const style = window.getComputedStyle(el);
      const boxShadow = style.boxShadow;
      const borderColor = style.borderColor;
      const outlineColor = style.outlineColor;

      // Check for golden/yellow colors (RGB where R and G are high, B is low)
      const isGolden = (color) => {
        if (!color || color === 'none') return false;
        const m = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)/);
        if (m) {
          const [_, r, g, b] = m.map(Number);
          // Golden: R > 150, G > 100, B < 100, and R similar to G
          return r > 150 && g > 100 && b < 100 && Math.abs(r - g) < 80;
        }
        return false;
      };

      const hasGoldenBorder = isGolden(borderColor) || isGolden(outlineColor);

      // Also check box-shadow for golden glow
      let hasGoldenShadow = false;
      if (boxShadow && boxShadow !== 'none') {
        const colors = boxShadow.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/g);
        if (colors) {
          for (const c of colors) {
            if (isGolden(c)) {
              hasGoldenShadow = true;
              break;
            }
          }
        }
      }

      if (hasGoldenBorder || hasGoldenShadow) {
        const rect = el.getBoundingClientRect();
        // Filter to reasonable cell sizes (30-80px)
        if (rect.width > 30 && rect.width < 80 && rect.height > 30 && rect.height < 80) {
          connectedElements.push({
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            borderColor,
            tag: el.tagName,
          });
        }
      }
    }

    // Parse the destabilization count from page text
    const pageText = document.body.innerText;
    const destabMatch = pageText.match(/Around\s+(\d+)\s+room/i);
    result.summary.destabilizationCount = destabMatch ? parseInt(destabMatch[1]) : 0;

    // Check if temple has active bonuses (indicates rooms are connected)
    result.summary.hasActiveBonuses = !pageText.includes('Place rooms to see effects');

    // Extract any visible room counts or stats
    const statsMatch = pageText.match(/(\d+)\s+rooms?/gi);
    if (statsMatch) {
      result.summary.roomStats = statsMatch;
    }

    result.roomImages = roomImages;
    result.tierElements = tierElements;
    result.connectedElements = connectedElements;

    // Count connected vs disconnected based on golden elements
    result.summary.connectedCount = connectedElements.length;
    result.summary.tierCount = tierElements.length;
    result.summary.imageCount = roomImages.length;

    return result;
  });

  // Take screenshot
  await page.screenshot({
    path: '/mnt/c/github/poe2templerobbit/sulozor-screenshot.png',
    fullPage: false
  });

  await browser.close();

  // Output results
  if (jsonOutput) {
    console.log(JSON.stringify(gridData, null, 2));
  } else {
    console.log('=== SULOZOR SCRAPE RESULTS ===\n');
    console.log('Summary:');
    console.log(`  Destabilization warning: ${gridData.summary.destabilizationCount} rooms`);
    console.log(`  Has active bonuses: ${gridData.summary.hasActiveBonuses}`);
    console.log(`  Room images found: ${gridData.summary.imageCount}`);
    console.log(`  Tier indicators found: ${gridData.summary.tierCount}`);
    console.log(`  Green (connected) elements: ${gridData.summary.connectedCount}`);

    if (gridData.tierElements.length > 0) {
      console.log('\nTier elements:');
      gridData.tierElements.forEach((t, i) => {
        console.log(`  [${i}] Tier ${t.tier} at (${Math.round(t.x)}, ${Math.round(t.y)}) connected=${t.isConnected}`);
      });
    }

    if (gridData.connectedElements && gridData.connectedElements.length > 0) {
      console.log('\nConnected (golden) elements:');
      gridData.connectedElements.slice(0, 10).forEach((g, i) => {
        console.log(`  [${i}] at (${Math.round(g.x)}, ${Math.round(g.y)}) w=${Math.round(g.width)}`);
      });
    }

    console.log('\nScreenshot: sulozor-screenshot.png');
  }

  return gridData;
}

verifySulozor(url).catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
