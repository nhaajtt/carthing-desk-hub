import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIcs, agenda, wallToUtc } from '../server/calendar.mjs';

const TZ = 'America/Los_Angeles';
const ics = (...events) => ['BEGIN:VCALENDAR', ...events.flatMap((e) => ['BEGIN:VEVENT', ...e, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');
const pt = (y, mo, d, h = 0, mi = 0) => wallToUtc({ y, mo, d, h, mi }, TZ);
const DAY = 86400000;

test('local times follow daylight saving', () => {
  assert.equal(new Date(pt(2026, 7, 1, 9)).toISOString(), '2026-07-01T16:00:00.000Z'); // PDT, UTC-7
  assert.equal(new Date(pt(2026, 12, 1, 9)).toISOString(), '2026-12-01T17:00:00.000Z'); // PST, UTC-8
});

test('single event with TZID, UTC event and folded summary', () => {
  const evs = parseIcs(ics(
    ['UID:a', 'DTSTART;TZID=America/Los_Angeles:20261019T090000', 'DTEND;TZID=America/Los_Angeles:20261019T100000', 'SUMMARY:Stand', '  up\\, team'], // folded line: one leading space is removed
    ['UID:b', 'DTSTART:20261019T200000Z', 'DURATION:PT30M', 'SUMMARY:Call'],
  ), TZ);
  const out = agenda(evs, pt(2026, 10, 19), pt(2026, 10, 20));
  assert.deepEqual(out.map((e) => e.title), ['Stand up, team', 'Call']);
  assert.equal(out[0].start, pt(2026, 10, 19, 9));
  assert.equal(out[1].end - out[1].start, 30 * 60000);
});

test('weekly recurrence keeps local time across DST, honours EXDATE and moved instances', () => {
  const evs = parseIcs(ics(
    ['UID:w', 'DTSTART;TZID=America/Los_Angeles:20261026T100000', 'DTEND;TZID=America/Los_Angeles:20261026T103000',
      'RRULE:FREQ=WEEKLY;BYDAY=MO,WE', 'EXDATE;TZID=America/Los_Angeles:20261028T100000', 'SUMMARY:Gym'],
    ['UID:w', 'RECURRENCE-ID;TZID=America/Los_Angeles:20261102T100000', 'DTSTART;TZID=America/Los_Angeles:20261102T180000',
      'DTEND;TZID=America/Los_Angeles:20261102T183000', 'SUMMARY:Gym (evening)'],
  ), TZ);
  const out = agenda(evs, pt(2026, 10, 26), pt(2026, 11, 6));
  assert.deepEqual(out.map((e) => [new Date(e.start).toISOString(), e.title]), [
    ['2026-10-26T17:00:00.000Z', 'Gym'],           // PDT
    ['2026-11-03T02:00:00.000Z', 'Gym (evening)'], // moved instance: 6 pm PST on Nov 2
    ['2026-11-04T18:00:00.000Z', 'Gym'],           // after DST ends: still 10 am local
  ]);
});

test('all-day, monthly by weekday, COUNT and cancelled events', () => {
  const evs = parseIcs(ics(
    ['UID:h', 'DTSTART;VALUE=DATE:20261126', 'DTEND;VALUE=DATE:20261127', 'SUMMARY:Thanksgiving'],
    ['UID:m', 'DTSTART;TZID=America/Los_Angeles:20260908T120000', 'DTEND;TZID=America/Los_Angeles:20260908T130000', 'RRULE:FREQ=MONTHLY;BYDAY=2TU;COUNT=4', 'SUMMARY:Lunch'],
    ['UID:c', 'DTSTART:20261110T200000Z', 'DTEND:20261110T210000Z', 'STATUS:CANCELLED', 'SUMMARY:Gone'],
  ), TZ);
  const out = agenda(evs, pt(2026, 11, 1), pt(2027, 1, 31));
  assert.deepEqual(out.map((e) => e.title), ['Lunch', 'Thanksgiving', 'Lunch']); // Nov 10, Nov 26, Dec 8; COUNT ends it
  assert.equal(out[1].allDay, true);
  assert.equal(out[1].end - out[1].start, DAY);
  assert.equal(out[0].start, pt(2026, 11, 10, 12));
});

test('an old daily series still reaches today', () => {
  const evs = parseIcs(ics(['UID:d', 'DTSTART;TZID=America/Los_Angeles:20100101T070000', 'DTEND;TZID=America/Los_Angeles:20100101T071500', 'RRULE:FREQ=DAILY', 'SUMMARY:Pills']), TZ);
  const out = agenda(evs, pt(2026, 10, 17), pt(2026, 10, 19));
  assert.equal(out.length, 2);
  assert.equal(out[0].start, pt(2026, 10, 17, 7));
});
