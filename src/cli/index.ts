#!/usr/bin/env node
/**
 * POE2 Temple of Atziri Solver - CLI Interface
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

import { Coord, RoomType, Tier, SolverGoal } from '../domain/types.js';
import { TempleState, createEmptyState, updateConnectivity } from '../state/temple-state.js';
import { TempleSolver, quickSolve, analyzeTemple } from '../solver/solver.js';
import { createUnlimitedPool } from '../solver/action-generator.js';
import { solveOptimal } from '../solver/optimal-solver.js';
import {
  parseTempleFromJSON,
  createTempleFromInput,
  exportStateToJSON,
  parseSulozorUrl,
  parseSulozorUrlWithArchitect,
  exportToSulozorUrl,
} from '../io/state-parser.js';
import {
  formatSolution,
  formatGrid,
  formatCompactSummary,
  formatSolutionJSON,
} from '../io/solution-formatter.js';

// Parse command line arguments
const args = process.argv.slice(2);

interface CLIOptions {
  command: 'solve' | 'analyze' | 'help' | 'interactive';
  inputFile?: string;
  sulozorUrl?: string;
  outputFormat: 'text' | 'json';
  architectX?: number;
  architectY?: number;
  strategy: 'OPTIMAL' | 'FAST' | 'BALANCED';
  maxTime: number;
  exportUrl: boolean;
  minSpymasters?: number;
  minCorruptionChambers?: number;
  useOptimalSolver: boolean;
  unlockExisting: boolean;  // If true, existing rooms can be replaced
}

function parseArgs(args: string[]): CLIOptions {
  const options: CLIOptions = {
    command: 'help',
    outputFormat: 'text',
    strategy: 'BALANCED',
    maxTime: 30000,
    exportUrl: false,
    useOptimalSolver: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case 'solve':
      case 'analyze':
      case 'interactive':
        options.command = arg;
        break;

      case '-i':
      case '--input':
        options.inputFile = args[++i];
        break;

      case '-u':
      case '--url':
        options.sulozorUrl = args[++i];
        break;

      case '-f':
      case '--format':
        options.outputFormat = args[++i] as 'text' | 'json';
        break;

      case '--architect':
        const [x, y] = args[++i].split(',').map(Number);
        options.architectX = x;
        options.architectY = y;
        break;

      case '-s':
      case '--strategy':
        options.strategy = args[++i].toUpperCase() as CLIOptions['strategy'];
        break;

      case '-t':
      case '--time':
        options.maxTime = parseInt(args[++i]) * 1000;
        break;

      case '-e':
      case '--export-url':
        options.exportUrl = true;
        break;

      case '--min-spymasters':
        options.minSpymasters = parseInt(args[++i]);
        break;

      case '--min-corruption':
        options.minCorruptionChambers = parseInt(args[++i]);
        break;

      case '--optimal':
      case '-O':
        options.useOptimalSolver = true;
        break;

      case '-h':
      case '--help':
        options.command = 'help';
        break;
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
POE2 Temple of Atziri Solver
============================

A decision-support tool for optimizing Temple room placements.

USAGE:
  temple-solver <command> [options]

COMMANDS:
  solve       Solve a temple and output optimal placement sequence
  analyze     Analyze current temple state without solving
  interactive Start interactive mode for step-by-step guidance
  help        Show this help message

OPTIONS:
  -i, --input <file>      Input file (JSON format)
  -u, --url <url>         Import from Sulozor temple planner URL
  -f, --format <type>     Output format: text (default) or json
  --architect <x,y>       Architect position (e.g., --architect 7,4)
  -s, --strategy <type>   Search strategy: OPTIMAL, FAST, or BALANCED
  -t, --time <seconds>    Maximum solve time in seconds (default: 30)
  -e, --export-url        Output Sulozor URL for the solution
  --min-spymasters <n>    Minimum Spymasters required (default: 8)
  --min-corruption <n>    Minimum Corruption Chambers required (default: 6)
  -O, --optimal           Use OR-Tools CP-SAT solver for optimal solutions
  -h, --help              Show help

EXAMPLES:
  # Solve from Sulozor URL
  temple-solver solve --url "https://sulozor.github.io/?t=ABC123..." --architect 5,4

  # Solve with architect at (7, 4)
  temple-solver solve --architect 7,4

  # Solve from input file
  temple-solver solve -i temple.json

  # Quick analysis
  temple-solver analyze --architect 7,4

  # Interactive mode
  temple-solver interactive

INPUT FILE FORMAT (JSON):
  {
    "architect": { "x": 7, "y": 4 },
    "rooms": [
      { "type": "GARRISON", "tier": 1, "position": { "x": 5, "y": 2 } }
    ],
    "paths": [
      { "x": 4, "y": 2 }
    ]
  }

For more information, see the documentation.
`);
}

async function runSolve(options: CLIOptions): Promise<void> {
  let state: TempleState;

  if (options.sulozorUrl) {
    // Load from Sulozor URL
    try {
      const architectPos = options.architectX && options.architectY
        ? { x: options.architectX, y: options.architectY }
        : undefined;

      if (architectPos) {
        const result = parseSulozorUrlWithArchitect(options.sulozorUrl, architectPos);
        state = result.state;
        if (result.warnings.length > 0) {
          console.log('Warnings:');
          result.warnings.forEach(w => console.log(`  - ${w}`));
          console.log('');
        }
      } else {
        const result = parseSulozorUrl(options.sulozorUrl);
        state = result.state;
        if (result.warnings.length > 0) {
          console.log('Warnings:');
          result.warnings.forEach(w => console.log(`  - ${w}`));
          console.log('');
        }
      }
      console.log(`Imported from Sulozor URL`);
    } catch (err) {
      console.error(`Error parsing Sulozor URL: ${err}`);
      process.exit(1);
    }
  } else if (options.inputFile) {
    // Load from file
    try {
      const content = fs.readFileSync(options.inputFile, 'utf-8');
      state = parseTempleFromJSON(content);
    } catch (err) {
      console.error(`Error loading input file: ${err}`);
      process.exit(1);
    }
  } else if (options.architectX && options.architectY) {
    // Create empty state with architect position
    state = createEmptyState({ x: options.architectX, y: options.architectY });
  } else {
    console.error('Error: Must provide either --url, --input file, or --architect position');
    process.exit(1);
  }

  const minSpymasters = options.minSpymasters ?? 8;
  const minCorruptionChambers = options.minCorruptionChambers ?? 6;

  console.log('Starting temple solver...');
  console.log(`Architect position: (${state.architect.x}, ${state.architect.y})`);
  console.log(`Solver: ${options.useOptimalSolver ? 'OR-Tools CP-SAT (optimal)' : options.strategy}`);
  console.log(`Max time: ${options.maxTime / 1000}s`);
  console.log(`Min Spymasters: ${minSpymasters}`);
  console.log(`Min Corruption Chambers: ${minCorruptionChambers}`);
  console.log('');

  // Print initial grid
  console.log('Initial State:');
  console.log(formatGrid(state));
  console.log('');

  let solution;

  if (options.useOptimalSolver) {
    // Use OR-Tools CP-SAT solver
    console.log('Running OR-Tools CP-SAT solver (this may take a while)...');
    console.log('');
    solution = await solveOptimal(state, {
      minSpymasters,
      minCorruptionChambers,
      maxTimeSeconds: Math.ceil(options.maxTime / 1000),
    });
  } else {
    // Use built-in A* solver
    const goal = TempleSolver.createBestTempleGoal();
    goal.minSpymasters = minSpymasters;
    goal.minCorruptionChambers = minCorruptionChambers;

    const pool = createUnlimitedPool();
    const solver = new TempleSolver();

    solution = solver.solve(state, pool, goal, {
      strategy: options.strategy,
      maxTime: options.maxTime,
    });
  }

  // Output result
  if (options.outputFormat === 'json') {
    console.log(formatSolutionJSON(solution));
  } else {
    console.log(formatSolution(solution));
    console.log('');
    console.log('Final Grid:');
    console.log(formatGrid(solution.finalState));
  }

  // Export Sulozor URL if requested
  if (options.exportUrl) {
    console.log('');
    console.log('=== SULOZOR URL ===');
    console.log(exportToSulozorUrl(solution.finalState));
  }
}

function runAnalyze(options: CLIOptions): void {
  let state: TempleState;

  if (options.inputFile) {
    try {
      const content = fs.readFileSync(options.inputFile, 'utf-8');
      state = parseTempleFromJSON(content);
    } catch (err) {
      console.error(`Error loading input file: ${err}`);
      process.exit(1);
    }
  } else if (options.architectX && options.architectY) {
    state = createEmptyState({ x: options.architectX, y: options.architectY });
  } else {
    console.error('Error: Must provide either --input file or --architect position');
    process.exit(1);
  }

  console.log('=== TEMPLE ANALYSIS ===');
  console.log('');
  console.log(formatGrid(state));
  console.log('');

  const analysis = analyzeTemple(state);

  console.log(`Total Rooms: ${analysis.totalRooms}`);
  console.log('');

  console.log('Room Counts:');
  for (const [key, count] of Object.entries(analysis.roomCounts)) {
    console.log(`  ${key}: ${count}`);
  }
  console.log('');

  console.log('Connectivity:');
  console.log(`  Connected to Foyer: ${analysis.connectivity.connectedToFoyer} cells`);
  console.log(`  Connected to Architect: ${analysis.connectivity.connectedToArchitect} cells`);
  console.log('');

  console.log('Chain Tips:');
  for (const tip of analysis.chainTips) {
    console.log(`  (${tip.x}, ${tip.y})`);
  }
  console.log('');

  if (analysis.suggestions.length > 0) {
    console.log('Suggestions:');
    for (const suggestion of analysis.suggestions) {
      console.log(`  • ${suggestion}`);
    }
  }
}

async function runInteractive(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string): Promise<string> => {
    return new Promise(resolve => {
      rl.question(prompt, resolve);
    });
  };

  console.log('=== POE2 Temple Solver - Interactive Mode ===');
  console.log('');

  // Get architect position
  const archInput = await question('Enter Architect position (x,y): ');
  const [archX, archY] = archInput.split(',').map(s => parseInt(s.trim()));

  if (isNaN(archX) || isNaN(archY)) {
    console.log('Invalid position. Using default (7, 4).');
  }

  const architectPos = { x: archX || 7, y: archY || 4 };
  let state = createEmptyState(architectPos);

  console.log('');
  console.log('Commands: solve, analyze, place <type> <tier> <x,y>, path <x,y>, show, quit');
  console.log('');

  let running = true;

  while (running) {
    console.log(formatGrid(state));
    console.log('');

    const input = await question('> ');
    const parts = input.trim().toLowerCase().split(/\s+/);
    const cmd = parts[0];

    switch (cmd) {
      case 'solve': {
        console.log('Solving...');
        const goal = TempleSolver.createBestTempleGoal();
        const pool = createUnlimitedPool();
        const solver = new TempleSolver();
        const solution = solver.solve(state, pool, goal);
        console.log(formatSolution(solution));
        state = solution.finalState;
        break;
      }

      case 'analyze': {
        const analysis = analyzeTemple(state);
        console.log(`Rooms: ${analysis.totalRooms}`);
        for (const suggestion of analysis.suggestions) {
          console.log(`  • ${suggestion}`);
        }
        break;
      }

      case 'place': {
        if (parts.length < 4) {
          console.log('Usage: place <type> <tier> <x,y>');
          break;
        }
        const type = parts[1].toUpperCase() as RoomType;
        const tier = parseInt(parts[2]) as Tier;
        const [px, py] = parts[3].split(',').map(Number);

        try {
          const { placeRoom } = require('../state/temple-state.js');
          placeRoom(state, type, tier, { x: px, y: py });
          updateConnectivity(state);
          console.log(`Placed ${type} T${tier} at (${px}, ${py})`);
        } catch (err) {
          console.log(`Error: ${err}`);
        }
        break;
      }

      case 'path': {
        if (parts.length < 2) {
          console.log('Usage: path <x,y>');
          break;
        }
        const [px, py] = parts[1].split(',').map(Number);

        try {
          const { placePath } = require('../state/temple-state.js');
          placePath(state, { x: px, y: py });
          updateConnectivity(state);
          console.log(`Placed path at (${px}, ${py})`);
        } catch (err) {
          console.log(`Error: ${err}`);
        }
        break;
      }

      case 'show':
        // Grid is printed at start of loop
        break;

      case 'export': {
        const json = exportStateToJSON(state);
        console.log(json);
        break;
      }

      case 'quit':
      case 'exit':
      case 'q':
        running = false;
        break;

      default:
        console.log('Unknown command. Type "help" for available commands.');
    }

    console.log('');
  }

  rl.close();
  console.log('Goodbye!');
}

// Main entry point
async function main(): Promise<void> {
  const options = parseArgs(args);

  switch (options.command) {
    case 'solve':
      await runSolve(options);
      break;

    case 'analyze':
      runAnalyze(options);
      break;

    case 'interactive':
      await runInteractive();
      break;

    case 'help':
    default:
      printHelp();
      break;
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
