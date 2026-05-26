import { requireAuth, applyRoleUi, isAdminProfile } from '../../shared/guards.js';
import { signOut } from '../../shared/auth.js';
import { revealApp, showMessage, setLoadingButton, showPageError, renderEmptyState } from '../../shared/ui.js';
import {
  getMyLeaveRequests,
  getMyLeaveBalance,
  getCompanyHolidays,
  createLeaveRequest,
  getLeaveOverlap,
  leaveTypeLabel,
  dayTypeLabel,
  calculateEmployeeLeaveDays
} from '../../shared/api.js';
import { calculateBusinessDays, calculateCalendarDays, formatDate } from '../../shared/dates.js';

function calculateLeaveStats(profile, requests, balance) {
  const fallbackAllowance = Number(profile.annual_leave_allowance || 0);

  const fallbackUsed = (requests || [])
    .filter((request) =>
      request.status === 'approved' &&
      request.deduct_allowance !== false &&
      ['annual', 'other'].includes(request.leave_type)
    )
    .reduce((sum, request) => sum + Number(request.total_days || 0), 0);

  const allowance = Number(balance?.total_allowance ?? fallbackAllowance);
  const used = Number(balance?.used_days ?? fallbackUsed);
  const remaining = Number(balance?.remaining_days ?? Math.max(0, allowance - used));

  return { allowance, used, remaining };
}

function openModal(id) {
  document.getElementById(id)?.classList.remove('hidden');
}

function closeModal(id) {
  document.getElementById(id)?.classList.add('hidden');
}

function restrictLeaveTypes(profile) {
  const leaveTypeEl = document.getElementById('leaveType');
  if (!leaveTypeEl) return;

  const isAdmin = isAdminProfile(profile);

  if (!isAdmin) {
    [...leaveTypeEl.options].forEach((option) => {
      if (option.value !== 'annual') option.remove();
    });

    leaveTypeEl.value = 'annual';
  }
}

function isHalfDay(dayType) {
  return dayType === 'half_am' || dayType === 'half_pm';
}

function isHoliday(holidayDates, isoDate) {
  return holidayDates.includes(isoDate);
}

async function calculateTotalDays({
  employeeId,
  companyId,
  leaveType,
  dayType,
  startDate,
  endDate,
  holidayDates
}) {
  if (!startDate || !endDate) return 0;

  if (isHalfDay(dayType) && startDate !== endDate) return 0;

  try {
    const serverDays = await calculateEmployeeLeaveDays({
      employee_id: employeeId,
      company_id: companyId,
      start_date: startDate,
      end_date: endDate,
      leave_type: leaveType,
      day_type: dayType
    });

    return Number(serverDays || 0);
  } catch (error) {
    console.warn('Server leave calculation failed, using browser fallback:', error);
  }

  if (isHalfDay(dayType)) {
    if (leaveType === 'annual' && isHoliday(holidayDates, startDate)) return 0;
    return 0.5;
  }

  return leaveType === 'annual'
    ? calculateBusinessDays(startDate, endDate, holidayDates)
    : calculateCalendarDays(startDate, endDate);
}

