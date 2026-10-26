/**
 * `@smarthorizon-labs/dmn-xml`
 *
 * Secure, version-aware DMN XML loading. The threat model is in SECURITY.md.
 */

export {
  DEFAULT_XML_LIMITS,
  XmlParseError,
  XmlSecurityError,
  attribute,
  childNamed,
  childrenNamed,
  parseXml,
  textOfChild,
  type XmlElement,
  type XmlLimits,
} from './secure-xml.js';

export { DmnLoadError, detectDmnVersion, loadDmnXml, readExpression } from './dmn.js';
