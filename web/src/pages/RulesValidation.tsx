/**
 * Rules Validation Page - Verified Rules from Sulozor Testing
 *
 * This page documents ALL verified temple room connection rules based on
 * systematic testing in Sulozor's explorer tool.
 *
 * Testing Date: January 2026
 * Total Tests: 133 (14 foyer + 14 self-adjacency + 14 child + 91 pairs)
 */

import { useState } from 'react';

// =====================================================
// VERIFIED RULES FROM SULOZOR TESTING
// =====================================================

// ALL 14 room types - for reference
const ALL_ROOMS = [
  'GARRISON', 'SPYMASTER', 'COMMANDER', 'ARMOURY', 'ALCHEMY_LAB', 'SMITHY',
  'CORRUPTION_CHAMBER', 'SACRIFICIAL_CHAMBER', 'THAUMATURGE', 'GENERATOR',
  'GOLEM_WORKS', 'FLESH_SURGEON', 'SYNTHFLESH', 'LEGION_BARRACKS',
] as const;

// RULE 1: ALL rooms can connect to FOYER (verified - all 14 foyer tests passed)
// No REQUIRED_PARENTS restrictions for FOYER connection!

// RULE 2: NO room can be self-adjacent (verified - all 14 self tests failed)
// This means spatially adjacent (next to each other), not tree connections

// RULE 3: Only specific rooms can have children in tree (verified)
// These rooms CAN have children: GARRISON, SPYMASTER, COMMANDER, ARMOURY, SYNTHFLESH

// These rooms are LEAF-ONLY (cannot have children):
const LEAF_ROOMS = [
  'ALCHEMY_LAB', 'SMITHY', 'CORRUPTION_CHAMBER', 'SACRIFICIAL_CHAMBER',
  'THAUMATURGE', 'GENERATOR', 'GOLEM_WORKS', 'FLESH_SURGEON', 'LEGION_BARRACKS'
];

// RULE 4: Valid tree connection pairs (verified - only 19 of 91 pairs valid)
// Format: [parent, child] - direction matters!
const VALID_ADJACENCY_PAIRS = [
  // GARRISON can connect to:
  ['GARRISON', 'SPYMASTER'],
  ['GARRISON', 'COMMANDER'],
  ['GARRISON', 'ARMOURY'],
  ['GARRISON', 'SYNTHFLESH'],

  // SPYMASTER can connect to:
  ['SPYMASTER', 'LEGION_BARRACKS'],

  // COMMANDER can connect to:
  ['COMMANDER', 'LEGION_BARRACKS'],

  // ARMOURY can connect to:
  ['ARMOURY', 'ALCHEMY_LAB'],
  ['ARMOURY', 'SMITHY'],
  ['ARMOURY', 'LEGION_BARRACKS'],

  // ALCHEMY_LAB can connect to:
  ['ALCHEMY_LAB', 'THAUMATURGE'],

  // SMITHY can connect to:
  ['SMITHY', 'GOLEM_WORKS'],

  // CORRUPTION_CHAMBER can connect to:
  ['CORRUPTION_CHAMBER', 'SACRIFICIAL_CHAMBER'],
  ['CORRUPTION_CHAMBER', 'THAUMATURGE'],

  // SACRIFICIAL_CHAMBER can connect to:
  ['SACRIFICIAL_CHAMBER', 'THAUMATURGE'],
  ['SACRIFICIAL_CHAMBER', 'GENERATOR'],

  // THAUMATURGE can connect to:
  ['THAUMATURGE', 'GENERATOR'],
  ['THAUMATURGE', 'FLESH_SURGEON'],

  // FLESH_SURGEON can connect to:
  ['FLESH_SURGEON', 'SYNTHFLESH'],

  // SYNTHFLESH can connect to:
  ['SYNTHFLESH', 'LEGION_BARRACKS'],
];

// Build connection map for display
const connectionMap = new Map<string, string[]>();
VALID_ADJACENCY_PAIRS.forEach(([parent, child]) => {
  if (!connectionMap.has(parent)) {
    connectionMap.set(parent, []);
  }
  connectionMap.get(parent)!.push(child);
});

// =====================================================
// COMPONENT
// =====================================================

