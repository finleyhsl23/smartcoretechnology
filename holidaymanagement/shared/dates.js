export function formatDate(dateValue) {
  if (!dateValue) return '—';
  const date = new Date(dateValue);
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).format(date);
}

export function formatShortDate(dateValue) {
  if (!dateValue) return '—';
  const date = new Date(dateValue);
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short'
  }).format(date);
}

export function toIsoDate(date = new Date()) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function isWeekend(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

export function calculateBusinessDays(startDate, endDate, holidayDates = []) {
  if (!startDate || !endDate) return 0;

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0;

  const holidaySet = new Set((holidayDates || []).filter(Boolean));
  let count = 0;
  const current = new Date(start);

  while (current <= end) {
    const iso = toIsoDate(current);
    if (!isWeekend(current) && !holidaySet.has(iso)) count += 1;
    current.setDate(current.getDate() + 1);
  }

  return count;
}

export function calculateCalendarDays(startDate, endDate) {
  if (!startDate || !endDate) return 0;
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0;
  return Math.ceil((end - start) / 86400000) + 1;
}

export function isDateInRange(targetIsoDate, startIsoDate, endIsoDate) {
  return targetIsoDate >= startIsoDate && targetIsoDate <= endIsoDate;
}

export function addDays(isoDate, days) {
  const date = new Date(isoDate);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

export function getDaysRemainingInYear(startDate) {
  if (!startDate) return 365;

  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) return 365;

  const year = start.getFullYear();
  const end = new Date(year, 11, 31);

  if (start > end) return 0;

  return Math.ceil((end - start) / 86400000) + 1;
}

export function calculateProratedYearAllowance(annualAllowance, startDate) {
  const allowance = Number(annualAllowance || 0);
  if (!allowance) return 0;
  if (!startDate) return allowance;

  const start = new Date(startDate);
  const today = new Date();

  if (Number.isNaN(start.getTime())) return allowance;
  if (start.getFullYear() < today.getFullYear()) return allowance;
  if (start.getFullYear() > today.getFullYear()) return 0;

  const daysRemaining = getDaysRemainingInYear(startDate);
  return Math.round(((allowance / 365) * daysRemaining) * 2) / 2;
}

export function getMonthMatrix(date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = new Date(year, month, 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const gridStart = new Date(year, month, 1 - startOffset);
  const days = [];

  for (let i = 0; i < 42; i += 1) {
    const current = new Date(gridStart);
    current.setDate(gridStart.getDate() + i);
    days.push({
      iso: toIsoDate(current),
      day: current.getDate(),
      inMonth: current.getMonth() === month
    });
  }

  return days;
}
