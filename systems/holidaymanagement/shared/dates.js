
export function toIsoDate(date=new Date()){const d=new Date(date);d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,10)}
export function formatDate(v){if(!v)return '—'; return new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(v))}
export function calculateCalendarDays(s,e){if(!s||!e)return 0;const a=new Date(s),b=new Date(e);if(b<a)return 0;return Math.ceil((b-a)/86400000)+1}
export function isDateInRange(t,s,e){return t>=s&&t<=e}
export function roundHalf(n){return Math.round(Number(n||0)*2)/2}
export function prorateAllowance(allowance,startDate,year=new Date().getFullYear()){const a=Number(allowance||0);if(!startDate)return a;const s=new Date(startDate);if(s.getFullYear()<year)return a;if(s.getFullYear()>year)return 0;const end=new Date(year,11,31);return roundHalf((a/365)*(Math.ceil((end-s)/86400000)+1))}
