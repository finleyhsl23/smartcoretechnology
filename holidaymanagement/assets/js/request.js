import { requireAuth, applyRoleUi } from '../../shared/guards.js';
import { signOut } from '../../shared/auth.js';
import { revealApp, showMessage, setLoadingButton } from '../../shared/ui.js';
import { getMyLeaveBalance, getCompanyHolidays, createLeaveRequest } from '../../shared/api.js';
import { calculateBusinessDays } from '../../shared/dates.js';

const auth = await requireAuth();
if (!auth) throw new Error('Unauthorised');

const { profile } = auth;
applyRoleUi(profile);

document.getElementById('logoutBtn')?.addEventListener('click', async () => {
  await signOut();
  window.location.href = './login.html';
});

const currentYear = new Date().getFullYear();
const balance = await getMyLeaveBalance(profile.id, currentYear);
const holidays = await getCompanyHolidays(profile.company_id);
const holidayDates = holidays.map((item) => item.holiday_date);

document.getElementById('balancePreview').textContent = balance?.remaining_days ?? '0';

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
    : Math.max(1, Math.ceil((new Date(endDate) - new Date(startDate)) / 86400000) + 1);

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

  if (leaveType === 'annual' && balance && totalDays > Number(balance.remaining_days || 0)) {
    showMessage('requestMessage', 'This request is greater than your remaining annual leave.', 'error');
    return;
  }

  try {
    setLoadingButton(submitButton, true, 'Submitting...');

    await createLeaveRequest({
      user_id: profile.id,
      company_id: profile.company_id,
      leave_type: leaveType,
      start_date: startDate,
      end_date: endDate,
      total_days: totalDays,
      status: 'pending',
      reason: reason || null,
      notes: notes || null
    });

    form.reset();
    totalDaysEl.value = '';
    showMessage('requestMessage', 'Leave request submitted successfully.', 'success');
  } catch (error) {
    console.error(error);
    showMessage('requestMessage', error.message || 'Unable to submit request.', 'error');
  } finally {
    setLoadingButton(submitButton, false);
  }
});

revealApp();
