/**
 * A minimal, deliberately restricted XML reader.
 *
 * Original work. No external entity resolution, no network retrieval, DTDs
 * rejected by policy, and enforced limits on document size and nesting
 * depth.
 *
 * `saxes` is used as the tokenizer because it reports line and column —
 * diagnostics without source positions are markedly less useful.
 */

import { SaxesParser, type SaxesTagNS } from 'saxes';

export interface XmlElement {
  /** Namespace URI, or the empty string when unqualified. */
  readonly uri: string;
  /** Local name, without prefix. */
  readonly local: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: readonly XmlElement[];
  /** Concatenated direct text content. */
  readonly text: string;
  readonly line: number;
  readonly column: number;
}

export interface XmlLimits {
  /** Maximum document size in characters. */
  readonly maxLength: number;
  readonly maxDepth: number;
}

export const DEFAULT_XML_LIMITS: XmlLimits = {
  maxLength: 8 * 1024 * 1024,
  maxDepth: 200,
};

export class XmlSecurityError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'XmlSecurityError';
  }
}

export class XmlParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly column: number,
  ) {
    super(message);
    this.name = 'XmlParseError';
  }
}

interface MutableElement {
  uri: string;
  local: string;
  attributes: Record<string, string>;
  children: XmlElement[];
  text: string;
  line: number;
  column: number;
}

/**
 * Parses XML into an element tree.
 *
 * Throws {@link XmlSecurityError} when a policy limit is breached and
 * {@link XmlParseError} when the document is not well formed. Both are
 * programmer- or input-level failures that callers convert into diagnostics.
 */
export function parseXml(source: string, limits: XmlLimits = DEFAULT_XML_LIMITS): XmlElement {
  if (source.length > limits.maxLength) {
    throw new XmlSecurityError(
      `Document exceeds the maximum size of ${String(limits.maxLength)} characters.`,
      'XML_DOCUMENT_TOO_LARGE',
    );
  }

  const parser = new SaxesParser<{ xmlns: true; position: true }>({
    xmlns: true,
    position: true,
  });
  const stack: MutableElement[] = [];
  let root: XmlElement | undefined;
  let failure: Error | undefined;

  parser.on('error', (error) => {
    failure ??= new XmlParseError(error.message, parser.line, parser.column);
  });

  parser.on('doctype', () => {
    // Rejecting the DTD outright removes entity expansion, external entity
    // resolution and billion-laughs in one policy rather than three defences.
    failure ??= new XmlSecurityError(
      'Document type declarations are not permitted.',
      'XML_DTD_NOT_PERMITTED',
    );
  });

  parser.on('opentag', (tag) => {
    if (failure !== undefined) {
      return;
    }

    if (stack.length >= limits.maxDepth) {
      failure = new XmlSecurityError(
        `Document nests deeper than the maximum of ${String(limits.maxDepth)}.`,
        'XML_DEPTH_EXCEEDED',
      );
      return;
    }

    stack.push({
      uri: tag.uri ?? '',
      local: tag.local ?? tag.name,
      attributes: readAttributes(tag),
      children: [],
      text: '',
      line: parser.line,
      column: parser.column,
    });
  });

  parser.on('text', (text) => {
    const current = stack[stack.length - 1];
    if (current !== undefined) {
      current.text += text;
    }
  });

  parser.on('cdata', (text) => {
    const current = stack[stack.length - 1];
    if (current !== undefined) {
      current.text += text;
    }
  });

  parser.on('closetag', () => {
    if (failure !== undefined) {
      return;
    }

    const finished = stack.pop();
    if (finished === undefined) {
      return;
    }

    const element: XmlElement = {
      uri: finished.uri,
      local: finished.local,
      attributes: finished.attributes,
      children: finished.children,
      text: finished.text,
      line: finished.line,
      column: finished.column,
    };

    const parent = stack[stack.length - 1];
    if (parent === undefined) {
      root ??= element;
    } else {
      parent.children.push(element);
    }
  });

  parser.write(source);
  parser.close();

  if (failure !== undefined) {
    throw failure;
  }

  if (root === undefined) {
    throw new XmlParseError('Document contains no root element.', 1, 1);
  }

  return root;
}

function readAttributes(tag: SaxesTagNS): Record<string, string> {
  // A null-prototype dictionary: attribute names come from the document and
  // must never reach Object.prototype.
  const attributes: Record<string, string> = Object.create(null) as Record<string, string>;

  for (const [name, attribute] of Object.entries(tag.attributes)) {
    if (name === '__proto__' || name === 'constructor' || name === 'prototype') {
      continue;
    }
    attributes[name] = attribute.value;
  }

  return attributes;
}

// --- tree helpers ---------------------------------------------------------

/** Direct children with the given local name, in any namespace. */
export function childrenNamed(element: XmlElement, local: string): readonly XmlElement[] {
  return element.children.filter((child) => child.local === local);
}

/** The first direct child with the given local name, if any. */
export function childNamed(element: XmlElement, local: string): XmlElement | undefined {
  return element.children.find((child) => child.local === local);
}

/**
 * An attribute value, ignoring any namespace prefix.
 *
 * DMN documents in the wild qualify attributes inconsistently, and none of the
 * attributes this loader reads are namespace-significant.
 */
export function attribute(element: XmlElement, name: string): string | undefined {
  const direct = element.attributes[name];
  if (direct !== undefined) {
    return direct;
  }

  for (const [key, value] of Object.entries(element.attributes)) {
    if (key.endsWith(`:${name}`)) {
      return value;
    }
  }

  return undefined;
}

/** Trimmed text of the first child with the given local name. */
export function textOfChild(element: XmlElement, local: string): string | undefined {
  const child = childNamed(element, local);
  return child === undefined ? undefined : child.text.trim();
}
