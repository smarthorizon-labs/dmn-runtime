/**
 * Input helpers for the examples.
 *
 * Values are constructed explicitly rather than inferred from JavaScript
 * literals, because the inference would be wrong in the case that matters: a
 * JavaScript number has already lost precision before the runtime sees it, so
 * a monetary amount has to arrive as a string.
 */

import { parseDate, parseDateTime, parseDuration, toFeelNumber } from '@smarthorizon-labs/dmn-feel';

/** A FEEL number. Always pass a string for money. */
export const n = (literal) => toFeelNumber(String(literal));

/** A FEEL date, from its ISO form. */
export const d = (iso) => parseDate(iso);

/** A FEEL date and time, from its ISO form. */
export const dt = (iso) => parseDateTime(iso);

/** A FEEL duration, from its ISO 8601 form. */
export const dur = (iso) => parseDuration(iso);
