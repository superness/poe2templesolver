import { useState, useEffect } from 'react';

const API_URL = import.meta.env.DEV ? 'http://localhost:5000' : '/api';

interface ActiveSolve {
  job_id: string;
  elapsed_seconds: number;
  config: { architect?: number[]; max_time?: number };
  best_score: number | null;
  ip: string;
}

interface CompletedSolve {
  job_id: string;
  completed_at: number;
  duration: number;
  score: number | null;
  success: boolean;
  ip: string;
}

interface AdminData {
  server: {
    uptime_seconds: number;
    total_solves: number;
    max_concurrent: number;
    rate_limit_seconds: number;
  };
  active_solves: ActiveSolve[];
  recent_completed: CompletedSolve[];
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs}s`;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleTimeString();
}

export default function AdminPage() {
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const resp = await fetch(`${API_URL}/admin`);
        if (resp.ok) {
          setData(await resp.json());
          setError(null);
        } else {
          setError('Failed to fetch admin data');
        }
      } catch (e) {
        setError('Server not reachable');
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 2000); // Poll every 2s
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ padding: 20, fontFamily: 'monospace', background: '#1a1a1a', minHeight: '100vh', color: '#ccc' }}>
      <h1 style={{ color: '#c9a860' }}>Temple Solver Admin</h1>
      <a href="/" style={{ color: '#88f' }}>&larr; Back to Solver</a>

      {error && <div style={{ color: '#f88', marginTop: 20 }}>{error}</div>}

      {data && (
        <>
          {/* Server Stats */}
          <div style={{ marginTop: 20, padding: 15, background: '#252525', borderRadius: 8 }}>
            <h2 style={{ color: '#8f8', marginTop: 0 }}>Server Stats</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 15 }}>
              <div>
                <div style={{ color: '#888', fontSize: 12 }}>Uptime</div>
                <div style={{ fontSize: 20 }}>{formatDuration(data.server.uptime_seconds)}</div>
              </div>
              <div>
                <div style={{ color: '#888', fontSize: 12 }}>Total Solves</div>
                <div style={{ fontSize: 20 }}>{data.server.total_solves}</div>
              </div>
              <div>
                <div style={{ color: '#888', fontSize: 12 }}>Max Concurrent</div>
                <div style={{ fontSize: 20 }}>{data.server.max_concurrent}</div>
              </div>
              <div>
                <div style={{ color: '#888', fontSize: 12 }}>Rate Limit</div>
                <div style={{ fontSize: 20 }}>{data.server.rate_limit_seconds}s</div>
              </div>
            </div>
          </div>

          {/* Active Solves */}
          <div style={{ marginTop: 20, padding: 15, background: '#252525', borderRadius: 8 }}>
            <h2 style={{ color: '#ff8', marginTop: 0 }}>
              Active Solves ({data.active_solves.length})
            </h2>
            {data.active_solves.length === 0 ? (
              <div style={{ color: '#666' }}>No active solves</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #444' }}>
                    <th style={{ textAlign: 'left', padding: 8 }}>Job ID</th>
                    <th style={{ textAlign: 'left', padding: 8 }}>IP</th>
                    <th style={{ textAlign: 'right', padding: 8 }}>Elapsed</th>
                    <th style={{ textAlign: 'right', padding: 8 }}>Best Score</th>
                    <th style={{ textAlign: 'left', padding: 8 }}>Progress</th>
                  </tr>
                </thead>
                <tbody>
                  {data.active_solves.map((solve) => (
                    <tr key={solve.job_id} style={{ borderBottom: '1px solid #333' }}>
                      <td style={{ padding: 8, color: '#8cf' }}>{solve.job_id}</td>
                      <td style={{ padding: 8, color: '#888' }}>{solve.ip}</td>
                      <td style={{ padding: 8, textAlign: 'right' }}>{formatDuration(solve.elapsed_seconds)}</td>
                      <td style={{ padding: 8, textAlign: 'right', color: solve.best_score ? '#8f8' : '#666' }}>
                        {solve.best_score ?? '—'}
                      </td>
                      <td style={{ padding: 8 }}>
                        <div style={{
                          width: 100,
                          height: 8,
                          background: '#333',
                          borderRadius: 4,
                          overflow: 'hidden'
                        }}>
                          <div style={{
                            width: `${Math.min(100, (solve.elapsed_seconds / (solve.config.max_time || 60)) * 100)}%`,
                            height: '100%',
                            background: '#c9a860',
                            transition: 'width 0.5s'
                          }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Recent Completed */}
          <div style={{ marginTop: 20, padding: 15, background: '#252525', borderRadius: 8 }}>
            <h2 style={{ color: '#88f', marginTop: 0 }}>Recent Completed</h2>
            {data.recent_completed.length === 0 ? (
              <div style={{ color: '#666' }}>No completed solves yet</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #444' }}>
                    <th style={{ textAlign: 'left', padding: 8 }}>Job ID</th>
                    <th style={{ textAlign: 'left', padding: 8 }}>IP</th>
                    <th style={{ textAlign: 'left', padding: 8 }}>Time</th>
                    <th style={{ textAlign: 'right', padding: 8 }}>Duration</th>
                    <th style={{ textAlign: 'right', padding: 8 }}>Score</th>
                    <th style={{ textAlign: 'center', padding: 8 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent_completed.map((solve) => (
                    <tr key={solve.job_id} style={{ borderBottom: '1px solid #333' }}>
                      <td style={{ padding: 8, color: '#8cf' }}>{solve.job_id}</td>
                      <td style={{ padding: 8, color: '#888' }}>{solve.ip}</td>
                      <td style={{ padding: 8, color: '#888' }}>{formatTime(solve.completed_at)}</td>
                      <td style={{ padding: 8, textAlign: 'right' }}>{formatDuration(solve.duration)}</td>
                      <td style={{ padding: 8, textAlign: 'right', color: '#8f8' }}>{solve.score ?? '—'}</td>
                      <td style={{ padding: 8, textAlign: 'center' }}>
                        {solve.success ? (
                          <span style={{ color: '#8f8' }}>✓</span>
                        ) : (
                          <span style={{ color: '#f88' }}>✗</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
