export function formatDate(dateValue) {
  if (!dateValue) return '—';
  const date = new Date(dateValue);
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).format(date);
}

export function isWeekend(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

export function calculateBusinessDays(startDate, endDate, holidayDates = []) {
  if (!startDate || !endDate) return 0;

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return 0;
  }

  const holidaySet = new Set(holidayDates);
  let count = 0;
  const current = new Date(start);

  while (current <= end) {
    const iso = current.toISOString().slice(0, 10);
    if (!isWeekend(current) && !holidaySet.has(iso)) {
      count += 1;
    }
    current.setDate(current.getDate() + 1);
  }

  return count;
}

export function isDateInRange(targetIsoDate, startIsoDate, endIsoDate) {
  return targetIsoDate >= startIsoDate && targetIsoDate <= endIsoDate;
}
