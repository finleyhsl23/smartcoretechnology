import { requireAuth, isAdminProfile } from '../../shared/guards.js';
import { signOut } from '../../shared/auth.js';
import { renderEmptyState, escapeHtml } from '../../shared/ui.js';
import { formatDate, toIsoDate } from '../../shared/dates.js';
import * as api from '../../shared/api.js';

const ctx = await requireAuth();
if (ctx) {
  const { profile, user } = ctx;
  const el = id => document.getElementById(id);
  document.getElementById('logoutBtn')?.addEventListener('click', async () => { await signOut(); location.href = './login.html'; });
  el('welcomeText').textContent = `Welcome back, ${profile.full_name || user.email}`;
  el('profileName').textContent = profile.full_name || '—';
  el('profileEmail').textContent = profile.work_email || user.email;
  el('profileRole').textContent = profile.role || 'employee';

  const [reqs, balance] = await Promise.all([api.getMyLeave(profile).catch(() => []), api.getBalance(profile.employee_id).catch(() => null)]);
  const allowance = Number(balance?.total_allowance ?? profile.annual_leave_allowance ?? 0);
  const used = Number(balance?.used_days ?? 0);
  el('profileAllowance').textContent = allowance;
  el('profileUsed').textContent = used;
  el('profileRemaining').textContent = Number(balance?.remaining_days ?? (allowance - used));
  el('profilePending').textContent = reqs.filter(r => r.status === 'pending').length;

  function list(id, rows, empty = 'Nothing to show.') {
    const el = document.getElementById(id);
    if (!rows.length) return renderEmptyState(el, empty);
    el.innerHTML = rows.map(r => `
      <article class="leave-card">
        <p class="leave-card-title">${escapeHtml(r.employees?.full_name || r.full_name || 'Employee')}</p>
        <p class="leave-card-subtitle">${escapeHtml(r.employees?.job_title || r.job_title || '—')} ${r.employees?.department || r.department ? '• ' + escapeHtml(r.employees?.department || r.department) : ''}</p>
        ${r.start_date ? `<p class="leave-card-subtitle">${formatDate(r.start_date)} to ${formatDate(r.end_date)}</p>` : ''}
      </article>`).join('');
  }
  function isWithinNext7Recurring(dateValue) {
    if (!dateValue) return false;
    const today = new Date();
    for (let i = 0; i <= 7; i++) {
      const check = new Date(today); check.setDate(today.getDate() + i);
      const target = new Date(dateValue);
      if (check.getMonth() === target.getMonth() && check.getDate() === target.getDate()) return true;
    }
    return false;
  }

  if (isAdminProfile(profile)) {
    el('adminDashboardSection').classList.remove('hidden');
    const [all, employees] = await Promise.all([api.getLeaveRequests(profile.company_id).catch(() => []), api.getEmployees(profile.company_id).catch(() => [])]);
    const today = toIsoDate(new Date());
    const todays = all.filter(r => r.status === 'approved' && r.start_date <= today && r.end_date >= today);
    const birthdays = employees.filter(e => isWithinNext7Recurring(e.dob));
    const anniversaries = employees.filter(e => isWithinNext7Recurring(e.start_date));

    el('annualTodayCount').textContent = todays.filter(r => r.leave_type === 'annual').length;
    el('sickTodayCount').textContent = todays.filter(r => r.leave_type === 'sick').length;
    el('otherTodayCount').textContent = todays.filter(r => r.leave_type === 'other').length;
    el('birthdaysCount').textContent = birthdays.length;
    el('anniversariesCount').textContent = anniversaries.length;

    list('annualTodayList', todays.filter(r => r.leave_type === 'annual'));
    list('sickTodayList', todays.filter(r => r.leave_type === 'sick'));
    list('otherTodayList', todays.filter(r => r.leave_type === 'other'));
    list('birthdaysList', birthdays.map(e => ({...e, start_date: e.dob, end_date: e.dob})), 'No birthdays in the next 7 days.');
    list('anniversariesList', anniversaries.map(e => ({...e, start_date: e.start_date, end_date: e.start_date})), 'No work anniversaries in the next 7 days.');

    document.querySelectorAll('[data-panel-target]').forEach(btn => btn.addEventListener('click', () => {
      document.querySelectorAll('.dashboard-detail-panel').forEach(p => p.classList.add('hidden'));
      document.querySelectorAll('.stat-button').forEach(b => b.classList.remove('active-stat-button'));
      document.getElementById(btn.dataset.panelTarget)?.classList.remove('hidden');
      btn.classList.add('active-stat-button');
    }));
  }
}
