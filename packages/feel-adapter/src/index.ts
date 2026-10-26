/**
 * `@smarthorizon-labs/dmn-feel`
 *
 * FEEL parsing and evaluation with DMN-conformant decimal semantics.
 * See docs/adr/0001-numeric-semantics.md.
 */

export {
  createFeelEngine,
  type CompiledFeelExpression,
  type CompiledFeelUnaryTests,
  type FeelEngine,
  type FeelEngineInfo,
  type FeelEngineOptions,
  type FeelEvaluation,
} from './engine.js';

export { EMPTY_SCOPE, scopeCacheKey, type FeelScope, type TopRule } from './parse.js';

export {
  FeelDecimal,
  arithmetic,
  feelNumberToString,
  isFeelNumber,
  negate,
  toFeelNumber,
  type FeelNumber,
} from './number.js';

export {
  describeValue,
  feelCompare,
  feelEquals,
  feelNotEquals,
  feelTypeOf,
  isFeelContext,
  isFeelFunction,
  isFeelList,
  isFeelRange,
  type FeelContext,
  type FeelFunction,
  type FeelRange,
  type FeelValue,
} from './values.js';

export {
  FEEL_DIAGNOSTIC_CODES,
  NOT_EVALUATED_CODES,
  type Diagnostic,
  type DiagnosticSeverity,
  type FeelDiagnosticCode,
  type SourceSpan,
} from './diagnostics.js';

export { INPUT_VALUE_NAME } from './unary-tests.js';

export {
  compareTemporal,
  duration,
  isFeelDuration,
  isFeelTemporal,
  isPlainDate,
  isPlainDateTime,
  isPlainTime,
  isZoned,
  parseAtLiteral,
  parseDate,
  parseDateTime,
  parseDuration,
  parseTime,
  temporalToString,
  temporalTypeOf,
  type FeelDate,
  type FeelDateTime,
  type FeelDuration,
  type FeelTemporal,
  type FeelTime,
} from './temporal.js';

export { BUILTINS } from './builtins.js';
