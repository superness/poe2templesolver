import { useState, useCallback, useEffect, useRef } from 'react';
import type { TempleState, SolverConfig, SolverResult, Room, Edge, RoomValues, RoomType, ChainConfig } from './solver/types';
import { GRID_SIZE, FOYER_POS, DEFAULT_ROOM_VALUES, CHAIN_PRESETS } from './solver/types';
import { parseSulozorUrl, exportToSulozorUrl } from './lib/sulozor-parser';
import { ROOM_ABBREV } from './solver/room-rules';
import AdminPage from './pages/AdminPage';
import './App.css';

// API URL: /api in production (same server), localhost:5000 in dev
const API_URL = import.meta.env.DEV ? 'http://localhost:5000' : '/api';
const MAX_SOLVE_TIME = parseInt(import.meta.env.VITE_MAX_SOLVE_TIME || '120');

const DEFAULT_CONFIG: SolverConfig = {
  minSpymasters: 8,
  minCorruptionChambers: 6,
  maxPaths: 0,
  snakeMode: true,
  maxEndpoints: 3,  // 2-3 endpoints like the great temples
  maxTimeSeconds: 60,
  lockExisting: true,
  junctionPenalty: 100,  // Points deducted per room with 3+ neighbors
  maxNeighbors: 4,      // Hard limit (2 = strict snake, 4 = no limit)
  emptyPenalty: 100,      // Points deducted per empty cell (encourages filling)
};

