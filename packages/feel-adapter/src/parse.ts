/**
 * FEEL parsing.
 *
 * Original work. The FEEL *grammar* is reused from `lezer-feel` (MIT, Nico
 * Rehwaldt); see NOTICE. Only evaluation is implemented here; ADR-0001
 * explains why.
 */

import type { SyntaxNode, Tree } from '@lezer/common';
import { parser, trackVariables, VariableContext } from 'lezer-feel';

import { FEEL_DIAGNOSTIC_CODES, diagnostic, spanFor, type Diagnostic } from './diagnostics.js';

/**
 * The names visible at an expression's site.
 *
 * This is not decoration. FEEL parsing is context-sensitive: the declared name
 * set determines tokenization, which is how names containing spaces are
 * recognized. Parsing `Applicant Data.Monthly` against an empty scope yields a
 * different tree than parsing it against a scope declaring `Applicant Data`.
 */
export interface FeelScope {
  readonly names: readonly string[];
  readonly dialect?: string;
}

export const EMPTY_SCOPE: FeelScope = { names: [] };

export type TopRule = 'Expression' | 'UnaryTests';

export interface ParseResult {
  readonly tree: Tree;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Separator for composite cache keys.
 *
 * It must be a character that cannot appear in a scope token or in FEEL
 * source, because without one the parts run together and distinct keys collide:
 * scope `s1` with source `11` would key the same as scope `s11` with source
 * `1`, and the second compile would silently be handed the first one's tree.
 */
const SEPARATOR = '\u001f';

/**
 * A short token standing for a scope's name set.
 *
 * The obvious key is the sorted name list itself, but a DRG with a thousand
 * decisions makes that a 20 KB string, and embedding it in every
 * per-expression cache key means building and hashing 20 KB per compile — which
 * measured as the dominant cost of compiling TCK `0100-arithmetic`.
 *
 * Interning it to a token keeps keys short while preserving both properties
 * that matter: scopes with the same names share a token
 * whatever order they were declared in, and scopes with different names never
 * share one.
 */
const scopeIds = new WeakMap<FeelScope, string>();
const idsByFingerprint = new Map<string, string>();
const MAX_INTERNED_SCOPES = 1024;
let nextScopeId = 0;

export function scopeId(scope: FeelScope): string {
  const cached = scopeIds.get(scope);
  if (cached !== undefined) {
    return cached;
  }

  const fingerprint = `${scope.dialect ?? ''}${SEPARATOR}${[...scope.names].sort().join('\u0000')}`;
  let id = idsByFingerprint.get(fingerprint);

  if (id === undefined) {
    if (idsByFingerprint.size >= MAX_INTERNED_SCOPES) {
      // Dropping the intern table costs deduplication, never correctness:
      // scopes still in use keep their token through the WeakMap.
      idsByFingerprint.clear();
    }

    nextScopeId += 1;
    id = `s${String(nextScopeId)}`;
    idsByFingerprint.set(fingerprint, id);
  }

  scopeIds.set(scope, id);
  return id;
}

/**
 * The cache key for a compiled expression.
 *
 * Scope identity is part of the key because two identical source strings
 * parsed under different scopes are different expressions. Keying on source
 * text alone would be a correctness bug, not merely a cache inefficiency.
 */
export function scopeCacheKey(source: string, scope: FeelScope, top: TopRule): string {
  return `${top}${SEPARATOR}${scopeId(scope)}${SEPARATOR}${source}`;
}

function contextFor(scope: FeelScope): VariableContext {
  const entries: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
  for (const name of scope.names) {
    entries[name] = true;
  }
  return VariableContext.of(entries);
}

/**
 * Parsers configured for a scope.
 *
 * `parser.configure` builds a fresh parser, and its configuration depends only
 * on the scope and the top rule — never on the expression being parsed.
 * Configuring per expression made compiling a large model quadratic in the
 * number of expressions; configuring per scope makes it linear.
 */
const parsers = new Map<string, ReturnType<typeof parser.configure>>();
const MAX_CACHED_PARSERS = 32;

function parserFor(scope: FeelScope, top: TopRule): ReturnType<typeof parser.configure> {
  const key = `${top}${SEPARATOR}${scopeId(scope)}`;
  const cached = parsers.get(key);

  if (cached !== undefined) {
    return cached;
  }

  const configured = parser.configure({
    top,
    contextTracker: trackVariables(contextFor(scope)),
  });

  if (parsers.size >= MAX_CACHED_PARSERS) {
    const oldest = parsers.keys().next();
    if (!oldest.done) {
      parsers.delete(oldest.value);
    }
  }

  parsers.set(key, configured);
  return configured;
}

/** Parses `source`, reporting syntax errors as compile-time diagnostics. */
export function parseFeel(source: string, scope: FeelScope, top: TopRule): ParseResult {
  if (source.trim() === '') {
    return {
      tree: parser.configure({ top }).parse(''),
      diagnostics: [
        diagnostic(
          FEEL_DIAGNOSTIC_CODES.FEEL_EMPTY_EXPRESSION,
          'Expression is empty.',
          spanFor(source, 0, source.length),
        ),
      ],
    };
  }

  const tree = parserFor(scope, top).parse(source);

  return { tree, diagnostics: collectSyntaxErrors(tree, source) };
}

/**
 * `lezer` recovers from syntax errors rather than throwing, marking the
 * affected nodes. Surfacing them here is what makes a malformed expression a
 * deploy-time failure instead of a per-request null.
 */
function collectSyntaxErrors(tree: Tree, source: string): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  tree.iterate({
    enter: (node) => {
      if (!node.type.isError) {
        return;
      }

      const excerpt = source.slice(node.from, node.to).trim();
      const message =
        excerpt === ''
          ? `Unexpected end of expression at offset ${String(node.from)}.`
          : `Unexpected input ${JSON.stringify(excerpt)}.`;

      diagnostics.push(
        diagnostic(
          FEEL_DIAGNOSTIC_CODES.FEEL_PARSE_ERROR,
          message,
          spanFor(source, node.from, node.to),
        ),
      );
    },
  });

  return diagnostics;
}

/**
 * Node names that carry no semantics: punctuation and keywords the tree
 * structure already encodes.
 */
const STRUCTURAL_TOKENS = new Set([
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  ',',
  ':',
  '..',
  'if',
  'then',
  'else',
  'and',
  'or',
  'for',
  'return',
  'some',
  'every',
  'satisfies',
  'function',
]);

// `in`, `not` and `external` are deliberately absent. Each distinguishes one
// construct from another rather than merely punctuating it: `x in [...]` from
// an ordinary comparison, a negated unary test from a positive one, and an
// external function binding from an executable one. Filtering `not` silently
// turned `not(1, 2)` into `1, 2`, inverting the match; filtering `external`
// turned a Java binding into an ordinary function over a descriptor context.

/** The children of `node` that carry meaning, in source order. */
export function significantChildren(node: SyntaxNode): SyntaxNode[] {
  const children: SyntaxNode[] = [];

  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    if (!STRUCTURAL_TOKENS.has(child.name)) {
      children.push(child);
    }
  }

  return children;
}
