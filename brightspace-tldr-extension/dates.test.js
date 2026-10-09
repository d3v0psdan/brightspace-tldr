// Run: node brightspace-tldr-extension/dates.test.js
const assert = require('node:assert');
const { parseHeading, daysUntil, dueBadge, weekBucket } = require('./dates.js');

const now = new Date(2026, 9, 8, 18, 30); // Thursday, October 8 2026, evening
assert.equal(parseHeading('Friday, October 2', true, now), '2026-10-02');
assert.equal(parseHeading('Thursday, October 8', false, now), '2026-10-08');
assert.equal(parseHeading('Thursday, November 19', false, now), '2026-11-19');
assert.equal(parseHeading('Today', false, now), null);

// Headings have no year, so the section decides which side of New Year a date is on.
assert.equal(parseHeading('Monday, December 21', true, new Date(2027, 0, 5)), '2026-12-21');
assert.equal(parseHeading('Friday, January 15', false, new Date(2027, 0, 5)), '2027-01-15');
assert.equal(parseHeading('Tuesday, January 5', false, new Date(2026, 11, 28)), '2027-01-05');

assert.equal(daysUntil('2026-10-08', now), 0);
assert.equal(daysUntil('2026-10-02', now), -6);
assert.equal(daysUntil('2026-11-02', now), 25); // spans the November 1 clock change
assert.equal(daysUntil(null, now), null);

assert.deepEqual([-6, 0, 3, null].map(dueBadge), ['LATE', 'TODAY', '3d', '']);
assert.deepEqual([-1, 0, 6, 7, 13, 14, null].map(weekBucket),
  ['Overdue', 'This week', 'This week', 'Next week', 'Next week', 'Later', 'Later']);

console.log('dates ok');
