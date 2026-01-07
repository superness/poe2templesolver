#!/usr/bin/env python3
"""
Generate training data for ML warm-start model.
Runs solver on random temple configurations and saves (input, solution) pairs.

Usage:
  python generate_training_data.py --count 1000 --output training_data.json
"""

import argparse
import json
import random
import time
from pathlib import Path
from temple_solver import SolverInput, solve_temple, GRID_SIZE, FOYER_POS

# Room types that can appear in temples
ROOM_TYPES = [
    'SPYMASTER', 'GARRISON', 'LEGION_BARRACKS', 'COMMANDER', 'ARMOURY',
    'CORRUPTION_CHAMBER', 'THAUMATURGE', 'SACRIFICIAL_CHAMBER', 'ALCHEMY_LAB',
    'GOLEM_WORKS', 'SMITHY', 'GENERATOR', 'FLESH_SURGEON', 'SYNTHFLESH'
]

def random_architect_position():
    """Generate a random valid architect position."""
    while True:
        x = random.randint(1, GRID_SIZE)
        y = random.randint(1, GRID_SIZE)
        # Not on foyer
        if (x, y) != FOYER_POS:
            return (x, y)

def get_systematic_architect_positions():
    """Get a list of architect positions to cover systematically."""
    positions = []
    # Cover the grid in a pattern - corners, edges, center areas
    # Skip positions too close to foyer (1,1)
    for x in range(1, GRID_SIZE + 1):
        for y in range(1, GRID_SIZE + 1):
            if (x, y) != FOYER_POS:
                positions.append((x, y))
    return positions

def random_existing_rooms(architect_pos, count_range=(0, 8)):
    """Generate random existing rooms."""
    rooms = []
    count = random.randint(*count_range)
    used_positions = {FOYER_POS, architect_pos}

    for _ in range(count):
        # Find unused position
        attempts = 0
        while attempts < 100:
            x = random.randint(1, GRID_SIZE)
            y = random.randint(1, GRID_SIZE)
            if (x, y) not in used_positions:
                used_positions.add((x, y))
                rooms.append({
                    'type': random.choice(ROOM_TYPES),
                    'tier': random.randint(1, 3),
                    'x': x,
                    'y': y,
                })
                break
            attempts += 1

    return rooms

def generate_sample(sample_id, max_time=30):
    """Generate one training sample."""
    architect = random_architect_position()
    existing_rooms = random_existing_rooms(architect)

    # Randomize some solver params
    min_spy = random.randint(6, 10)
    min_corr = random.randint(4, 7)

    solver_input = SolverInput(
        architect_pos=architect,
        min_spymasters=min_spy,
        min_corruption_chambers=min_corr,
        max_paths=0,
        snake_mode=True,
        max_endpoints=random.randint(2, 3),
        max_time_seconds=max_time,
        existing_rooms=existing_rooms,
        existing_paths=[],
        lock_existing=True,
        junction_penalty=100,
        max_neighbors=4,
        empty_penalty=100,
    )

    start = time.time()
    result = solve_temple(solver_input)
    solve_time = time.time() - start

    if not result.success:
        return None

    # Build training sample
    sample = {
        'id': sample_id,
        'input': {
            'architect': list(architect),
            'existing_rooms': existing_rooms,
            'min_spymasters': min_spy,
            'min_corruption_chambers': min_corr,
        },
        'output': {
            'rooms': result.rooms,
            'paths': [{'x': p[0], 'y': p[1]} if isinstance(p, tuple) else p for p in result.paths],
            'score': result.score,
            'optimal': result.optimal,
        },
        'meta': {
            'solve_time': round(solve_time, 2),
            'status': result.stats.get('status', 'unknown') if isinstance(result.stats, dict) else str(result.stats),
        }
    }

    return sample