export default function RulesValidation() {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['summary', 'pairs'])
  );

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="rules-validation" style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto', boxSizing: 'border-box' }}>
      <h1>Verified Temple Room Rules</h1>
      <p style={{ marginBottom: '20px', color: '#888' }}>
        All rules verified through systematic testing in Sulozor's explorer tool.
        <br />
        <strong>133 total tests:</strong> 14 foyer connections, 14 self-adjacency, 14 child tests, 91 pair tests.
      </p>

      {/* EXECUTIVE SUMMARY */}
      <Section
        title="Executive Summary"
        expanded={expandedSections.has('summary')}
        onToggle={() => toggleSection('summary')}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px' }}>
          <SummaryCard
            title="FOYER Connections"
            result="ALL VALID"
            color="#4a6"
            description="All 14 room types can connect directly to FOYER. No REQUIRED_PARENTS for FOYER."
          />
          <SummaryCard
            title="Self-Adjacency"
            result="ALL INVALID"
            color="#a44"
            description="No room can be spatially adjacent to another room of the same type."
          />
          <SummaryCard
            title="Valid Pairs"
            result="19 of 91"
            color="#66f"
            description="Only 19 room type pairs can form valid tree connections."
          />
          <SummaryCard
            title="Leaf Rooms"
            result="9 types"
            color="#f80"
            description="9 room types cannot have children (can only be leaves in tree)."
          />
        </div>
      </Section>

      {/* VALID ADJACENCY PAIRS - THE CORE RULE */}
      <Section
        title="Valid Tree Connection Pairs (19 pairs)"
        expanded={expandedSections.has('pairs')}
        onToggle={() => toggleSection('pairs')}
      >
        <p style={{ marginBottom: '16px', color: '#aaa' }}>
          These are the ONLY valid parent→child connections in the temple tree.
          Rooms can be <strong>spatially next to each other</strong> without connecting -
          but if they DO connect in the tree, it must be one of these pairs.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px' }}>
          {Array.from(connectionMap.entries()).map(([parent, children]) => (
            <div
              key={parent}
              style={{
                padding: '12px',
                backgroundColor: '#2a2a2a',
                borderRadius: '8px',
                border: '1px solid #444',
              }}
            >
              <div style={{ fontWeight: 'bold', marginBottom: '8px', color: '#8cf' }}>
                {formatRoomName(parent)}
              </div>
              <div style={{ fontSize: '0.9em', color: '#aaa' }}>
                Can connect to:
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                {children.map((child) => (
                  <span
                    key={child}
                    style={{
                      padding: '4px 8px',
                      backgroundColor: '#3a3a3a',
                      borderRadius: '4px',
                      fontSize: '0.85em',
                    }}
                  >
                    {formatRoomName(child)}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Rooms with NO valid children */}
        <div style={{ marginTop: '20px' }}>
          <h3 style={{ color: '#f88' }}>Leaf-Only Rooms (cannot have children)</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
            {LEAF_ROOMS.map((room) => (
              <span
                key={room}
                style={{
                  padding: '6px 12px',
                  backgroundColor: '#3a2a2a',
                  border: '1px solid #a44',
                  borderRadius: '4px',
                }}
              >
                {formatRoomName(room)}
              </span>
            ))}
          </div>
        </div>
      </Section>

      {/* SELF-ADJACENCY RULE */}
      <Section
        title="Self-Adjacency Rule (All 14 Invalid)"
        expanded={expandedSections.has('self-adj')}
        onToggle={() => toggleSection('self-adj')}
      >
        <p style={{ marginBottom: '16px', color: '#aaa' }}>
          <strong>No room can be spatially adjacent to another room of the same type.</strong>
          <br />
          This means if you have GARRISON at (5,3), you cannot place another GARRISON at (5,2), (5,4), (4,3), or (6,3).
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {ALL_ROOMS.map((room) => (
            <span
              key={room}
              style={{
                padding: '6px 12px',
                backgroundColor: '#2a1a1a',
                border: '1px solid #a44',
                borderRadius: '4px',
                fontSize: '0.9em',
              }}
            >
              {formatRoomName(room)} + {formatRoomName(room)}
            </span>
          ))}
        </div>
      </Section>

      {/* FOYER CONNECTIONS */}
      <Section
        title="FOYER Connections (All 14 Valid)"
        expanded={expandedSections.has('foyer')}
        onToggle={() => toggleSection('foyer')}
      >
        <p style={{ marginBottom: '16px', color: '#aaa' }}>
          <strong>All 14 room types can connect directly to FOYER.</strong>
          <br />
          This was a surprise - we originally thought some rooms had REQUIRED_PARENTS.
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {ALL_ROOMS.map((room) => (
            <span
              key={room}
              style={{
                padding: '6px 12px',
                backgroundColor: '#1a2a1a',
                border: '1px solid #4a6',
                borderRadius: '4px',
                fontSize: '0.9em',
              }}
            >
              FOYER → {formatRoomName(room)}
            </span>
          ))}
        </div>
      </Section>

      {/* FULL PAIR MATRIX */}
      <Section
        title="Full Pair Matrix (91 pairs)"
        expanded={expandedSections.has('matrix')}
        onToggle={() => toggleSection('matrix')}
      >
        <p style={{ marginBottom: '16px', color: '#aaa' }}>
          Complete matrix of all room type pairs and their validity.
          <span style={{ color: '#4a6', marginLeft: '12px' }}>Green = Valid</span>
          <span style={{ color: '#a44', marginLeft: '12px' }}>Red = Invalid</span>
        </p>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: '0.75em', width: '100%' }}>
            <thead>
              <tr>
                <th style={{ padding: '4px', backgroundColor: '#333' }}></th>
                {ALL_ROOMS.map((room) => (
                  <th
                    key={room}
                    style={{
                      padding: '4px',
                      backgroundColor: '#333',
                      writingMode: 'vertical-rl',
                      textOrientation: 'mixed',
                      height: '80px',
                    }}
                  >
                    {formatRoomName(room).slice(0, 4)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ALL_ROOMS.map((roomA, i) => (
                <tr key={roomA}>
                  <td style={{ padding: '4px', backgroundColor: '#333', fontWeight: 'bold' }}>
                    {formatRoomName(roomA).slice(0, 4)}
                  </td>
                  {ALL_ROOMS.map((roomB, j) => {
                    if (i >= j) {
                      // Skip diagonal and lower triangle
                      return (
                        <td
                          key={roomB}
                          style={{ padding: '4px', backgroundColor: '#222', textAlign: 'center' }}
                        >
                          -
                        </td>
                      );
                    }
                    const isValid = VALID_ADJACENCY_PAIRS.some(
                      ([a, b]) => (a === roomA && b === roomB) || (a === roomB && b === roomA)
                    );
                    return (
                      <td
                        key={roomB}
                        style={{
                          padding: '4px',
                          backgroundColor: isValid ? '#1a3a1a' : '#3a1a1a',
                          textAlign: 'center',
                          color: isValid ? '#4a6' : '#a44',
                        }}
                      >
                        {isValid ? 'Y' : 'N'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* CHANGELOG RULES */}
      <Section
        title="Additional Rules from Sulozor Changelog"
        expanded={expandedSections.has('changelog')}
        onToggle={() => toggleSection('changelog')}
      >
        <p style={{ marginBottom: '16px', color: '#aaa' }}>
          These rules were discovered from Sulozor's changelog (v1.4 - v1.24).
          Some may overlap with the pair rules above.
        </p>

        <div style={{ display: 'grid', gap: '12px' }}>
          <ChangelogRule
            version="v1.24"
            rule="Asymmetric Chain: COR ↔ THAU"
            description="No THAU→COR→THAU pattern allowed, but COR→THAU→COR is OK"
          />
          <ChangelogRule
            version="v1.24"
            rule="Asymmetric Chain: SMITHY ↔ GOLEM_WORKS"
            description="No GOL→SMI→GOL pattern allowed, but SMI→GOL→SMI is OK"
          />
          <ChangelogRule
            version="v1.23"
            rule="Adjacency Limit: ARMOURY → SMITHY"
            description="Armoury can have at most 1 Smithy adjacent"
          />
          <ChangelogRule
            version="v1.13"
            rule="Linear Chain Ban: SPYMASTER ↔ COMMANDER"
            description="Cannot be in linear chain together"
          />
          <ChangelogRule
            version="v1.12"
            rule="Adjacency Limit: ALCHEMY_LAB → THAUMATURGE"
            description="Alchemy Lab can have at most 2 Thaumaturges adjacent"
          />
          <ChangelogRule
            version="v1.4.1"
            rule="PATH Requirement: GENERATOR"
            description="Generator must connect to a PATH tile"
          />
        </div>
      </Section>

      {/* SOLVER IMPLEMENTATION */}
      <Section
        title="Solver Implementation Status"
        expanded={expandedSections.has('solver')}
        onToggle={() => toggleSection('solver')}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #444' }}>
              <th style={{ textAlign: 'left', padding: '8px' }}>Rule</th>
              <th style={{ textAlign: 'center', padding: '8px' }}>Implemented</th>
              <th style={{ textAlign: 'left', padding: '8px' }}>Notes</th>
            </tr>
          </thead>
          <tbody>
            <ImplementationRow rule="FOYER - all rooms can connect" implemented={true} notes="REQUIRED_PARENTS removed" />
            <ImplementationRow rule="Self-adjacency (14 types)" implemented={true} notes="NO_SELF_ADJACENCY set" />
            <ImplementationRow rule="Valid pairs (19 pairs)" implemented={true} notes="VALID_ADJACENCY_PAIRS" />
            <ImplementationRow rule="Leaf rooms (9 types)" implemented={true} notes="LEAF_ROOMS set" />
            <ImplementationRow rule="ARMOURY → SMITHY max 1" implemented={false} notes="TODO" />
            <ImplementationRow rule="ALCHEMY_LAB → THAU max 2" implemented={false} notes="TODO" />
            <ImplementationRow rule="Asymmetric chains" implemented={false} notes="Complex, disabled" />
            <ImplementationRow rule="SPY ↔ CMD linear ban" implemented={false} notes="TODO" />
            <ImplementationRow rule="GENERATOR requires PATH" implemented={false} notes="TODO" />
          </tbody>
        </table>
      </Section>

      <div style={{ marginTop: '30px', textAlign: 'center', padding: '20px', backgroundColor: '#222', borderRadius: '8px' }}>
        <p style={{ color: '#888', marginBottom: '16px' }}>
          Test data collected from Sulozor explorer tool.
          <br />
          Rules verified by manually testing each configuration.
        </p>
        <a href="/" style={{ color: '#88f', marginRight: '20px' }}>Back to Solver</a>
        <a href="#/explorer" style={{ color: '#88f' }}>Rule Explorer Tool</a>
      </div>
    </div>
  );
}

// =====================================================
// HELPER COMPONENTS
// =====================================================

function Section({
  title,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        border: '1px solid #444',
        borderRadius: '8px',
        marginBottom: '16px',
        overflow: 'hidden',
      }}
    >
      <div
        onClick={onToggle}
        style={{
          padding: '16px',
          backgroundColor: '#2a2a2a',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <strong>{title}</strong>
        <span style={{ fontSize: '1.5em' }}>{expanded ? '−' : '+'}</span>
      </div>
      {expanded && (
        <div style={{ padding: '16px', backgroundColor: '#1a1a1a' }}>
          {children}
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  title,
  result,
  color,
  description,
}: {
  title: string;
  result: string;
  color: string;
  description: string;
}) {
  return (
    <div
      style={{
        padding: '16px',
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        borderLeft: `4px solid ${color}`,
      }}
    >
      <div style={{ fontSize: '0.9em', color: '#888' }}>{title}</div>
      <div style={{ fontSize: '1.5em', fontWeight: 'bold', color, margin: '8px 0' }}>
        {result}
      </div>
      <div style={{ fontSize: '0.85em', color: '#aaa' }}>{description}</div>
    </div>
  );
}

function ChangelogRule({
  version,
  rule,
  description,
}: {
  version: string;
  rule: string;
  description: string;
}) {
  return (
    <div
      style={{
        padding: '12px',
        backgroundColor: '#2a2a2a',
        borderRadius: '6px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '12px',
      }}
    >
      <span
        style={{
          padding: '4px 8px',
          backgroundColor: '#444',
          borderRadius: '4px',
          fontSize: '0.8em',
          flexShrink: 0,
        }}
      >
        {version}
      </span>
      <div>
        <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>{rule}</div>
        <div style={{ fontSize: '0.9em', color: '#aaa' }}>{description}</div>
      </div>
    </div>
  );
}

function ImplementationRow({
  rule,
  implemented,
  notes,
}: {
  rule: string;
  implemented: boolean;
  notes: string;
}) {
  return (
    <tr style={{ borderBottom: '1px solid #333' }}>
      <td style={{ padding: '8px' }}>{rule}</td>
      <td style={{ padding: '8px', textAlign: 'center' }}>
        {implemented ? (
          <span style={{ color: '#4a6', fontWeight: 'bold' }}>YES</span>
        ) : (
          <span style={{ color: '#f80' }}>NO</span>
        )}
      </td>
      <td style={{ padding: '8px', color: '#888' }}>{notes}</td>
    </tr>
  );
}

function formatRoomName(name: string): string {
  return name
    .split('_')
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
}
