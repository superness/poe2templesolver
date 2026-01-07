#!/usr/bin/env python3
"""
POE2 Temple of Atziri Optimal Solver using OR-Tools CP-SAT.

This solver finds the provably optimal temple layout that:
1. Places rooms where adjacent compatible rooms AUTO-CONNECT (no choice!)
2. Ensures all rooms can reach the Foyer via auto-connections
3. Minimizes junctions (rooms with 3+ connections)
4. Meets minimum room requirements (spymasters, corruption chambers)
5. Maximizes total temple value/score

KEY INSIGHT: In POE2 temples, you don't choose which rooms connect.
If two compatible rooms are adjacent, they ARE connected. Period.
The solver must work with this constraint, not against it.
"""

import json
import sys
from typing import Dict, List, Tuple, Optional, Set
from dataclasses import dataclass
from ortools.sat.python import cp_model

# =============================================================================
# DOMAIN DEFINITIONS
# =============================================================================

GRID_SIZE = 9
FOYER_POS = (5, 1)  # 1-indexed
# ATZIRI_POS removed - (5, 9) is a regular grid cell, not special

# Room types (index 0 = EMPTY, 1 = PATH, rest are actual rooms)
ROOM_TYPES = [
    'EMPTY',
    'PATH',
    'GARRISON',
    'SPYMASTER',
    'COMMANDER',
    'ARMOURY',
    'ALCHEMY_LAB',
    'SMITHY',
    'CORRUPTION_CHAMBER',
    'SACRIFICIAL_CHAMBER',
    'THAUMATURGE',
    'GENERATOR',
    'GOLEM_WORKS',
    'FLESH_SURGEON',
    'SYNTHFLESH',
    'LEGION_BARRACKS',
]

ROOM_TYPE_TO_IDX = {name: idx for idx, name in enumerate(ROOM_TYPES)}
EMPTY_IDX = 0
PATH_IDX = 1

# Connection rules - discovered empirically via Sulozor testing:
#
# CRITICAL: Only certain rooms can be PARENTS and have children.
# Other rooms are "leaf" rooms - they can connect to FOYER or be children,
# but cannot have children themselves.
#
# Valid parent -> children relationships:
#   - GARRISON -> COMMANDER, ARMOURY, SPYMASTER, SYNTHFLESH
#   - SPYMASTER -> GARRISON, LEGION_BARRACKS
#   - ARMOURY -> GARRISON, LEGION_BARRACKS, SMITHY, ALCHEMY_LAB
#   - GENERATOR -> THAUMATURGE, SACRIFICIAL_CHAMBER
#   - SMITHY -> ARMOURY, GOLEM_WORKS
#
# Rooms can branch to multiple children - no linear chain restriction.

# =============================================================================
# VERIFIED RULES FROM SULOZOR SOURCE CODE (2026-01-06)
# Extracted from: https://github.com/sulozor/sulozor.github.io
# =============================================================================

# ALL rooms can connect to FOYER - no REQUIRED_PARENTS restrictions!
REQUIRED_PARENTS: Dict[str, List[str]] = {}

# ALL rooms CANNOT be adjacent to themselves (spatial adjacency)
NO_SELF_ADJACENCY: Set[str] = {
    'GARRISON', 'SPYMASTER', 'COMMANDER', 'ARMOURY', 'ALCHEMY_LAB', 'SMITHY',
    'CORRUPTION_CHAMBER', 'SACRIFICIAL_CHAMBER', 'THAUMATURGE', 'GENERATOR',
    'GOLEM_WORKS', 'FLESH_SURGEON', 'SYNTHFLESH', 'LEGION_BARRACKS',
}

# LEAF ROOMS - rooms that can ONLY be leaves (cannot have children)
# NOTE: LEGION_BARRACKS was removed - it CAN be a parent of SPYMASTER, COMMANDER, ARMOURY
LEAF_ROOMS: Set[str] = {
    'GOLEM_WORKS',
    'GENERATOR',
}

# VALID ADJACENCY from Sulozor's Rh object (what each room can connect to)
# Note: PATH can connect to anything, so we only list room-to-room connections
SULOZOR_ADJACENCY: Dict[str, Set[str]] = {
    'GARRISON': {'COMMANDER', 'ARMOURY', 'SPYMASTER', 'SYNTHFLESH'},
    'LEGION_BARRACKS': {'COMMANDER', 'ARMOURY', 'SPYMASTER'},  # NOT SYNTHFLESH!
    'COMMANDER': {'GARRISON', 'LEGION_BARRACKS'},  # NOT LEGION_BARRACKS direct!
    'SPYMASTER': {'GARRISON', 'LEGION_BARRACKS'},
    'ARMOURY': {'GARRISON', 'LEGION_BARRACKS', 'SMITHY', 'ALCHEMY_LAB'},
    'SMITHY': {'ARMOURY', 'GOLEM_WORKS'},
    'GOLEM_WORKS': {'SMITHY'},
    'GENERATOR': {'THAUMATURGE', 'SACRIFICIAL_CHAMBER'},
    'SYNTHFLESH': {'GARRISON', 'FLESH_SURGEON'},  # NOT LEGION_BARRACKS!
    'FLESH_SURGEON': {'SYNTHFLESH'},
    'ALCHEMY_LAB': {'ARMOURY', 'THAUMATURGE'},
    'THAUMATURGE': {'ALCHEMY_LAB', 'SACRIFICIAL_CHAMBER', 'CORRUPTION_CHAMBER', 'GENERATOR'},
    'CORRUPTION_CHAMBER': {'THAUMATURGE', 'SACRIFICIAL_CHAMBER'},
    'SACRIFICIAL_CHAMBER': {'THAUMATURGE', 'CORRUPTION_CHAMBER', 'GENERATOR'},
}

# Build VALID_ADJACENCY_PAIRS from SULOZOR_ADJACENCY
def _build_valid_pairs() -> Set[Tuple[str, str]]:
    pairs = set()
    for room, adjacent in SULOZOR_ADJACENCY.items():
        for adj in adjacent:
            # Add both directions
            pairs.add((room, adj))
            pairs.add((adj, room))
    return pairs

VALID_ADJACENCY_PAIRS = _build_valid_pairs()
VALID_ADJACENCY_SET = VALID_ADJACENCY_PAIRS  # Same thing now

def can_be_adjacent(type_a: str, type_b: str) -> bool:
    """Check if two room types can be placed adjacent to each other."""
    if type_a == 'PATH' or type_b == 'PATH':
        return True  # PATH can be adjacent to anything
    if type_a == 'EMPTY' or type_b == 'EMPTY':
        return True  # EMPTY is fine
    return (type_a, type_b) in VALID_ADJACENCY_SET

# Rooms that CAN have children (appear as keys in SULOZOR_ADJACENCY with non-empty sets)
CAN_HAVE_CHILDREN: Set[str] = {
    room for room, adj in SULOZOR_ADJACENCY.items() if adj
}

# =============================================================================
# CHAIN BANS - Specific patterns that are NOT allowed
# From Sulozor validation error messages
# =============================================================================

# Format: (A, B, C) means A→B→C chain is banned
CHAIN_BANS: List[Tuple[str, str, str]] = [
    ('ARMOURY', 'GARRISON', 'ARMOURY'),           # "Armoury → Garrison → Armoury not allowed"
    ('ALCHEMY_LAB', 'ARMOURY', 'ALCHEMY_LAB'),    # "Alchemy Lab → Armoury → Alchemy Lab not allowed"
    ('THAUMATURGE', 'CORRUPTION_CHAMBER', 'THAUMATURGE'),  # "Thaumaturge → Corruption → Thaumaturge not allowed"
    ('GOLEM_WORKS', 'SMITHY', 'GOLEM_WORKS'),     # "Golem → Smithy → Golem not allowed"
    ('SPYMASTER', 'LEGION_BARRACKS', 'SPYMASTER'),  # "Spymaster → Legion → Spymaster not allowed"
    ('LEGION_BARRACKS', 'SPYMASTER', 'LEGION_BARRACKS'),  # "Legion → Spymaster → Legion not allowed"
]

# =============================================================================
# ADJACENCY LIMITS - Maximum count of specific adjacent room types
# =============================================================================

# Format: {room_type: {adjacent_type: max_count}}
ADJACENCY_LIMITS: Dict[str, Dict[str, int]] = {
    'ARMOURY': {'SMITHY': 1},           # "Armoury already has 1 Smithy adjacent (maximum allowed)"
    'ALCHEMY_LAB': {'THAUMATURGE': 2},  # "Alchemy Lab already has 2 Thaumaturges connected (maximum allowed)"
}

# =============================================================================
# SPECIAL RULES
# =============================================================================

# Rooms that MUST be connected to PATH
REQUIRES_PATH_NEIGHBOR: Set[str] = {
    'GENERATOR',  # "Generator must be connected to a Path"
}

# Rooms with linear chain restrictions
# "Spymaster cannot be in a linear chain with Commander"
LINEAR_CHAIN_BAN: List[Tuple[str, str]] = [
    ('SPYMASTER', 'COMMANDER'),
]

# Legacy - not used
VALID_CHILDREN: Dict[str, List[str]] = {}
ASYMMETRIC_CHAINS: List[Tuple[str, str]] = []

# Room values by tier [T1, T2, T3]
ROOM_VALUES: Dict[str, List[int]] = {
    'EMPTY': [0, 0, 0],
    'PATH': [1, 1, 1],
    'GARRISON': [8, 12, 18],
    'SPYMASTER': [20, 35, 50],
    'COMMANDER': [12, 20, 35],
    'ARMOURY': [10, 18, 28],
    'ALCHEMY_LAB': [14, 24, 40],
    'SMITHY': [12, 22, 38],
    'CORRUPTION_CHAMBER': [25, 45, 70],
    'SACRIFICIAL_CHAMBER': [30, 50, 80],
    'THAUMATURGE': [15, 30, 50],
    'GENERATOR': [10, 18, 30],
    'GOLEM_WORKS': [8, 14, 22],
    'FLESH_SURGEON': [15, 28, 45],
    'SYNTHFLESH': [10, 18, 28],
    'LEGION_BARRACKS': [12, 22, 35],
}

# Unique rooms (only one allowed per temple)
UNIQUE_ROOMS = {'SACRIFICIAL_CHAMBER'}


def can_connect(type_a: str, type_b: str) -> bool:
    """
    Check if two room types can connect for tree connectivity.

    Rules (discovered via Sulozor testing):
    1. EMPTY never connects to anything
    2. Most rooms can connect to any other room freely
    3. Only SPYMASTER, GOLEM_WORKS, and THAUMATURGE need specific parents
    """
    if type_a == 'EMPTY' or type_b == 'EMPTY':
        return False

    # Normalize special cells to PATH
    if type_a in ('FOYER', 'ARCHITECT', 'ATZIRI'):
        type_a = 'PATH'
    if type_b in ('FOYER', 'ARCHITECT', 'ATZIRI'):
        type_b = 'PATH'

    # Check if type_a requires specific parents
    if type_a in REQUIRED_PARENTS:
        if type_b not in REQUIRED_PARENTS[type_a] and type_b != 'PATH':
            # type_a needs a specific parent, and type_b is not one of them
            # But they can still connect if type_b is NOT the parent (type_a could be parent to type_b)
            pass  # Allow - we check parent direction separately

    # Check if type_b requires specific parents
    if type_b in REQUIRED_PARENTS:
        if type_a not in REQUIRED_PARENTS[type_b] and type_a != 'PATH':
            pass  # Allow - we check parent direction separately

    # Most rooms can connect freely
    return True