async function initRequestPage() {
  try {
    const auth = await requireAuth();
    if (!auth) return;

    const { profile, user } = auth;
    applyRoleUi(profile);

    const authUserId = profile.user_id || profile.auth_user_id || user.id;
    const employeeId = profile.employee_id || profile.id;
    const currentYear = new Date().getFullYear();

    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
      await signOut();
      window.location.href = './login.html';
    });

    document.querySelectorAll('[data-close-modal]').forEach((button) => {
      button.addEventListener('click', () => closeModal(button.dataset.closeModal));
    });

    restrictLeaveTypes(profile);

    let myRequests = [];
    let balance = null;

    try {
      myRequests = await getMyLeaveRequests(authUserId);
    } catch (error) {
      console.warn('Leave requests failed:', error);
    }

    try {
      balance = await getMyLeaveBalance(authUserId, currentYear);
    } catch (error) {
      console.warn('Leave balance failed:', error);
    }

    let stats = calculateLeaveStats(profile, myRequests, balance);

    const balancePreview = document.getElementById('balancePreview');
    if (balancePreview) balancePreview.textContent = stats.remaining;

    const holidays = await getCompanyHolidays(profile.company_id).catch(() => []);
    const holidayDates = holidays.map((item) => item.holiday_date).filter(Boolean);

    const form = document.getElementById('leaveRequestForm');
    const submitButton = form?.querySelector('button[type="submit"]');
    const leaveTypeEl = document.getElementById('leaveType');
    const dayTypeEl = document.getElementById('dayType');
    const startDateEl = document.getElementById('startDate');
    const endDateEl = document.getElementById('endDate');
    const totalDaysEl = document.getElementById('totalDays');
    const whoElseOffBtn = document.getElementById('whoElseOffBtn');

    async function updateTotalDays() {
      const leaveType = leaveTypeEl?.value || 'annual';
      const dayType = dayTypeEl?.value || 'full';
      const startDate = startDateEl?.value || '';
      const endDate = endDateEl?.value || '';

      if (!totalDaysEl) return;

      if (!startDate || !endDate) {
        totalDaysEl.value = '';
        return;
      }

      if (isHalfDay(dayType) && startDate !== endDate) {
        totalDaysEl.value = '';
        showMessage('requestMessage', 'Half days can only be requested when the start date and end date are the same.', 'error');
        return;
      }

      const days = await calculateTotalDays({
        employeeId,
        companyId: profile.company_id,
        leaveType,
        dayType,
        startDate,
        endDate,
        holidayDates
      });

      if (!days) {
        totalDaysEl.value = '';
        showMessage(
          'requestMessage',
          leaveType === 'annual'
            ? 'No annual leave days are deducted for this selection. Check bank/company holidays and your working pattern.'
            : 'Please check the selected dates.',
          'error'
        );
        return;
      }

      totalDaysEl.value = String(days);
      showMessage('requestMessage', '');
    }

    leaveTypeEl?.addEventListener('change', updateTotalDays);
    dayTypeEl?.addEventListener('change', updateTotalDays);
    startDateEl?.addEventListener('change', updateTotalDays);
    endDateEl?.addEventListener('change', updateTotalDays);

    whoElseOffBtn?.addEventListener('click', async () => {
      const startDate = startDateEl?.value || '';
      const endDate = endDateEl?.value || '';
      const list = document.getElementById('overlapList');
      const subtitle = document.getElementById('overlapSubtitle');

      if (!startDate || !endDate) {
        showMessage('requestMessage', 'Choose a start date and end date first.', 'error');
        return;
      }

      if (subtitle) subtitle.textContent = `${formatDate(startDate)} to ${formatDate(endDate)}`;

      const items = await getLeaveOverlap(profile.company_id, startDate, endDate);
      const filtered = items.filter((item) => item.employee_id !== employeeId);

      if (!filtered.length) {
        renderEmptyState(list, 'Nobody else is off in this period.');
      } else {
        list.innerHTML = filtered.map((item) => `
          <article class="leave-card">
            <p class="leave-card-title">${item.employee_name || 'Employee'}</p>
            <p class="leave-card-subtitle">${leaveTypeLabel(item.leave_type)} • ${dayTypeLabel(item.day_type)}</p>
            <p class="leave-card-subtitle">${formatDate(item.start_date)} to ${formatDate(item.end_date)} • ${item.total_days || 0} day(s)</p>
          </article>
        `).join('');
      }

      openModal('overlapModal');
    });

    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      showMessage('requestMessage', '');

      const leaveType = leaveTypeEl?.value || 'annual';
      const dayType = dayTypeEl?.value || 'full';
      const startDate = startDateEl?.value || '';
      const endDate = endDateEl?.value || '';
      const reason = document.getElementById('reason')?.value?.trim() || '';
      const notes = document.getElementById('notes')?.value?.trim() || '';

      const totalDays = await calculateTotalDays({
        employeeId,
        companyId: profile.company_id,
        leaveType,
        dayType,
        startDate,
        endDate,
        holidayDates
      });

      if (!startDate || !endDate || !totalDays) {
        showMessage('requestMessage', 'Please complete the dates properly.', 'error');
        return;
      }

      if (isHalfDay(dayType) && startDate !== endDate) {
        showMessage('requestMessage', 'Half days can only be requested when the start date and end date are the same.', 'error');
        return;
      }

      if (leaveType === 'annual' && totalDays > Number(stats.remaining || 0)) {
        showMessage('requestMessage', 'This request is greater than your remaining annual leave.', 'error');
        return;
      }

      try {
        setLoadingButton(submitButton, true, 'Submitting...');

        await createLeaveRequest({
          user_id: authUserId,
          employee_id: employeeId,
          company_id: profile.company_id,
          leave_type: leaveType,
          day_type: dayType,
          start_date: startDate,
          end_date: endDate,
          total_days: totalDays,
          status: 'pending',
          reason: reason || null,
          notes: notes || null,
          deduct_allowance: leaveType !== 'sick'
        });

        form.reset();
        if (dayTypeEl) dayTypeEl.value = 'full';
        if (totalDaysEl) totalDaysEl.value = '';

        const refreshedRequests = await getMyLeaveRequests(authUserId);
        const refreshedBalance = await getMyLeaveBalance(authUserId, currentYear).catch(() => null);

        stats = calculateLeaveStats(profile, refreshedRequests, refreshedBalance);

        if (balancePreview) balancePreview.textContent = stats.remaining;

        showMessage('requestMessage', 'Leave request submitted successfully.', 'success');
      } catch (error) {
        console.error(error);
        showMessage('requestMessage', error.message || 'Unable to submit request.', 'error');
      } finally {
        setLoadingButton(submitButton, false);
      }
    });

    revealApp();
  } catch (error) {
    showPageError(error, 'Request page failed to load');
  }
}

initRequestPage();
