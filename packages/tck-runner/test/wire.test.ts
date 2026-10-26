/**
 * The wire format carries values between two engines in different languages.
 * If it loses precision or conflates types, every differential result becomes
 * untrustworthy, so it is tested directly.
 */

import { feelNumberToString, isFeelNumber, toFeelNumber } from '@smarthorizon-labs/dmn-feel';
import { describe, expect, it } from 'vitest';

import { UNREPRESENTABLE, decodeWire, encodeFeel, wireEquals, type WireValue } from '../src/wire.js';

describe('round trip', () => {
  it('preserves a 34-digit decimal exactly', () => {
    // The reason numbers travel as strings: a JSON number would destroy this.
    const literal = '2778.693549432766768088520383236299';
    const wire = encodeFeel(toFeelNumber(literal));

    expect(wire).toEqual({ type: 'number', value: literal });

    const back = decodeWire(wire);
    expect(isFeelNumber(back) && feelNumberToString(back)).toBe(literal);
  });

  it('preserves null, booleans and strings', () => {
    for (const value of [null, true, false, '', 'text with "quotes"']) {
      expect(decodeWire(encodeFeel(value))).toEqual(value);
    }
  });

  it('preserves nested lists and contexts', () => {
    const value = [{ a: toFeelNumber('1'), b: ['x', null] }];
    const back = decodeWire(encodeFeel(value));
    expect(back).toEqual(value);
  });
});

describe('temporal values', () => {
  it('decodes each temporal type', () => {
    expect(String(decodeWire({ type: 'date', value: '2024-01-01' }))).toBe('2024-01-01');
    expect(String(decodeWire({ type: 'time', value: '10:00:00' }))).toBe('10:00:00');
    expect(String(decodeWire({ type: 'dateTime', value: '2024-01-01T10:00:00' }))).toBe(
      '2024-01-01T10:00:00',
    );
    expect(decodeWire({ type: 'duration', value: 'P1Y' })).not.toBe(UNREPRESENTABLE);
  });

  it('round-trips a temporal value through the wire format', () => {
    const wire: WireValue = { type: 'date', value: '2024-06-15' };
    expect(encodeFeel(decodeWire(wire) as never)).toEqual(wire);
  });

  it('reports a value the format cannot express', () => {
    // The remaining unrepresentable case is an XSD type outside the mapping.
    expect(decodeWire({ type: 'unsupported', detail: 'xsd:hexBinary' })).toBe(UNREPRESENTABLE);
  });

  it('propagates unrepresentability out of a surrounding structure', () => {
    const wire: WireValue = {
      type: 'list',
      items: [{ type: 'number', value: '1' }, { type: 'unsupported', detail: 'xsd:hexBinary' }],
    };
    expect(decodeWire(wire)).toBe(UNREPRESENTABLE);
  });
});

describe('comparison', () => {
  const number = (value: string): WireValue => ({ type: 'number', value });

  it('compares numbers as decimals, not as strings', () => {
    expect(wireEquals(number('1.50'), number('1.5'))).toBe(true);
  });

  it('is exact by default', () => {
    // Two engines' outputs are both full precision, so any difference is real.
    expect(wireEquals(number('2778.693549432766768088520383236299'), number('2778.69354943277')))
      .toBe(false);
  });

  it('allows recorded precision when comparing against a TCK expectation', () => {
    expect(
      wireEquals(
        number('2778.693549432766768088520383236299'),
        number('2778.69354943277'),
        'recorded',
      ),
    ).toBe(true);
  });

  it('does not relax comparison for a value that fits within precision', () => {
    expect(wireEquals(number('0.30000000000000004'), number('0.3'), 'recorded')).toBe(false);
  });

  it('treats two errors as agreement, since the messages never match', () => {
    expect(
      wireEquals({ type: 'error', message: 'a' }, { type: 'error', message: 'b' }),
    ).toBe(true);
  });

  it('distinguishes types that would collide in plain JSON', () => {
    expect(wireEquals(number('1'), { type: 'string', value: '1' })).toBe(false);
    expect(wireEquals({ type: 'null' }, { type: 'string', value: '' })).toBe(false);
  });
});
