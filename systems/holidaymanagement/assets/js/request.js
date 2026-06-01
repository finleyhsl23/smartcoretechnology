import { requireAuth, isAdminProfile } from '../../shared/guards.js';
import { signOut } from '../../shared/auth.js';
import { showMessage, setLoadingButton, renderEmptyState, openModal, closeModal, escapeHtml } from '../../shared/ui.js';
import { formatDate } from '../../shared/dates.js';
import * as api from '../../shared/api.js';

const ctx = await requireAuth();
if (ctx) {
  const { profile, user } = ctx;
  const form = document.getElementById('leaveRequestForm');
  const submitBtn = form?.querySelector('button[type="submit"]');
  const leaveTypeEl = document.getElementById('leaveType');
  const dayTypeEl = document.getElementById('dayType');
  const startDateEl = document.getElementById('startDate');
  const endDateEl = document.getElementById('endDate');
  const totalDaysEl = document.getElementById('totalDays');
  const reasonEl = document.getElementById('reason');
  const notesEl = document.getElementById('notes');

  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await signOut();
    location.href = './login.html';
  });
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.closeModal));
  });

  if (!isAdminProfile(profile)) {
    [...leaveTypeEl.options].forEach(option => {
      if (option.value !== 'annual') option.remove();
    });
    leaveTypeEl.value = 'annual';
  }

  async function calculateAndShow() {
    const payload = {
      employee_id: profile.employee_id,
      company_id: profile.company_id,
      leave_type: leaveTypeEl.value,
      day_type: dayTypeEl.value,
      start_date: startDateEl.value,
      end_date: endDateEl.value
    };

    if (!payload.start_date || !payload.end_date) {
      totalDaysEl.value = '';
      return 0;
    }
    if (['half_am', 'half_pm'].includes(payload.day_type) && payload.start_date !== payload.end_date) {
      totalDaysEl.value = '';
      showMessage('requestMessage', 'Half days can only be requested for one date.', 'error');
      return 0;
    }

    try {
      const days = await api.calculateLeaveDays(payload);
      totalDaysEl.value = days || '';
      showMessage('requestMessage', days ? '' : 'No leave days are deducted for this selection. Check holidays and working pattern.');
      return days;
    } catch (error) {
      totalDaysEl.value = '';
      showMessage('requestMessage', error.message || 'Could not calculate leave days.', 'error');
      return 0;
    }
  }

  [leaveTypeEl, dayTypeEl, startDateEl, endDateEl].forEach(el => el?.addEventListener('change', calculateAndShow));

  document.getElementById('whoElseOffBtn')?.addEventListener('click', async () => {
    const start = startDateEl.value;
    const end = endDateEl.value;
    const list = document.getElementById('overlapList');
    const subtitle = document.getElementById('overlapSubtitle');

    if (!start || !end) {
      showMessage('requestMessage', 'Choose a start date and end date first.', 'error');
      return;
    }

    if (subtitle) subtitle.textContent = `${formatDate(start)} to ${formatDate(end)}`;
    openModal('overlapModal');
    renderEmptyState(list, 'Loading...');

    try {
      const rows = await api.getLeaveOverlap(profile.company_id, start, end);
      const others = rows.filter(r => r.employee_id !== profile.employee_id && r.status !== 'rejected' && r.status !== 'cancelled');
      if (!others.length) {
        renderEmptyState(list, 'Nobody else is off in this period.');
        return;
      }
      list.innerHTML = others.map(r => `
        <article class="leave-card">
          <p class="leave-card-title">${escapeHtml(r.employees?.full_name || 'Employee')}</p>
          <p class="leave-card-subtitle">${escapeHtml(r.employees?.job_title || '—')}${r.employees?.department ? ` • ${escapeHtml(r.employees.department)}` : ''}</p>
          <p class="leave-card-subtitle">${api.leaveTypeLabel(r.leave_type)} • ${formatDate(r.start_date)} to ${formatDate(r.end_date)} • ${r.total_days || 0} day(s)</p>
        </article>`).join('');
    } catch (error) {
      renderEmptyState(list, error.message || 'Could not load who else is off.');
    }
  });

  form?.addEventListener('submit', async event => {
    event.preventDefault();
    const total = await calculateAndShow();
    if (!total) return;

    try {
      setLoadingButton(submitBtn, true, 'Submitting...');
      await api.createLeaveRequest({
        company_id: profile.company_id,
        employee_id: profile.employee_id,
        user_id: user.id,
        leave_type: leaveTypeEl.value,
        day_type: dayTypeEl.value,
        start_date: startDateEl.value,
        end_date: endDateEl.value,
        reason: reasonEl.value.trim(),
        notes: notesEl.value.trim()
      });
      showMessage('requestMessage', 'Leave request submitted.', 'success');
      form.reset();
      totalDaysEl.value = '';
    } catch (error) {
      showMessage('requestMessage', error.message || 'Could not submit leave request.', 'error');
    } finally {
      setLoadingButton(submitBtn, false);
    }
  });
}
