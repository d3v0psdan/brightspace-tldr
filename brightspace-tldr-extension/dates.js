// Date helpers for board.js. Dates are stored as local 'YYYY-MM-DD' strings.
const DAY_MS = 86400000;

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function toIsoDate(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function fromIsoDate(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
}

// Work To Do headings drop the year ("Friday, October 2"). An overdue date is the
// latest match on or before today, an upcoming one the earliest on or after it.
function parseHeading(heading, isOverdue, now = new Date()) {
  const monthDay = heading.split(', ').slice(1).join(' ');
  if (!monthDay) return null;
  const today = startOfDay(now);
  const year = today.getFullYear();
  const candidates = [year - 1, year, year + 1].map(y => new Date(`${monthDay}, ${y}`));
  if (candidates.some(date => isNaN(date))) return null;
  const match = isOverdue
    ? candidates.filter(date => date <= today).pop()
    : candidates.find(date => date >= today);
  return match ? toIsoDate(match) : null;
}

// Rounding absorbs the 23/25 hour days around daylight saving changes.
function daysUntil(iso, now = new Date()) {
  if (!iso) return null;
  return Math.round((fromIsoDate(iso) - startOfDay(now)) / DAY_MS);
}

function dueBadge(days) {
  if (days === null) return '';
  if (days < 0) return 'LATE';
  if (days === 0) return 'TODAY';
  return `${days}d`;
}

function weekBucket(days) {
  if (days === null) return 'Later';
  if (days < 0) return 'Overdue';
  if (days < 7) return 'This week';
  if (days < 14) return 'Next week';
  return 'Later';
}

function formatDue(iso) {
  if (!iso) return 'No due date';
  return fromIsoDate(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

if (typeof module === 'object') module.exports = { parseHeading, daysUntil, dueBadge, weekBucket };
