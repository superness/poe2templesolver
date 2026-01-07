#!/usr/bin/env python3
"""
Flask API server for Temple Solver.

Run with: python server.py
Then access at: http://localhost:5000/solve
"""

import threading
import time
from flask import Flask, request, jsonify
from flask_cors import CORS
from temple_solver import SolverInput, solve_temple

app = Flask(__name__)
CORS(app)  # Allow cross-origin requests from the frontend

# Track solve state
solve_state = {
    "solving": False,
    "started_at": None,
    "config": None,
    "best_solution": None,  # Current best solution during solving
}
solve_lock = threading.Lock()


@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint."""
    return jsonify({"status": "ok"})


@app.route('/status', methods=['GET'])
def status():
    """Check if solver is busy."""
    with solve_lock:
        if solve_state["solving"]:
            elapsed = time.time() - solve_state["started_at"]
            return jsonify({
                "status": "solving",
                "elapsed_seconds": round(elapsed, 1),
                "config": solve_state["config"],
            })
        return jsonify({"status": "idle"})


@app.route('/best', methods=['GET'])
def best():
    """Get the current best solution while solving."""
    with solve_lock:
        if solve_state["best_solution"]:
            elapsed = time.time() - solve_state["started_at"] if solve_state["started_at"] else 0
            return jsonify({
                "status": "solving" if solve_state["solving"] else "done",
                "elapsed_seconds": round(elapsed, 1),
                "solution": solve_state["best_solution"],
            })
        elif solve_state["solving"]:
            elapsed = time.time() - solve_state["started_at"]
            return jsonify({
                "status": "searching",
                "elapsed_seconds": round(elapsed, 1),
                "solution": None,
            })
        return jsonify({"status": "idle", "solution": None})


@app.route('/solve', methods=['POST'])
def solve():
    """
    Solve temple layout.

    Request JSON:
    {
        "architect": [x, y],
        "min_spymasters": 8,
        "min_corruption_chambers": 6,
        "max_time_seconds": 60,
        "existing_rooms": [...],
        "existing_paths": [...],
        "lock_existing": true,
        "junction_penalty": 10,  // Points deducted per room with 3+ neighbors
        "max_neighbors": 4       // Hard limit on neighbors per room (2 = strict snake)
    }
    """
    try:
        data = request.get_json()

        if not data:
            return jsonify({"success": False, "error": "No JSON body provided"}), 400

        if 'architect' not in data:
            return jsonify({"success": False, "error": "Missing required field: architect"}), 400

        architect = tuple(data['architect'])

        # Parse room_values if provided
        room_values = data.get('room_values', None)

        # Parse chain configurations if provided
        chains = data.get('chains', None)

        solver_input = SolverInput(
            architect_pos=architect,
            min_spymasters=data.get('min_spymasters', 8),
            min_corruption_chambers=data.get('min_corruption_chambers', 6),
            max_paths=data.get('max_paths', 0),
            snake_mode=data.get('snake_mode', True),
            max_endpoints=data.get('max_endpoints', 2),
            max_time_seconds=data.get('max_time_seconds', 60),
            existing_rooms=data.get('existing_rooms', []),
            existing_paths=[tuple(p) if isinstance(p, list) else (p['x'], p['y']) for p in data.get('existing_paths', [])],
            lock_existing=data.get('lock_existing', True),
            junction_penalty=data.get('junction_penalty', 10),
            max_neighbors=data.get('max_neighbors', 4),
            room_values=room_values,
            chains=chains,
            empty_penalty=data.get('empty_penalty', 0),
        )

        print(f"Solving: architect={architect}, spymasters={solver_input.min_spymasters}, corruption={solver_input.min_corruption_chambers}, junction_penalty={solver_input.junction_penalty}, max_neighbors={solver_input.max_neighbors}, empty_penalty={solver_input.empty_penalty}, chains={len(chains) if chains else 0}")

        # Callback to store intermediate solutions
        def on_new_solution(solution):
            with solve_lock:
                solve_state["best_solution"] = solution
                print(f"  New best: score={solution['score']}, solutions_found={solution['solution_count']}")

        # Mark as solving
        with solve_lock:
            solve_state["solving"] = True
            solve_state["started_at"] = time.time()
            solve_state["best_solution"] = None  # Clear previous best
            solve_state["config"] = {
                "architect": architect,
                "min_spymasters": solver_input.min_spymasters,
                "min_corruption": solver_input.min_corruption_chambers,
                "max_time": solver_input.max_time_seconds,
            }

        try:
            result = solve_temple(solver_input, on_solution=on_new_solution)
        finally:
            with solve_lock:
                solve_state["solving"] = False
                solve_state["started_at"] = None
                solve_state["config"] = None
                # Keep best_solution available briefly for final poll

        # Preserve chain field in paths if present
        paths_out = []
        for p in result.paths:
            if isinstance(p, dict):
                paths_out.append(p)  # Already has x, y, and possibly chain
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

        print(f"Result: success={result.success}, score={result.score}")

        return jsonify(output)

    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500


if __name__ == '__main__':
    print("Starting Temple Solver API on http://localhost:5000")
    print("Endpoints:")
    print("  GET  /health - Health check")
    print("  GET  /status - Check solver status")
    print("  GET  /best   - Get current best solution (poll while solving)")
    print("  POST /solve  - Solve temple layout")
    app.run(host='0.0.0.0', port=5000, debug=True)
