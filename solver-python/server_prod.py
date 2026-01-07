#!/usr/bin/env python3
"""
Production Flask API server for Temple Solver.
Includes rate limiting, concurrency control, and queue management.

Run with: gunicorn -c gunicorn.conf.py server_prod:app
"""

import os
import threading
import time
import uuid
from collections import OrderedDict
from functools import wraps
from flask import Flask, request, jsonify, g
from flask_cors import CORS
from temple_solver import SolverInput, solve_temple

# =============================================================================
# Configuration
# =============================================================================

MAX_CONCURRENT_SOLVES = int(os.environ.get('MAX_CONCURRENT_SOLVES', 1))
MAX_QUEUE_SIZE = int(os.environ.get('MAX_QUEUE_SIZE', 10))
RATE_LIMIT_SECONDS = int(os.environ.get('RATE_LIMIT_SECONDS', 30))
MAX_SOLVE_TIME = int(os.environ.get('MAX_SOLVE_TIME', 60))
MAX_HISTORY = 50  # Keep last N completed solves

# Server stats
SERVER_START_TIME = time.time()
total_solves = 0
completed_solves = []  # List of {job_id, completed_at, duration, score, success}

# =============================================================================
# App Setup
# =============================================================================

app = Flask(__name__)

# CORS - configure for production
# Default allows GitHub Pages + localhost for dev
default_origins = 'https://superness.github.io,http://localhost:5173,http://localhost:3000'
allowed_origins = os.environ.get('ALLOWED_ORIGINS', default_origins)
if allowed_origins != '*':
    allowed_origins = [o.strip() for o in allowed_origins.split(',')]
CORS(app, origins=allowed_origins)

# =============================================================================
# Rate Limiting & Queue Management
# =============================================================================

# Thread-safe state
state_lock = threading.Lock()

# Track active solves
active_solves = {}  # job_id -> {started_at, config, best_solution}

# Rate limiting by IP
ip_last_solve = OrderedDict()  # IP -> timestamp (LRU cache)
MAX_IP_CACHE = 10000

# Semaphore for concurrent solve limiting
solve_semaphore = threading.Semaphore(MAX_CONCURRENT_SOLVES)

# Queue for waiting requests
solve_queue = []  # List of job_ids waiting


def get_client_ip():
    """Get client IP, respecting X-Forwarded-For from nginx."""
    if request.headers.get('X-Forwarded-For'):
        return request.headers.get('X-Forwarded-For').split(',')[0].strip()
    return request.remote_addr


def check_rate_limit():
    """Check if client IP is rate limited. Returns (allowed, wait_seconds)."""
    ip = get_client_ip()
    now = time.time()

    with state_lock:
        if ip in ip_last_solve:
            elapsed = now - ip_last_solve[ip]
            if elapsed < RATE_LIMIT_SECONDS:
                return False, RATE_LIMIT_SECONDS - elapsed
        return True, 0


def record_solve_start():
    """Record that this IP started a solve."""
    ip = get_client_ip()
    now = time.time()

    with state_lock:
        ip_last_solve[ip] = now
        # Move to end (LRU)
        ip_last_solve.move_to_end(ip)
        # Prune old entries
        while len(ip_last_solve) > MAX_IP_CACHE:
            ip_last_solve.popitem(last=False)


def get_queue_position():
    """Get current queue length."""
    with state_lock:
        return len(active_solves), MAX_CONCURRENT_SOLVES


