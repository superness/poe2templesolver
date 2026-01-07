#!/usr/bin/env python3
"""
Production Flask API server for Temple Solver.
Async job queue with rate limiting and concurrency control.

Run with: gunicorn -c gunicorn.conf.py server_prod:app
"""

import os
import threading
import time
import uuid
import queue
import multiprocessing
from collections import OrderedDict
from flask import Flask, request, jsonify
from flask_cors import CORS
from temple_solver import SolverInput, solve_temple

# =============================================================================
# Configuration
# =============================================================================

MAX_CONCURRENT_SOLVES = int(os.environ.get('MAX_CONCURRENT_SOLVES', 1))
MAX_QUEUE_SIZE = int(os.environ.get('MAX_QUEUE_SIZE', 10))
RATE_LIMIT_SECONDS = int(os.environ.get('RATE_LIMIT_SECONDS', 30))
MAX_SOLVE_TIME = int(os.environ.get('MAX_SOLVE_TIME', 3600))
RESULT_TTL_SECONDS = 300  # Keep completed results for 5 minutes
MAX_HISTORY = 50  # Keep last N completed solves for admin
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'temple-admin')

# Server stats
SERVER_START_TIME = time.time()
total_solves = 0
completed_solves_history = []  # For admin view

# =============================================================================
# App Setup
# =============================================================================

app = Flask(__name__)

# CORS
default_origins = 'https://superness.github.io,http://localhost:5173,http://localhost:5174,http://localhost:3000'
allowed_origins = os.environ.get('ALLOWED_ORIGINS', default_origins)
if allowed_origins != '*':
    allowed_origins = [o.strip() for o in allowed_origins.split(',')]
CORS(app, origins=allowed_origins)

# =============================================================================
# Job Queue System
# =============================================================================

# Thread-safe state
state_lock = threading.Lock()

# Job states: "queued" -> "solving" -> "complete" | "error"
# jobs dict: job_id -> {
#   status: "queued" | "solving" | "complete" | "error",
#   queued_at: timestamp,
#   started_at: timestamp (when solving started),
#   completed_at: timestamp,
#   config: {...},
#   solver_input: SolverInput,
#   best_solution: {...} or None,
#   result: {...} or None (final result),
#   error: str or None,
#   ip: str,
# }
jobs = {}

# Queue of job_ids to process (FIFO)
job_queue = queue.Queue()

# Rate limiting by IP
ip_last_solve = OrderedDict()
MAX_IP_CACHE = 10000

# Worker threads
workers = []
workers_started = False


def get_client_ip():
    """Get client IP, respecting X-Forwarded-For from nginx."""
    if request.headers.get('X-Forwarded-For'):
        return request.headers.get('X-Forwarded-For').split(',')[0].strip()
    return request.remote_addr


def check_rate_limit(ip):
    """Check if IP is rate limited. Returns (allowed, wait_seconds)."""
    now = time.time()
    with state_lock:
        if ip in ip_last_solve:
            elapsed = now - ip_last_solve[ip]
            if elapsed < RATE_LIMIT_SECONDS:
                return False, RATE_LIMIT_SECONDS - elapsed
        return True, 0


def record_rate_limit(ip):
    """Record that this IP submitted a job."""
    now = time.time()
    with state_lock:
        ip_last_solve[ip] = now
        ip_last_solve.move_to_end(ip)
        while len(ip_last_solve) > MAX_IP_CACHE:
            ip_last_solve.popitem(last=False)


def get_queue_position(job_id):
    """Get position in queue (1-indexed). Returns 0 if not queued."""
    with state_lock:
        queued_jobs = [jid for jid, j in jobs.items() if j["status"] == "queued"]
        if job_id in queued_jobs:
            return queued_jobs.index(job_id) + 1
        return 0


def get_queue_length():
    """Get number of jobs in queue."""
    with state_lock:
        return sum(1 for j in jobs.values() if j["status"] == "queued")


def get_active_count():
    """Get number of currently solving jobs."""
    with state_lock:
        return sum(1 for j in jobs.values() if j["status"] == "solving")


