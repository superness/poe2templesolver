/**
 * HiGHS WASM Solver Wrapper
 *
 * Provides a TypeScript interface for building and solving MIP problems
 * using HiGHS (https://highs.dev)
 */

console.log('=== highs-solver.ts v11 loaded ===');

// HiGHS types
interface HighsSolution {
  Status: string;
  ObjectiveValue: number;
  Columns: Record<string, { Primal: number }>;
  Rows: unknown[];
}

type HighsSolver = { solve: (problem: string, options?: Record<string, unknown>) => HighsSolution };
type HighsLoader = (options?: { locateFile?: (file: string) => string }) => Promise<HighsSolver>;

let loaderPromise: Promise<HighsLoader> | null = null;

/**
 * Load HiGHS script dynamically
 */
function loadHighsScript(): Promise<HighsLoader> {
  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/highs@1.8.0/build/highs.js';
    script.onload = () => {
      // The script sets window.Module
      const Module = (window as unknown as { Module: HighsLoader }).Module;
      if (typeof Module === 'function') {
        resolve(Module);
      } else {
        reject(new Error('HiGHS script loaded but Module not found'));
      }
    };
    script.onerror = () => reject(new Error('Failed to load HiGHS script'));
    document.head.appendChild(script);
  });

  return loaderPromise;
}

/**
 * Initialize HiGHS WASM - creates a fresh instance each time
 */
export async function initHiGHS(): Promise<HighsSolver> {
  const loader = await loadHighsScript();

  const instance = await loader({
    locateFile: (file: string) => {
      if (file.endsWith('.wasm')) {
        return `https://cdn.jsdelivr.net/npm/highs@1.8.0/build/${file}`;
      }
      return file;
    },
  });

  console.log('HiGHS instance created');
  return instance;
}

/**
 * Variable type
 */
export type VarType = 'continuous' | 'binary' | 'integer';

/**
 * Variable definition
 */
export interface Variable {
  name: string;
  type: VarType;
  lb?: number;
  ub?: number;
  obj?: number; // Objective coefficient
}

/**
 * Constraint sense
 */
export type ConstraintSense = '<=' | '>=' | '=';

/**
 * Linear constraint: sum(coef[i] * var[i]) sense rhs
 */
export interface Constraint {
  name?: string;
  terms: { var: string; coef: number }[];
  sense: ConstraintSense;
  rhs: number;
}

/**
 * MIP Problem definition
 */
export interface MIPProblem {
  name?: string;
  sense: 'minimize' | 'maximize';
  variables: Variable[];
  constraints: Constraint[];
}

/**
 * Solution result
 */
export interface SolutionResult {
  status: string;
  optimal: boolean;
  objectiveValue: number;
  variables: Record<string, number>;
  timeSeconds?: number;
}

/**
 * Convert MIP problem to LP format string
 */
function problemToLP(problem: MIPProblem): string {
  const lines: string[] = [];

  // Objective
  lines.push(problem.sense === 'maximize' ? 'Maximize' : 'Minimize');

  // Build objective function - break into multiple lines to avoid line length issues
  const objTerms = problem.variables
    .filter((v) => v.obj !== undefined && v.obj !== 0)
    .map((v) => {
      const coef = v.obj!;
      if (coef === 1) return v.name;
      if (coef === -1) return `- ${v.name}`;
      if (coef > 0) return `${coef} ${v.name}`;
      return `- ${Math.abs(coef)} ${v.name}`;
    });

  if (objTerms.length > 0) {
    // Break objective into chunks of 10 terms per line
    lines.push('  obj:');
    for (let i = 0; i < objTerms.length; i += 10) {
      const chunk = objTerms.slice(i, i + 10);
      const prefix = i === 0 ? '    ' : '    + ';
      lines.push(prefix + chunk.join(' + ').replace(/\+ -/g, '- '));
    }
  } else {
    lines.push('  obj: 0');
  }

  // Constraints - break long lines
  lines.push('Subject To');
  for (let i = 0; i < problem.constraints.length; i++) {
    const c = problem.constraints[i];
    const name = c.name || `c${i}`;

    const termStrs = c.terms.map((t) => {
      if (t.coef === 1) return t.var;
      if (t.coef === -1) return `- ${t.var}`;
      if (t.coef > 0) return `${t.coef} ${t.var}`;
      return `- ${Math.abs(t.coef)} ${t.var}`;
    });

    const senseStr = c.sense === '<=' ? '<=' : c.sense === '>=' ? '>=' : '=';

    if (termStrs.length === 0) {
      lines.push(`  ${name}: 0 ${senseStr} ${c.rhs}`);
    } else if (termStrs.length <= 10) {
      const lhs = termStrs.join(' + ').replace(/\+ -/g, '- ');
      lines.push(`  ${name}: ${lhs} ${senseStr} ${c.rhs}`);
    } else {
      // Break into multiple lines - but keep sense/rhs on last line with terms
      lines.push(`  ${name}:`);
      const chunks: string[] = [];
      for (let j = 0; j < termStrs.length; j += 10) {
        chunks.push(termStrs.slice(j, j + 10).join(' + '));
      }
      for (let j = 0; j < chunks.length; j++) {
        const prefix = j === 0 ? '    ' : '    + ';
        const suffix = j === chunks.length - 1 ? ` ${senseStr} ${c.rhs}` : '';
        lines.push(prefix + chunks[j].replace(/\+ -/g, '- ') + suffix);
      }
    }
  }

  // Bounds
  lines.push('Bounds');
  for (const v of problem.variables) {
    const lb = v.lb ?? 0;
    const ub = v.ub ?? (v.type === 'binary' ? 1 : Infinity);

    if (v.type === 'binary') {
      lines.push(`  0 <= ${v.name} <= 1`);
    } else if (ub === Infinity) {
      if (lb === 0) {
        lines.push(`  ${v.name} >= 0`);
      } else {
        lines.push(`  ${v.name} >= ${lb}`);
      }
    } else {
      lines.push(`  ${lb} <= ${v.name} <= ${ub}`);
    }
  }

  // Integer/Binary variables
  const intVars = problem.variables.filter((v) => v.type === 'integer');
  const binVars = problem.variables.filter((v) => v.type === 'binary');

  if (intVars.length > 0) {
    lines.push('General');
    // Group into lines of ~10 variables
    for (let i = 0; i < intVars.length; i += 10) {
      lines.push('  ' + intVars.slice(i, i + 10).map((v) => v.name).join(' '));
    }
  }

  if (binVars.length > 0) {
    lines.push('Binary');
    for (let i = 0; i < binVars.length; i += 10) {
      lines.push('  ' + binVars.slice(i, i + 10).map((v) => v.name).join(' '));
    }
  }

  lines.push('End');

  return lines.join('\n');
}

