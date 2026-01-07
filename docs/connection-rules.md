# Sulozor Temple Connection Rules

## Discovery Method
These rules were empirically discovered by batch-testing room placements against
the Sulozor planner and checking for the "Place rooms to see effects" indicator.
If this message appears, the room is NOT connected to the FOYER chain.

## Multiple Chains Are Valid

Multiple rooms CAN connect to FOYER, and rooms CAN branch to multiple children.
Each branch creates a separate "chain" in Sulozor's terminology, but **ALL chains
contribute to bonuses**. Sulozor counts and displays chains separately but they
all provide their effects.

The key constraints are:
1. Rooms must be orthogonally adjacent (no diagonal connections)
2. Some rooms require specific parent rooms (see below)
3. All connected rooms contribute bonuses regardless of which chain they're in

## Rooms That Connect Directly to PATH/FOYER

The following rooms can be placed adjacent to the FOYER (PATH at 5,1) and will
be considered connected:

- GARRISON
- LEGION_BARRACKS
- COMMANDER
- ARMOURY
- SMITHY
- GENERATOR
- SYNTHFLESH
- FLESH_SURGEON
- ALCHEMY_LAB
- CORRUPTION_CHAMBER
- SACRIFICIAL_CHAMBER

## Rooms That Require Specific Parents

### SPYMASTER
Cannot connect directly to PATH. Requires:
- GARRISON
- LEGION_BARRACKS

### GOLEM_WORKS
Cannot connect directly to PATH. Requires:
- SMITHY

### THAUMATURGE
Cannot connect directly to PATH. Requires:
- GENERATOR
- ALCHEMY_LAB
- CORRUPTION_CHAMBER
- SACRIFICIAL_CHAMBER

## Room -> Valid Children Relationships

**CRITICAL: Only the rooms listed below can be PARENTS. All other rooms are "leaf" rooms
that cannot have children - they can only connect to FOYER or as children of valid parents.**

| Parent Room | Valid Children |
|-------------|----------------|
| GARRISON | COMMANDER, ARMOURY, SPYMASTER, SYNTHFLESH |
| SPYMASTER | GARRISON, LEGION_BARRACKS |
| ARMOURY | GARRISON, LEGION_BARRACKS, SMITHY, ALCHEMY_LAB |
| GENERATOR | THAUMATURGE, SACRIFICIAL_CHAMBER |
| SMITHY | ARMOURY, GOLEM_WORKS |

### Leaf Rooms (Cannot Have Children)

The following rooms can connect to FOYER directly, or be children of valid parents,
but they CANNOT have any children themselves:

- CORRUPTION_CHAMBER
- SACRIFICIAL_CHAMBER
- THAUMATURGE
- ALCHEMY_LAB
- LEGION_BARRACKS
- GOLEM_WORKS
- COMMANDER
- SYNTHFLESH
- FLESH_SURGEON

**Example:** You CAN place CORRUPTION_CHAMBER at (5,2) adjacent to FOYER at (5,1) and it
will connect. But you CANNOT place another room at (5,3) expecting to chain through
the CORRUPTION_CHAMBER - that room will be disconnected.

## Detection Method

To detect if a room is connected:
1. Check the page for "Place rooms to see effects" text
2. If this text is present, at least one room is NOT connected
3. Check the "CHAINS (N)" indicator for how many rooms are in the chain
4. The "N rooms +" count shows how many rooms contribute to bonuses

Note: The tier indicator color (golden `rgb(201, 168, 96)` vs grey `rgb(212, 212, 212)`)
appears the same for both connected and disconnected rooms in headless browser mode.