def cleanup_old_jobs():
    """Remove completed/errored jobs older than TTL."""
    now = time.time()
    with state_lock:
        to_remove = []
        for job_id, job in jobs.items():
            if job["status"] in ("complete", "error", "aborted"):
                completed_at = job.get("completed_at", 0)
                if now - completed_at > RESULT_TTL_SECONDS:
                    to_remove.append(job_id)
        for job_id in to_remove:
            del jobs[job_id]


def solver_subprocess(solver_input, result_queue, solution_queue):
    """
    Run solver in a separate process.
    Sends intermediate solutions via solution_queue.
    Sends final result via result_queue.
    """
    def on_solution(solution):
        try:
            solution_queue.put_nowait(solution)
        except:
            pass  # Queue full, skip this update

    try:
        result = solve_temple(solver_input, on_solution=on_solution)

        # Build output dict
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
        }

        if result.error:
            output["error"] = result.error
        if result.excluded_rooms:
            output["excluded_rooms"] = result.excluded_rooms
        if result.chain_names:
            output["chain_names"] = result.chain_names

        result_queue.put({"status": "complete", "result": output})

    except Exception as e:
        import traceback
        result_queue.put({"status": "error", "error": str(e), "traceback": traceback.format_exc()})


def worker_thread():
    """Background worker that processes jobs from queue using subprocesses."""
    global total_solves

    while True:
        try:
            # Get next job (blocks until available)
            job_id = job_queue.get()

            if job_id is None:  # Shutdown signal
                break

            with state_lock:
                if job_id not in jobs:
                    continue
                job = jobs[job_id]
                if job["status"] != "queued":
                    continue  # Job was cancelled or already processed

                # Mark as solving
                job["status"] = "solving"
                job["started_at"] = time.time()
                solver_input = job["solver_input"]

            app.logger.info(f"[{job_id}] Starting solve (subprocess)")

            # Create queues for communication with subprocess
            result_queue = multiprocessing.Queue()
            solution_queue = multiprocessing.Queue(maxsize=10)

            # Start solver subprocess
            proc = multiprocessing.Process(
                target=solver_subprocess,
                args=(solver_input, result_queue, solution_queue)
            )
            proc.start()

            # Store process reference for abort
            with state_lock:
                if job_id in jobs:
                    jobs[job_id]["process"] = proc

            # Poll for updates until process completes or is aborted
            output = None
            aborted = False

            while proc.is_alive():
                # Check for abort
                with state_lock:
                    if job_id in jobs and jobs[job_id]["status"] == "aborted":
                        app.logger.info(f"[{job_id}] Aborting subprocess")
                        proc.terminate()
                        proc.join(timeout=2)
                        if proc.is_alive():
                            proc.kill()
                            proc.join(timeout=1)
                        aborted = True
                        break

                # Check for intermediate solutions
                try:
                    while True:
                        solution = solution_queue.get_nowait()
                        with state_lock:
                            if job_id in jobs and jobs[job_id]["status"] == "solving":
                                jobs[job_id]["best_solution"] = solution
                                app.logger.info(f"[{job_id}] New best: score={solution['score']}")
                except:
                    pass  # Queue empty

                time.sleep(0.1)  # Small sleep to avoid busy-waiting

            # Process completed or was killed
            proc.join(timeout=1)

            # Get final result if not aborted
            if not aborted:
                try:
                    final = result_queue.get_nowait()
                    if final["status"] == "complete":
                        output = final["result"]
                        output["job_id"] = job_id
                    else:
                        # Error in subprocess
                        with state_lock:
                            if job_id in jobs:
                                jobs[job_id]["status"] = "error"
                                jobs[job_id]["completed_at"] = time.time()
                                jobs[job_id]["error"] = final.get("error", "Unknown error")
                        app.logger.error(f"[{job_id}] Subprocess error: {final.get('error')}")
                        cleanup_old_jobs()
                        continue
                except:
                    # No result - process was killed or crashed
                    with state_lock:
                        if job_id in jobs and jobs[job_id]["status"] == "solving":
                            jobs[job_id]["status"] = "error"
                            jobs[job_id]["completed_at"] = time.time()
                            jobs[job_id]["error"] = "Solver process crashed"
                    cleanup_old_jobs()
                    continue

            # Update job status
            with state_lock:
                if job_id in jobs:
                    if aborted:
                        # Keep aborted status, store best solution if we have one
                        if jobs[job_id].get("best_solution"):
                            jobs[job_id]["result"] = jobs[job_id]["best_solution"]
                        app.logger.info(f"[{job_id}] Aborted by user")
                    else:
                        jobs[job_id]["status"] = "complete"
                        jobs[job_id]["completed_at"] = time.time()
                        jobs[job_id]["result"] = output
                        total_solves += 1

                        # Record for admin history
                        completed_solves_history.append({
                            "job_id": job_id,
                            "completed_at": time.time(),
                            "duration": round(time.time() - job["started_at"], 1),
                            "score": output.get("score", 0),
                            "success": output.get("success", False),
                            "ip": job.get("ip", "unknown"),
                        })
                        while len(completed_solves_history) > MAX_HISTORY:
                            completed_solves_history.pop(0)

                        app.logger.info(f"[{job_id}] Complete: success={output.get('success')}, score={output.get('score')}")

                    # Clean up process reference
                    jobs[job_id].pop("process", None)

            # Cleanup old jobs periodically
            cleanup_old_jobs()

        except Exception as e:
            app.logger.error(f"Worker error: {e}")
            import traceback
            traceback.print_exc()


