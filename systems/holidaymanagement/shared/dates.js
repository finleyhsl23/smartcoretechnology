export function toISODate(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toISOString().split('T')[0];
}

export function today() {
  return toISODate(new Date());
}

export function diffDays(start, end) {
  const a = new Date(start), b = new Date(end);
  return Math.round((b - a) / 86400000) + 1;
}

export function countWorkingDays(startStr, endStr, holidays = []) {
  const holidaySet = new Set(holidays.map(h => (typeof h === 'string' ? h : h.date)));
  let count = 0;
  const current = new Date(startStr);
  const last = new Date(endStr);
  while (current <= last) {
    const dow = current.getDay();
    const iso = toISODate(current);
    if (dow !== 0 && dow !== 6 && !holidaySet.has(iso)) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
}

export function formatDateShort(dateStr) {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  } catch { return dateStr; }
}

export function formatDateFull(dateStr) {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch { return dateStr; }
}

export function monthName(index) {
  return ['January','February','March','April','May','June',
          'July','August','September','October','November','December'][index];
}

export function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

export function firstDayOfMonth(year, month) {
  const d = new Date(year, month, 1).getDay();
  return d === 0 ? 6 : d - 1; // Mon-first: 0=Mon ... 6=Sun
}

export function getAgeInYears(dobStr) {
  if (!dobStr) return null;
  const dob = new Date(dobStr);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

export function getYearsService(startDateStr) {
  if (!startDateStr) return null;
  return getAgeInYears(startDateStr);
}
