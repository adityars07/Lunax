import * as chrono from 'chrono-node';
import type { DateReference, DateCandidate } from './types.js';

/**
 * Parse temporal references from a message and return candidate date ranges.
 * For ambiguous phrases like "last Tuesday", both possible weeks are returned
 * so that memory lookup can disambiguate.
 */
export function resolveTemporalRefs(
  message: string,
  _tz: string,
  now: string,
): DateReference[] {
  const refDate = new Date(now);
  const results = chrono.parse(message, refDate);

  return results.map((result) => {
    const ref: DateReference = {
      text: result.text,
      candidates: [],
    };

    // "this week" / "earlier this week"
    if (/this\s+week/i.test(result.text)) {
      const start = new Date(refDate);
      const day = start.getDay();
      const diffToMonday = (day === 0 ? -6 : 1) - day;
      const monday = new Date(start);
      monday.setDate(start.getDate() + diffToMonday);
      monday.setHours(0, 0, 0, 0);

      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      sunday.setHours(23, 59, 59, 999);

      ref.candidates.push({
        start: monday,
        end: sunday,
        label: `This week (${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${sunday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`,
      });
      return ref;
    }

    // "last week"
    if (/last\s+week/i.test(result.text)) {
      const start = new Date(refDate);
      const day = start.getDay();
      const diffToMonday = (day === 0 ? -6 : 1) - day - 7;
      const monday = new Date(start);
      monday.setDate(start.getDate() + diffToMonday);
      monday.setHours(0, 0, 0, 0);

      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      sunday.setHours(23, 59, 59, 999);

      ref.candidates.push({
        start: monday,
        end: sunday,
        label: `Last week (${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${sunday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`,
      });
      return ref;
    }

    const primaryDate = result.start.date();
    ref.candidates.push(dayRange(primaryDate));

    // "last <weekday>" — also try one week earlier
    if (/last\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.test(result.text)) {
      const alt = new Date(primaryDate);
      alt.setDate(alt.getDate() - 7);
      ref.candidates.push(dayRange(alt));
    }

    // "on <weekday>" (no "last") — could be this week or last
    if (
      /\bon\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.test(result.text) &&
      !/last/i.test(result.text)
    ) {
      const alt = new Date(primaryDate);
      alt.setDate(alt.getDate() - 7);
      ref.candidates.push(dayRange(alt));
    }

    return ref;
  });
}

/** Build a full-day range (00:00 → 23:59) for a given date. */
function dayRange(date: Date): DateCandidate {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setHours(23, 59, 59, 999);

  const label = start.toLocaleDateString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return { start, end, label };
}

/** Format resolved date references for the router prompt. */
export function formatDateContext(refs: DateReference[]): string {
  if (refs.length === 0) return '';

  return refs
    .map((ref) => {
      const labels = ref.candidates.map((c) => c.label).join(' or ');
      const resolved = ref.resolved ? ` → resolved to ${ref.resolved.label}` : '';
      return `"${ref.text}" → ${labels}${resolved}`;
    })
    .join('\n');
}

