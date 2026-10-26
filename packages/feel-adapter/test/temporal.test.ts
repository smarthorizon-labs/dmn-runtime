import { describe, expect, it } from 'vitest';

import { createFeelEngine } from '../src/engine.js';
import { describeValue, type FeelContext } from '../src/values.js';

const engine = createFeelEngine();

function show(source: string, context: FeelContext = {}): string {
  const compiled = engine.compileExpression(source);
  expect(compiled.diagnostics).toEqual([]);
  return describeValue(compiled.evaluate(context).value);
}

describe('temporal literals', () => {
  it('builds each type from its lexical form', () => {
    expect(show('date("2024-01-15")')).toBe('2024-01-15');
    expect(show('time("10:30:00")')).toBe('10:30:00');
    expect(show('date and time("2024-01-15T10:30:00")')).toBe('2024-01-15T10:30:00');
    expect(show('duration("P1D")')).toBe('P1D');
    expect(show('duration("P1Y2M")')).toBe('P1Y2M');
  });

  it('reads the @ shorthand, inferring the type from the shape', () => {
    expect(show('@"2024-01-15"')).toBe('2024-01-15');
    expect(show('@"10:30:00"')).toBe('10:30:00');
    expect(show('@"2024-01-15T10:30:00"')).toBe('2024-01-15T10:30:00');
    expect(show('@"P1D"')).toBe('P1D');
  });

  it('builds from components', () => {
    expect(show('date(2024, 1, 15)')).toBe('2024-01-15');
    expect(show('time(10, 30, 0)')).toBe('10:30:00');
  });

  it('converts between types', () => {
    expect(show('date(date and time("2024-01-15T10:30:00"))')).toBe('2024-01-15');
    expect(show('time(date and time("2024-01-15T10:30:00"))')).toBe('10:30:00');
  });

  it('yields null for a malformed value, with a diagnostic', () => {
    const outcome = engine.compileExpression('date("2024-13-45")').evaluate({});
    expect(outcome.value).toBeNull();

    // A typo in a date would otherwise be entirely silent.
    const at = engine.compileExpression('@"not-a-date"').evaluate({});
    expect(at.value).toBeNull();
    expect(at.warnings.map((warning) => warning.code)).toContain('FEEL_INVALID_TEMPORAL');
  });
});

describe('temporal comparison', () => {
  it('orders dates and date-times', () => {
    expect(show('date("2024-01-01") < date("2024-06-01")')).toBe('true');
    expect(show('date("2024-01-01") = date("2024-01-01")')).toBe('true');
    expect(show('date and time("2024-01-01T09:00:00") < date and time("2024-01-01T10:00:00")'))
      .toBe('true');
  });

  it('orders durations within a kind', () => {
    expect(show('duration("P1D") < duration("P2D")')).toBe('true');
    expect(show('duration("P1Y") > duration("P11M")')).toBe('true');
  });

  it('refuses to compare the two duration kinds', () => {
    // A year is not a fixed number of days, so the question has no answer
    // rather than a conventional one.
    expect(show('duration("P1Y") < duration("P400D")')).toBe('null');
    expect(show('duration("P1Y") = duration("P365D")')).toBe('null');
  });

  it('refuses to compare across temporal types', () => {
    expect(show('date("2024-01-01") = time("10:00:00")')).toBe('null');
  });
});

describe('temporal arithmetic', () => {
  it('adds and subtracts durations', () => {
    expect(show('date("2024-01-01") + duration("P1M")')).toBe('2024-02-01');
    expect(show('date("2024-03-15") - duration("P1M")')).toBe('2024-02-15');
    expect(show('date and time("2024-01-01T10:00:00") + duration("PT90M")')).toBe(
      '2024-01-01T11:30:00',
    );
  });

  it('subtracts two moments into a duration', () => {
    expect(show('date("2024-03-01") - date("2024-01-01")')).toBe('P60D');
  });

  it('handles leap years, because Temporal does', () => {
    // date + days-and-time duration widens to a date and time, per the DMN
    // operator table; only a years-and-months duration keeps it a date.
    expect(show('date("2024-02-28") + duration("P1D")')).toBe('2024-02-29T00:00:00');
    expect(show('date("2023-02-28") + duration("P1D")')).toBe('2023-03-01T00:00:00');
    expect(show('date("2024-02-28") + duration("P1M")')).toBe('2024-03-28');
  });

  it('combines and scales durations', () => {
    expect(show('duration("P1D") + duration("P2D")')).toBe('P3D');
    expect(show('duration("P1Y") + duration("P2M")')).toBe('P1Y2M');
    expect(show('duration("P1D") * 3')).toBe('P3D');
  });

  it('yields null for a meaningless combination', () => {
    expect(show('date("2024-01-01") + date("2024-01-01")')).toBe('null');
    expect(show('date("2024-01-01") + 1')).toBe('null');
    expect(show('duration("P1Y") + duration("P1D")')).toBe('null');
  });
});

describe('temporal properties', () => {
  it('reads date and time components', () => {
    expect(show('date("2024-06-15").year')).toBe('2024');
    expect(show('date("2024-06-15").month')).toBe('6');
    expect(show('date("2024-06-15").day')).toBe('15');
    // 2024-06-15 is a Saturday.
    expect(show('date("2024-06-15").weekday')).toBe('6');
    expect(show('date and time("2024-06-15T13:45:30").hour')).toBe('13');
    expect(show('date and time("2024-06-15T13:45:30").minute')).toBe('45');
  });

  it('reads duration components', () => {
    expect(show('duration("P1Y3M").years')).toBe('1');
    expect(show('duration("P1Y3M").months')).toBe('3');
    expect(show('duration("P2DT3H").days')).toBe('2');
    expect(show('duration("P2DT3H").hours')).toBe('3');
  });
});

describe('temporal built-ins', () => {
  it('names days and months', () => {
    expect(show('day of week(date("2024-06-15"))')).toBe('"Saturday"');
    expect(show('month of year(date("2024-06-15"))')).toBe('"June"');
    expect(show('day of year(date("2024-01-05"))')).toBe('5');
  });

  it('measures a span in years and months', () => {
    expect(show('years and months duration(date("2020-01-01"), date("2024-04-01"))')).toBe(
      'P4Y3M',
    );
  });
});

describe('determinism', () => {
  it('does not provide now() or today()', () => {
    // Reading the host clock would make evaluation
    // non-reproducible. They are reported rather than silently answered.
    for (const source of ['now()', 'today()']) {
      const outcome = engine.compileExpression(source).evaluate({});
      expect(outcome.value).toBeNull();
      expect(outcome.warnings.map((warning) => warning.code)).toContain('FEEL_UNKNOWN_FUNCTION');
    }
  });
});