def can_be_parent_of(parent_type: str, child_type: str) -> bool:
    """
    Check if parent_type can be the parent of child_type in the tree.

    Rules (discovered empirically via Sulozor testing):
    1. PATH/FOYER can be parent of any room EXCEPT those requiring specific parents
    2. Only rooms in VALID_CHILDREN can have children, and only specific ones
    3. Leaf rooms (CORRUPTION_CHAMBER, ALCHEMY_LAB, etc.) cannot have any children
    """
    if child_type == 'EMPTY' or parent_type == 'EMPTY':
        return False

    # Normalize special cells to PATH
    if parent_type in ('FOYER', 'ARCHITECT', 'ATZIRI'):
        parent_type = 'PATH'

    # PATH/FOYER can be parent of rooms that don't require specific parents
    if parent_type == 'PATH':
        # Check if child requires specific parents (can't connect directly to PATH)
        if child_type in REQUIRED_PARENTS:
            return False
        return True

    # Leaf rooms cannot have any children
    if parent_type in LEAF_ROOMS:
        return False

    # Check if parent can have this specific child
    if parent_type in VALID_CHILDREN:
        return child_type in VALID_CHILDREN[parent_type]

    # Rooms not in VALID_CHILDREN cannot have children
    return False


def get_neighbors(x: int, y: int) -> List[Tuple[int, int]]:
    """Get valid grid neighbors (1-indexed)."""
    neighbors = []
    for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
        nx, ny = x + dx, y + dy
        if 1 <= nx <= GRID_SIZE and 1 <= ny <= GRID_SIZE:
            neighbors.append((nx, ny))
    return neighbors


def validate_spy_cmd_constraint(rooms: List[dict], edges: List[dict]) -> Tuple[bool, Optional[List[Tuple[int, int]]]]:
    """
    Validate SPY-CMD linear chain constraint.

    Rule: In a linear chain (path of degree-2 nodes), SPY cannot come AFTER CMD.
    - SPY → ... → CMD is VALID (SPY before CMD, closer to foyer)
    - CMD → ... → SPY is INVALID (SPY after CMD, further from foyer)

    Returns (is_valid, violation_path) where violation_path shows the invalid chain if found.
    """
    # Build adjacency graph from edges
    graph = {}
    for edge in edges:
        a = (edge['from']['x'], edge['from']['y'])
        b = (edge['to']['x'], edge['to']['y'])
        if a not in graph:
            graph[a] = set()
        if b not in graph:
            graph[b] = set()
        graph[a].add(b)
        graph[b].add(a)

    # Build room type map
    room_types = {}
    for room in rooms:
        pos = (room['position']['x'], room['position']['y']) if 'position' in room else (room['x'], room['y'])
        room_types[pos] = room['type']

    # Find CMD positions
    cmd_positions = [pos for pos, rtype in room_types.items() if rtype == 'COMMANDER']

    if not cmd_positions:
        return True, None  # No CMD, no violation possible

    # For each CMD, check if any SPY is reachable via linear path going AWAY from foyer
    # We do BFS from CMD through degree-2 nodes, looking for SPY
    # The direction "away from foyer" means we're going deeper into the tree

    # First, compute distances from foyer to establish direction
    from collections import deque
    foyer = FOYER_POS
    distances = {foyer: 0}
    bfs_queue = deque([foyer])
    while bfs_queue:
        current = bfs_queue.popleft()
        for neighbor in graph.get(current, set()):
            if neighbor not in distances:
                distances[neighbor] = distances[current] + 1
                bfs_queue.append(neighbor)

    # For each CMD, search for SPY that's further from foyer via linear path
    for cmd_pos in cmd_positions:
        if cmd_pos not in graph or cmd_pos not in distances:
            continue

        cmd_dist = distances[cmd_pos]

        # BFS from CMD through degree-2 nodes, only going AWAY from foyer (increasing distance)
        queue = [(cmd_pos, [cmd_pos])]
        visited = {cmd_pos}

        while queue:
            current, path = queue.pop(0)
            current_dist = distances.get(current, 0)

            for neighbor in graph.get(current, set()):
                if neighbor in visited:
                    continue

                neighbor_dist = distances.get(neighbor, 0)

                # Only go away from foyer (increasing distance)
                if neighbor_dist <= current_dist:
                    continue

                new_path = path + [neighbor]

                # Check if this neighbor is SPY
                if room_types.get(neighbor) == 'SPYMASTER':
                    # Found SPY after CMD - check if path is linear
                    is_linear = True
                    for intermediate in path[1:]:  # Skip CMD itself
                        if len(graph.get(intermediate, set())) > 2:
                            is_linear = False
                            break
                    if is_linear:
                        return False, new_path

                # Continue through degree-2 nodes (linear chain)
                if len(graph.get(neighbor, set())) == 2:
                    visited.add(neighbor)
                    queue.append((neighbor, new_path))

    return True, None


# =============================================================================
# SOLVER
# =============================================================================

@dataclass
class SolverInput:
    architect_pos: Tuple[int, int]
    min_spymasters: int = 8
    min_corruption_chambers: int = 6
    max_paths: int = 0  # Maximum number of path tiles (0 = no paths, optimal)
    snake_mode: bool = True  # If True, each cell has max 1 child in tree (linear chains)
    max_endpoints: int = 2  # Maximum chain endpoints (cells with 1 neighbor)
    existing_rooms: List[dict] = None  # [{type, tier, x, y}, ...]
    existing_paths: List[Tuple[int, int]] = None
    max_time_seconds: int = 60
    lock_existing: bool = True  # If True, existing rooms must be included; if False, they're optional

    # Snake mode tuning - encourage thin chains
    junction_penalty: int = 10  # Points deducted per room with 3+ neighbors (0 = no penalty)
    max_neighbors: int = 4  # Hard limit on neighbors per room (2 = strict snake, 4 = no limit)

    # Custom room values - overrides ROOM_VALUES if provided
    room_values: Dict[str, List[int]] = None  # {room_type: [T1, T2, T3], ...}

    # Chain configurations - define what room types each branch should contain
    chains: List[dict] = None  # [{name, roomTypes, roomCounts, startingRoom}, ...]

    # Penalty per empty cell (encourages filling all cells)
    empty_penalty: int = 0

    # Lazy SPY-CMD constraint - validate post-solve instead of pre-generating constraints
    lazy_spy_cmd: bool = False

    def __post_init__(self):
        if self.existing_rooms is None:
            self.existing_rooms = []
        if self.existing_paths is None:
            self.existing_paths = []

    def get_room_values(self) -> Dict[str, List[int]]:
        """Get effective room values (custom or default)."""
        if self.room_values:
            return self.room_values
        return ROOM_VALUES


@dataclass
class SolverOutput:
    success: bool
    optimal: bool
    score: int
    rooms: List[dict]  # [{type, tier, x, y, chain?}, ...]
    paths: List[Tuple[int, int]]
    edges: List[dict] = None  # [{from: {x,y}, to: {x,y}}, ...] tree edges
    stats: dict = None
    excluded_rooms: List[dict] = None  # Existing rooms that couldn't be included
    error: Optional[str] = None
    chain_names: List[str] = None  # Names of chains if configured


class SolutionCallback(cp_model.CpSolverSolutionCallback):
    """Callback to capture intermediate solutions during solving."""

    def __init__(self, variables: dict, on_solution=None, lazy_spy_cmd=False):
        super().__init__()
        self.variables = variables  # Dict with all the variable refs we need
        self.on_solution = on_solution
        self.lazy_spy_cmd = lazy_spy_cmd
        self.solution_count = 0
        self.best_score = -1
        self.best_solution = None
        self.rejected_count = 0  # Track how many solutions failed SPY-CMD validation

    def on_solution_callback(self):
        self.solution_count += 1
        score = self.Value(self.variables['total_value'])

        if score > self.best_score:
            # Extract current solution
            solution = self._extract_solution()

            # Validate SPY-CMD constraint if lazy mode
            if self.lazy_spy_cmd:
                is_valid, violation = validate_spy_cmd_constraint(
                    solution['rooms'], solution['edges']
                )
                print(f"DEBUG: SPY-CMD validation: valid={is_valid}, violation={violation}, score={score}", flush=True)
                if not is_valid:
                    self.rejected_count += 1
                    print(f"DEBUG: Rejected solution (score={score}) - SPY after CMD at {violation}", flush=True)
                    # Skip this solution, don't update best
                    return

            self.best_score = score
            self.best_solution = solution

            if self.on_solution:
                self.on_solution(solution)

    def _extract_solution(self):
        """Extract current solution state."""
        v = self.variables
        rooms = []
        paths = []
        edges = []

        for x in range(1, GRID_SIZE + 1):
            for y in range(1, GRID_SIZE + 1):
                pos = (x, y)

                # Skip fixed positions
                if pos in (FOYER_POS, v['architect_pos']):
                    continue

                if self.Value(v['in_temple'][pos]):
                    rt_idx = self.Value(v['room_type'][pos])
                    rt_name = ROOM_TYPES[rt_idx]
                    t = self.Value(v['tier'][pos])

                    # Get chain assignment if available
                    chain = None
                    if 'chain_idx' in v and v['chain_idx'] and pos in v['chain_idx']:
                        chain = self.Value(v['chain_idx'][pos])

                    if rt_name == 'PATH':
                        path_data = {'x': x, 'y': y}
                        if chain is not None:
                            path_data['chain'] = chain
                        paths.append(path_data)
                    elif rt_name != 'EMPTY':
                        room_data = {
                            'type': rt_name,
                            'tier': t,
                            'x': x,
                            'y': y
                        }
                        if chain is not None:
                            room_data['chain'] = chain
                        rooms.append(room_data)

        # Extract auto-connection edges
        for pos_a, pos_b, edge_var in v['all_edges']:
            if self.Value(edge_var):
                edges.append({
                    'from': {'x': pos_a[0], 'y': pos_a[1]},
                    'to': {'x': pos_b[0], 'y': pos_b[1]}
                })

        return {
            'score': self.best_score,
            'rooms': rooms,
            'paths': paths,
            'edges': edges,
            'solution_count': self.solution_count,
            'chain_names': v.get('chain_names', []),
        }