def start_workers():
    """Start worker threads."""
    global workers_started
    if workers_started:
        return

    for i in range(MAX_CONCURRENT_SOLVES):
        t = threading.Thread(target=worker_thread, daemon=True, name=f"solver-worker-{i}")
        t.start()
        workers.append(t)

    workers_started = True
    app.logger.info(f"Started {MAX_CONCURRENT_SOLVES} worker threads")


# Start workers when module loads
start_workers()


# =============================================================================
# Routes
# =============================================================================

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint."""
    return jsonify({
        "status": "ok",
        "active_solves": get_active_count(),
        "queued": get_queue_length(),
        "max_concurrent": MAX_CONCURRENT_SOLVES,
    })


@app.route('/status', methods=['GET'])
def status():
    """Get server status and queue info."""
    return jsonify({
        "active_solves": get_active_count(),
        "queued": get_queue_length(),
        "max_concurrent": MAX_CONCURRENT_SOLVES,
        "rate_limit_seconds": RATE_LIMIT_SECONDS,
        "max_solve_time": MAX_SOLVE_TIME,
    })


@app.route('/admin', methods=['GET'])
def admin():
    """Admin endpoint - detailed server stats and active solves."""
    auth_key = request.args.get('key') or request.headers.get('X-Admin-Key')
    if auth_key != ADMIN_PASSWORD:
        return jsonify({"error": "Unauthorized"}), 401

    now = time.time()
    with state_lock:
        # Build lists by status
        queued_list = []
        active_list = []

        for job_id, job in jobs.items():
            if job["status"] == "queued":
                queued_list.append({
                    "job_id": job_id,
                    "queued_at": job["queued_at"],
                    "waiting_seconds": round(now - job["queued_at"], 1),
                    "config": job.get("config", {}),
                    "ip": job.get("ip", "unknown"),
                })
            elif job["status"] == "solving":
                best = job.get("best_solution")
                active_list.append({
                    "job_id": job_id,
                    "started_at": job["started_at"],
                    "elapsed_seconds": round(now - job["started_at"], 1),
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
            "queued": queued_list,
            "active_solves": active_list,
            "recent_completed": list(reversed(completed_solves_history[-20:])),
        })


@app.route('/job/<job_id>', methods=['GET'])
def get_job(job_id):
    """Get job status and result."""
    with state_lock:
        if job_id not in jobs:
            return jsonify({"status": "not_found"}), 404

        job = jobs[job_id]
        now = time.time()

        response = {
            "status": job["status"],
            "job_id": job_id,
        }

        if job["status"] == "queued":
            response["queue_position"] = get_queue_position(job_id)
            response["waiting_seconds"] = round(now - job["queued_at"], 1)

        elif job["status"] == "solving":
            response["elapsed_seconds"] = round(now - job["started_at"], 1)
            response["max_time"] = job["config"].get("max_time", MAX_SOLVE_TIME)
            if job.get("best_solution"):
                response["best_solution"] = job["best_solution"]

        elif job["status"] == "complete":
            response["result"] = job["result"]
            response["duration"] = round(job["completed_at"] - job["started_at"], 1)

        elif job["status"] == "error":
            response["error"] = job.get("error", "Unknown error")

        return jsonify(response)


# Keep /best for backwards compatibility
@app.route('/best/<job_id>', methods=['GET'])
def best(job_id):
    """Get job status (alias for /job)."""
    return get_job(job_id)


@app.route('/abort/<job_id>', methods=['POST'])
def abort_job(job_id):
    """Abort a running or queued job by killing the subprocess."""
    with state_lock:
        if job_id not in jobs:
            return jsonify({"success": False, "error": "Job not found"}), 404

        job = jobs[job_id]
        if job["status"] in ("complete", "error", "aborted"):
            return jsonify({"success": False, "error": f"Job already {job['status']}"}), 400

        # Mark as aborted - the worker will pick this up
        job["status"] = "aborted"
        job["completed_at"] = time.time()

        # Kill the subprocess immediately if it exists
        proc = job.get("process")
        if proc and proc.is_alive():
            app.logger.info(f"[{job_id}] Killing subprocess")
            proc.terminate()

        app.logger.info(f"[{job_id}] Aborted by user")

        return jsonify({"success": True, "message": "Job aborted"})


@app.route('/solve', methods=['POST'])
def solve():
    """
    Submit a solve job. Returns immediately with job_id.
    Poll /job/<job_id> for status and results.
    """
    client_ip = get_client_ip()

    # Check rate limit
    allowed, wait_time = check_rate_limit(client_ip)
    if not allowed:
        return jsonify({
            "success": False,
            "error": f"Rate limited. Please wait {int(wait_time)} seconds.",
            "retry_after": int(wait_time),
        }), 429

    # Check queue capacity
    queue_len = get_queue_length()
    if queue_len >= MAX_QUEUE_SIZE:
        return jsonify({
            "success": False,
            "error": f"Queue full ({queue_len} jobs waiting). Please try again later.",
            "queue_full": True,
        }), 503

    try:
        data = request.get_json()

        if not data:
            return jsonify({"success": False, "error": "No JSON body provided"}), 400

        if 'architect' not in data:
            return jsonify({"success": False, "error": "Missing required field: architect"}), 400

        architect = tuple(data['architect'])
        room_values = data.get('room_values', None)
        chains = data.get('chains', None)
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
        record_rate_limit(client_ip)

        # Create job
        with state_lock:
            jobs[job_id] = {
                "status": "queued",
                "queued_at": time.time(),
                "started_at": None,
                "completed_at": None,
                "config": {"architect": architect, "max_time": max_time},
                "solver_input": solver_input,
                "best_solution": None,
                "result": None,
                "error": None,
                "ip": client_ip,
            }

        # Add to queue
        job_queue.put(job_id)

        queue_pos = get_queue_position(job_id)
        app.logger.info(f"[{job_id}] Queued: architect={architect}, position={queue_pos}")

        return jsonify({
            "success": True,
            "job_id": job_id,
            "status": "queued",
            "queue_position": queue_pos,
            "message": f"Job queued. Poll /job/{job_id} for status.",
        })

    except Exception as e:
        app.logger.error(f"Error creating job: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500


# =============================================================================
# Main
# =============================================================================

if __name__ == '__main__':
    print("=" * 60)
    print("POE2 Temple Solver - Production Server (Async)")
    print("=" * 60)
    print(f"Max concurrent solves: {MAX_CONCURRENT_SOLVES}")
    print(f"Max queue size: {MAX_QUEUE_SIZE}")
    print(f"Rate limit: {RATE_LIMIT_SECONDS}s between solves per IP")
    print(f"Max solve time: {MAX_SOLVE_TIME}s")
    print()
    print("Endpoints:")
    print("  GET  /health      - Health check")
    print("  GET  /status      - Server status")
    print("  POST /solve       - Submit solve job (returns immediately)")
    print("  GET  /job/<id>    - Get job status/result")
    print()
    print("For production, run with:")
    print("  gunicorn -c ../deploy/gunicorn.conf.py server_prod:app")
    print("=" * 60)

    app.run(host='0.0.0.0', port=5000, debug=True, threaded=True)
