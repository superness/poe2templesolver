/**
 * Format solutions for human-readable output
 */

import { Solution, SolutionStep, Coord, TempleMetrics } from '../domain/types.js';
import { getRoomName } from '../domain/room-rules.js';
import { TempleState, getCell } from '../state/temple-state.js';
import { GRID_SIZE } from '../domain/constants.js';

/**
 * Format a complete solution for console output
 */
export function formatSolution(solution: Solution): string {
  const lines: string[] = [];

  lines.push('=== TEMPLE SOLUTION ===');
  lines.push('');

  if (!solution.found) {
    lines.push('⚠️  Complete solution not found. Showing best achievable state.');
    lines.push('');
  }

  const targetSpy = solution.metrics.targetSpymasters ?? 8;
  const targetCorr = solution.metrics.targetCorruptionChambers ?? 6;

  lines.push(`Starting state: ${solution.steps.length === 0 ? 'Empty temple' : 'Partial temple'}`);
  lines.push(`Goal: Best Temple with ≥${targetSpy} Spymasters and ≥${targetCorr} Corruption Chambers`);
  lines.push('');

  // Format each step
  for (const step of solution.steps) {
    lines.push(formatStep(step));
    lines.push('');
  }

  // Final metrics
  lines.push('=== FINAL METRICS ===');
  lines.push(formatMetrics(solution.metrics));
  lines.push('');

  // Search stats
  lines.push('=== SEARCH STATISTICS ===');
  lines.push(`Nodes Explored: ${solution.stats.nodesExplored.toLocaleString()}`);
  lines.push(`Time Taken: ${solution.stats.timeTaken}ms`);
  lines.push(`Optimality Guarantee: ${solution.stats.optimalityGuarantee ? 'Yes' : 'No (heuristic solution)'}`);
  lines.push('');

  // Excluded rooms warning
  if (solution.excludedRooms && solution.excludedRooms.length > 0) {
    lines.push('');
    lines.push('⚠️  EXCLUDED ROOMS (cannot connect to temple tree):');
    for (const room of solution.excludedRooms) {
      lines.push(`  - ${room.type} T${room.tier} at (${room.x}, ${room.y})`);
    }
    lines.push('');
    lines.push('Note: These rooms were excluded because their room types cannot');
    lines.push('form a valid connected path to the Foyer (e.g., LEGION_BARRACKS');
    lines.push('can only connect to ARMOURY and SPYMASTER, not to PATH/FOYER).');
  }

  lines.push('');

  // Verdict
  if (solution.metrics.meetsVictoryConditions) {
    lines.push('🏆 VERDICT: Best Temple achieved!');
  } else {
    lines.push('📋 VERDICT: Partial solution - see requirements above');
  }

  return lines.join('\n');
}

/**
 * Format a single solution step
 */
export function formatStep(step: SolutionStep): string {
  const lines: string[] = [];

  const roomName = step.roomType === 'PATH'
    ? 'PATH'
    : `${getRoomName(step.roomType, step.tier || 1)} (${step.roomType} T${step.tier})`;

  lines.push(`Step ${step.stepNumber}: ${step.action} ${roomName} at (${step.position.x}, ${step.position.y})`);

  // Connections
  if (step.connectsTo.length > 0) {
    const connections = step.connectsTo.map(c => `(${c.x}, ${c.y})`).join(', ');
    lines.push(`        Connects to: ${connections}`);
  }

  // Reason
  lines.push(`        Reason: ${step.reason}`);

  // Synergies
  for (const synergy of step.synergiesActivated) {
    lines.push(`        ✨ Synergy: ${synergy}`);
  }

  // Warnings
  for (const warning of step.warnings) {
    lines.push(`        ⚠️  Warning: ${warning}`);
  }

  return lines.join('\n');
}

/**
 * Format temple metrics
 */
export function formatMetrics(metrics: TempleMetrics): string {
  const lines: string[] = [];
  const targetSpy = metrics.targetSpymasters ?? 8;
  const targetCorr = metrics.targetCorruptionChambers ?? 6;

  lines.push(`Total Rooms: ${metrics.totalRooms}`);
  lines.push(`Total Paths: ${metrics.totalPaths}`);
  lines.push(`Spymasters: ${metrics.spymasterCount} ${metrics.spymasterCount >= targetSpy ? '✓' : `✗ (need ${targetSpy})`}`);
  lines.push(`Corruption Chambers: ${metrics.corruptionCount} ${metrics.corruptionCount >= targetCorr ? '✓' : `✗ (need ${targetCorr})`}`);
  lines.push(`Tier 3 Rooms: ${metrics.t3RoomCount}`);
  lines.push(`Estimated Value: ${metrics.estimatedValue}`);
  lines.push(`Victory Conditions: ${metrics.meetsVictoryConditions ? 'MET ✓' : 'NOT MET ✗'}`);

  return lines.join('\n');
}

/**
 * Format temple state as ASCII grid
 */
export function formatGrid(state: TempleState): string {
  const lines: string[] = [];

  // Header - row 9 at top (Atziri), row 1 at bottom (Foyer entrance)
  // This matches the game's visual: you start at bottom and progress upward
  lines.push('    1   2   3   4   5   6   7   8   9');
  lines.push('  +---+---+---+---+---+---+---+---+---+');

  for (let y = GRID_SIZE; y >= 1; y--) {
    let row = `${y} |`;

    for (let x = 1; x <= GRID_SIZE; x++) {
      const cell = getCell(state, { x, y });
      let symbol = '   ';

      if (cell && cell.content !== null) {
        if (typeof cell.content === 'string') {
          switch (cell.content) {
            case 'FOYER': symbol = 'FOY'; break;
            case 'ATZIRI': symbol = 'ATZ'; break;
            case 'ARCHITECT': symbol = 'ARC'; break;
          }
        } else if ('type' in cell.content) {
          // Room
          const type = cell.content.type;
          const tier = cell.content.tier;
          symbol = `${type.slice(0, 2)}${tier}`;
        } else {
          // Path
          symbol = ' P ';
        }
      }

      row += symbol + '|';
    }

    lines.push(row);
    lines.push('  +---+---+---+---+---+---+---+---+---+');
  }

  return lines.join('\n');
}

/**
 * Format a compact solution summary
 */
export function formatCompactSummary(solution: Solution): string {
  const status = solution.found ? '✓ SOLVED' : '⚠ PARTIAL';
  const rooms = solution.metrics.totalRooms;
  const spies = solution.metrics.spymasterCount;
  const corr = solution.metrics.corruptionCount;
  const steps = solution.steps.length;

  return `${status} | ${steps} steps | ${rooms} rooms | ${spies} Spymasters | ${corr} Corruption`;
}

/**
 * Format solution as JSON
 */
export function formatSolutionJSON(solution: Solution): string {
  return JSON.stringify({
    found: solution.found,
    stepsCount: solution.steps.length,
    metrics: solution.metrics,
    stats: solution.stats,
    steps: solution.steps.map(s => ({
      step: s.stepNumber,
      action: s.action,
      room: s.roomType,
      tier: s.tier,
      position: s.position,
      reason: s.reason,
    })),
  }, null, 2);
}