def diagnose_infeasibility(input_data: SolverInput) -> List[str]:
    """
    Check for common causes of infeasibility and return diagnostic hints.
    """
    hints = []

    architect_pos = input_data.architect_pos
    ax, ay = architect_pos

    # Build position maps
    existing_positions = {(r['x'], r['y']): r['type'] for r in input_data.existing_rooms}
    existing_path_positions = set(input_data.existing_paths)
    all_existing = set(existing_positions.keys()) | existing_path_positions

    # Check 1: GENERATOR requires PATH but max_paths = 0
    if input_data.max_paths == 0:
        hints.append("max_paths=0 but GENERATOR rooms require PATH neighbors. Either increase max_paths or avoid GENERATOR rooms.")

    # Check 2: Snake mode limits room count
    if input_data.snake_mode:
        max_rooms_estimate = 78  # 81 - FOYER - ATZIRI - ARCHITECT
        required_rooms = input_data.min_spymasters + input_data.min_corruption_chambers
        min_support_rooms = input_data.min_spymasters + input_data.min_corruption_chambers
        total_min = required_rooms + min_support_rooms

        if total_min > max_rooms_estimate * 0.7:
            hints.append(f"High room requirements ({input_data.min_spymasters} SPY + {input_data.min_corruption_chambers} COR) "
                        f"with snake_mode=True may be hard to satisfy. Each SPY needs GAR/LEG parent, each COR needs THAU parent.")

    # Check 3: Max endpoints constraint
    if input_data.max_endpoints < 2:
        hints.append(f"max_endpoints={input_data.max_endpoints} is very restrictive. Tree needs at least 2 endpoints (architect + one leaf).")

    # Check 4: Architect position accessibility
    if ax < 1 or ax > 9 or ay < 1 or ay > 9:
        hints.append(f"Architect position ({ax}, {ay}) is outside the grid (1-9).")

    # Check 5: Architect reachability - is it adjacent to any existing room/path?
    architect_neighbors = [(ax+dx, ay+dy) for dx, dy in [(-1,0), (1,0), (0,-1), (0,1)]
                          if 1 <= ax+dx <= 9 and 1 <= ay+dy <= 9]
    architect_adjacent_to_existing = any(n in all_existing for n in architect_neighbors)

    if not architect_adjacent_to_existing and all_existing:
        # Calculate minimum Manhattan distance to nearest existing room
        min_dist = min(abs(ax - x) + abs(ay - y) for x, y in all_existing) if all_existing else 99
        paths_needed = min_dist - 1  # Need this many paths to bridge the gap

        # Find the nearest room position(s)
        nearest_rooms = [(x, y) for x, y in all_existing if abs(ax - x) + abs(ay - y) == min_dist]
        nearest_str = f"({nearest_rooms[0][0]},{nearest_rooms[0][1]})" if nearest_rooms else "unknown"

        if paths_needed > input_data.max_paths:
            hints.append(f"Architect at ({ax},{ay}) is {min_dist} cells from nearest room at {nearest_str}. "
                        f"Need {paths_needed} path(s) to connect, but max_paths={input_data.max_paths}.")
        elif paths_needed > 0:
            hints.append(f"Architect at ({ax},{ay}) needs {paths_needed} path(s) to connect to nearest room at {nearest_str}.")

    # Check 6: Existing rooms vs minimum requirements
    existing_types = {}
    for room in input_data.existing_rooms:
        rt = room.get('type', 'UNKNOWN')
        existing_types[rt] = existing_types.get(rt, 0) + 1

    existing_spymasters = existing_types.get('SPYMASTER', 0)
    existing_corruption = existing_types.get('CORRUPTION_CHAMBER', 0)

    if input_data.lock_existing:
        # With locked rooms, we can only ADD rooms, not remove
        spymasters_needed = input_data.min_spymasters - existing_spymasters
        corruption_needed = input_data.min_corruption_chambers - existing_corruption

        if spymasters_needed > 0 or corruption_needed > 0:
            # Check if there's room to add more
            empty_cells = 81 - len(all_existing) - 3  # minus FOYER, ATZIRI, ARCHITECT
            rooms_to_add = max(0, spymasters_needed) + max(0, corruption_needed)
            # Each new SPY needs a GAR/LEG parent, each COR needs THAU parent
            support_needed = max(0, spymasters_needed) + max(0, corruption_needed)
            total_to_add = rooms_to_add + support_needed

            if total_to_add > empty_cells:
                hints.append(f"Need to add ~{total_to_add} rooms ({spymasters_needed} SPY + {corruption_needed} COR + parents) "
                            f"but only {empty_cells} empty cells available.")

    # Check 7: Multiple SACRIFICIAL_CHAMBER
    if existing_types.get('SACRIFICIAL_CHAMBER', 0) > 1:
        hints.append(f"Multiple SACRIFICIAL_CHAMBER rooms in existing ({existing_types['SACRIFICIAL_CHAMBER']}), but only 1 allowed.")

    # Check 8: Self-adjacency violations
    for pos, rtype in existing_positions.items():
        x, y = pos
        for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            nx, ny = x + dx, y + dy
            neighbor_pos = (nx, ny)
            if neighbor_pos in existing_positions:
                neighbor_type = existing_positions[neighbor_pos]
                if rtype == neighbor_type and rtype in NO_SELF_ADJACENCY:
                    hints.append(f"Self-adjacency: {rtype} at ({x},{y}) next to same type at ({nx},{ny}).")

    # Check 9: Existing room stats vs requirements
    if input_data.lock_existing:
        if existing_spymasters < input_data.min_spymasters:
            hints.append(f"Existing rooms have {existing_spymasters} Spymasters, need {input_data.min_spymasters}. "
                        f"Solver must add {input_data.min_spymasters - existing_spymasters} more.")
        if existing_corruption < input_data.min_corruption_chambers:
            hints.append(f"Existing rooms have {existing_corruption} Corruption Chambers, need {input_data.min_corruption_chambers}. "
                        f"Solver must add {input_data.min_corruption_chambers - existing_corruption} more.")

    # Check 10: Foyer connectivity - can existing rooms reach Foyer?
    if all_existing and input_data.lock_existing:
        # BFS from Foyer to see if we can reach any existing room
        foyer = FOYER_POS
        foyer_neighbors = [(foyer[0]+dx, foyer[1]+dy) for dx, dy in [(-1,0), (1,0), (0,-1), (0,1)]
                          if 1 <= foyer[0]+dx <= 9 and 1 <= foyer[1]+dy <= 9]
        foyer_adjacent_to_existing = any(n in all_existing for n in foyer_neighbors)

        if not foyer_adjacent_to_existing:
            min_dist_to_foyer = min(abs(foyer[0] - x) + abs(foyer[1] - y) for x, y in all_existing)
            hints.append(f"No existing room adjacent to Foyer. Nearest is {min_dist_to_foyer} cells away.")

    return hints