/**
 * Solve a MIP problem
 */
export async function solveMIP(
  problem: MIPProblem,
  options?: { timeLimit?: number; verbose?: boolean }
): Promise<SolutionResult> {
  console.log('[solveMIP] Starting...');
  console.log('[solveMIP] Problem:', problem.variables.length, 'vars,', problem.constraints.length, 'constraints');

  // Create fresh HiGHS instance for each solve (reusing causes corruption)
  console.log('[solveMIP] Creating HiGHS instance...');
  const highs = await initHiGHS();
  console.log('[solveMIP] HiGHS instance ready');

  console.log('[solveMIP] Converting to LP format...');
  const lpString = problemToLP(problem);
  console.log('[solveMIP] LP string length:', lpString.length);

  // Always save LP for debugging
  try {
    localStorage.setItem('lastLP', lpString);
    console.log('[solveMIP] LP saved to localStorage');
  } catch (e) {
    console.log('[solveMIP] Could not save LP to localStorage');
  }

  // Log first and last parts of LP
  console.log('[solveMIP] LP start:', lpString.slice(0, 200));
  console.log('[solveMIP] LP end:', lpString.slice(-200));

  const startTime = performance.now();

  console.log('[solveMIP] Calling highs.solve()...');
  let result: HighsSolution;
  try {
    // Don't pass options - they may cause WASM issues
    result = highs.solve(lpString);
    console.log('[solveMIP] Solve returned:', result?.Status);
  } catch (e) {
    const endTime = performance.now();
    console.error('[solveMIP] HiGHS solve EXCEPTION:', e);
    console.error('[solveMIP] Exception type:', typeof e);
    console.error('[solveMIP] Exception message:', (e as Error)?.message);
    // Return infeasible result
    return {
      status: 'Infeasible',
      optimal: false,
      objectiveValue: 0,
      variables: {},
      timeSeconds: (endTime - startTime) / 1000,
    };
  }

  const endTime = performance.now();

  if (options?.verbose) {
    console.log('HiGHS result:', result);
  }

  const variables: Record<string, number> = {};
  if (result.Columns) {
    for (const [name, col] of Object.entries(result.Columns)) {
      variables[name] = col.Primal;
    }
  }

  const optimal = result.Status === 'Optimal';
  const feasible =
    optimal ||
    result.Status === 'Time limit reached' ||
    result.Status === 'Iteration limit reached';

  return {
    status: result.Status,
    optimal,
    objectiveValue: feasible ? result.ObjectiveValue : 0,
    variables: feasible ? variables : {},
    timeSeconds: (endTime - startTime) / 1000,
  };
}

/**
 * Helper to create variable name for room placement
 */
export function roomVar(x: number, y: number, roomTypeIdx: number): string {
  return `r_${x}_${y}_${roomTypeIdx}`;
}

/**
 * Helper to create variable name for tier
 */
export function tierVar(x: number, y: number, tier: number): string {
  return `t_${x}_${y}_${tier}`;
}

/**
 * Helper to create variable name for in_temple
 */
export function inTempleVar(x: number, y: number): string {
  return `in_${x}_${y}`;
}

/**
 * Helper for flow variables
 */
export function flowVar(x: number, y: number, dir: string): string {
  return `flow_${x}_${y}_${dir}`;
}

/**
 * Helper for edge variables
 */
export function edgeVar(x1: number, y1: number, x2: number, y2: number): string {
  // Normalize edge direction for consistency
  if (x1 < x2 || (x1 === x2 && y1 < y2)) {
    return `edge_${x1}_${y1}_${x2}_${y2}`;
  }
  return `edge_${x2}_${y2}_${x1}_${y1}`;
}
