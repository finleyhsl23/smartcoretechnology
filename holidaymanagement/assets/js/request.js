import { requireAuth, applyRoleUi } from '../../shared/guards.js';
import { signOut } from '../../shared/auth.js';
import { revealApp, showMessage, setLoadingButton, showPageError } from '../../shared/ui.js';
import {
  getMyLeaveRequests,
  getCompanyHolidays,
  createLeaveRequest
} from '../../shared/api.js';
import { calculateBusinessDays, calculateCalendarDays } from '../../shared/dates.js';

function calculateLeaveStats(profile, requests) {
  const allowance = Number(profile.annual_leave_allowance || 0);

  const used = (requests || [])
    .filter((request) =>
      request.status === 'approved' &&
      request.deduct_allowance !== false &&
      ['annual', 'other'].includes(request.leave_type)
    )
    .reduce((sum, request) => sum + Number(request.total_days || 0), 0);

  const remaining = Math.max(0, allowance - used);

  return { allowance, used, remaining };
}

async function initRequestPage() {
  try {
    const auth = await requireAuth();
    if (!auth) return;

    const { profile, user } = auth;
    applyRoleUi(profile);

    const authUserId = profile.user_id || profile.auth_user_id || user.id;
    const employeeId = profile.employee_id || profile.id;

    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
      await signOut();
      window.location.href = './login.html';
    });

    let myRequests = [];

    try {
      myRequests = await getMyLeaveRequests(authUserId);
    } catch (error) {
      console.warn('Leave requests failed:', error);
    }

    const stats = calculateLeaveStats(profile, myRequests);

    const balancePreview = document.getElementById('balancePreview');
    if (balancePreview) {
      balancePreview.textContent = stats.remaining;
    }

    const holidays = await getCompanyHolidays(profile.company_id);
    const holidayDates = holidays.map((item) => item.holiday_date);

    const form = document.getElementById('leaveRequestForm');
    const submitButton = form?.querySelector('button[type="submit"]');
    const leaveTypeEl = document.getElementById('leaveType');
    const startDateEl = document.getElementById('startDate');
    const endDateEl = document.getElementById('endDate');
    const totalDaysEl = document.getElementById('totalDays');

    function updateTotalDays() {
      const leaveType = leaveTypeEl.value;
      const startDate = startDateEl.value;
      const endDate = endDateEl.value;

      if (!startDate || !endDate) {
        totalDaysEl.value = '';
        return;
      }

      const days = leaveType === 'annual'
        ? calculateBusinessDays(startDate, endDate, holidayDates)
        : calculateCalendarDays(startDate, endDate);

      totalDaysEl.value = days > 0 ? String(days) : '';
    }

    leaveTypeEl?.addEventListener('change', updateTotalDays);
    startDateEl?.addEventListener('change', updateTotalDays);
    endDateEl?.addEventListener('change', updateTotalDays);

    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      showMessage('requestMessage', '');

      const leaveType = leaveTypeEl.value;
      const startDate = startDateEl.value;
      const endDate = endDateEl.value;
      const totalDays = Number(totalDaysEl.value || 0);
      const reason = document.getElementById('reason').value.trim();
      const notes = document.getElementById('notes').value.trim();

      if (!startDate || !endDate || !totalDays) {
        showMessage('requestMessage', 'Please complete the dates properly.', 'error');
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
          start_date: startDate,
          end_date: endDate,
          total_days: totalDays,
          status: 'pending',
          reason: reason || null,
          notes: notes || null,
          deduct_allowance: leaveType !== 'sick'
        });

        form.reset();
        totalDaysEl.value = '';

        const refreshedRequests = await getMyLeaveRequests(authUserId);
        const refreshedStats = calculateLeaveStats(profile, refreshedRequests);

        if (balancePreview) {
          balancePreview.textContent = refreshedStats.remaining;
        }

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