def solve_temple(input_data: SolverInput, on_solution=None, hints=None) -> SolverOutput:
    """
    Solve for optimal temple layout using CP-SAT.

    Args:
        input_data: Solver configuration and constraints
        on_solution: Optional callback called with each new best solution found
        hints: Optional list of hint dicts with {x, y, type, in_temple} for warm start

    The model:
    - Variables: room_type[x,y], tier[x,y], in_temple[x,y], parent_dir[x,y]
    - Tree structure via parent pointers
    - Connection constraints between adjacent in_temple cells
    - Minimize negative value (maximize value)
    """
    # Run diagnostics first
    diagnostic_hints = diagnose_infeasibility(input_data)

    model = cp_model.CpModel()

    architect_pos = input_data.architect_pos

    # =========================================================================
    # VARIABLES
    # =========================================================================

    # room_type[x,y] - index into ROOM_TYPES (0 = EMPTY)
    room_type = {}
    for x in range(1, GRID_SIZE + 1):
        for y in range(1, GRID_SIZE + 1):
            room_type[(x, y)] = model.NewIntVar(0, len(ROOM_TYPES) - 1, f'room_{x}_{y}')

    # tier[x,y] - 0 for empty, 1-3 for rooms
    tier = {}
    for x in range(1, GRID_SIZE + 1):
        for y in range(1, GRID_SIZE + 1):
            tier[(x, y)] = model.NewIntVar(0, 3, f'tier_{x}_{y}')

    # in_temple[x,y] - is this cell part of the temple?
    in_temple = {}
    for x in range(1, GRID_SIZE + 1):
        for y in range(1, GRID_SIZE + 1):
            in_temple[(x, y)] = model.NewBoolVar(f'in_temple_{x}_{y}')

    # NOTE: parent_dir REMOVED - we no longer use a tree structure!
    # Connections are auto-determined by room type compatibility.

    # Helper: is_room[x,y] = in_temple AND room_type > PATH_IDX
    is_room = {}
    for x in range(1, GRID_SIZE + 1):
        for y in range(1, GRID_SIZE + 1):
            is_room[(x, y)] = model.NewBoolVar(f'is_room_{x}_{y}')

    # =========================================================================
    # FIXED POSITIONS
    # =========================================================================

    # Foyer at (5, 1) - always in temple
    model.Add(in_temple[FOYER_POS] == 1)
    model.Add(room_type[FOYER_POS] == ROOM_TYPE_TO_IDX.get('PATH', PATH_IDX))  # Treat as PATH for connections
    model.Add(tier[FOYER_POS] == 1)

    # Architect position - always in temple
    model.Add(in_temple[architect_pos] == 1)
    model.Add(room_type[architect_pos] == ROOM_TYPE_TO_IDX.get('PATH', PATH_IDX))  # Treat as PATH
    model.Add(tier[architect_pos] == 1)

    # Position (5, 9) is a regular grid cell - no special handling needed

    # =========================================================================
    # BASIC CONSTRAINTS
    # =========================================================================

    for x in range(1, GRID_SIZE + 1):
        for y in range(1, GRID_SIZE + 1):
            pos = (x, y)

            # If not in temple, must be EMPTY with tier 0
            model.Add(room_type[pos] == EMPTY_IDX).OnlyEnforceIf(in_temple[pos].Not())
            model.Add(tier[pos] == 0).OnlyEnforceIf(in_temple[pos].Not())

            # If in temple, must not be EMPTY
            model.Add(room_type[pos] != EMPTY_IDX).OnlyEnforceIf(in_temple[pos])

            # If in temple and not PATH, tier must be 1-3
            is_path = model.NewBoolVar(f'is_path_{x}_{y}')
            model.Add(room_type[pos] == PATH_IDX).OnlyEnforceIf(is_path)
            model.Add(room_type[pos] != PATH_IDX).OnlyEnforceIf(is_path.Not())

            # PATH has tier 1, rooms have tier 1-3
            model.Add(tier[pos] == 1).OnlyEnforceIf(is_path, in_temple[pos])
            model.Add(tier[pos] >= 1).OnlyEnforceIf(is_path.Not(), in_temple[pos])
            model.Add(tier[pos] <= 3).OnlyEnforceIf(is_path.Not(), in_temple[pos])

            # is_room = in_temple AND room_type > PATH_IDX
            model.Add(room_type[pos] > PATH_IDX).OnlyEnforceIf(is_room[pos])
            model.Add(room_type[pos] <= PATH_IDX).OnlyEnforceIf(is_room[pos].Not())
            model.AddImplication(is_room[pos], in_temple[pos])
            model.AddImplication(in_temple[pos].Not(), is_room[pos].Not())

    # =========================================================================
    # AUTO-CONNECTION MODEL
    # =========================================================================
    # In POE2 temples, adjacent compatible rooms AUTO-CONNECT. No choice!
    # We model this with:
    #   1. connected[pos, neighbor] = true if both in_temple AND types compatible
    #   2. All in_temple cells must be reachable from FOYER via connections

    # Direction encoding for neighbors
    DIR_OFFSETS = {1: (0, -1), 2: (0, 1), 3: (-1, 0), 4: (1, 0)}

    # Build list of valid (type_a, type_b) index pairs that can connect
    # PATH can connect to anything non-EMPTY
    # Room types follow SULOZOR_ADJACENCY rules
    compatible_type_pairs = set()
    for type_a_idx, type_a in enumerate(ROOM_TYPES):
        for type_b_idx, type_b in enumerate(ROOM_TYPES):
            if type_a == 'EMPTY' or type_b == 'EMPTY':
                continue
            if type_a == 'PATH' or type_b == 'PATH':
                # PATH connects to anything non-empty
                compatible_type_pairs.add((type_a_idx, type_b_idx))
            elif can_be_adjacent(type_a, type_b):
                compatible_type_pairs.add((type_a_idx, type_b_idx))

    # Create connection variables for each adjacent pair
    # connected[pos][neighbor] = true if auto-connected
    connected = {}
    all_edges = []  # List of (pos, neighbor) pairs

    for x in range(1, GRID_SIZE + 1):
        for y in range(1, GRID_SIZE + 1):
            pos = (x, y)
            # Use setdefault to avoid overwriting edges added by previous iterations
            connected.setdefault(pos, {})

            for nx, ny in get_neighbors(x, y):
                neighbor = (nx, ny)
                # Only create one variable per edge (avoid duplicates)
                if neighbor < pos:
                    continue

                edge_var = model.NewBoolVar(f'conn_{x}_{y}_{nx}_{ny}')
                connected[pos][neighbor] = edge_var
                connected.setdefault(neighbor, {})[pos] = edge_var
                all_edges.append((pos, neighbor, edge_var))

                # Connection requires: both in_temple AND types compatible
                both_in_temple = model.NewBoolVar(f'both_in_{x}_{y}_{nx}_{ny}')
                model.AddBoolAnd([in_temple[pos], in_temple[neighbor]]).OnlyEnforceIf(both_in_temple)
                model.AddBoolOr([in_temple[pos].Not(), in_temple[neighbor].Not()]).OnlyEnforceIf(both_in_temple.Not())

                # If not both in temple, no connection
                model.AddImplication(both_in_temple.Not(), edge_var.Not())

                # Connection is active iff both in temple AND types are compatible
                # Use table constraint to directly tie edge_var to type compatibility
                # edge_var = 1 iff (room_type[pos], room_type[neighbor]) in compatible_type_pairs
                #                  AND both are in_temple

                # Build table: (type_a, type_b, both_in, edge) tuples
                # edge = 1 only when both_in=1 and types compatible
                connection_tuples = []
                for type_a_idx in range(len(ROOM_TYPES)):
                    for type_b_idx in range(len(ROOM_TYPES)):
                        is_compat = (type_a_idx, type_b_idx) in compatible_type_pairs
                        # both_in=0 -> edge=0
                        connection_tuples.append((type_a_idx, type_b_idx, 0, 0))
                        # both_in=1 -> edge=1 iff compatible
                        connection_tuples.append((type_a_idx, type_b_idx, 1, 1 if is_compat else 0))

                model.AddAllowedAssignments(
                    [room_type[pos], room_type[neighbor], both_in_temple, edge_var],
                    connection_tuples
                )

    # =========================================================================
    # REACHABILITY CONSTRAINT (ensures connectivity to FOYER)
    # =========================================================================
    # Each in_temple cell must be reachable from FOYER via connections.
    # We use reach_dist as distance from FOYER; cells with lower dist are "closer".

    reach_dist = {}
    MAX_DIST = GRID_SIZE * GRID_SIZE
    for x in range(1, GRID_SIZE + 1):
        for y in range(1, GRID_SIZE + 1):
            reach_dist[(x, y)] = model.NewIntVar(0, MAX_DIST, f'rdist_{x}_{y}')

    # FOYER has distance 0
    model.Add(reach_dist[FOYER_POS] == 0)

    for x in range(1, GRID_SIZE + 1):
        for y in range(1, GRID_SIZE + 1):
            pos = (x, y)

            if pos == FOYER_POS:
                continue

            # If not in temple, distance doesn't matter (but set to MAX for clarity)
            model.Add(reach_dist[pos] == MAX_DIST).OnlyEnforceIf(in_temple[pos].Not())

            # Collect possible connected neighbors
            neighbor_edges = []
            for nx, ny in get_neighbors(x, y):
                neighbor = (nx, ny)
                if neighbor in connected.get(pos, {}):
                    neighbor_edges.append((neighbor, connected[pos][neighbor]))

            # If no possible edges, cell can still be in temple if types can connect
            # (the solver will figure out if it's feasible based on room type assignments)

            # For each edge: if connected, my dist <= neighbor dist + 1
            for neighbor, edge_var in neighbor_edges:
                model.Add(reach_dist[pos] <= reach_dist[neighbor] + 1).OnlyEnforceIf(edge_var)

            # If in_temple, must have at least one active connection to a closer cell
            # This ensures the cell is actually reachable from FOYER
            if neighbor_edges:
                has_closer_neighbor = []
                for neighbor, edge_var in neighbor_edges:
                    # is_closer = edge is active AND neighbor has strictly lower reach_dist
                    is_closer = model.NewBoolVar(f'closer_{x}_{y}_{neighbor[0]}_{neighbor[1]}')

                    # neighbor_is_closer: reach_dist[neighbor] < reach_dist[pos]
                    neighbor_is_closer = model.NewBoolVar(f'nb_closer_{x}_{y}_{neighbor[0]}_{neighbor[1]}')
                    model.Add(reach_dist[neighbor] < reach_dist[pos]).OnlyEnforceIf(neighbor_is_closer)
                    model.Add(reach_dist[neighbor] >= reach_dist[pos]).OnlyEnforceIf(neighbor_is_closer.Not())

                    # is_closer = edge_var AND neighbor_is_closer
                    model.AddBoolAnd([edge_var, neighbor_is_closer]).OnlyEnforceIf(is_closer)
                    model.AddBoolOr([edge_var.Not(), neighbor_is_closer.Not()]).OnlyEnforceIf(is_closer.Not())
                    has_closer_neighbor.append(is_closer)

                # If in_temple, at least one neighbor must provide a path to FOYER
                model.Add(sum(has_closer_neighbor) >= 1).OnlyEnforceIf(in_temple[pos])

    # =========================================================================
    # NO SELF-ADJACENCY for certain room types (SPATIAL rule)
    # =========================================================================

    # Some room types cannot be adjacent to themselves (discovered from great temple)
    no_self_adj_indices = [ROOM_TYPE_TO_IDX.get(r) for r in NO_SELF_ADJACENCY if r in ROOM_TYPE_TO_IDX]

    processed_pairs = set()
    for x in range(1, GRID_SIZE + 1):
        for y in range(1, GRID_SIZE + 1):
            pos = (x, y)
            for nx, ny in get_neighbors(x, y):
                neighbor = (nx, ny)
                pair = tuple(sorted([pos, neighbor]))
                if pair in processed_pairs:
                    continue
                processed_pairs.add(pair)

                # For each no-self-adj room type, prevent both cells from being that type
                for room_idx in no_self_adj_indices:
                    if room_idx is None:
                        continue
                    # NOT (room_type[pos] == idx AND room_type[neighbor] == idx)
                    # Equivalent to: room_type[pos] != idx OR room_type[neighbor] != idx
                    is_type_a = model.NewBoolVar(f'nsa_a_{room_idx}_{x}_{y}_{nx}_{ny}')
                    is_type_b = model.NewBoolVar(f'nsa_b_{room_idx}_{x}_{y}_{nx}_{ny}')
                    model.Add(room_type[pos] == room_idx).OnlyEnforceIf(is_type_a)
                    model.Add(room_type[pos] != room_idx).OnlyEnforceIf(is_type_a.Not())
                    model.Add(room_type[neighbor] == room_idx).OnlyEnforceIf(is_type_b)
                    model.Add(room_type[neighbor] != room_idx).OnlyEnforceIf(is_type_b.Not())
                    # At most one can be this type (not both)
                    model.AddBoolOr([is_type_a.Not(), is_type_b.Not()])

    # =========================================================================
    # ARCHITECT CONNECTION LIMIT
    # =========================================================================

    # Architect must have exactly 1 neighbor in temple (single connection)
    architect_neighbors = get_neighbors(*architect_pos)
    architect_neighbor_in_temple = [in_temple[n] for n in architect_neighbors if n != FOYER_POS]

    # Count neighbors in temple (excluding architect itself being counted)
    model.Add(sum(in_temple[n] for n in architect_neighbors) == 1)

    # =========================================================================
    # MINIMUM REQUIREMENTS
    # =========================================================================

    # Count spymasters
    spymaster_idx = ROOM_TYPE_TO_IDX['SPYMASTER']
    spymaster_cells = []
    for x in range(1, GRID_SIZE + 1):
        for y in range(1, GRID_SIZE + 1):
            is_spy = model.NewBoolVar(f'is_spy_{x}_{y}')
            model.Add(room_type[(x, y)] == spymaster_idx).OnlyEnforceIf(is_spy)
            model.Add(room_type[(x, y)] != spymaster_idx).OnlyEnforceIf(is_spy.Not())
            spymaster_cells.append(is_spy)

    model.Add(sum(spymaster_cells) >= input_data.min_spymasters)

    # Count corruption chambers
    corruption_idx = ROOM_TYPE_TO_IDX['CORRUPTION_CHAMBER']
    corruption_cells = []
    for x in range(1, GRID_SIZE + 1):
        for y in range(1, GRID_SIZE + 1):
            is_corr = model.NewBoolVar(f'is_corr_{x}_{y}')
            model.Add(room_type[(x, y)] == corruption_idx).OnlyEnforceIf(is_corr)
            model.Add(room_type[(x, y)] != corruption_idx).OnlyEnforceIf(is_corr.Not())
            corruption_cells.append(is_corr)

    model.Add(sum(corruption_cells) >= input_data.min_corruption_chambers)

    # Max paths constraint
    path_cells = []
    for x in range(1, GRID_SIZE + 1):
        for y in range(1, GRID_SIZE + 1):
            # Skip fixed positions
            if (x, y) in (FOYER_POS, architect_pos):
                continue
            is_path = model.NewBoolVar(f'is_path_{x}_{y}')
            model.Add(room_type[(x, y)] == PATH_IDX).OnlyEnforceIf(is_path)
            model.Add(room_type[(x, y)] != PATH_IDX).OnlyEnforceIf(is_path.Not())
            path_cells.append(is_path)

    model.Add(sum(path_cells) <= input_data.max_paths)

    # =========================================================================
    # CHAIN CONFIGURATION CONSTRAINTS
    # =========================================================================
    # If chain configs are provided, enforce room type restrictions per chain.
    # Each chain is a set of connected rooms that must follow the chain's rules.

    if input_data.chains and len(input_data.chains) > 0:
        num_chains = len(input_data.chains)
        print(f"DEBUG: Applying {num_chains} chain configurations", flush=True)

        # Create chain assignment variable for each cell
        # chain_idx[pos] = which chain this cell belongs to (0 to num_chains-1, or num_chains for "any")
        chain_idx = {}
        for x in range(1, GRID_SIZE + 1):
            for y in range(1, GRID_SIZE + 1):
                pos = (x, y)
                if pos in (FOYER_POS, architect_pos):
                    continue
                chain_idx[pos] = model.NewIntVar(0, num_chains, f'chain_{x}_{y}')

        # CRITICAL: Connected cells must be in the same chain (except connections TO FOYER)
        # This ensures chains are physical branches, not just logical groupings
        for pos, neighbor, edge_var in all_edges:
            if pos not in chain_idx or neighbor not in chain_idx:
                continue
            # Only skip if one of the cells IS FOYER (the actual branch point)
            # NOT just "adjacent to FOYER"
            if pos == FOYER_POS or neighbor == FOYER_POS:
                continue  # Allow different chains only at FOYER itself
            # Both connected and in temple => same chain
            both_in_temple = model.NewBoolVar(f'both_temple_{pos}_{neighbor}')
            model.AddBoolAnd([in_temple[pos], in_temple[neighbor], edge_var]).OnlyEnforceIf(both_in_temple)
            model.AddBoolOr([in_temple[pos].Not(), in_temple[neighbor].Not(), edge_var.Not()]).OnlyEnforceIf(both_in_temple.Not())
            model.Add(chain_idx[pos] == chain_idx[neighbor]).OnlyEnforceIf(both_in_temple)

        print(f"DEBUG: Added chain connectivity constraints", flush=True)

        # For each chain, enforce room type constraints
        for c_idx, chain in enumerate(input_data.chains):
            chain_name = chain.get('name', f'Chain {c_idx + 1}')
            allowed_types = chain.get('roomTypes', [])
            room_counts = chain.get('roomCounts', {})
            starting_room = chain.get('startingRoom')

            # Get indices of allowed room types
            # If roomTypes is empty, allow ALL room types (no restriction)
            if not allowed_types:
                allowed_type_indices = set(range(len(ROOM_TYPES)))  # All types allowed
                print(f"DEBUG: Chain '{chain_name}' has no type restrictions (all allowed), counts: {room_counts}", flush=True)
            else:
                allowed_type_indices = set()
                for rt in allowed_types:
                    if rt in ROOM_TYPE_TO_IDX:
                        allowed_type_indices.add(ROOM_TYPE_TO_IDX[rt])
                # PATH is only allowed if explicitly in the list (not auto-added)
                print(f"DEBUG: Chain '{chain_name}' allows types: {allowed_types}, counts: {room_counts}", flush=True)

            # Track cells assigned to this chain for counting
            in_chain = {}
            for pos in chain_idx:
                in_chain[pos] = model.NewBoolVar(f'in_chain_{c_idx}_{pos[0]}_{pos[1]}')
                model.Add(chain_idx[pos] == c_idx).OnlyEnforceIf(in_chain[pos])
                model.Add(chain_idx[pos] != c_idx).OnlyEnforceIf(in_chain[pos].Not())

            # If a cell is in this chain, its room type must be allowed
            for pos in chain_idx:
                # Create boolean for "room type is allowed in this chain"
                type_allowed = model.NewBoolVar(f'type_allowed_{c_idx}_{pos[0]}_{pos[1]}')

                # type_allowed = room_type[pos] in allowed_type_indices OR room_type[pos] == EMPTY_IDX
                type_check_vars = []
                for allowed_idx in allowed_type_indices:
                    is_this_type = model.NewBoolVar(f'is_type_{allowed_idx}_{c_idx}_{pos[0]}_{pos[1]}')
                    model.Add(room_type[pos] == allowed_idx).OnlyEnforceIf(is_this_type)
                    model.Add(room_type[pos] != allowed_idx).OnlyEnforceIf(is_this_type.Not())
                    type_check_vars.append(is_this_type)

                # Also allow EMPTY (not in temple)
                is_empty = model.NewBoolVar(f'is_empty_c{c_idx}_{pos[0]}_{pos[1]}')
                model.Add(room_type[pos] == EMPTY_IDX).OnlyEnforceIf(is_empty)
                model.Add(room_type[pos] != EMPTY_IDX).OnlyEnforceIf(is_empty.Not())
                type_check_vars.append(is_empty)

                # type_allowed = OR of all type checks
                model.AddBoolOr(type_check_vars).OnlyEnforceIf(type_allowed)
                model.AddBoolAnd([v.Not() for v in type_check_vars]).OnlyEnforceIf(type_allowed.Not())

                # If in_chain AND in_temple, type must be allowed
                model.AddImplication(in_chain[pos], type_allowed).OnlyEnforceIf(in_temple[pos])

            # Enforce room count constraints for this chain
            for room_type_name, counts in room_counts.items():
                if room_type_name not in ROOM_TYPE_TO_IDX:
                    continue

                rt_idx = ROOM_TYPE_TO_IDX[room_type_name]
                min_count = counts.get('min', 0)
                max_count = counts.get('max', 999)

                # Count rooms of this type in this chain
                type_in_chain = []
                for pos in chain_idx:
                    is_type_in_chain = model.NewBoolVar(f'type_{room_type_name}_in_c{c_idx}_{pos[0]}_{pos[1]}')
                    # is_type_in_chain = in_chain[pos] AND room_type[pos] == rt_idx
                    is_this_type = model.NewBoolVar(f'is_{room_type_name}_{pos[0]}_{pos[1]}_c{c_idx}')
                    model.Add(room_type[pos] == rt_idx).OnlyEnforceIf(is_this_type)
                    model.Add(room_type[pos] != rt_idx).OnlyEnforceIf(is_this_type.Not())

                    model.AddBoolAnd([in_chain[pos], is_this_type]).OnlyEnforceIf(is_type_in_chain)
                    model.AddBoolOr([in_chain[pos].Not(), is_this_type.Not()]).OnlyEnforceIf(is_type_in_chain.Not())
                    type_in_chain.append(is_type_in_chain)

                # Apply min/max constraints
                if min_count > 0:
                    model.Add(sum(type_in_chain) >= min_count)
                if max_count < 999:
                    model.Add(sum(type_in_chain) <= max_count)

                print(f"DEBUG: Chain '{chain_name}' requires {min_count}-{max_count} {room_type_name}", flush=True)

            # Enforce starting room constraint: if specified, at least one room of that type
            # in this chain must be adjacent to FOYER (or adjacent to a PATH next to FOYER)
            if starting_room and starting_room in ROOM_TYPE_TO_IDX:
                start_rt_idx = ROOM_TYPE_TO_IDX[starting_room]
                print(f"DEBUG: Chain '{chain_name}' must start with {starting_room} adjacent to FOYER", flush=True)

                # Find cells adjacent to FOYER
                foyer_neighbors = get_neighbors(*FOYER_POS)

                # A valid start position is:
                # 1. Adjacent to FOYER directly, OR
                # 2. Adjacent to a PATH that's adjacent to FOYER
                valid_start_positions = []

                for pos in chain_idx:
                    # Check if this position could be a valid chain start
                    is_valid_start = model.NewBoolVar(f'valid_start_{c_idx}_{pos[0]}_{pos[1]}')

                    # Condition: in_chain AND room_type == starting_room AND (adjacent to FOYER OR adjacent to PATH near FOYER)
                    is_start_type = model.NewBoolVar(f'is_start_type_{c_idx}_{pos[0]}_{pos[1]}')
                    model.Add(room_type[pos] == start_rt_idx).OnlyEnforceIf(is_start_type)
                    model.Add(room_type[pos] != start_rt_idx).OnlyEnforceIf(is_start_type.Not())

                    # Check adjacency to FOYER
                    is_adjacent_to_foyer = pos in foyer_neighbors

                    # Check adjacency to a PATH that's adjacent to FOYER
                    adjacent_to_path_near_foyer_vars = []
                    for neighbor in get_neighbors(*pos):
                        if neighbor in foyer_neighbors and neighbor != FOYER_POS and neighbor in room_type:
                            # This neighbor is adjacent to FOYER - check if it's a PATH
                            neighbor_is_path = model.NewBoolVar(f'nb_path_{c_idx}_{pos[0]}_{pos[1]}_{neighbor[0]}_{neighbor[1]}')
                            model.Add(room_type[neighbor] == PATH_IDX).OnlyEnforceIf(neighbor_is_path)
                            model.Add(room_type[neighbor] != PATH_IDX).OnlyEnforceIf(neighbor_is_path.Not())
                            adjacent_to_path_near_foyer_vars.append(neighbor_is_path)

                    if is_adjacent_to_foyer:
                        # Directly adjacent to FOYER - valid if in_chain and correct type
                        model.AddBoolAnd([in_chain[pos], is_start_type]).OnlyEnforceIf(is_valid_start)
                        model.AddBoolOr([in_chain[pos].Not(), is_start_type.Not()]).OnlyEnforceIf(is_valid_start.Not())
                    elif adjacent_to_path_near_foyer_vars:
                        # Adjacent to a potential PATH near FOYER
                        has_path_neighbor = model.NewBoolVar(f'has_path_nb_{c_idx}_{pos[0]}_{pos[1]}')
                        model.AddBoolOr(adjacent_to_path_near_foyer_vars).OnlyEnforceIf(has_path_neighbor)
                        model.AddBoolAnd([v.Not() for v in adjacent_to_path_near_foyer_vars]).OnlyEnforceIf(has_path_neighbor.Not())

                        model.AddBoolAnd([in_chain[pos], is_start_type, has_path_neighbor]).OnlyEnforceIf(is_valid_start)
                        model.AddBoolOr([in_chain[pos].Not(), is_start_type.Not(), has_path_neighbor.Not()]).OnlyEnforceIf(is_valid_start.Not())
                    else:
                        # Not near FOYER at all
                        model.Add(is_valid_start == 0)

                    valid_start_positions.append(is_valid_start)

                # At least one valid start position must exist for this chain
                if valid_start_positions:
                    model.Add(sum(valid_start_positions) >= 1)

    # =========================================================================
    # SNAKE MODE: Penalize/limit rooms with many AUTO-CONNECTIONS (junctions)
    # =========================================================================
    # In the new model, connections are automatic based on room adjacency.
    # A "junction" is a room with 3+ connections.
    # We penalize junctions and optionally hard-limit connections per room.

    connection_counts = {}  # Track connection count per cell for penalty/limit

    if input_data.snake_mode:
        debug_conn_count = 0
        debug_edges_per_cell = {}
        for x in range(1, GRID_SIZE + 1):
            for y in range(1, GRID_SIZE + 1):
                pos = (x, y)

                # Skip fixed positions (they don't count for snake penalties)
                if pos in (FOYER_POS, architect_pos):
                    continue

                # Count connections for this cell
                conn_vars = []
                for neighbor in connected.get(pos, {}).keys():
                    conn_vars.append(connected[pos][neighbor])

                debug_edges_per_cell[pos] = len(conn_vars)

                if conn_vars:
                    num_connections = model.NewIntVar(0, 4, f'num_conn_{x}_{y}')
                    model.Add(num_connections == sum(conn_vars))
                    connection_counts[pos] = num_connections
                    debug_conn_count += 1

        print(f"DEBUG: snake_mode={input_data.snake_mode}, junction_penalty={input_data.junction_penalty}, max_neighbors={input_data.max_neighbors}", flush=True)
        print(f"DEBUG: Created {debug_conn_count} connection count variables, {len(all_edges)} edge variables", flush=True)

        # Debug: show cells with most potential edges
        cells_by_edges = sorted(debug_edges_per_cell.items(), key=lambda x: -x[1])[:5]
        print(f"DEBUG: Cells with most potential edges: {cells_by_edges}", flush=True)

    # =========================================================================
    # CHAIN BANS: Forbid specific A-B-C patterns (using auto-connections)
    # =========================================================================
    # Format: (A, B, C) means if B is between A and C with connections, it's invalid
    # We check: if room B at pos has connections to neighbors with types A and C

    for x in range(1, GRID_SIZE + 1):
        for y in range(1, GRID_SIZE + 1):
            pos = (x, y)

            # Get all neighbors that could be connected
            neighbors = list(connected.get(pos, {}).keys())
            if len(neighbors) < 2:
                continue

            # For each pair of neighbors
            for i, neighbor_a in enumerate(neighbors):
                for neighbor_c in neighbors[i+1:]:
                    conn_a = connected[pos][neighbor_a]
                    conn_c = connected[pos][neighbor_c]

                    # For each chain ban
                    for chain_a, chain_b, chain_c in CHAIN_BANS:
                        idx_a = ROOM_TYPE_TO_IDX.get(chain_a)
                        idx_b = ROOM_TYPE_TO_IDX.get(chain_b)
                        idx_c = ROOM_TYPE_TO_IDX.get(chain_c)
                        if idx_a is None or idx_b is None or idx_c is None:
                            continue

                        # Forbid: neighbor_a=A, pos=B, neighbor_c=C, both connected
                        # Use a boolean to check if this ban applies
                        is_banned_pattern = model.NewBoolVar(f'ban_{chain_a}_{chain_b}_{chain_c}_{x}_{y}_{neighbor_a}_{neighbor_c}')

                        # Pattern matches if: pos=B, neighbor_a=A, neighbor_c=C, both connections active
                        pos_is_b = model.NewBoolVar(f'pos_b_{x}_{y}_{chain_b}')
                        model.Add(room_type[pos] == idx_b).OnlyEnforceIf(pos_is_b)
                        model.Add(room_type[pos] != idx_b).OnlyEnforceIf(pos_is_b.Not())

                        na_is_a = model.NewBoolVar(f'na_a_{neighbor_a}_{chain_a}')
                        model.Add(room_type[neighbor_a] == idx_a).OnlyEnforceIf(na_is_a)
                        model.Add(room_type[neighbor_a] != idx_a).OnlyEnforceIf(na_is_a.Not())

                        nc_is_c = model.NewBoolVar(f'nc_c_{neighbor_c}_{chain_c}')
                        model.Add(room_type[neighbor_c] == idx_c).OnlyEnforceIf(nc_is_c)
                        model.Add(room_type[neighbor_c] != idx_c).OnlyEnforceIf(nc_is_c.Not())

                        # Pattern is banned if all conditions met
                        model.AddBoolAnd([pos_is_b, na_is_a, nc_is_c, conn_a, conn_c]).OnlyEnforceIf(is_banned_pattern)

                        # Forbid the pattern
                        model.Add(is_banned_pattern == 0)

                        # Also check reverse: neighbor_a=C, neighbor_c=A
                        if chain_a != chain_c:
                            is_banned_rev = model.NewBoolVar(f'banr_{chain_a}_{chain_b}_{chain_c}_{x}_{y}_{neighbor_a}_{neighbor_c}')

                            na_is_c = model.NewBoolVar(f'na_c_{neighbor_a}_{chain_c}')
                            model.Add(room_type[neighbor_a] == idx_c).OnlyEnforceIf(na_is_c)
                            model.Add(room_type[neighbor_a] != idx_c).OnlyEnforceIf(na_is_c.Not())

                            nc_is_a = model.NewBoolVar(f'nc_a_{neighbor_c}_{chain_a}')
                            model.Add(room_type[neighbor_c] == idx_a).OnlyEnforceIf(nc_is_a)
                            model.Add(room_type[neighbor_c] != idx_a).OnlyEnforceIf(nc_is_a.Not())

                            model.AddBoolAnd([pos_is_b, na_is_c, nc_is_a, conn_a, conn_c]).OnlyEnforceIf(is_banned_rev)
                            model.Add(is_banned_rev == 0)

    # =========================================================================
    # ADJACENCY LIMITS: Max count of specific adjacent room types
    # =========================================================================

    for room_type_name, limits in ADJACENCY_LIMITS.items():
        room_idx = ROOM_TYPE_TO_IDX.get(room_type_name)
        if room_idx is None:
            continue

        for adj_type_name, max_count in limits.items():
            adj_idx = ROOM_TYPE_TO_IDX.get(adj_type_name)
            if adj_idx is None:
                continue

            # For each cell, if it's room_type_name, count adjacent adj_type_name
            for x in range(1, GRID_SIZE + 1):
                for y in range(1, GRID_SIZE + 1):
                    pos = (x, y)

                    # Is this cell the room type with the limit?
                    is_limited_type = model.NewBoolVar(f'adj_limit_{room_type_name}_{x}_{y}')
                    model.Add(room_type[pos] == room_idx).OnlyEnforceIf(is_limited_type)
                    model.Add(room_type[pos] != room_idx).OnlyEnforceIf(is_limited_type.Not())

                    # Count neighbors of the adjacent type
                    neighbor_is_adj_type = []
                    for nx, ny in get_neighbors(x, y):
                        neighbor_pos = (nx, ny)
                        is_adj = model.NewBoolVar(f'adj_{room_type_name}_{adj_type_name}_{x}_{y}_{nx}_{ny}')
                        model.Add(room_type[neighbor_pos] == adj_idx).OnlyEnforceIf(is_adj)
                        model.Add(room_type[neighbor_pos] != adj_idx).OnlyEnforceIf(is_adj.Not())
                        neighbor_is_adj_type.append(is_adj)

                    # If this cell is the limited type, adjacent count must be <= max_count
                    if neighbor_is_adj_type:
                        model.Add(sum(neighbor_is_adj_type) <= max_count).OnlyEnforceIf(is_limited_type)

    # =========================================================================
    # GENERATOR REQUIRES PATH NEIGHBOR
    # =========================================================================

    for room_type_name in REQUIRES_PATH_NEIGHBOR:
        room_idx = ROOM_TYPE_TO_IDX.get(room_type_name)
        if room_idx is None:
            continue

        for x in range(1, GRID_SIZE + 1):
            for y in range(1, GRID_SIZE + 1):
                pos = (x, y)

                # Is this cell the room type that requires PATH?
                is_requires_path = model.NewBoolVar(f'req_path_{room_type_name}_{x}_{y}')
                model.Add(room_type[pos] == room_idx).OnlyEnforceIf(is_requires_path)
                model.Add(room_type[pos] != room_idx).OnlyEnforceIf(is_requires_path.Not())

                # At least one neighbor must be PATH
                neighbor_is_path = []
                for nx, ny in get_neighbors(x, y):
                    neighbor_pos = (nx, ny)
                    is_path_neighbor = model.NewBoolVar(f'path_neighbor_{room_type_name}_{x}_{y}_{nx}_{ny}')
                    model.Add(room_type[neighbor_pos] == PATH_IDX).OnlyEnforceIf(is_path_neighbor)
                    model.Add(room_type[neighbor_pos] != PATH_IDX).OnlyEnforceIf(is_path_neighbor.Not())
                    neighbor_is_path.append(is_path_neighbor)

                # If this cell requires PATH neighbor, at least one neighbor must be PATH
                if neighbor_is_path:
                    model.Add(sum(neighbor_is_path) >= 1).OnlyEnforceIf(is_requires_path)

    # =========================================================================
    # LINEAR CHAIN BAN: SPY-CMD cannot be in linear chain
    # =========================================================================
    # Rule: Spymaster cannot be in a linear chain with Commander
    # "Linear chain" means all intermediate nodes have exactly 2 connections
    # Branching (junction with 3+ connections) between them is allowed
    #
    # Implementation: For each cell, if it's between SPY and CMD (both adjacent),
    # it must have 3+ total connections (be a junction, not a linear link)
    #
    # If lazy_spy_cmd=True, skip this and validate post-solve instead

    spy_idx = ROOM_TYPE_TO_IDX.get('SPYMASTER')
    cmd_idx = ROOM_TYPE_TO_IDX.get('COMMANDER')

    if spy_idx is not None and cmd_idx is not None and not input_data.lazy_spy_cmd:
        # First: SPY and CMD cannot be directly adjacent
        for x in range(1, GRID_SIZE + 1):
            for y in range(1, GRID_SIZE + 1):
                pos = (x, y)
                for nx, ny in get_neighbors(x, y):
                    neighbor = (nx, ny)
                    if neighbor <= pos:  # Avoid duplicate constraints
                        continue

                    # Forbid SPY-CMD direct adjacency
                    pos_is_spy = model.NewBoolVar(f'spy_cmd_direct_{x}_{y}_{nx}_{ny}_spy')
                    pos_is_cmd = model.NewBoolVar(f'spy_cmd_direct_{x}_{y}_{nx}_{ny}_cmd')
                    nb_is_spy = model.NewBoolVar(f'spy_cmd_direct_{x}_{y}_{nx}_{ny}_nb_spy')
                    nb_is_cmd = model.NewBoolVar(f'spy_cmd_direct_{x}_{y}_{nx}_{ny}_nb_cmd')

                    model.Add(room_type[pos] == spy_idx).OnlyEnforceIf(pos_is_spy)
                    model.Add(room_type[pos] != spy_idx).OnlyEnforceIf(pos_is_spy.Not())
                    model.Add(room_type[pos] == cmd_idx).OnlyEnforceIf(pos_is_cmd)
                    model.Add(room_type[pos] != cmd_idx).OnlyEnforceIf(pos_is_cmd.Not())
                    model.Add(room_type[neighbor] == spy_idx).OnlyEnforceIf(nb_is_spy)
                    model.Add(room_type[neighbor] != spy_idx).OnlyEnforceIf(nb_is_spy.Not())
                    model.Add(room_type[neighbor] == cmd_idx).OnlyEnforceIf(nb_is_cmd)
                    model.Add(room_type[neighbor] != cmd_idx).OnlyEnforceIf(nb_is_cmd.Not())

                    # Forbid: pos=SPY and neighbor=CMD
                    spy_cmd_adjacent = model.NewBoolVar(f'spy_cmd_adj_{x}_{y}_{nx}_{ny}')
                    model.AddBoolAnd([pos_is_spy, nb_is_cmd]).OnlyEnforceIf(spy_cmd_adjacent)
                    model.AddBoolOr([pos_is_spy.Not(), nb_is_cmd.Not()]).OnlyEnforceIf(spy_cmd_adjacent.Not())
                    model.Add(spy_cmd_adjacent == 0)

                    # Forbid: pos=CMD and neighbor=SPY
                    cmd_spy_adjacent = model.NewBoolVar(f'cmd_spy_adj_{x}_{y}_{nx}_{ny}')
                    model.AddBoolAnd([pos_is_cmd, nb_is_spy]).OnlyEnforceIf(cmd_spy_adjacent)
                    model.AddBoolOr([pos_is_cmd.Not(), nb_is_spy.Not()]).OnlyEnforceIf(cmd_spy_adjacent.Not())
                    model.Add(cmd_spy_adjacent == 0)

        # Second: For SPY-X-CMD pattern (distance 2), X must be a junction (3+ connections)
        # This prevents linear chains like SPY-GARRISON-CMD
        for x in range(1, GRID_SIZE + 1):
            for y in range(1, GRID_SIZE + 1):
                pos = (x, y)
                neighbors = get_neighbors(x, y)

                if len(neighbors) < 2:
                    continue

                # Check if this cell (pos) is between a SPY and CMD
                for i, n1 in enumerate(neighbors):
                    for n2 in neighbors[i+1:]:
                        # Is n1 a SPY and n2 a CMD (or vice versa)?
                        n1_is_spy = model.NewBoolVar(f'linban_n1spy_{x}_{y}_{n1}_{n2}')
                        n1_is_cmd = model.NewBoolVar(f'linban_n1cmd_{x}_{y}_{n1}_{n2}')
                        n2_is_spy = model.NewBoolVar(f'linban_n2spy_{x}_{y}_{n1}_{n2}')
                        n2_is_cmd = model.NewBoolVar(f'linban_n2cmd_{x}_{y}_{n1}_{n2}')

                        model.Add(room_type[n1] == spy_idx).OnlyEnforceIf(n1_is_spy)
                        model.Add(room_type[n1] != spy_idx).OnlyEnforceIf(n1_is_spy.Not())
                        model.Add(room_type[n1] == cmd_idx).OnlyEnforceIf(n1_is_cmd)
                        model.Add(room_type[n1] != cmd_idx).OnlyEnforceIf(n1_is_cmd.Not())
                        model.Add(room_type[n2] == spy_idx).OnlyEnforceIf(n2_is_spy)
                        model.Add(room_type[n2] != spy_idx).OnlyEnforceIf(n2_is_spy.Not())
                        model.Add(room_type[n2] == cmd_idx).OnlyEnforceIf(n2_is_cmd)
                        model.Add(room_type[n2] != cmd_idx).OnlyEnforceIf(n2_is_cmd.Not())

                        # Pattern 1: n1=SPY, n2=CMD, both connected to pos
                        # Pattern 2: n1=CMD, n2=SPY, both connected to pos
                        # In either case, pos must have 3+ connections (be a junction)

                        conn_n1 = connected[pos].get(n1)
                        conn_n2 = connected[pos].get(n2)

                        if conn_n1 is None or conn_n2 is None:
                            continue

                        # Count total connections for this cell
                        total_connections = []
                        for neighbor in neighbors:
                            if neighbor in connected[pos]:
                                total_connections.append(connected[pos][neighbor])

                        if len(total_connections) < 3:
                            # Cell can have at most 2 connections, so it can never be a junction
                            # Just forbid the SPY-X-CMD pattern entirely for this cell
                            pattern1 = model.NewBoolVar(f'linban_p1_{x}_{y}_{n1}_{n2}')
                            model.AddBoolAnd([n1_is_spy, n2_is_cmd, conn_n1, conn_n2]).OnlyEnforceIf(pattern1)
                            model.Add(pattern1 == 0)

                            pattern2 = model.NewBoolVar(f'linban_p2_{x}_{y}_{n1}_{n2}')
                            model.AddBoolAnd([n1_is_cmd, n2_is_spy, conn_n1, conn_n2]).OnlyEnforceIf(pattern2)
                            model.Add(pattern2 == 0)
                        else:
                            # Cell can potentially be a junction - require 3+ connections if SPY-X-CMD
                            is_between_spy_cmd = model.NewBoolVar(f'linban_between_{x}_{y}_{n1}_{n2}')

                            # is_between if (n1=SPY,n2=CMD) OR (n1=CMD,n2=SPY), both connected
                            spy_cmd_pattern = model.NewBoolVar(f'linban_sc_{x}_{y}')
                            cmd_spy_pattern = model.NewBoolVar(f'linban_cs_{x}_{y}')
                            model.AddBoolAnd([n1_is_spy, n2_is_cmd, conn_n1, conn_n2]).OnlyEnforceIf(spy_cmd_pattern)
                            model.AddBoolOr([n1_is_spy.Not(), n2_is_cmd.Not(), conn_n1.Not(), conn_n2.Not()]).OnlyEnforceIf(spy_cmd_pattern.Not())
                            model.AddBoolAnd([n1_is_cmd, n2_is_spy, conn_n1, conn_n2]).OnlyEnforceIf(cmd_spy_pattern)
                            model.AddBoolOr([n1_is_cmd.Not(), n2_is_spy.Not(), conn_n1.Not(), conn_n2.Not()]).OnlyEnforceIf(cmd_spy_pattern.Not())

                            model.AddBoolOr([spy_cmd_pattern, cmd_spy_pattern]).OnlyEnforceIf(is_between_spy_cmd)
                            model.AddBoolAnd([spy_cmd_pattern.Not(), cmd_spy_pattern.Not()]).OnlyEnforceIf(is_between_spy_cmd.Not())

                            # If between SPY and CMD, must have 3+ total connections
                            model.Add(sum(total_connections) >= 3).OnlyEnforceIf(is_between_spy_cmd)

    # =========================================================================
    # UNIQUE ROOMS
    # =========================================================================

    for unique_room in UNIQUE_ROOMS:
        if unique_room in ROOM_TYPE_TO_IDX:
            idx = ROOM_TYPE_TO_IDX[unique_room]
            unique_cells = []
            for x in range(1, GRID_SIZE + 1):
                for y in range(1, GRID_SIZE + 1):
                    is_unique = model.NewBoolVar(f'is_{unique_room}_{x}_{y}')
                    model.Add(room_type[(x, y)] == idx).OnlyEnforceIf(is_unique)
                    model.Add(room_type[(x, y)] != idx).OnlyEnforceIf(is_unique.Not())
                    unique_cells.append(is_unique)
            model.Add(sum(unique_cells) <= 1)

    # =========================================================================
    # EXISTING ROOMS
    # =========================================================================

    # Track which cells have existing rooms
    existing_cells: Set[Tuple[int, int]] = set()

    for existing in input_data.existing_rooms:
        ex, ey = existing['x'], existing['y']
        etype = existing['type']
        etier = existing['tier']
        pos = (ex, ey)

        if etype in ROOM_TYPE_TO_IDX and pos != FOYER_POS and pos != architect_pos:
            existing_cells.add(pos)

            if input_data.lock_existing:
                # LOCKED mode: room MUST be included exactly as specified
                model.Add(room_type[pos] == ROOM_TYPE_TO_IDX[etype])
                model.Add(tier[pos] == etier)
                model.Add(in_temple[pos] == 1)
            else:
                # OPTIONAL mode: if included, must use this type/tier
                model.Add(room_type[pos] == ROOM_TYPE_TO_IDX[etype]).OnlyEnforceIf(in_temple[pos])
                model.Add(tier[pos] == etier).OnlyEnforceIf(in_temple[pos])

    for px, py in input_data.existing_paths:
        pos = (px, py)
        if pos != FOYER_POS and pos != architect_pos:
            existing_cells.add(pos)

            if input_data.lock_existing:
                model.Add(room_type[pos] == PATH_IDX)
                model.Add(tier[pos] == 1)
                model.Add(in_temple[pos] == 1)
            else:
                model.Add(room_type[pos] == PATH_IDX).OnlyEnforceIf(in_temple[pos])
                model.Add(tier[pos] == 1).OnlyEnforceIf(in_temple[pos])

    # =========================================================================
    # OBJECTIVE: MAXIMIZE TOTAL VALUE
    # =========================================================================

    # Value = sum over all cells of value(room_type, tier)
    # We'll create auxiliary variables for the value contribution of each cell

    # Get effective room values (custom or default)
    effective_room_values = input_data.get_room_values()

    cell_values = []
    for x in range(1, GRID_SIZE + 1):
        for y in range(1, GRID_SIZE + 1):
            pos = (x, y)

            # Skip fixed positions (Foyer, Architect, Atziri)
            if pos in (FOYER_POS, architect_pos):
                continue

            # Create value variable for this cell
            # Max possible value is max(room_values) * max_tier
            max_val = max(max(vals) for vals in effective_room_values.values())
            cell_val = model.NewIntVar(0, max_val, f'val_{x}_{y}')

            # Value depends on room_type and tier
            # We encode this as a table constraint
            value_tuples = []
            for rt_idx, rt_name in enumerate(ROOM_TYPES):
                for t in range(4):  # 0, 1, 2, 3
                    if rt_name == 'EMPTY' or t == 0:
                        value_tuples.append((rt_idx, t, 0))
                    elif rt_name in effective_room_values:
                        val = effective_room_values[rt_name][t - 1] if t >= 1 else 0
                        value_tuples.append((rt_idx, t, val))

            model.AddAllowedAssignments([room_type[pos], tier[pos], cell_val], value_tuples)
            cell_values.append(cell_val)

    total_value = model.NewIntVar(0, 100000, 'total_value')
    model.Add(total_value == sum(cell_values))

    # =========================================================================
    # SNAKE PENALTY: Penalize rooms with 3+ AUTO-CONNECTIONS (junctions)
    # This encourages thin, linear chains instead of dense interconnected layouts
    # =========================================================================

    junction_penalties = []

    max_neighbor_constraints_added = 0
    junction_vars_added = 0

    if input_data.snake_mode and (input_data.junction_penalty > 0 or input_data.max_neighbors < 4):
        print(f"DEBUG: Applying snake constraints - connection_counts has {len(connection_counts)} entries", flush=True)
        for pos, num_conn in connection_counts.items():
            # Junction penalty for 3+ auto-connections
            if input_data.junction_penalty > 0:
                is_junction = model.NewBoolVar(f'junction_{pos[0]}_{pos[1]}')
                model.Add(num_conn >= 3).OnlyEnforceIf(is_junction)
                model.Add(num_conn < 3).OnlyEnforceIf(is_junction.Not())
                junction_penalties.append(is_junction)
                junction_vars_added += 1

            # Hard limit on connections
            if input_data.max_neighbors < 4:
                model.Add(num_conn <= input_data.max_neighbors).OnlyEnforceIf(in_temple[pos])
                max_neighbor_constraints_added += 1

    print(f"DEBUG: Added {max_neighbor_constraints_added} max_neighbor constraints, {junction_vars_added} junction penalty vars", flush=True)

    total_junction_penalty = model.NewIntVar(0, 10000, 'junction_penalty')
    if junction_penalties:
        model.Add(total_junction_penalty == input_data.junction_penalty * sum(junction_penalties))
    else:
        model.Add(total_junction_penalty == 0)

    # =========================================================================
    # EMPTY PENALTY: Penalize empty cells to encourage filling the grid
    # =========================================================================

    total_empty_penalty = model.NewIntVar(0, 10000, 'empty_penalty')
    if input_data.empty_penalty > 0:
        # Count empty cells (cells not in temple, excluding FOYER and architect area)
        empty_cells = []
        architect_area = {architect_pos} | set(get_neighbors(*architect_pos))
        for x in range(1, GRID_SIZE + 1):
            for y in range(1, GRID_SIZE + 1):
                pos = (x, y)
                if pos == FOYER_POS or pos in architect_area:
                    continue  # Don't penalize FOYER or cells near architect
                is_empty = model.NewBoolVar(f'empty_{x}_{y}')
                model.Add(in_temple[pos] == 0).OnlyEnforceIf(is_empty)
                model.Add(in_temple[pos] == 1).OnlyEnforceIf(is_empty.Not())
                empty_cells.append(is_empty)
        model.Add(total_empty_penalty == input_data.empty_penalty * sum(empty_cells))
        print(f"DEBUG: Empty penalty {input_data.empty_penalty} applied to {len(empty_cells)} cells", flush=True)
    else:
        model.Add(total_empty_penalty == 0)

    # Maximize value minus penalties
    final_score = model.NewIntVar(-100000, 100000, 'final_score')
    model.Add(final_score == total_value - total_junction_penalty - total_empty_penalty)
    model.Maximize(final_score)

    # =========================================================================
    # SOLVE
    # =========================================================================

    # =========================================================================
    # APPLY ML HINTS (warm start)
    # =========================================================================
    if hints:
        hint_count = 0
        for hint in hints:
            pos = (hint['x'], hint['y'])
            if pos in in_temple and pos not in (FOYER_POS, architect_pos):
                # Hint that this cell should be in temple
                if hint.get('in_temple', True):
                    model.AddHint(in_temple[pos], 1)
                    hint_count += 1

                # Hint the room type if provided
                if 'type' in hint and pos in room_type:
                    type_idx = ROOM_TYPE_TO_IDX.get(hint['type'], 0)
                    if type_idx > 0:  # Don't hint EMPTY
                        model.AddHint(room_type[pos], type_idx)
        print(f"DEBUG: Applied {hint_count} ML hints")

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = input_data.max_time_seconds
    solver.parameters.num_search_workers = 4  # Match vCPU count, don't over-subscribe
    solver.parameters.log_search_progress = True
    solver.parameters.linearization_level = 2  # Better LP relaxation for tighter bounds
    solver.parameters.cp_model_presolve = True  # Aggressive presolve

    # Create solution callback if requested
    callback = None
    # Store chain_idx for solution extraction (will be None if no chains configured)
    chain_idx_vars = chain_idx if (input_data.chains and len(input_data.chains) > 0) else None
    chain_names = [c.get('name', f'Chain {i+1}') for i, c in enumerate(input_data.chains)] if input_data.chains else []

    if on_solution:
        callback_vars = {
            'total_value': total_value,
            'in_temple': in_temple,
            'room_type': room_type,
            'tier': tier,
            'connected': connected,  # Auto-connection edges
            'all_edges': all_edges,  # List of (pos, neighbor, edge_var)
            'architect_pos': architect_pos,
            'dir_offsets': DIR_OFFSETS,
            'chain_idx': chain_idx_vars,
            'chain_names': chain_names,
        }
        print(f"DEBUG: Creating callback with lazy_spy_cmd={input_data.lazy_spy_cmd}", flush=True)
        callback = SolutionCallback(callback_vars, on_solution, lazy_spy_cmd=input_data.lazy_spy_cmd)
        status = solver.Solve(model, callback)
        print(f"DEBUG: Solve complete. lazy_spy_cmd={input_data.lazy_spy_cmd}, rejected={callback.rejected_count}", flush=True)
        if input_data.lazy_spy_cmd and callback.rejected_count > 0:
            print(f"DEBUG: Lazy SPY-CMD rejected {callback.rejected_count} solutions")
    else:
        status = solver.Solve(model)

    # =========================================================================
    # EXTRACT SOLUTION
    # =========================================================================

    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        # If lazy_spy_cmd is enabled, use the callback's validated best_solution
        # instead of extracting from raw solver values
        if input_data.lazy_spy_cmd and on_solution and callback.best_solution:
            validated = callback.best_solution
            # Convert room format from callback (x,y) to expected format
            rooms = []
            for r in validated['rooms']:
                room_data = {
                    'type': r['type'],
                    'tier': r['tier'],
                    'x': r['x'],
                    'y': r['y']
                }
                if 'chain' in r:
                    room_data['chain'] = r['chain']
                rooms.append(room_data)

            paths = validated.get('paths', [])
            edges = validated.get('edges', [])

            # Double-check SPY-CMD validation on final result
            final_valid, final_violation = validate_spy_cmd_constraint(rooms, edges)
            if not final_valid:
                print(f"WARNING: Final result failed SPY-CMD validation! Violation: {final_violation}")

            # Track excluded rooms
            included_positions = {(r['x'], r['y']) for r in rooms}
            included_positions.update({(p['x'], p['y']) for p in paths})
            excluded = []
            for existing in input_data.existing_rooms:
                pos = (existing['x'], existing['y'])
                if pos not in included_positions and pos not in (FOYER_POS, architect_pos):
                    excluded.append(existing)

            return SolverOutput(
                success=True,
                optimal=(status == cp_model.OPTIMAL),
                score=validated['score'],
                rooms=rooms,
                paths=paths,
                edges=edges,
                stats={
                    'status': solver.StatusName(status),
                    'time_seconds': solver.WallTime(),
                    'branches': solver.NumBranches(),
                    'conflicts': solver.NumConflicts(),
                    'lazy_rejected': callback.rejected_count,
                    'spy_cmd_valid': final_valid,
                    'spy_cmd_violation': str(final_violation) if final_violation else None,
                },
                excluded_rooms=excluded if excluded else None,
                chain_names=chain_names if chain_names else None
            )

        # Standard extraction from solver values
        rooms = []
        paths = []
        included_positions = set()

        for x in range(1, GRID_SIZE + 1):
            for y in range(1, GRID_SIZE + 1):
                pos = (x, y)

                # Skip fixed positions
                if pos in (FOYER_POS, architect_pos):
                    continue

                if solver.Value(in_temple[pos]):
                    included_positions.add(pos)
                    rt_idx = solver.Value(room_type[pos])
                    rt_name = ROOM_TYPES[rt_idx]
                    t = solver.Value(tier[pos])

                    # Get chain assignment if available
                    chain = None
                    if chain_idx_vars and pos in chain_idx_vars:
                        chain = solver.Value(chain_idx_vars[pos])

                    if rt_name == 'PATH':
                        path_data = {'x': x, 'y': y}
                        if chain is not None:
                            path_data['chain'] = chain
                        paths.append(path_data)
                    elif rt_name != 'EMPTY':
                        room_data = {
                            'type': rt_name,
                            'tier': t,
                            'x': x,
                            'y': y
                        }
                        if chain is not None:
                            room_data['chain'] = chain
                        rooms.append(room_data)

        # Track which existing rooms were excluded
        excluded = []
        for existing in input_data.existing_rooms:
            pos = (existing['x'], existing['y'])
            if pos not in included_positions and pos not in (FOYER_POS, architect_pos):
                excluded.append(existing)

        # Extract auto-connection edges
        edges = []
        for pos_a, pos_b, edge_var in all_edges:
            if solver.Value(edge_var):
                edges.append({
                    'from': {'x': pos_a[0], 'y': pos_a[1]},
                    'to': {'x': pos_b[0], 'y': pos_b[1]}
                })

        # Always validate SPY-CMD constraint on final result
        spy_cmd_valid, spy_cmd_violation = validate_spy_cmd_constraint(rooms, edges)
        if not spy_cmd_valid:
            print(f"WARNING: Final result has SPY after CMD! Violation: {spy_cmd_violation}", flush=True)

        return SolverOutput(
            success=True,
            optimal=(status == cp_model.OPTIMAL),
            score=solver.Value(total_value),
            rooms=rooms,
            paths=paths,
            edges=edges,
            stats={
                'status': solver.StatusName(status),
                'time_seconds': solver.WallTime(),
                'branches': solver.NumBranches(),
                'conflicts': solver.NumConflicts(),
                'spy_cmd_valid': spy_cmd_valid,
                'spy_cmd_violation': str(spy_cmd_violation) if spy_cmd_violation else None,
            },
            excluded_rooms=excluded if excluded else None,
            chain_names=chain_names if chain_names else None
        )
    else:
        # Build error message with diagnostics
        error_parts = [f"Solver status: {solver.StatusName(status)}"]

        if status == cp_model.INFEASIBLE:
            error_parts.append("\nNo valid temple layout exists with these constraints.")
            if diagnostic_hints:
                error_parts.append("\nPossible issues:")
                for hint in diagnostic_hints:
                    error_parts.append(f"\n  • {hint}")
            else:
                error_parts.append("\nTry: reducing min_spymasters/min_corruption_chambers, increasing max_paths, or disabling snake_mode.")
        elif status == cp_model.UNKNOWN:
            error_parts.append("\nSolver timed out before finding a solution.")
            if diagnostic_hints:
                error_parts.append("\nPotential constraint issues:")
                for hint in diagnostic_hints:
                    error_parts.append(f"\n  • {hint}")
            error_parts.append(f"\nTry: increasing max_time_seconds (current: {input_data.max_time_seconds}s), relaxing min_spymasters/min_corruption_chambers, or increasing max_paths.")

        return SolverOutput(
            success=False,
            optimal=False,
            score=0,
            rooms=[],
            paths=[],
            edges=[],
            stats={
                'status': solver.StatusName(status),
                'time_seconds': solver.WallTime(),
                'diagnostic_hints': diagnostic_hints,
            },
            error=''.join(error_parts)
        )


