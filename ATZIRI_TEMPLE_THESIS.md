# The Temple of Atziri: A Comprehensive Analysis of POE 2's Emergent Dungeon-Building System

## Abstract

The Temple of Atziri represents Path of Exile 2's most complex emergent gameplay system introduced in the "Fate of the Vaal" league (Patch 0.4.0). This document provides a thesis-level analysis of the temple mechanics, strategic optimization approaches, and the mathematical constraints governing optimal layout construction. Particular attention is given to the "snake chain" methodology, destabilization mechanics, and the specific optimization problem of maximizing Spymaster and Corruption Chamber placement while maintaining linear pathing through a fixed Architect position.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Foundational Mechanics](#2-foundational-mechanics)
3. [The 9x9 Grid System](#3-the-9x9-grid-system)
4. [Room Taxonomy and Upgrade Synergies](#4-room-taxonomy-and-upgrade-synergies)
5. [Destabilization Theory](#5-destabilization-theory)
6. [The Snake Chain Methodology](#6-the-snake-chain-methodology)
7. [Spymaster Mechanics and Self-Sustaining Locks](#7-spymaster-mechanics-and-self-sustaining-locks)
8. [Architect Positioning Strategy](#8-architect-positioning-strategy)
9. [The Optimization Problem](#9-the-optimization-problem)
10. [Constraint Satisfaction Approach](#10-constraint-satisfaction-approach)
11. [Conclusions](#11-conclusions)
12. [References](#12-references)

---

## 1. Introduction

The Temple of Atziri is a dungeon-building roguelike subsystem where players construct a custom temple layout on a grid, placing rooms and paths strategically to maximize rewards while managing entropy through destabilization mechanics. Unlike traditional dungeon crawlers, the temple persists across runs, decaying and regenerating according to complex rules that reward strategic planning over reactive play.

The system presents a fascinating optimization problem: players must balance immediate reward acquisition against long-term temple stability, room upgrade synergies against placement constraints, and linear pathing requirements against the desire for room density.

### 1.1 Historical Context

The Temple of Atziri draws inspiration from Path of Exile 1's Incursion league mechanic, but introduces substantially more complex adjacency rules, the concept of persistent destabilization, and the novel "snake chain" protection paradigm that fundamentally changes optimal play patterns.

### 1.2 Scope of Analysis

This thesis covers:
- Core mechanical systems and their mathematical properties
- Strategic frameworks for optimal temple construction
- The specific constraint satisfaction problem of building an optimized layout
- Practical application to real-world optimization scenarios

---

## 2. Foundational Mechanics

### 2.1 Unlocking the Temple

Before temple construction begins, players must:

1. **Activate 6 Vaal Beacons** scattered throughout Wraeclast
2. Beacons appear in campaign areas (minimum level 10 below character level)
3. After level 86+, beacons exclusively spawn in maps
4. Beacons are energized by defeating nearby monsters, then approaching them

### 2.2 The Temple Console

The Temple Console serves as the primary interface for layout construction:

- Located in Vaal Ruins after beacon activation
- Each interaction generates **6 Room Cards** for placement
- Approximately **50% of cards are Paths** (traversal-only tiles)
- Cards can be saved (up to 60 via Xopec's Medallions) for strategic deployment

### 2.3 Temple Lifecycle

```
[Beacon Collection] → [Console Interaction] → [Card Placement] →
[Temple Entry] → [Room Clearing] → [Boss Optional] → [Temple Close] →
[Destabilization] → [Repeat]
```

The temple persists between runs, with each cycle potentially adding new rooms while destabilization removes existing ones.

---

## 3. The 9x9 Grid System

### 3.1 Grid Structure

The Temple of Atziri operates on a **9x9 grid** with fixed anchor points:

```
         [Col 1][Col 2][Col 3][Col 4][Col 5][Col 6][Col 7][Col 8][Col 9]
[Row 9]  |  .  |  .  |  .  |  .  | ATZ |  .  |  .  |  .  |  .  |  ← Atziri's Chamber (fixed)
[Row 8]  |  .  |  .  |  .  |  .  |  .  |  .  |  .  |  .  |  .  |
[Row 7]  |  .  |  .  |  .  |  .  |  .  |  .  |  .  |  .  |  .  |
[Row 6]  |  .  |  .  |  .  |  .  |  .  |  .  |  .  |  .  |  .  |
[Row 5]  |  .  |  .  |  .  |  .  |  .  |  .  |  .  |  .  |  .  |
[Row 4]  |  .  |  .  |  .  |  .  |  .  |  .  |  .  |  .  |  .  |
[Row 3]  |  .  |  .  |  .  |  .  |  .  |  .  |  .  |  .  |  .  |
[Row 2]  |  .  |  .  |  .  |  .  |  .  |  .  |  .  |  .  |  .  |
[Row 1]  |  .  |  .  |  .  |  .  | FOY |  .  |  .  |  .  |  .  |  ← Foyer (fixed entrance)
```

**Key Properties:**
- **Foyer**: Fixed at position (5, 1) - the temple entrance
- **Atziri's Chamber**: Fixed at position (5, 9) - the final boss location
- **Architect's Chamber**: Spawns randomly, typically in the far half of the grid

### 3.2 Coordinate System

Based on the Sulozor planner tool encoding, coordinates appear to follow an (x, y) convention:
- **x**: Column position (1-9, left to right)
- **y**: Row position (1-9, bottom to top)

The Foyer at (5, 1) has **3 exits** available for initial path branching.

### 3.3 Connection Rules

Rooms connect according to strict adjacency rules:

1. **Paths** connect automatically to any adjacent Path or Room
2. **Rooms** connect only to adjacent rooms they have upgrade interactions with
3. Paths come in 2-way, 3-way, and 4-way variants
4. A room is **connected** if a continuous path exists from Foyer to that room
5. **Disconnected rooms are removed** during destabilization

---

## 4. Room Taxonomy and Upgrade Synergies

### 4.1 Room Categories

Rooms fall into distinct functional categories:

#### 4.1.1 Monster Enhancement Rooms

| Room Line | Tier 1 | Tier 2 | Tier 3 | Primary Effect |
|-----------|--------|--------|--------|----------------|
| Garrison | Guardhouse | Barracks | Hall of War | Pack size + normal monster effectiveness |
| Commander | Commander's Chamber | Commander's Hall | Commander's HQ | Rare monster effectiveness |
| Legion | Legion Barracks | Viper's Loyals | Elite Legion | Magic/rare monster spawning |

#### 4.1.2 Equipment & Crafting Rooms

| Room Line | Tier 1 | Tier 2 | Tier 3 | Primary Effect |
|-----------|--------|--------|--------|----------------|
| Armoury | Armoury Depot | Armoury Arsenal | Armoury Gallery | Humanoid effectiveness + equipment |
| Smithy | Bronzeworks | Chamber of Iron | Golden Forge | Chest rarity + quality crafting |
| Alchemy Lab | Chamber of Souls | Core Machinarium | Grand Phylactory | Item rarity + gold |

#### 4.1.3 Corruption & Sacrifice Rooms

| Room Line | Tier 1 | Tier 2 | Tier 3 | Primary Effect |
|-----------|--------|--------|--------|----------------|
| Corruption Chamber | Crimson Hall | Catalyst of Corruption | Locus of Corruption | Extra modifiers on rares |
| Sacrificial Chamber | Sealed Vault | Altar of Sacrifice | Apex of Oblation | Currency + Vaal Cultivation Orb |
| Thaumaturge | Laboratory | Cuttery | Cathedral | Gem corruption |

#### 4.1.4 Support Rooms

| Room Line | Tier 1 | Tier 2 | Tier 3 | Primary Effect |
|-----------|--------|--------|--------|----------------|
| Generator | Dynamo | Shrine of Empowerment | Solar Nexus | Construct effectiveness (powers other rooms) |
| Spymaster | Spymaster's Study | Hall of Shadows | Omnipresent Panopticon | Effect multiplier + medallion drops |
| Golem Works | Workshop | Automaton Lab | Stone Legion | Generator/Synthflesh synergy |

### 4.2 Upgrade Synergy Matrix

Rooms upgrade when placed adjacent to specific other rooms:

```
Garrison ←[upgrades]← Commander + Armoury
Armoury ←[upgrades]← Smithy + Alchemy Lab
Smithy ←[upgrades]← Golem Works
Commander ←[upgrades]← 3x Garrison + 3x Transcendent Barracks
Thaumaturge ←[upgrades]← Sacrificial Chamber + Generator
Synthflesh ←[upgrades]← Flesh Surgeon
Legion Barracks ←[upgrades]← Armoury + Spymaster
```

**Critical Insight**: Synergy connections display as a **brighter green outline** with corner squares in the grid UI.

### 4.3 Connection Restrictions

Each room type has specific placement constraints:

- **Garrison** → Can connect to: Path, Commander, Armoury, Synth Lab, Spymaster
- **Spymaster** → Can connect to: Garrison (primarily)
- **Commander** → Can connect to: Garrison, Armoury
- **Armoury** → Can connect to: Garrison, Commander, Alchemy Lab, Thaumaturge
- **Alchemy Lab** → Can connect to: Armoury, Thaumaturge, Corruption Chamber

**Known Bug/Design**: Spymaster cannot be placed after Commander in a linear chain, but Commander can be placed after Spymaster.

---

## 5. Destabilization Theory

### 5.1 The Entropy Model

The temple operates under an entropy model where rooms progressively destabilize unless protected. Destabilization occurs at temple close with intensity varying by player actions:

| Event | Destabilization Rate | Effect |
|-------|---------------------|--------|
| Normal Close | ~10% of temple | Random room removal |
| After Xipocado | ~30% of temple | Many rooms removed, Architect position randomized |
| After Atziri | ~60-80% of temple | Most paths and non-reward rooms removed |

### 5.2 Destabilization Targeting

Destabilization follows a **chain-end-first** algorithm:

1. System identifies all "loose" unprotected rooms
2. Removal begins from rooms **furthest from the Foyer**
3. Rooms in a linear chain are removed from the tip backward
4. Protected (locked) rooms block the removal cascade

```
[Foyer] → [A] → [B] → [C] → [D] → [E(unlocked)]
                                    ↑
                          Destabilization starts here
```

### 5.3 Protection Mechanisms

#### 5.3.1 Juatalotli's Medallion

The primary protection currency:
- Prevents destabilization of one room
- **Post-patch 0.4.0c requirement**: Only applies to Tier 3 rooms
- Dropped by Spymaster rooms
- Can be accumulated (up to 60 beacon charges)

#### 5.3.2 Chain Protection

Locking the **tip** of a chain protects all preceding rooms:

```
[Foyer] → [A] → [B] → [C] → [LOCKED D]
          ↑       ↑       ↑      ↑
       protected protected protected locked
```

#### 5.3.3 Filler Room Strategy

Place expendable rooms in the center to give the system "something to eat":

```
[Foyer] → [Value] → [Filler] → [Filler] → [LOCKED Tip]
                       ↑           ↑
              Destabilizes first, protecting value
```

---

## 6. The Snake Chain Methodology

### 6.1 Core Concept

The "snake chain" is the dominant strategy for stable temple construction. Rather than building a dense cluster, players construct a single **long linear path** from the Foyer:

```
[Foyer] → [Path] → [Room] → [Room] → [Path] → [Room] → [LOCK]
   ↓
 No branches, no loops, single thread
```

### 6.2 Critical Rules

1. **Never Loop**: Closing a chain (creating a cycle) causes total collapse
2. **Avoid Squares**: Square formations can delete locked sections
3. **Lock the Tip**: Decay only nibbles the chain end
4. **Minimize Paths**: Reward rooms > path tiles; optimize for room density
5. **Single Thread**: One (or at most two) chains from the entrance

### 6.3 Optimal Snake Pattern

The recommended room sequence:

```
Garrison → Spymaster → Garrison → Spymaster → Garrison → Armory →
Alchemy Lab → Thaumaturge → Corruption Chamber → [repeat pattern]
```

**Rationale**:
- Early Garrisons provide buffer and monster density
- Spymasters generate medallions for self-sustaining locks
- Armory/Alchemy Lab provide upgrade synergy
- Corruption Chambers placed deeper (protected by chain length)

### 6.4 Post-Nerf Considerations

Patch 0.4.0c changed the medallion lock requirement:
- **Pre-patch**: Any room could be locked
- **Post-patch**: Only Tier 3 rooms can be locked

This dramatically increases the difficulty of maintaining snake chains, requiring:
- More aggressive early Spymaster farming
- Focus on rooms with natural T3 upgrade paths
- Strategic "assassin" use of Spymaster mechanics

---

## 7. Spymaster Mechanics and Self-Sustaining Locks

### 7.1 The Assassin Mechanic

Spymasters have a unique upgrade system:

> When two or more Spymasters are placed anywhere in a temple when opened, one destabilizable Spymaster is "assassinated" (room empties, auto-completes on entry), upgrading another Spymaster by 1 tier.

**Implications**:
1. Multiple Spymasters naturally tier up without adjacency requirements
2. Sacrifice one Spymaster to upgrade another
3. Creates self-sustaining medallion generation

### 7.2 Medallion Farming

Each Spymaster room drops **Juatalotli's Medallions**, enabling:
- Chain protection (tier 3 locks)
- Energy storage (up to 60 charges)
- Run sustainability

**Target**: 6-8 Spymasters in a temple for self-sustaining lock generation.

### 7.3 Placement Constraint

**Critical Bug/Feature**:
- Spymaster **cannot** be placed after Commander in a chain
- Commander **can** be placed after Spymaster

**Strategy**: Frontload Spymasters, introduce Commanders late:

```
[Foyer] → [Spy] → [Spy] → [Spy] → [Commander] → [Garrison] → ...
            ↑                        ↑
     Medallion farm            Block further Spies
```

---

## 8. Architect Positioning Strategy

### 8.1 The Architect's Chamber

The Architect's Chamber is a unique gateway room:

- Spawns **randomly** on the grid (typically far half of temple)
- Position **randomizes after defeating Xipocado**
- Contains boss encounter (Xipocado, Royal Architect)
- Unlocks vault selection and Royal Access Chamber placement

### 8.2 Connection Properties

Unlike normal rooms, the Architect's Chamber can connect **directly to adjacent rooms**, not just paths. This provides flexibility in reaching the boss.

### 8.3 Optimal Positioning

Recommended positions for Architect:
- **Dead center** (5, 5)
- **Top-right corner** region
- **Top-left corner** region

### 8.4 The Single-Connection Rule

**Critical Constraint**: You want **no more than 1 connection** to the Architect's Chamber.

**Rationale**:
- Multiple connections create loops
- Loops violate the snake chain paradigm
- Loops risk catastrophic destabilization of locked sections

**Implementation**:
```
     [Architect]
          ↑
    Single connection
          |
 ... → [Room] → ...

NOT:

    [Room] → [Architect] ← [Room]
         ↑ Loop risk ↑
```

### 8.5 Forcing Architect Position

Players can influence Architect spawn location:
- Fill undesired grid areas first
- Architect won't overlap owned tiles
- Constrain possible spawn locations through strategic filling

---

## 9. The Optimization Problem

### 9.1 Problem Statement

Given:
- A 9x9 grid with fixed Foyer (5,1) and Atziri's Chamber (5,9)
- An existing partial layout with Architect at position (7,4)
- Entry point at (1,5) with 3 initial paths

Constraints:
- Maximum 1 connection to the Architect
- All paths must remain linear (no crossings, no loops)
- Minimum 8 Spymasters
- Minimum 6 Corruption Chambers
- Maximum 2 paths per direction constraint

Objective:
- Maximize valuable room coverage
- Maintain destabilization-resistant layout
- Optimize room upgrade synergies

### 9.2 Constraint Categories

#### Hard Constraints
1. Room connection rules (see Section 4.3)
2. Linear pathing (no loops)
3. Single Architect connection
4. Grid boundary (9x9)
5. Foyer position fixed

#### Soft Constraints (Optimization Targets)
1. Spymaster count ≥ 8
2. Corruption Chamber count ≥ 6
3. Path count minimized
4. Upgrade synergies maximized
5. Empty spots acceptable (filler rooms)

### 9.3 Mathematical Formulation

Let G = (V, E) be the temple graph where:
- V = set of grid positions (1-9, 1-9)
- E = set of valid connections between adjacent positions

Decision variables:
- x[i,j,r] ∈ {0,1}: Room type r placed at position (i,j)
- p[i,j,k,l] ∈ {0,1}: Path exists between (i,j) and (k,l)

Objective:
```
Maximize: Σ(value[r] * x[i,j,r]) + Σ(synergy[r,s] * adjacent[i,j,k,l])
```

Subject to:
```
1. Σ(x[i,j,r] for all r) ≤ 1  ∀(i,j)  [One room per cell]
2. connected(Foyer, cell) = 1  ∀ occupied cells  [Connectivity]
3. Σ(connections to Architect) ≤ 1  [Single Architect link]
4. no_cycles(G) = True  [Acyclic constraint]
5. Σ(x[i,j,Spymaster]) ≥ 8  [Spymaster minimum]
6. Σ(x[i,j,Corruption]) ≥ 6  [Corruption minimum]
```

---

## 10. Constraint Satisfaction Approach

### 10.1 Solving the Puzzle

For the specific case presented (Architect at (7,4), entry at (1,5)):

#### Step 1: Analyze Fixed Elements
```
Entry: (1,5) with 3 paths
Architect: (7,4) - needs single connection
Existing layout: [from encoded URL parameter]
```

#### Step 2: Identify Valid Chains

Build chains that:
- Start from one of the 3 entry paths
- Wind through the grid without crossing
- Touch Architect exactly once
- Terminate at lockable positions

#### Step 3: Place High-Value Rooms First

Priority order:
1. Spymasters (medallion generation)
2. Corruption Chambers (high value, needs protection)
3. Garrison/Armoury (synergy providers)
4. Alchemy Lab/Thaumaturge (secondary synergy)

#### Step 4: Fill Strategy

- Place rooms in snake order following constraints
- Use lower-value rooms as filler toward chain tips
- Ensure Spymasters are placed before any Commander
- Position Corruption Chambers in protected mid-chain locations

### 10.2 Validation Approach

Use the Sulozor planner tool to validate solutions:
1. Enter proposed layout in the planner
2. Verify all connections are valid
3. Confirm single Architect link
4. Check for loop formation
5. Count Spymasters (≥8) and Corruption Chambers (≥6)

### 10.3 Algorithmic Solution

A potential solver approach:

```
function solve_temple(grid, architect_pos, entry_pos, constraints):
    # Initialize
    chain = [entry_pos]
    spymaster_count = 0
    corruption_count = 0

    # BFS/DFS with constraint checking
    while can_extend(chain) and not constraints_met:
        next_positions = valid_adjacent(chain.tip)

        for pos in next_positions:
            if creates_loop(chain, pos):
                continue
            if pos == architect_pos and architect_connections > 0:
                continue

            # Room selection heuristic
            if spymaster_count < 8:
                place(Spymaster, pos)
                spymaster_count++
            elif corruption_count < 6:
                place(Corruption, pos)
                corruption_count++
            else:
                place(best_synergy_room(chain), pos)

            chain.append(pos)

    return chain
```

---

## 11. Conclusions

### 11.1 Key Insights

1. **The Temple is a Graph Problem**: Layout optimization reduces to constrained graph construction with cycle avoidance

2. **Destabilization Creates Pressure**: The entropy model forces strategic trade-offs between immediate reward and long-term stability

3. **Snake Chains Are Dominant**: Linear pathing with tip-locking provides optimal stability-to-reward ratio

4. **Spymasters Enable Sustainability**: Self-upgrading mechanics and medallion drops create positive feedback loops

5. **Architect Positioning Is Critical**: Single-connection requirement to Architect prevents catastrophic loop formation

### 11.2 Optimal Strategy Summary

1. Build single linear chain from Foyer
2. Frontload Spymasters (6-8 minimum)
3. Place Corruption Chambers in protected mid-chain positions
4. Introduce Commanders only after Spymaster saturation
5. Touch Architect with exactly one connection
6. Lock chain tip with medallions (T3 rooms only post-patch)
7. Accept empty spots as filler/buffer

### 11.3 Future Considerations

The temple system may evolve with patches. Key areas to monitor:
- Medallion lock requirements
- Spymaster placement bug/feature status
- Destabilization rate adjustments
- New room types and synergies

---

## 12. References

### Primary Sources
- [POE2 Wiki - Temple of Atziri](https://www.poe2wiki.net/wiki/Guide:The_Temple_of_Atziri)
- [POE2 Wiki - Atziri's Temple](https://www.poe2wiki.net/wiki/Atziri%27s_Temple)
- [Keengamer - Fate of the Vaal Guide](https://www.keengamer.com/articles/guides/path-of-exile-2-fate-of-the-vaal-guide-vaal-ruins-temple-rooms-and-atziri/)
- [Game8 - Vaal Temple Guide](https://game8.co/games/Path-of-Exile-2/archives/571706)

### Strategy Guides
- [AOEAH - Vaal Temple Cheat Sheet](https://www.aoeah.com/news/4279--poe-2-04-vaal-temple-cheat-sheet-rewards-rooms-boss-farm-strats)
- [Poecurrency - Temple Farming Strategies](https://www.poecurrency.com/news/poe-2-patch-0-4-0-temple-of-atziri-farming-strategies-for-speed-or-long-room-chains)
- [MMOJUGG - Master Lira Vaal Guide](https://www.mmojugg.com/news/master-lira-vaal-poe2-temple-of-atziri-full-guide.html)

### Tools
- [Sulozor Temple Planner](https://sulozor.github.io/)
- [Tetriszocker Atziri Temple Editor](https://tetriszocker.github.io/atziri-temple-editor/)
- [Temple Optimizer (akashdeepo)](https://akashdeepo.github.io/Temple-Optimizer/)
- [GitHub - Temple Optimizer Source](https://github.com/akashdeepo/Temple-Optimizer)
- [GitHub - Atziri Temple Editor Source](https://github.com/Tetriszocker/atziri-temple-editor)

---

## Appendix A: Room Connection Quick Reference

```
Garrison → [Path, Commander, Armoury, Synth Lab, Spymaster]
Spymaster → [Garrison] (creates Legion Barracks bonus)
Commander → [Garrison, Armoury] (BLOCKS future Spymasters)
Armoury → [Garrison, Commander, Alchemy Lab, Thaumaturge]
Alchemy Lab → [Armoury, Thaumaturge, Corruption Chamber]
Corruption Chamber → [Alchemy Lab, Thaumaturge]
Generator → [Paths, Thaumaturge, Sacrificial Chamber] (3-5 cell power range)
```

## Appendix B: Value Tier List

| Tier | Room | Estimated Value |
|------|------|-----------------|
| S | Sacrificial Chamber T3 | ~1.5 Divine (Vaal Cultivation Orb) |
| S | Corruption Chamber T3 | ~70 Exalted (Vaal Infuser) |
| A | Thaumaturge T3 | ~50 Exalted (Gem Double Corruption) |
| A | Flesh Surgeon T3 | Priceless (Limb Modification Device) |
| B | Spymaster T3 | Medallion sustainability |
| B | Commander T3 | 60% rare effectiveness |
| C | Garrison T3 | Pack density |
| C | Armoury T3 | Equipment focus |

## Appendix C: Specific Puzzle Requirements

Based on the conversation context provided:

**Given State:**
- Architect position: (7, 4)
- Entry point: (1, 5) with 3 paths
- Constraint: Single connection to Architect
- Constraint: Linear paths only (no crossings)
- Requirement: ≥8 Spymasters
- Requirement: ≥6 Corruption Chambers
- Constraint: ≤2 paths per direction
- Expected: Some empty spots acceptable

**Optimization Target:**
Build an optimized layout that fills remaining space while satisfying all constraints, following the "turbo BIS" pattern shown in reference images with proper Architect pathing.

---

*Document compiled from Path of Exile 2 Patch 0.4.0 "Fate of the Vaal" league mechanics*
*Last updated: January 2025*