function App() {
  const [url, setUrl] = useState('');
  const [state, setState] = useState<TempleState | null>(null);
  const [config, setConfig] = useState<SolverConfig>(DEFAULT_CONFIG);
  const [result, setResult] = useState<SolverResult | null>(null);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [solving, setSolving] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [solutionsFound, setSolutionsFound] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [apiStatus, setApiStatus] = useState<'unknown' | 'ok' | 'error'>('unknown');
  const pollIntervalRef = useRef<number | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<'queued' | 'solving' | 'complete' | 'error' | null>(null);
  const [queuePosition, setQueuePosition] = useState<number>(0);
  const [roomValues, setRoomValues] = useState<RoomValues>(() => JSON.parse(JSON.stringify(DEFAULT_ROOM_VALUES)));
  const [showRoomValues, setShowRoomValues] = useState(false);
  const [chainPreset, setChainPreset] = useState<string>('none');
  const [chains, setChains] = useState<ChainConfig[]>([]);
  const [showChains, setShowChains] = useState(false);
  const [customPresets, setCustomPresets] = useState<Record<string, ChainConfig[]>>(() => {
    try {
      const saved = localStorage.getItem('temple-solver-presets');
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  });

  // Save custom presets to localStorage when they change
  useEffect(() => {
    localStorage.setItem('temple-solver-presets', JSON.stringify(customPresets));
  }, [customPresets]);

  const saveCurrentAsPreset = () => {
    const name = prompt('Enter preset name:');
    if (name && name.trim()) {
      setCustomPresets({ ...customPresets, [name.trim()]: JSON.parse(JSON.stringify(chains)) });
      setChainPreset(`custom:${name.trim()}`);
    }
  };

  const deleteCustomPreset = (name: string) => {
    const newPresets = { ...customPresets };
    delete newPresets[name];
    setCustomPresets(newPresets);
    if (chainPreset === `custom:${name}`) {
      setChainPreset('custom');
    }
  };

  // Load temple from URL parameter on mount (e.g., ?t=ENCODED_DATA)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const templeParam = params.get('t');
    if (templeParam) {
      try {
        // Try to parse as Sulozor-style encoded data
        const fakeUrl = `https://sulozor.github.io/poe2-temple/?t=${templeParam}`;
        const parsed = parseSulozorUrl(fakeUrl);
        if (parsed && parsed.state) {
          setState(parsed.state);
          setUrl(fakeUrl);
        }
      } catch (e) {
        console.error('Failed to parse temple from URL param:', e);
      }
    }
  }, []);

  const checkApi = useCallback(async () => {
    try {
      const resp = await fetch(`${API_URL}/health`);
      if (resp.ok) {
        setApiStatus('ok');
        return true;
      }
      setApiStatus('error');
      setError('Python solver not running. Start it with: cd solver-python && python server.py');
      return false;
    } catch {
      setApiStatus('error');
      setError('Python solver not running. Start it with: cd solver-python && python server.py');
      return false;
    }
  }, []);

  // Check API on mount
  useEffect(() => {
    checkApi();
  }, [checkApi]);

  // Poll job status while solving
  useEffect(() => {
    if (!jobId || !solving) return;

    const pollJob = async () => {
      try {
        const resp = await fetch(`${API_URL}/job/${jobId}`);
        const data = await resp.json();

        setJobStatus(data.status);

        if (data.status === 'queued') {
          setQueuePosition(data.queue_position || 0);
          setElapsedSeconds(data.waiting_seconds || 0);
        } else if (data.status === 'solving') {
          setQueuePosition(0);
          setElapsedSeconds(data.elapsed_seconds || 0);

          // Update with intermediate solution if available
          if (data.best_solution) {
            setSolutionsFound(data.best_solution.solution_count || 0);

            const intermediateSolution: SolverResult = {
              success: true,
              optimal: false,
              score: data.best_solution.score,
              rooms: data.best_solution.rooms.map((r: { type: string; tier: number; x: number; y: number; chain?: number }) => ({
                type: r.type as Room['type'],
                tier: r.tier as Room['tier'],
                position: { x: r.x, y: r.y },
                chain: r.chain,
              })),
              paths: data.best_solution.paths.map((p: { x: number; y: number; chain?: number }) => ({ x: p.x, y: p.y, chain: p.chain })),
              stats: {
                status: 'SEARCHING',
                timeSeconds: data.elapsed_seconds || 0,
              },
              chainNames: data.best_solution.chain_names,
            };
            setResult(intermediateSolution);

            const solverEdges: Edge[] = (data.best_solution.edges || []).map((e: { from: { x: number; y: number }; to: { x: number; y: number } }) => ({
              from: { x: e.from.x, y: e.from.y },
              to: { x: e.to.x, y: e.to.y },
            }));
            setEdges(solverEdges);
          }
        } else if (data.status === 'complete') {
          // Final result
          const finalData = data.result;
          const solution: SolverResult = {
            success: finalData.success,
            optimal: finalData.optimal,
            score: finalData.score,
            rooms: finalData.rooms.map((r: { type: string; tier: number; x: number; y: number; chain?: number }) => ({
              type: r.type as Room['type'],
              tier: r.tier as Room['tier'],
              position: { x: r.x, y: r.y },
              chain: r.chain,
            })),
            paths: finalData.paths.map((p: { x: number; y: number; chain?: number }) => ({ x: p.x, y: p.y, chain: p.chain })),
            stats: {
              status: finalData.stats?.status || 'Complete',
              timeSeconds: finalData.stats?.time_seconds || data.duration || 0,
              spy_cmd_valid: finalData.stats?.spy_cmd_valid,
              spy_cmd_violation: finalData.stats?.spy_cmd_violation,
            },
            error: finalData.error,
            chainNames: finalData.chain_names,
          };

          const solverEdges: Edge[] = (finalData.edges || []).map((e: { from: { x: number; y: number }; to: { x: number; y: number } }) => ({
            from: { x: e.from.x, y: e.from.y },
            to: { x: e.to.x, y: e.to.y },
          }));
          setEdges(solverEdges);
          setResult(solution);
          setSolving(false);
          setJobId(null);
          setJobStatus(null);

          if (!solution.success) {
            setError(solution.error || 'Solver failed');
          }
        } else if (data.status === 'error') {
          setError(data.error || 'Solver error');
          setSolving(false);
          setJobId(null);
          setJobStatus(null);
        }
      } catch {
        // Ignore transient errors during polling
      }
    };

    // Poll immediately and then every 500ms
    pollJob();
    pollIntervalRef.current = window.setInterval(pollJob, 500);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [jobId, solving]);

  const handleImport = useCallback(() => {
    setError(null);
    setWarnings([]);
    setResult(null);

    try {
      const { state: parsed, warnings: w } = parseSulozorUrl(url);
      setState(parsed);
      setWarnings(w);
      // Set imported edges for visualization
      if (parsed.edges) {
        setEdges(parsed.edges);
      } else {
        setEdges([]);
      }
    } catch (e) {
      setError(`Import failed: ${e}`);
    }
  }, [url]);

  const handleSolve = useCallback(async () => {
    if (!state) return;

    setError(null);
    setResult(null);
    setElapsedSeconds(0);
    setSolutionsFound(0);
    setQueuePosition(0);
    setJobStatus(null);

    try {
      // Check API is available
      const apiOk = await checkApi();
      if (!apiOk) {
        return;
      }

      // Build request for Python API
      const requestBody = {
        architect: [state.architect.x, state.architect.y],
        min_spymasters: config.minSpymasters,
        min_corruption_chambers: config.minCorruptionChambers,
        max_paths: config.maxPaths,
        snake_mode: config.snakeMode,
        max_endpoints: config.maxEndpoints,
        max_time_seconds: config.maxTimeSeconds,
        lock_existing: config.lockExisting,
        junction_penalty: config.junctionPenalty,
        max_neighbors: config.maxNeighbors,
        empty_penalty: config.emptyPenalty,
        room_values: roomValues,
        chains: chains.length > 0 ? chains : undefined,
        existing_rooms: state.rooms.map(r => ({
          type: r.type,
          tier: r.tier,
          x: r.position.x,
          y: r.position.y,
        })),
        existing_paths: state.paths.map(p => [p.x, p.y]),
      };

      console.log('Submitting job to solver:', requestBody);

      const resp = await fetch(`${API_URL}/solve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const data = await resp.json();
      console.log('Job submitted:', data);

      if (!data.success && !data.job_id) {
        // Immediate error (rate limit, queue full, etc.)
        setError(data.error || 'Failed to submit job');
        return;
      }

      // Job submitted - start polling
      setJobId(data.job_id);
      setJobStatus(data.status || 'queued');
      setQueuePosition(data.queue_position || 0);
      setSolving(true);

    } catch (e) {
      setError(`Failed to submit job: ${e}`);
    }
  }, [state, config, roomValues, chains, checkApi]);

  const handleExport = useCallback(() => {
    if (!result || !state) return;

    const finalState: TempleState = {
      architect: state.architect,
      rooms: result.rooms,
      paths: result.paths,
      edges: edges,  // Include edges from solver for proper connection encoding
    };

    console.log('Exporting with', edges.length, 'edges');
    const exportUrl = exportToSulozorUrl(finalState);
    window.open(exportUrl, '_blank');
  }, [result, state, edges]);

  const displayState = result
    ? { architect: state!.architect, rooms: result.rooms, paths: result.paths }
    : state;

  // Check if admin page requested
  const isAdmin = window.location.hash === '#/admin' || new URLSearchParams(window.location.search).get('admin') === 'true';
  if (isAdmin) {
    return <AdminPage />;
  }

  // Generate shareable URL with temple data (uses result if available)
  const getShareUrl = () => {
    if (!state) return null;
    // Use result if available, otherwise use current state
    const finalState = result
      ? { architect: state.architect, rooms: result.rooms, paths: result.paths }
      : state;
    const exportUrl = exportToSulozorUrl(finalState);
    const params = new URL(exportUrl).searchParams.get('t');
    if (params) {
      return `${window.location.origin}${window.location.pathname}?t=${params}`;
    }
    return null;
  };

  return (
    <div className="app">
      <h1>POE2 Temple Solver</h1>
      <div className={`api-status ${apiStatus}`}>
        {apiStatus === 'unknown' && 'Solver: checking...'}
        {apiStatus === 'ok' && 'Solver: connected'}
        {apiStatus === 'error' && 'Solver: not connected'}
        {apiStatus !== 'ok' && (
          <button onClick={checkApi} style={{ marginLeft: 8 }}>Retry</button>
        )}
      </div>

      <div className="input-section">
        <h2>Import Temple</h2>
        <div className="url-input">
          <input
            type="text"
            placeholder="Paste Sulozor URL here..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button onClick={handleImport} disabled={!url}>
            Import
          </button>
        </div>
        {warnings.length > 0 && (
          <div className="warnings">
            {warnings.map((w, i) => (
              <div key={i}>{w}</div>
            ))}
          </div>
        )}
      </div>

      {state && (
        <>
          <div className="config-section">
            <h2>Solver Config</h2>
            <div className="config-grid">
              <label>
                Architect X:
                <input
                  type="number"
                  min={1}
                  max={9}
                  value={state.architect.x}
                  onChange={(e) => {
                    const x = Math.max(1, Math.min(9, parseInt(e.target.value) || 1));
                    setState({ ...state, architect: { ...state.architect, x } });
                  }}
                />
              </label>
              <label>
                Architect Y:
                <input
                  type="number"
                  min={1}
                  max={9}
                  value={state.architect.y}
                  onChange={(e) => {
                    const y = Math.max(1, Math.min(9, parseInt(e.target.value) || 1));
                    setState({ ...state, architect: { ...state.architect, y } });
                  }}
                />
              </label>
              <label>
                Min Spymasters:
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={config.minSpymasters}
                  onChange={(e) =>
                    setConfig({ ...config, minSpymasters: parseInt(e.target.value) || 0 })
                  }
                />
              </label>
              <label>
                Min Corruption Chambers:
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={config.minCorruptionChambers}
                  onChange={(e) =>
                    setConfig({ ...config, minCorruptionChambers: parseInt(e.target.value) || 0 })
                  }
                />
              </label>
              <label>
                Max Paths:
                <input
                  type="number"
                  min={0}
                  max={50}
                  value={config.maxPaths}
                  onChange={(e) =>
                    setConfig({ ...config, maxPaths: parseInt(e.target.value) || 0 })
                  }
                />
              </label>
              <label>
                Max Endpoints:
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={config.maxEndpoints}
                  onChange={(e) =>
                    setConfig({ ...config, maxEndpoints: parseInt(e.target.value) || 2 })
                  }
                />
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={config.snakeMode}
                  onChange={(e) => setConfig({ ...config, snakeMode: e.target.checked })}
                />
                Snake mode (no junctions)
              </label>
              {config.snakeMode && (
                <>
                  <label>
                    Junction Penalty:
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={config.junctionPenalty}
                      onChange={(e) =>
                        setConfig({ ...config, junctionPenalty: parseInt(e.target.value) || 0 })
                      }
                      title="Points deducted per room with 3+ neighbors (0 = disabled)"
                    />
                  </label>
                  <label>
                    Max Neighbors:
                    <input
                      type="number"
                      min={2}
                      max={4}
                      value={config.maxNeighbors}
                      onChange={(e) =>
                        setConfig({ ...config, maxNeighbors: parseInt(e.target.value) || 4 })
                      }
                      title="Hard limit on neighbors per room (2 = strict snake, 4 = no limit)"
                    />
                  </label>
                </>
              )}
              <label>
                Empty Penalty:
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={config.emptyPenalty}
                  onChange={(e) =>
                    setConfig({ ...config, emptyPenalty: parseInt(e.target.value) || 0 })
                  }
                  title="Points deducted per empty cell (high value = fill all cells)"
                />
              </label>
              <label>
                Time Limit (s):
                <input
                  type="number"
                  min={5}
                  max={MAX_SOLVE_TIME}
                  value={config.maxTimeSeconds}
                  onChange={(e) =>
                    setConfig({ ...config, maxTimeSeconds: Math.min(MAX_SOLVE_TIME, parseInt(e.target.value) || 30) })
                  }
                />
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={config.lockExisting}
                  onChange={(e) => setConfig({ ...config, lockExisting: e.target.checked })}
                />
                Keep existing rooms
              </label>
            </div>
            <button className="solve-btn" onClick={handleSolve} disabled={solving}>
              {solving
                ? jobStatus === 'queued'
                  ? `Queued #${queuePosition} (${elapsedSeconds.toFixed(0)}s)`
                  : `Solving... ${elapsedSeconds.toFixed(1)}s${solutionsFound ? ` (${solutionsFound} found)` : ''}`
                : 'Solve'}
            </button>
          </div>

          <div className="room-values-section">
            <h2 onClick={() => setShowRoomValues(!showRoomValues)} style={{ cursor: 'pointer' }}>
              Room Values {showRoomValues ? '▼' : '▶'}
            </h2>
            {showRoomValues && (
              <div className="room-values-grid">
                <div className="room-values-header">
                  <span>Room Type</span>
                  <span>T1</span>
                  <span>T2</span>
                  <span>T3</span>
                </div>
                {(Object.keys(roomValues) as (RoomType | 'EMPTY')[])
                  .filter(t => t !== 'EMPTY' && t !== 'PATH')
                  .sort()
                  .map((roomType) => (
                    <div key={roomType} className="room-values-row">
                      <span className="room-type-name">{ROOM_ABBREV[roomType as RoomType] || roomType.slice(0, 3)}</span>
                      {[0, 1, 2].map((tierIdx) => (
                        <input
                          key={tierIdx}
                          type="number"
                          min={0}
                          max={200}
                          value={roomValues[roomType][tierIdx]}
                          onChange={(e) => {
                            const newValues = { ...roomValues };
                            const tierValues = [...newValues[roomType]] as [number, number, number];
                            tierValues[tierIdx] = parseInt(e.target.value) || 0;
                            newValues[roomType] = tierValues;
                            setRoomValues(newValues);
                          }}
                        />
                      ))}
                    </div>
                  ))}
                <button
                  className="reset-values-btn"
                  onClick={() => setRoomValues(JSON.parse(JSON.stringify(DEFAULT_ROOM_VALUES)))}
                >
                  Reset to Defaults
                </button>
              </div>
            )}
          </div>

          <div className="chains-section">
            <h2 onClick={() => setShowChains(!showChains)} style={{ cursor: 'pointer' }}>
              Chain Configuration {showChains ? '▼' : '▶'}
            </h2>
            {showChains && (
              <div className="chains-config">
                <div className="preset-select">
                  <label>
                    Preset:
                    <select
                      value={chainPreset}
                      onChange={(e) => {
                        const preset = e.target.value;
                        setChainPreset(preset);
                        if (preset === 'none') {
                          setChains([]);
                        } else if (preset === 'custom') {
                          // Keep current chains
                        } else if (preset.startsWith('custom:')) {
                          const name = preset.slice(7);
                          if (customPresets[name]) {
                            setChains(JSON.parse(JSON.stringify(customPresets[name])));
                          }
                        } else if (CHAIN_PRESETS[preset]) {
                          setChains(JSON.parse(JSON.stringify(CHAIN_PRESETS[preset])));
                        }
                      }}
                    >
                      <option value="none">None (auto)</option>
                      <option value="spymaster-focus">Spymaster Focus (10-12 SPY + Corruption)</option>
                      <option value="golem-corruption">Golem/Corruption (SPY + Golem/Corr + GE)</option>
                      <option value="balanced">Balanced (3 chains)</option>
                      {Object.keys(customPresets).map(name => (
                        <option key={name} value={`custom:${name}`}>★ {name}</option>
                      ))}
                      <option value="custom">Custom (unsaved)</option>
                    </select>
                  </label>
                  <button
                    className="add-chain-btn"
                    onClick={() => {
                      setChainPreset('custom');
                      setChains([...chains, {
                        name: `Chain ${chains.length + 1}`,
                        roomTypes: [],
                        roomCounts: {},
                      }]);
                    }}
                  >
                    + Add Chain
                  </button>
                  {chains.length > 0 && (
                    <button
                      className="add-chain-btn"
                      onClick={saveCurrentAsPreset}
                      style={{ background: '#3a4a5a' }}
                    >
                      Save Preset
                    </button>
                  )}
                  {chainPreset.startsWith('custom:') && (
                    <button
                      className="remove-chain-btn"
                      onClick={() => deleteCustomPreset(chainPreset.slice(7))}
                      title="Delete this preset"
                    >
                      🗑
                    </button>
                  )}
                </div>

                {chains.length > 0 && (
                  <div className="chains-list">
                    {chains.map((chain, idx) => (
                      <div key={idx} className="chain-config">
                        <div className="chain-header">
                          <input
                            type="text"
                            className="chain-name-input"
                            value={chain.name}
                            onChange={(e) => {
                              const newChains = [...chains];
                              newChains[idx] = { ...chain, name: e.target.value };
                              setChains(newChains);
                              setChainPreset('custom');
                            }}
                          />
                          <button
                            className="remove-chain-btn"
                            onClick={() => {
                              setChains(chains.filter((_, i) => i !== idx));
                              setChainPreset('custom');
                            }}
                          >
                            ×
                          </button>
                        </div>

                        <div className="chain-field">
                          <span className="label">Starting Room:</span>
                          <select
                            value={chain.startingRoom || ''}
                            onChange={(e) => {
                              const newChains = [...chains];
                              newChains[idx] = {
                                ...chain,
                                startingRoom: e.target.value as RoomType || undefined,
                              };
                              setChains(newChains);
                              setChainPreset('custom');
                            }}
                          >
                            <option value="">None</option>
                            {(['GENERATOR', 'GARRISON', 'ARMOURY', 'THAUMATURGE', 'SMITHY', 'ALCHEMY_LAB'] as RoomType[]).map(rt => (
                              <option key={rt} value={rt}>{ROOM_ABBREV[rt]} - {rt}</option>
                            ))}
                          </select>
                        </div>

                        <div className="chain-field">
                          <span className="label">Allowed Types:</span>
                          <div className="room-type-checkboxes">
                            {(['SPYMASTER', 'GARRISON', 'LEGION_BARRACKS', 'COMMANDER', 'ARMOURY',
                              'CORRUPTION_CHAMBER', 'THAUMATURGE', 'SACRIFICIAL_CHAMBER', 'ALCHEMY_LAB',
                              'GOLEM_WORKS', 'SMITHY', 'GENERATOR', 'FLESH_SURGEON', 'SYNTHFLESH'] as RoomType[]).map(rt => (
                              <label key={rt} className="room-type-checkbox">
                                <input
                                  type="checkbox"
                                  checked={chain.roomTypes.includes(rt)}
                                  onChange={(e) => {
                                    const newChains = [...chains];
                                    const newTypes = e.target.checked
                                      ? [...chain.roomTypes, rt]
                                      : chain.roomTypes.filter(t => t !== rt);
                                    newChains[idx] = { ...chain, roomTypes: newTypes };
                                    setChains(newChains);
                                    setChainPreset('custom');
                                  }}
                                />
                                {ROOM_ABBREV[rt]}
                              </label>
                            ))}
                          </div>
                        </div>

                        <div className="chain-field">
                          <span className="label">Room Counts:</span>
                          <div className="room-counts-editor">
                            {chain.roomTypes.map(rt => (
                              <div key={rt} className="room-count-row">
                                <span className="room-count-name">{ROOM_ABBREV[rt]}</span>
                                <span>Min:</span>
                                <input
                                  type="number"
                                  min={0}
                                  max={20}
                                  value={chain.roomCounts?.[rt]?.min ?? ''}
                                  placeholder="-"
                                  onChange={(e) => {
                                    const newChains = [...chains];
                                    const newCounts = { ...chain.roomCounts };
                                    const val = parseInt(e.target.value);
                                    if (isNaN(val)) {
                                      if (newCounts[rt]) {
                                        delete newCounts[rt].min;
                                        if (Object.keys(newCounts[rt] || {}).length === 0) delete newCounts[rt];
                                      }
                                    } else {
                                      newCounts[rt] = { ...newCounts[rt], min: val };
                                    }
                                    newChains[idx] = { ...chain, roomCounts: newCounts };
                                    setChains(newChains);
                                    setChainPreset('custom');
                                  }}
                                />
                                <span>Max:</span>
                                <input
                                  type="number"
                                  min={0}
                                  max={20}
                                  value={chain.roomCounts?.[rt]?.max ?? ''}
                                  placeholder="-"
                                  onChange={(e) => {
                                    const newChains = [...chains];
                                    const newCounts = { ...chain.roomCounts };
                                    const val = parseInt(e.target.value);
                                    if (isNaN(val)) {
                                      if (newCounts[rt]) {
                                        delete newCounts[rt].max;
                                        if (Object.keys(newCounts[rt] || {}).length === 0) delete newCounts[rt];
                                      }
                                    } else {
                                      newCounts[rt] = { ...newCounts[rt], max: val };
                                    }
                                    newChains[idx] = { ...chain, roomCounts: newCounts };
                                    setChains(newChains);
                                    setChainPreset('custom');
                                  }}
                                />
                              </div>
                            ))}
                            {chain.roomTypes.length === 0 && (
                              <span className="no-types-hint">Select room types above to set counts</span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {chains.length === 0 && (
                  <div className="chain-hint">
                    Select a preset or click "+ Add Chain" to create custom chain configurations.
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="grid-section">
            <h2>{result ? (solving ? `Best So Far (Score: ${result.score})` : 'Solution') : 'Current Temple'}</h2>
            {displayState && <TempleGrid state={displayState} edges={edges} roomValues={roomValues} chainNames={result?.chainNames} />}
          </div>

          {result && (
            <div className="result-section">
              <h2>Results</h2>
              <div className="metrics">
                <div>Status: {result.stats.status}</div>
                <div>Score: {result.score}</div>
                <div>Rooms: {result.rooms.length}</div>
                <div>Paths: {result.paths.length}</div>
                <div>
                  Spymasters: {result.rooms.filter((r) => r.type === 'SPYMASTER').length}
                </div>
                <div>
                  Corruption: {result.rooms.filter((r) => r.type === 'CORRUPTION_CHAMBER').length}
                </div>
                <div>Time: {result.stats.timeSeconds.toFixed(2)}s</div>
                {result.stats.spy_cmd_valid !== undefined && (
                  <div style={{ color: result.stats.spy_cmd_valid ? '#4a4' : '#f44' }}>
                    SPY-CMD Check: {result.stats.spy_cmd_valid ? 'PASS' : 'FAIL'}
                  </div>
                )}
                {result.stats.spy_cmd_violation && (
                  <div style={{ color: '#f44', fontSize: '0.9em' }}>
                    Violation: {result.stats.spy_cmd_violation}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button className="export-btn" onClick={handleExport}>
                  Open in Sulozor
                </button>
                <button
                  className="export-btn"
                  style={{ background: '#5a7a5a' }}
                  onClick={() => {
                    const shareUrl = getShareUrl();
                    if (shareUrl) {
                      navigator.clipboard.writeText(shareUrl);
                      alert('Link copied to clipboard!');
                    }
                  }}
                >
                  Copy Link
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {error && <div className="error">{error}</div>}

      <div style={{ marginTop: 40, paddingTop: 20, borderTop: '1px solid #333', textAlign: 'center', fontSize: 12, color: '#666' }}>
        <a href="https://github.com/superness/poe2templesolver" target="_blank" rel="noopener noreferrer" style={{ color: '#666' }}>
          Source
        </a>
      </div>
    </div>
  );
}

interface TempleGridProps {
  state: TempleState;
  edges?: Edge[];
  roomValues?: RoomValues;
  chainNames?: string[];
}

function TempleGrid({ state, edges, roomValues, chainNames }: TempleGridProps) {
  const roomMap = new Map<string, Room & { chain?: number }>();
  const pathMap = new Map<string, { chain?: number }>();

  for (const room of state.rooms) {
    roomMap.set(`${room.position.x},${room.position.y}`, room as Room & { chain?: number });
  }
  for (const path of state.paths) {
    pathMap.set(`${path.x},${path.y}`, path as { chain?: number });
  }
  const pathSet = new Set(pathMap.keys());

  // Build edge set for visualization
  const edgeSet = new Set<string>();
  if (edges) {
    for (const edge of edges) {
      const k1 = `${edge.from.x},${edge.from.y}`;
      const k2 = `${edge.to.x},${edge.to.y}`;
      edgeSet.add(`${k1}-${k2}`);
      edgeSet.add(`${k2}-${k1}`);
    }
  }

  const hasEdge = (x1: number, y1: number, x2: number, y2: number) => {
    return edgeSet.has(`${x1},${y1}-${x2},${y2}`);
  };

  // Get room value for display
  const getRoomValue = (room: Room): number => {
    if (!roomValues) return 0;
    const values = roomValues[room.type];
    if (!values) return 0;
    return values[room.tier - 1] || 0;
  };

  const cells: React.ReactElement[] = [];

  for (let y = GRID_SIZE; y >= 1; y--) {
    for (let x = 1; x <= GRID_SIZE; x++) {
      const key = `${x},${y}`;
      let content = '';
      let className = 'cell';
      let value: number | null = null;

      if (x === FOYER_POS.x && y === FOYER_POS.y) {
        content = 'FOY';
        className += ' foyer';
      } else if (x === state.architect.x && y === state.architect.y) {
        content = 'ARC';
        className += ' architect';
      } else if (roomMap.has(key)) {
        const room = roomMap.get(key)!;
        const abbrev = ROOM_ABBREV[room.type] || room.type.slice(0, 2);
        content = `${abbrev}${room.tier}`;
        className += ` room tier-${room.tier}`;
        value = getRoomValue(room);

        if (room.type === 'SPYMASTER') className += ' spymaster';
        if (room.type === 'CORRUPTION_CHAMBER') className += ' corruption';
        if (room.chain !== undefined && chainNames) {
          if (room.chain < chainNames.length) {
            className += ` chain-${room.chain}`;
          } else {
            className += ' ungrouped';  // Cells not in any defined chain
          }
        }
      } else if (pathSet.has(key)) {
        const pathData = pathMap.get(key);
        content = 'P';
        className += ' path';
        value = roomValues?.PATH?.[0] || 1;
        if (pathData?.chain !== undefined && chainNames) {
          if (pathData.chain < chainNames.length) {
            className += ` chain-${pathData.chain}`;
          } else {
            className += ' ungrouped';  // Cells not in any defined chain
          }
        }
      } else {
        content = '';
        className += ' empty';
      }

      // Build connection line elements
      const connLines: React.ReactElement[] = [];
      if (edges && edges.length > 0) {
        if (hasEdge(x, y, x, y + 1)) connLines.push(<span key="up" className="conn-line up" />);
        if (hasEdge(x, y, x, y - 1)) connLines.push(<span key="down" className="conn-line down" />);
        if (hasEdge(x, y, x - 1, y)) connLines.push(<span key="left" className="conn-line left" />);
        if (hasEdge(x, y, x + 1, y)) connLines.push(<span key="right" className="conn-line right" />);
      }

      cells.push(
        <div key={key} className={className} title={`(${x}, ${y})${value !== null ? ` - Value: ${value}` : ''}`}>
          {connLines}
          <span className="cell-content">{content}</span>
          {value !== null && value > 0 && <span className="cell-value">{value}</span>}
        </div>
      );
    }
  }

  // Build chain stats with depth-ordered rooms
  // First, compute distances from foyer using BFS on edges
  const distances = new Map<string, number>();
  if (edges && edges.length > 0) {
    // Build adjacency graph
    const graph = new Map<string, string[]>();
    for (const edge of edges) {
      const k1 = `${edge.from.x},${edge.from.y}`;
      const k2 = `${edge.to.x},${edge.to.y}`;
      if (!graph.has(k1)) graph.set(k1, []);
      if (!graph.has(k2)) graph.set(k2, []);
      graph.get(k1)!.push(k2);
      graph.get(k2)!.push(k1);
    }
    // BFS from foyer
    const foyerKey = `${FOYER_POS.x},${FOYER_POS.y}`;
    distances.set(foyerKey, 0);
    const queue = [foyerKey];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentDist = distances.get(current)!;
      for (const neighbor of graph.get(current) || []) {
        if (!distances.has(neighbor)) {
          distances.set(neighbor, currentDist + 1);
          queue.push(neighbor);
        }
      }
    }
  }

  const chainStats: { name: string; rooms: string[]; count: number; isUngrouped?: boolean }[] = [];
  if (chainNames && chainNames.length > 0) {
    for (let i = 0; i < chainNames.length; i++) {
      // Collect rooms with their positions and distances
      const roomsWithDist: { abbrev: string; dist: number }[] = [];
      for (const room of state.rooms) {
        const r = room as Room & { chain?: number };
        if (r.chain === i) {
          const key = `${r.position.x},${r.position.y}`;
          const dist = distances.get(key) ?? 999;
          roomsWithDist.push({
            abbrev: ROOM_ABBREV[r.type] || r.type.slice(0, 2),
            dist,
          });
        }
      }
      // Sort by distance (depth ascending = closest to foyer first)
      roomsWithDist.sort((a, b) => a.dist - b.dist);
      chainStats.push({
        name: chainNames[i],
        rooms: roomsWithDist.map(r => r.abbrev),
        count: roomsWithDist.length,
      });
    }
    // Add ungrouped rooms (chain >= chainNames.length)
    const ungroupedWithDist: { abbrev: string; dist: number }[] = [];
    for (const room of state.rooms) {
      const r = room as Room & { chain?: number };
      if (r.chain === undefined || r.chain >= chainNames.length) {
        const key = `${r.position.x},${r.position.y}`;
        const dist = distances.get(key) ?? 999;
        ungroupedWithDist.push({
          abbrev: ROOM_ABBREV[r.type] || r.type.slice(0, 2),
          dist,
        });
      }
    }
    if (ungroupedWithDist.length > 0) {
      ungroupedWithDist.sort((a, b) => a.dist - b.dist);
      chainStats.push({
        name: 'Ungrouped',
        rooms: ungroupedWithDist.map(r => r.abbrev),
        count: ungroupedWithDist.length,
        isUngrouped: true,
      });
    }
  }

  return (
    <div>
      <div className="temple-grid">{cells}</div>
      {chainStats.length > 0 && (
        <div className="chain-stats">
          {chainStats.map((cs, idx) => (
            <div key={idx} className={`chain-stat ${cs.isUngrouped ? 'ungrouped' : `chain-${idx}`}`}>
              <span className="chain-name">{cs.name}:</span>
              <span className="chain-count">{cs.count} rooms</span>
              <span className="chain-rooms">[{cs.rooms.join(', ')}]</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default App;
