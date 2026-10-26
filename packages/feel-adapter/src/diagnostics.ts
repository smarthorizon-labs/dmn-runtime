/**
 * Structured diagnostics for the FEEL layer.
 *
 * Original work. Codes are stable identifiers
 * and are declared in one place so that the registry can later generate both
 * the union type and the published documentation.
 */

export const FEEL_DIAGNOSTIC_CODES = {
  /** The source could not be parsed. Raised at compile time. */
  FEEL_PARSE_ERROR: 'FEEL_PARSE_ERROR',
  /** The source parsed, but uses a construct this version cannot evaluate. */
  FEEL_UNSUPPORTED_CONSTRUCT: 'FEEL_UNSUPPORTED_CONSTRUCT',
  /** A name was referenced that the evaluation context does not define. */
  FEEL_UNKNOWN_VARIABLE: 'FEEL_UNKNOWN_VARIABLE',
  /**
   * A function was invoked that the environment does not provide — typically a
   * FEEL built-in this version has not implemented.
   *
   * Distinct from an unknown variable because it means the same thing as an
   * unsupported construct: the expression was not evaluated. Anything judging
   * results must treat it that way, or missing built-ins start looking like
   * correct null results.
   */
  FEEL_UNKNOWN_FUNCTION: 'FEEL_UNKNOWN_FUNCTION',
  /** A temporal literal or constructor argument was not a valid value. */
  FEEL_INVALID_TEMPORAL: 'FEEL_INVALID_TEMPORAL',
  /** Invocation nested deeper than the configured limit. */
  FEEL_RECURSION_LIMIT: 'FEEL_RECURSION_LIMIT',
  /** The source was empty. */
  FEEL_EMPTY_EXPRESSION: 'FEEL_EMPTY_EXPRESSION',
} as const;

/**
 * Codes meaning "this expression was not evaluated".
 *
 * A caller comparing results against expectations must not credit a null
 * produced for one of these reasons as a correct answer.
 */
export const NOT_EVALUATED_CODES: ReadonlySet<string> = new Set([
  'FEEL_UNSUPPORTED_CONSTRUCT',
  'FEEL_UNKNOWN_FUNCTION',
  'FEEL_RECURSION_LIMIT',
]);

export type FeelDiagnosticCode =
  (typeof FEEL_DIAGNOSTIC_CODES)[keyof typeof FEEL_DIAGNOSTIC_CODES];

export type DiagnosticSeverity = 'INFO' | 'WARNING' | 'ERROR';

export interface SourceSpan {
  readonly startOffset: number;
  readonly endOffset: number;
  readonly line: number;
  readonly column: number;
}

export interface Diagnostic {
  readonly code: FeelDiagnosticCode;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly source?: SourceSpan;
}

/** Converts a character offset into a 1-based line and column. */
export function spanFor(text: string, startOffset: number, endOffset: number): SourceSpan {
  let line = 1;
  let lastNewline = -1;

  for (let index = 0; index < startOffset && index < text.length; index++) {
    if (text.charCodeAt(index) === 10) {
      line++;
      lastNewline = index;
    }
  }

  return {
    startOffset,
    endOffset,
    line,
    column: startOffset - lastNewline,
  };
}

export function diagnostic(
  code: FeelDiagnosticCode,
  message: string,
  source?: SourceSpan,
): Diagnostic {
  return source === undefined
    ? { code, severity: 'ERROR', message }
    : { code, severity: 'ERROR', message, source };
}