# =============================================================================
# Routes
# =============================================================================

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint."""
    active, max_active = get_queue_position()
    return jsonify({
        "status": "ok",
        "active_solves": active,
        "max_concurrent": max_active,
    })


@app.route('/status', methods=['GET'])
def status():
    """Get server status and queue info."""
    with state_lock:
        return jsonify({
            "active_solves": len(active_solves),
            "max_concurrent": MAX_CONCURRENT_SOLVES,
            "rate_limit_seconds": RATE_LIMIT_SECONDS,
            "max_solve_time": MAX_SOLVE_TIME,
        })


@app.route('/admin', methods=['GET'])
def admin():
    """Admin endpoint - detailed server stats and active solves."""
    now = time.time()
    with state_lock:
        # Build active solves list with details
        active_list = []
        for job_id, job in active_solves.items():
            elapsed = now - job["started_at"]
            best = job.get("best_solution")
            active_list.append({
                "job_id": job_id,
                "started_at": job["started_at"],
                "elapsed_seconds": round(elapsed, 1),
                "config": job.get("config", {}),
                "best_score": best.get("score") if best else None,
                "ip": job.get("ip", "unknown"),
            })

        return jsonify({
            "server": {
                "uptime_seconds": round(now - SERVER_START_TIME, 1),
                "total_solves": total_solves,
                "max_concurrent": MAX_CONCURRENT_SOLVES,
                "rate_limit_seconds": RATE_LIMIT_SECONDS,
            },
            "active_solves": active_list,
            "recent_completed": list(reversed(completed_solves[-20:])),  # Last 20
        })


@app.route('/best/<job_id>', methods=['GET'])
def best(job_id):
    """Get the current best solution for a specific job."""
    with state_lock:
        if job_id in active_solves:
            job = active_solves[job_id]
            elapsed = time.time() - job["started_at"]
            return jsonify({
                "status": "solving",
                "elapsed_seconds": round(elapsed, 1),
                "solution": job.get("best_solution"),
            })
        return jsonify({"status": "not_found", "solution": None}), 404


@app.route('/solve', methods=['POST'])
def solve():
    """
    Solve temple layout with rate limiting and queue management.
    """
    # Check rate limit
    allowed, wait_time = check_rate_limit()
    if not allowed:
        return jsonify({
            "success": False,
            "error": f"Rate limited. Please wait {int(wait_time)} seconds.",
            "retry_after": int(wait_time),
        }), 429

    # Check queue capacity
    active, max_active = get_queue_position()
    if active >= max_active + MAX_QUEUE_SIZE:
        return jsonify({
            "success": False,
            "error": "Server busy. Please try again later.",
            "queue_full": True,
        }), 503

    try:
        data = request.get_json()

        if not data:
            return jsonify({"success": False, "error": "No JSON body provided"}), 400

        if 'architect' not in data:
            return jsonify({"success": False, "error": "Missing required field: architect"}), 400

        architect = tuple(data['architect'])

        # Parse inputs
        room_values = data.get('room_values', None)
        chains = data.get('chains', None)

        # Cap solve time for production
        max_time = min(data.get('max_time_seconds', 30), MAX_SOLVE_TIME)

        solver_input = SolverInput(
            architect_pos=architect,
            min_spymasters=data.get('min_spymasters', 8),
            min_corruption_chambers=data.get('min_corruption_chambers', 6),
            max_paths=data.get('max_paths', 0),
            snake_mode=data.get('snake_mode', True),
            max_endpoints=data.get('max_endpoints', 2),
            max_time_seconds=max_time,
            existing_rooms=data.get('existing_rooms', []),
            existing_paths=[tuple(p) if isinstance(p, list) else (p['x'], p['y']) for p in data.get('existing_paths', [])],
            lock_existing=data.get('lock_existing', True),
            junction_penalty=data.get('junction_penalty', 10),
            max_neighbors=data.get('max_neighbors', 4),
            room_values=room_values,
            chains=chains,
            empty_penalty=data.get('empty_penalty', 0),
        )

        # Generate job ID
        job_id = str(uuid.uuid4())[:8]

        # Record rate limit
        record_solve_start()

        app.logger.info(f"[{job_id}] Starting solve: architect={architect}, time_limit={max_time}s")

        # Register job
        job_start_time = time.time()
        client_ip = get_client_ip()
        with state_lock:
            active_solves[job_id] = {
                "started_at": job_start_time,
                "config": {"architect": architect, "max_time": max_time},
                "best_solution": None,
                "ip": client_ip,
            }

        # Callback to store intermediate solutions
        def on_new_solution(solution):
            with state_lock:
                if job_id in active_solves:
                    active_solves[job_id]["best_solution"] = solution
                    app.logger.info(f"[{job_id}] New best: score={solution['score']}")

        # Acquire semaphore (blocks if at capacity)
        solve_semaphore.acquire()
        try:
            result = solve_temple(solver_input, on_solution=on_new_solution)
        finally:
            solve_semaphore.release()
            # Clean up job and record completion
            global total_solves
            with state_lock:
                job_info = active_solves.pop(job_id, None)
                total_solves += 1
                # Record completion
                completed_solves.append({
                    "job_id": job_id,
                    "completed_at": time.time(),
                    "duration": round(time.time() - job_start_time, 1),
                    "score": result.score if result else None,
                    "success": result.success if result else False,
                    "ip": client_ip,
                })
                # Trim history
                while len(completed_solves) > MAX_HISTORY:
                    completed_solves.pop(0)

        # Build response
        paths_out = []
        for p in result.paths:
            if isinstance(p, dict):
                paths_out.append(p)
            else:
                paths_out.append({"x": p[0], "y": p[1]})

        output = {
            "success": result.success,
            "optimal": result.optimal,
            "score": result.score,
            "rooms": result.rooms,
            "paths": paths_out,
            "edges": result.edges or [],
            "stats": result.stats,
            "job_id": job_id,
        }

        if result.error:
            output["error"] = result.error
        if result.excluded_rooms:
            output["excluded_rooms"] = result.excluded_rooms
        if result.chain_names:
            output["chain_names"] = result.chain_names

        app.logger.info(f"[{job_id}] Complete: success={result.success}, score={result.score}")

        return jsonify(output)

    except Exception as e:
        app.logger.error(f"Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500


# =============================================================================
# Main
# =============================================================================

if __name__ == '__main__':
    print("=" * 60)
    print("POE2 Temple Solver - Production Server")
    print("=" * 60)
    print(f"Max concurrent solves: {MAX_CONCURRENT_SOLVES}")
    print(f"Rate limit: {RATE_LIMIT_SECONDS}s between solves per IP")
    print(f"Max solve time: {MAX_SOLVE_TIME}s")
    print()
    print("Endpoints:")
    print("  GET  /health      - Health check")
    print("  GET  /status      - Server status")
    print("  GET  /best/<id>   - Get solution progress")
    print("  POST /solve       - Solve temple layout")
    print()
    print("For production, run with:")
    print("  gunicorn -c ../deploy/gunicorn.conf.py server_prod:app")
    print("=" * 60)

    # Development mode
    app.run(host='0.0.0.0', port=5000, debug=True)
