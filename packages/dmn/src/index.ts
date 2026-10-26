/**
 * `@smarthorizon-labs/dmn`
 *
 * The one-install entry point. Re-exports the runtime, the FEEL engine, the
 * model types and the XML loader, so that the common case — load a DMN file,
 * compile it, evaluate it — needs a single dependency and a single import.
 *
 * This package defines no behaviour of its own. Every symbol here is exported
 * by one of the four packages below, and the granular packages remain
 * published for anyone who wants a subset — most usefully `dmn-feel`, which is
 * a standalone FEEL engine and has uses beyond DMN.
 *
 * The low-level XML tree helpers are deliberately not re-exported. They exist
 * for the loader's own use; a consumer reaching for them wants
 * `@smarthorizon-labs/dmn-xml` directly and should say so.
 */

export * from '@smarthorizon-labs/dmn-model';
export * from '@smarthorizon-labs/dmn-feel';
export * from '@smarthorizon-labs/dmn-runtime';

export {
  DEFAULT_XML_LIMITS,
  DmnLoadError,
  XmlParseError,
  XmlSecurityError,
  detectDmnVersion,
  loadDmnXml,
  type XmlLimits,
} from '@smarthorizon-labs/dmn-xml';