# =============================================================================
# CLI INTERFACE
# =============================================================================

def main():
    """Read JSON from stdin, solve, write JSON to stdout."""

    if len(sys.argv) > 1 and sys.argv[1] == '--help':
        print("""
Temple Solver - OR-Tools CP-SAT

Usage: echo '{"architect": [7, 4]}' | python temple_solver.py

Input JSON:
{
    "architect": [x, y],           // Required: architect position
    "min_spymasters": 8,           // Optional: default 8
    "min_corruption_chambers": 6,  // Optional: default 6
    "max_time_seconds": 60,        // Optional: default 60
    "existing_rooms": [            // Optional: pre-placed rooms
        {"type": "GARRISON", "tier": 3, "x": 5, "y": 2}
    ],
    "existing_paths": [[4, 2]]     // Optional: pre-placed paths
}

Output JSON:
{
    "success": true,
    "optimal": true,
    "score": 1234,
    "rooms": [...],
    "paths": [...],
    "stats": {...}
}
        """)
        return

    # Read input
    try:
        input_json = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(json.dumps({"success": False, "error": f"Invalid JSON: {e}"}))
        sys.exit(1)

    # Parse input
    try:
        architect = tuple(input_json['architect'])

        solver_input = SolverInput(
            architect_pos=architect,
            min_spymasters=input_json.get('min_spymasters', 8),
            min_corruption_chambers=input_json.get('min_corruption_chambers', 6),
            max_time_seconds=input_json.get('max_time_seconds', 60),
            existing_rooms=input_json.get('existing_rooms', []),
            existing_paths=[tuple(p) for p in input_json.get('existing_paths', [])],
            lock_existing=input_json.get('lock_existing', True),  # Default: game mode (rooms can't be removed)
        )
    except KeyError as e:
        print(json.dumps({"success": False, "error": f"Missing required field: {e}"}))
        sys.exit(1)

    # Solve
    result = solve_temple(solver_input)

    # Output
    output = {
        "success": result.success,
        "optimal": result.optimal,
        "score": result.score,
        "rooms": result.rooms,
        "paths": [{"x": p["x"], "y": p["y"]} if isinstance(p, dict) else {"x": p[0], "y": p[1]} for p in result.paths],
        "stats": result.stats,
    }
    if result.error:
        output["error"] = result.error
    if result.excluded_rooms:
        output["excluded_rooms"] = result.excluded_rooms

    print(json.dumps(output, indent=2))


if __name__ == '__main__':
    main()
