/**
 * Tests for room connection and synergy rules
 */

import { describe, it, assert } from 'node:test';
import { canConnect, triggersSynergy, getRoomName, getRoomValue } from '../../src/domain/room-rules.js';

describe('Room Connection Rules', () => {
  it('should allow PATH to connect to any room type', () => {
    assert.strictEqual(canConnect('PATH', 'GARRISON'), true);
    assert.strictEqual(canConnect('PATH', 'SPYMASTER'), true);
    assert.strictEqual(canConnect('PATH', 'CORRUPTION_CHAMBER'), true);
    assert.strictEqual(canConnect('GARRISON', 'PATH'), true);
  });

  it('should allow SPYMASTER to connect to GARRISON', () => {
    assert.strictEqual(canConnect('SPYMASTER', 'GARRISON'), true);
    assert.strictEqual(canConnect('GARRISON', 'SPYMASTER'), true);
  });

  it('should not allow SPYMASTER to connect to COMMANDER directly', () => {
    // Spymaster can only connect to Garrison
    assert.strictEqual(canConnect('SPYMASTER', 'COMMANDER'), false);
  });

  it('should allow CORRUPTION_CHAMBER to connect to ALCHEMY_LAB', () => {
    assert.strictEqual(canConnect('CORRUPTION_CHAMBER', 'ALCHEMY_LAB'), true);
  });

  it('should allow CORRUPTION_CHAMBER to connect to THAUMATURGE', () => {
    assert.strictEqual(canConnect('CORRUPTION_CHAMBER', 'THAUMATURGE'), true);
  });

  it('should not allow CORRUPTION_CHAMBER to connect to GARRISON', () => {
    assert.strictEqual(canConnect('CORRUPTION_CHAMBER', 'GARRISON'), false);
  });

  it('should allow valid Garrison chain: GARRISON -> COMMANDER', () => {
    assert.strictEqual(canConnect('GARRISON', 'COMMANDER'), true);
  });

  it('should allow valid Garrison chain: GARRISON -> ARMOURY', () => {
    assert.strictEqual(canConnect('GARRISON', 'ARMOURY'), true);
  });
});

describe('Synergy Upgrades', () => {
  it('should trigger GARRISON upgrade from COMMANDER', () => {
    assert.strictEqual(triggersSynergy('GARRISON', 'COMMANDER'), true);
  });

  it('should trigger GARRISON upgrade from ARMOURY', () => {
    assert.strictEqual(triggersSynergy('GARRISON', 'ARMOURY'), true);
  });

  it('should not trigger GARRISON upgrade from SPYMASTER', () => {
    assert.strictEqual(triggersSynergy('GARRISON', 'SPYMASTER'), false);
  });

  it('should trigger ARMOURY upgrade from SMITHY', () => {
    assert.strictEqual(triggersSynergy('ARMOURY', 'SMITHY'), true);
  });

  it('should trigger THAUMATURGE upgrade from GENERATOR', () => {
    assert.strictEqual(triggersSynergy('THAUMATURGE', 'GENERATOR'), true);
  });
});

describe('Room Names and Values', () => {
  it('should return correct tier names for GARRISON', () => {
    assert.strictEqual(getRoomName('GARRISON', 1), 'Guardhouse');
    assert.strictEqual(getRoomName('GARRISON', 2), 'Barracks');
    assert.strictEqual(getRoomName('GARRISON', 3), 'Hall of War');
  });

  it('should return correct tier names for SPYMASTER', () => {
    assert.strictEqual(getRoomName('SPYMASTER', 1), "Spymaster's Study");
    assert.strictEqual(getRoomName('SPYMASTER', 3), 'Omnipresent Panopticon');
  });

  it('should return increasing values for higher tiers', () => {
    const t1 = getRoomValue('SPYMASTER', 1);
    const t2 = getRoomValue('SPYMASTER', 2);
    const t3 = getRoomValue('SPYMASTER', 3);

    assert.ok(t2 > t1, 'T2 should be worth more than T1');
    assert.ok(t3 > t2, 'T3 should be worth more than T2');
  });

  it('should value CORRUPTION_CHAMBER higher than PATH', () => {
    const corruption = getRoomValue('CORRUPTION_CHAMBER', 1);
    const path = getRoomValue('PATH', 1);

    assert.ok(corruption > path, 'Corruption Chamber should be worth more than Path');
  });
});
