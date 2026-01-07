#!/usr/bin/env python3
"""
Test suite to analyze working temples and validate our constraint rules.
Uses the "great" temple as ground truth.
"""

import base64
from typing import Dict, List, Set, Tuple
from collections import defaultdict

# Sulozor room index mapping
SULOZOR_ROOM_INDEX = {
    0: 'EMPTY', 1: 'PATH', 2: 'GARRISON', 3: 'LEGION_BARRACKS', 4: 'LEGION_BARRACKS',
    5: 'COMMANDER', 6: 'ARMOURY', 7: 'SMITHY', 8: 'GENERATOR', 9: 'SPYMASTER',
    10: 'SYNTHFLESH', 11: 'FLESH_SURGEON', 12: 'GOLEM_WORKS', 13: 'ALCHEMY_LAB',
    14: 'THAUMATURGE', 15: 'CORRUPTION_CHAMBER', 16: 'SACRIFICIAL_CHAMBER',
    17: 'EMPTY', 18: 'EMPTY', 19: 'ARCHITECT', 20: 'SACRIFICIAL_CHAMBER',
}

def decode_sulozor_url(encoded: str) -> Tuple[Dict[Tuple[int,int], str], Tuple[int,int]]:
    """Decode Sulozor URL and return room map and architect position."""
    # Base64URL decode
    encoded = encoded.replace('-', '+').replace('_', '/')
    padding = 4 - len(encoded) % 4
    if padding != 4:
        encoded += '=' * padding

    try:
        data = base64.b64decode(encoded)
    except:
        # Try without padding fixes
        encoded = encoded.rstrip('=')
        encoded = encoded.replace('-', '+').replace('_', '/')
        data = base64.b64decode(encoded + '==')

    rooms = {}
    architect_pos = (5, 5)

    # Skip version byte, read 81 cell bytes
    for i in range(81):
        byte = data[1 + i] if 1 + i < len(data) else 0
        room_idx = (byte >> 3) & 0x1f
        tier = (byte & 0x7) + 1

        y = 9 - (i // 9)
        x = (i % 9) + 1

        room_type = SULOZOR_ROOM_INDEX.get(room_idx, 'EMPTY')

        if room_type == 'ARCHITECT':
            architect_pos = (x, y)
        elif room_type not in ('EMPTY', 'PATH'):
            rooms[(x, y)] = room_type
        elif room_type == 'PATH':
            rooms[(x, y)] = 'PATH'

    return rooms, architect_pos


def get_neighbors(x: int, y: int) -> List[Tuple[int, int]]:
    """Get valid grid neighbors."""
    neighbors = []
    for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
        nx, ny = x + dx, y + dy
        if 1 <= nx <= 9 and 1 <= ny <= 9:
            neighbors.append((nx, ny))
    return neighbors


def analyze_temple(name: str, encoded: str):
    """Analyze a temple and extract all rules."""
    print(f"\n{'='*60}")
    print(f"Analyzing: {name}")
    print(f"{'='*60}")

    rooms, architect_pos = decode_sulozor_url(encoded)

    # Add special positions
    rooms[(5, 1)] = 'FOYER'
    rooms[architect_pos] = 'ARCHITECT'

    # Count room types
    type_counts = defaultdict(int)
    for pos, rtype in rooms.items():
        if rtype not in ('FOYER', 'ARCHITECT', 'PATH'):
            type_counts[rtype] += 1

    print(f"\nArchitect position: {architect_pos}")
    print(f"Total rooms: {sum(type_counts.values())}")
    print(f"Paths: {sum(1 for r in rooms.values() if r == 'PATH')}")

    print("\nRoom counts:")
    for rtype in sorted(type_counts.keys()):
        print(f"  {rtype}: {type_counts[rtype]}")

    # Analyze adjacencies
    print("\n--- ADJACENCY ANALYSIS ---")

    adjacencies = defaultdict(set)  # type -> set of adjacent types
    same_type_adj = defaultdict(int)  # type -> count of same-type adjacencies

    for (x, y), rtype in rooms.items():
        for nx, ny in get_neighbors(x, y):
            if (nx, ny) in rooms:
                ntype = rooms[(nx, ny)]
                adjacencies[rtype].add(ntype)
                if rtype == ntype:
                    same_type_adj[rtype] += 1

    print("\nEach room type is adjacent to:")
    for rtype in sorted(adjacencies.keys()):
        adj_list = sorted(adjacencies[rtype])
        print(f"  {rtype}: {', '.join(adj_list)}")

    print("\nSame-type adjacencies (edges):")
    for rtype in sorted(same_type_adj.keys()):
        print(f"  {rtype}: {same_type_adj[rtype] // 2} edges")

    print("\nTypes with NO same-type adjacency:")
    all_types = set(rooms.values()) - {'FOYER', 'ARCHITECT', 'PATH'}
    for rtype in sorted(all_types):
        if same_type_adj[rtype] == 0:
            print(f"  {rtype}")

    # Check REQUIRED_PARENTS rules
    print("\n--- REQUIRED_PARENTS VALIDATION ---")

    REQUIRED_PARENTS = {
        'SPYMASTER': ['GARRISON', 'LEGION_BARRACKS'],
        'GOLEM_WORKS': ['SMITHY'],
        'THAUMATURGE': ['GENERATOR', 'ALCHEMY_LAB', 'CORRUPTION_CHAMBER', 'SACRIFICIAL_CHAMBER'],
    }

    for child_type, valid_parents in REQUIRED_PARENTS.items():
        positions = [(x, y) for (x, y), t in rooms.items() if t == child_type]
        for x, y in positions:
            neighbor_types = [rooms.get((nx, ny)) for nx, ny in get_neighbors(x, y)]
            neighbor_types = [t for t in neighbor_types if t]
            has_valid = any(t in valid_parents for t in neighbor_types)
            status = "OK" if has_valid else "FAIL"
            print(f"  {child_type} at ({x},{y}): neighbors={neighbor_types} -> {status}")

    return rooms, adjacencies, same_type_adj


# Great temple URL
GREAT_TEMPLE = "A0oiSiJKIkkiSSJ6cWoyEioSIklxMmkyEioqSiJ6OgCYABISIklxYWEAEioqSiJ6OjoyMjoSIklyYjppMmIqSiKCemJ5EioSIjJqcToIenFqMkABBAAQAEBAAf-7b7_-vv0_bO8B"

if __name__ == "__main__":
    analyze_temple("Great Temple", GREAT_TEMPLE)

    print("\n" + "="*60)
    print("CONCLUSIONS")
    print("="*60)
    print("""
Based on the great temple analysis:

1. REQUIRED_PARENTS rules seem correct:
   - SPYMASTER needs GARRISON or LEGION_BARRACKS adjacent
   - GOLEM_WORKS needs SMITHY adjacent
   - THAUMATURGE needs GENERATOR/ALCHEMY_LAB/CORRUPTION_CHAMBER/SACRIFICIAL_CHAMBER adjacent

2. Same-type adjacency rules to discover:
   - Which room types can be adjacent to themselves?
   - Which cannot?

3. General adjacency patterns:
   - What combinations are valid/invalid?
""")