def generate_sample_with_architect(sample_id, architect, max_time=30):
    """Generate one training sample with a specific architect position."""
    existing_rooms = random_existing_rooms(architect)

    min_spy = random.randint(6, 10)
    min_corr = random.randint(4, 7)

    solver_input = SolverInput(
        architect_pos=architect,
        min_spymasters=min_spy,
        min_corruption_chambers=min_corr,
        max_paths=0,
        snake_mode=True,
        max_endpoints=random.randint(2, 3),
        max_time_seconds=max_time,
        existing_rooms=existing_rooms,
        existing_paths=[],
        lock_existing=True,
        junction_penalty=100,
        max_neighbors=4,
        empty_penalty=100,
    )

    start = time.time()
    result = solve_temple(solver_input)
    solve_time = time.time() - start

    if not result.success:
        return None

    sample = {
        'id': sample_id,
        'input': {
            'architect': list(architect),
            'existing_rooms': existing_rooms,
            'min_spymasters': min_spy,
            'min_corruption_chambers': min_corr,
        },
        'output': {
            'rooms': result.rooms,
            'paths': [{'x': p[0], 'y': p[1]} if isinstance(p, tuple) else p for p in result.paths],
            'score': result.score,
            'optimal': result.optimal,
        },
        'meta': {
            'solve_time': round(solve_time, 2),
            'status': result.stats.get('status', 'unknown') if isinstance(result.stats, dict) else str(result.stats),
        }
    }
    return sample


def main():
    parser = argparse.ArgumentParser(description='Generate training data for temple solver ML model')
    parser.add_argument('--count', type=int, default=100, help='Number of samples to generate')
    parser.add_argument('--output', type=str, default='training_data.json', help='Output file')
    parser.add_argument('--max-time', type=int, default=30, help='Max solve time per sample')
    parser.add_argument('--append', action='store_true', help='Append to existing file')
    parser.add_argument('--systematic', action='store_true', help='Generate samples for all architect positions')
    parser.add_argument('--samples-per-position', type=int, default=5, help='Samples per architect position (with --systematic)')
    args = parser.parse_args()

    # Load existing data if appending
    samples = []
    start_id = 0
    if args.append and Path(args.output).exists():
        with open(args.output) as f:
            samples = json.load(f)
            start_id = max(s['id'] for s in samples) + 1
        print(f"Loaded {len(samples)} existing samples, starting from ID {start_id}")

    success = 0
    failed = 0
    total_time = 0

    if args.systematic:
        # Generate samples for each architect position
        positions = get_systematic_architect_positions()
        total = len(positions) * args.samples_per_position
        print(f"Systematic mode: {len(positions)} architect positions x {args.samples_per_position} samples = {total} total")
        print(f"Max solve time: {args.max_time}s per sample")
        print()

        i = 0
        for pos in positions:
            for j in range(args.samples_per_position):
                sample_id = start_id + i
                print(f"[{i+1}/{total}] Architect {pos}, sample {j+1}/{args.samples_per_position}...", end=' ', flush=True)

                try:
                    sample = generate_sample_with_architect(sample_id, pos, args.max_time)
                    if sample:
                        samples.append(sample)
                        success += 1
                        total_time += sample['meta']['solve_time']
                        print(f"OK (score={sample['output']['score']}, time={sample['meta']['solve_time']}s)")
                    else:
                        failed += 1
                        print("FAILED (no solution)")
                except Exception as e:
                    failed += 1
                    print(f"ERROR: {e}")

                i += 1

                # Save periodically
                if i % 10 == 0:
                    with open(args.output, 'w') as f:
                        json.dump(samples, f, indent=2)
                    print(f"  Saved {len(samples)} samples to {args.output}")
    else:
        # Random mode
        print(f"Generating {args.count} training samples...")
        print(f"Max solve time: {args.max_time}s per sample")
        print()

        for i in range(args.count):
            sample_id = start_id + i
            print(f"[{i+1}/{args.count}] Generating sample {sample_id}...", end=' ', flush=True)

            try:
                sample = generate_sample(sample_id, args.max_time)
                if sample:
                    samples.append(sample)
                    success += 1
                    total_time += sample['meta']['solve_time']
                    print(f"OK (score={sample['output']['score']}, time={sample['meta']['solve_time']}s)")
                else:
                    failed += 1
                    print("FAILED (no solution)")
            except Exception as e:
                failed += 1
                print(f"ERROR: {e}")

            # Save periodically
            if (i + 1) % 10 == 0:
                with open(args.output, 'w') as f:
                    json.dump(samples, f, indent=2)
                print(f"  Saved {len(samples)} samples to {args.output}")

    # Final save
    with open(args.output, 'w') as f:
        json.dump(samples, f, indent=2)

    print()
    print(f"Done! Generated {success} samples, {failed} failed")
    print(f"Total solve time: {total_time:.1f}s, avg: {total_time/max(success,1):.1f}s")
    print(f"Saved to {args.output}")

if __name__ == '__main__':
    main()
