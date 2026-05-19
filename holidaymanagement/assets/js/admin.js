import { requireAdminPageAccess } from '../../shared/guards.js';
import { signOut } from '../../shared/auth.js';
import { revealApp, renderEmptyState, showMessage } from '../../shared/ui.js';
import {
  getAllCompanyLeaveRequests,
  getAllCompanySickRecords,
  approveLeaveRequest,
  rejectLeaveRequest,
  cancelLeaveRequestAdmin,
  amendLeaveRequestAdmin,
  enrichRequestsWithEmployeeInfo,
  getEmployeeLeaveSummary,
  searchEmployees,
  createManualAbsence,
  sendSupportLeaveApprovedEmail,
  leaveTypeLabel,
  dayTypeLabel
} from '../../shared/api.js';
import { formatDate, calculateBusinessDays, isDateInRange } from '../../shared/dates.js';

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? '—';
}

function calendarDays(startDate, endDate) {
  if (!startDate || !endDate) return 0;

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return 0;
  }

  return Math.ceil((end - start) / 86400000) + 1;
}

function todayIso() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

function isHalfDay(dayType) {
  return dayType === 'half_am' || dayType === 'half_pm';
}

function isOwnerProfile(profile) {
  return String(profile?.role || '').toLowerCase() === 'owner';
}

function getRequestUserId(request) {
  return request?.user_id || request?.employee?.user_id || request?.auth_user_id || null;
}

function isOwnRequest(request, authUserId) {
  const requestUserId = getRequestUserId(request);
  return Boolean(requestUserId && authUserId && String(requestUserId) === String(authUserId));
}

function isSelectedEmployeeSelf(employee, profile, authUserId) {
  if (!employee) return false;

  const employeeUserId = employee.user_id || employee.auth_user_id || null;
  const employeeId = employee.id || employee.employee_id || null;
  const profileEmployeeId = profile?.employee_id || profile?.id || null;

  return Boolean(
    (employeeUserId && authUserId && String(employeeUserId) === String(authUserId)) ||
    (employeeId && profileEmployeeId && String(employeeId) === String(profileEmployeeId))
  );
}

function getCustomSelectValue(id) {
  return document.getElementById(id)?.dataset.value || 'all';
}

function setCustomSelectValue(selectEl, value, label) {
  if (!selectEl) return;

  selectEl.dataset.value = value;

  const span = selectEl.querySelector('.custom-select-trigger span');
  if (span) span.textContent = label;
}

function setupCustomSelects(onChange) {
  document.querySelectorAll('.custom-select').forEach((selectEl) => {
    const trigger = selectEl.querySelector('.custom-select-trigger');
    const menu = selectEl.querySelector('.custom-select-menu');

    trigger?.addEventListener('click', (event) => {
      event.stopPropagation();

      document.querySelectorAll('.custom-select.open').forEach((openSelect) => {
        if (openSelect !== selectEl) openSelect.classList.remove('open');
      });

      selectEl.classList.toggle('open');
    });

    menu?.querySelectorAll('button[data-value]').forEach((option) => {
      option.addEventListener('click', () => {
        setCustomSelectValue(selectEl, option.dataset.value, option.textContent.trim());
        selectEl.classList.remove('open');

        if (typeof onChange === 'function') {
          onChange(selectEl);
        }
      });
    });
  });

  document.addEventListener('click', () => {
    document.querySelectorAll('.custom-select.open').forEach((selectEl) => {
      selectEl.classList.remove('open');
    });
  });
}

function openModal(id) {
  document.getElementById(id)?.classList.remove('hidden');
}

function closeModal(id) {
  document.getElementById(id)?.classList.add('hidden');
}

function renderDetailTile(label, value) {
  return `
    <div class="detail-tile">
      <span class="detail-label">${label}</span>
      <div class="detail-value">${value ?? '—'}</div>
    </div>
  `;
}

function renderLeaveHistory(entries) {
  if (!entries || !entries.length) {
    return '<div class="empty-state">No leave history found.</div>';
  }

  return entries.slice(0, 8).map((entry) => `
    <article class="leave-card">
      <p class="leave-card-title">${leaveTypeLabel(entry.leave_type)} • ${dayTypeLabel(entry.day_type)} • ${entry.status}</p>
      <p class="leave-card-subtitle">
        ${formatDate(entry.start_date)} to ${formatDate(entry.end_date)} • ${entry.total_days} day(s)
      </p>
    </article>
  `).join('');
}

function renderEmployeeProfile(employee) {
  const container = document.getElementById('employeeProfileContent');
  if (!container) return;

  if (!employee) {
    container.innerHTML = `<div class="empty-state">No employee profile found.</div>`;
    return;
  }

  const hiddenKeys = new Set(['display_name', 'employee_name', 'employee_id_display']);

  const entries = Object.entries(employee).filter(([key]) => !hiddenKeys.has(key));

  container.innerHTML = entries.map(([key, value]) => {
    const label = key.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());
    return renderDetailTile(label, value);
  }).join('');
}

function setDeductAllowanceVisibility(action, leaveType) {
  const checkbox = document.getElementById('requestDeductAllowance');
  const row = document.getElementById('requestDeductAllowanceRow');

  const shouldShow = action === 'approve' && ['annual', 'other'].includes(leaveType);

  if (checkbox) checkbox.checked = true;

  if (row) {
    row.classList.toggle('hidden', !shouldShow);
    row.style.display = shouldShow ? 'flex' : 'none';
  }
}

async function initAdmin() {
  try {
    const auth = await requireAdminPageAccess();
    if (!auth) return;

    const { profile, user } = auth;
    const authUserId = profile.user_id || profile.auth_user_id || user.id;
    const currentUserIsOwner = isOwnerProfile(profile);

    let requests = [];
    let selectedRequest = null;
    let pendingAction = null;
    let selectedEmployee = null;

    const adminLeaveList = document.getElementById('adminLeaveList');
    const confirmRequestActionBtn = document.getElementById('confirmRequestActionBtn');
    const requestActionNote = document.getElementById('requestActionNote');

    const employeeSearchInput = document.getElementById('employeeSearchInput');
    const employeeSearchResults = document.getElementById('employeeSearchResults');
    const selectedEmployeeBox = document.getElementById('selectedEmployeeBox');

    const manualAbsenceForm = document.getElementById('manualAbsenceForm');
    const manualDayType = document.getElementById('manualDayType');
    const manualStartDate = document.getElementById('manualStartDate');
    const manualEndDate = document.getElementById('manualEndDate');
    const manualTotalDays = document.getElementById('manualTotalDays');
    const manualDeductAllowance = document.getElementById('manualDeductAllowance');
    const manualReason = document.getElementById('manualReason');

    const amendForm = document.getElementById('amendForm');
    const amendDayType = document.getElementById('amendDayType');
    const amendStartDate = document.getElementById('amendStartDate');
    const amendEndDate = document.getElementById('amendEndDate');
    const amendTotalDays = document.getElementById('amendTotalDays');
    const amendReason = document.getElementById('amendReason');

    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
      await signOut();
      window.location.href = './login.html';
    });

    document.querySelectorAll('[data-close-modal]').forEach((button) => {
      button.addEventListener('click', () => closeModal(button.dataset.closeModal));
    });

    setupCustomSelects((selectEl) => {
      if (selectEl.id === 'adminStatusSelect' || selectEl.id === 'adminTypeSelect') {
        renderList();
      }

      if (selectEl.id === 'manualAbsenceTypeSelect') {
        updateManualDays();
      }
    });

    async function loadData() {
      requests = await getAllCompanyLeaveRequests(profile.company_id);
      requests = await enrichRequestsWithEmployeeInfo(requests, profile.company_id);

      let sickRecords = [];

      try {
        sickRecords = await getAllCompanySickRecords(profile.company_id);
      } catch {
        sickRecords = [];
      }

      const today = todayIso();

      setText('adminPendingCount', requests.filter((request) => request.status === 'pending').length);
      setText('adminCancelCount', requests.filter((request) => request.status === 'cancel_requested').length);

      setText(
        'adminOffToday',
        requests.filter((request) =>
          request.status === 'approved' &&
          isDateInRange(today, request.start_date, request.end_date)
        ).length
      );

      setText('adminSickOpen', sickRecords.filter((record) => !record.end_date).length);

      renderList();
    }

    function renderList() {
      if (!adminLeaveList) return;

      const statusValue = getCustomSelectValue('adminStatusSelect');
      const typeValue = getCustomSelectValue('adminTypeSelect');

      const filtered = requests.filter((item) => {
        const statusMatch = statusValue === 'all' || item.status === statusValue;
        const typeMatch = typeValue === 'all' || item.leave_type === typeValue;
        return statusMatch && typeMatch;
      });

      if (!filtered.length) {
        renderEmptyState(adminLeaveList, 'No requests match the current filters.');
        return;
      }

      adminLeaveList.innerHTML = filtered.map((item) => `
        <article class="leave-card admin-request-card">
          <div class="leave-card-top">
            <div>
              <p class="leave-card-title">${item.employee_name || 'Employee'} • ${leaveTypeLabel(item.leave_type)}</p>
              <p class="leave-card-subtitle">${item.employee_id_display || item.employee_id || '—'} • ${item.job_title || '—'}</p>
              <p class="leave-card-subtitle">
                ${formatDate(item.start_date)} to ${formatDate(item.end_date)} • ${item.total_days} day(s) • ${dayTypeLabel(item.day_type)}
              </p>
            </div>
            <div class="badge badge-${item.status}">${item.status}</div>
          </div>

          <div class="leave-card-bottom admin-request-bottom">
            <div>
              <p class="leave-card-subtitle"><strong>Reason:</strong> ${item.reason || 'No reason provided'}</p>
              <p class="leave-card-subtitle"><strong>Notes:</strong> ${item.notes || 'No notes added'}</p>
              ${item.cancellation_reason ? `<p class="leave-card-subtitle"><strong>Cancellation reason:</strong> ${item.cancellation_reason}</p>` : ''}
            </div>

            <div class="inline-actions">
              <button class="btn btn-secondary" data-action="more-info" data-id="${item.id}" type="button">More Info</button>

              ${
                item.status === 'pending'
                  ? `
                    <button class="btn btn-primary" data-action="approve" data-id="${item.id}" type="button">Approve</button>
                    <button class="btn btn-danger" data-action="reject" data-id="${item.id}" type="button">Reject</button>
                  `
                  : ''
              }

              ${
                item.status === 'approved'
                  ? `
                    <button class="btn btn-secondary" data-action="amend" data-id="${item.id}" type="button">Amend</button>
                    <button class="btn btn-danger" data-action="cancel" data-id="${item.id}" type="button">Cancel Leave</button>
                  `
                  : ''
              }

              ${
                item.status === 'cancel_requested'
                  ? `
                    <button class="btn btn-primary" data-action="approve-cancel" data-id="${item.id}" type="button">Approve Cancellation</button>
                    <button class="btn btn-danger" data-action="reject-cancel" data-id="${item.id}" type="button">Reject Cancellation</button>
                  `
                  : ''
              }
            </div>
          </div>
        </article>
      `).join('');
    }

    function updateManualDays() {
      if (!manualStartDate || !manualEndDate || !manualTotalDays) return;

      const absenceType = getCustomSelectValue('manualAbsenceTypeSelect');
      const dayType = manualDayType?.value || 'full';

      if (!manualStartDate.value || !manualEndDate.value) {
        manualTotalDays.value = '';
        return;
      }

      if (isHalfDay(dayType)) {
        if (manualStartDate.value !== manualEndDate.value) {
          manualTotalDays.value = '';
          showMessage('manualAbsenceMessage', 'Half days can only be used when the start date and end date are the same.', 'error');
          return;
        }

        manualTotalDays.value = '0.5';
        showMessage('manualAbsenceMessage', '');
        return;
      }

      const total = absenceType === 'annual'
        ? calculateBusinessDays(manualStartDate.value, manualEndDate.value)
        : calendarDays(manualStartDate.value, manualEndDate.value);

      manualTotalDays.value = total > 0 ? String(total) : '';
      showMessage('manualAbsenceMessage', '');
    }

    function updateAmendDays() {
      if (!amendStartDate || !amendEndDate || !amendTotalDays || !selectedRequest) return;

      const dayType = amendDayType?.value || 'full';

      if (!amendStartDate.value || !amendEndDate.value) {
        amendTotalDays.value = '';
        return;
      }

      if (isHalfDay(dayType)) {
        if (amendStartDate.value !== amendEndDate.value) {
          amendTotalDays.value = '';
          showMessage('amendMessage', 'Half days can only be used when the start date and end date are the same.', 'error');
          return;
        }

        amendTotalDays.value = '0.5';
        showMessage('amendMessage', '');
        return;
      }

      const total = selectedRequest.leave_type === 'annual'
        ? calculateBusinessDays(amendStartDate.value, amendEndDate.value)
        : calendarDays(amendStartDate.value, amendEndDate.value);

      amendTotalDays.value = total > 0 ? String(total) : '';
      showMessage('amendMessage', '');
    }

    adminLeaveList?.addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;

      const action = button.dataset.action;
      const request = requests.find((item) => item.id === button.dataset.id);
      if (!request) return;

      selectedRequest = request;

      if (['approve', 'reject', 'cancel', 'approve-cancel', 'reject-cancel'].includes(action)) {
        if (
          !currentUserIsOwner &&
          (action === 'approve' || action === 'approve-cancel') &&
          isOwnRequest(request, authUserId)
        ) {
          alert('Admins cannot approve their own leave. An owner or another admin must approve it.');
          selectedRequest = null;
          pendingAction = null;
          return;
        }

        pendingAction = action;

        if (requestActionNote) requestActionNote.value = '';

        const titles = {
          approve: 'Approve Request',
          reject: 'Reject Request',
          cancel: 'Cancel Leave',
          'approve-cancel': 'Approve Cancellation',
          'reject-cancel': 'Reject Cancellation'
        };

        setText('requestActionTitle', titles[action] || 'Confirm Action');
        setText(
          'requestActionSubtitle',
          `${request.employee_name || 'Employee'} • ${leaveTypeLabel(request.leave_type)} • ${dayTypeLabel(request.day_type)}`
        );

        setDeductAllowanceVisibility(action, request.leave_type);
        openModal('requestActionModal');
        return;
      }

      if (action === 'amend') {
        setText(
          'amendSubtitle',
          `${request.employee_name || 'Employee'} • ${leaveTypeLabel(request.leave_type)}`
        );

        if (amendDayType) amendDayType.value = request.day_type || 'full';
        if (amendStartDate) amendStartDate.value = request.start_date || '';
        if (amendEndDate) amendEndDate.value = request.end_date || '';
        if (amendTotalDays) amendTotalDays.value = request.total_days || '';
        if (amendReason) amendReason.value = '';

        showMessage('amendMessage', '');
        openModal('amendModal');
        updateAmendDays();
        return;
      }

      if (action === 'more-info') {
        const summary = await getEmployeeLeaveSummary(request);

        setText('infoEmployeeName', request.employee_name || 'Employee');
        setText('infoEmployeeSubtitle', `${request.employee_id_display || request.employee_id || '—'} • ${request.job_title || '—'}`);

        const infoContent = document.getElementById('requestInfoContent');

        if (!infoContent) {
          alert('More Info modal is missing from admin.html');
          return;
        }

        infoContent.innerHTML = `
          <div class="modal-grid">
            ${renderDetailTile('Request Type', leaveTypeLabel(request.leave_type))}
            ${renderDetailTile('Day Type', dayTypeLabel(request.day_type))}
            ${renderDetailTile('Status', request.status)}
            ${renderDetailTile('Total Days', request.total_days)}
            ${renderDetailTile('Start Date', formatDate(request.start_date))}
            ${renderDetailTile('End Date', formatDate(request.end_date))}
            ${renderDetailTile('Deducts Allowance', request.deduct_allowance ? 'Yes' : 'No')}
            ${renderDetailTile('Annual Allowance', summary.balance?.total_allowance ?? request.employee?.annual_leave_allowance ?? '—')}
            ${renderDetailTile('Used Days', summary.balance?.used_days ?? '—')}
            ${renderDetailTile('Remaining Days', summary.balance?.remaining_days ?? '—')}
            ${renderDetailTile('Approved At', request.approved_at ? formatDate(request.approved_at) : '—')}
            ${renderDetailTile('Cancelled At', request.cancelled_at ? formatDate(request.cancelled_at) : '—')}
          </div>

          <div class="modal-section">
            <h3>Reason</h3>
            <p class="muted">${request.reason || 'No reason provided'}</p>
          </div>

          <div class="modal-section">
            <h3>Notes</h3>
            <p class="muted">${request.notes || 'No notes added'}</p>
          </div>

          <div class="modal-section">
            <h3>Recent Leave History</h3>
            <div class="card-list compact-list">
              ${renderLeaveHistory(summary.requests)}
            </div>
          </div>
        `;

        const profileBtn = document.getElementById('viewEmployeeProfileBtn');
        if (profileBtn) {
          profileBtn.onclick = () => {
            setText('employeeProfileTitle', request.employee_name || 'Employee');
            renderEmployeeProfile(request.employee);
            openModal('employeeProfileModal');
          };
        }

        openModal('requestInfoModal');
      }
    });

    confirmRequestActionBtn?.addEventListener('click', async () => {
      if (!selectedRequest || !pendingAction) return;

      if (
        !currentUserIsOwner &&
        (pendingAction === 'approve' || pendingAction === 'approve-cancel') &&
        isOwnRequest(selectedRequest, authUserId)
      ) {
        alert('Admins cannot approve their own leave. An owner or another admin must approve it.');
        closeModal('requestActionModal');
        selectedRequest = null;
        pendingAction = null;
        return;
      }

      try {
        confirmRequestActionBtn.disabled = true;

        const note = requestActionNote?.value?.trim() || '';
        const deductAllowance = document.getElementById('requestDeductAllowance')?.checked ?? true;

        if (pendingAction === 'approve') {
          await approveLeaveRequest(selectedRequest, authUserId, note, deductAllowance);

          await sendSupportLeaveApprovedEmail({
            employee_name: selectedRequest.employee_name || 'Employee',
            leave_type: selectedRequest.leave_type,
            day_type: selectedRequest.day_type || 'full',
            start_date: selectedRequest.start_date,
            end_date: selectedRequest.end_date,
            total_days: selectedRequest.total_days,
            note
          });
        }

        if (pendingAction === 'reject') {
          await rejectLeaveRequest(selectedRequest, authUserId, note);
        }

        if (pendingAction === 'cancel' || pendingAction === 'approve-cancel') {
          await cancelLeaveRequestAdmin(selectedRequest, authUserId, note);

          await sendSupportLeaveApprovedEmail({
            action: 'cancelled',
            employee_name: selectedRequest.employee_name || 'Employee',
            leave_type: selectedRequest.leave_type,
            day_type: selectedRequest.day_type || 'full',
            start_date: selectedRequest.start_date,
            end_date: selectedRequest.end_date,
            total_days: selectedRequest.total_days,
            note
          });
        }

        if (pendingAction === 'reject-cancel') {
          await approveLeaveRequest(
            { ...selectedRequest, status: 'pending' },
            authUserId,
            note,
            selectedRequest.deduct_allowance
          );
        }

        closeModal('requestActionModal');
        selectedRequest = null;
        pendingAction = null;
        await loadData();
      } catch (error) {
        alert(error.message || 'Unable to update request.');
      } finally {
        confirmRequestActionBtn.disabled = false;
      }
    });

    amendDayType?.addEventListener('change', updateAmendDays);
    amendStartDate?.addEventListener('change', updateAmendDays);
    amendEndDate?.addEventListener('change', updateAmendDays);

    amendForm?.addEventListener('submit', async (event) => {
      event.preventDefault();

      if (!selectedRequest) return;

      const dayType = amendDayType?.value || 'full';
      const startDate = amendStartDate?.value || '';
      const endDate = amendEndDate?.value || '';
      const totalDays = Number(amendTotalDays?.value || 0);
      const reason = amendReason?.value?.trim() || '';

      if (!startDate || !endDate || !totalDays) {
        showMessage('amendMessage', 'Please complete the dates properly.', 'error');
        return;
      }

      if (isHalfDay(dayType) && startDate !== endDate) {
        showMessage('amendMessage', 'Half days can only be used when the start date and end date are the same.', 'error');
        return;
      }

      try {
        await amendLeaveRequestAdmin(selectedRequest, authUserId, {
          start_date: startDate,
          end_date: endDate,
          total_days: totalDays,
          day_type: dayType,
          reason
        });

        closeModal('amendModal');
        selectedRequest = null;
        await loadData();
      } catch (error) {
        showMessage('amendMessage', error.message || 'Unable to save amendment.', 'error');
      }
    });

    document.getElementById('openManualAbsenceBtn')?.addEventListener('click', () => {
      selectedEmployee = null;
      manualAbsenceForm?.reset();

      if (manualDayType) manualDayType.value = 'full';
      if (manualTotalDays) manualTotalDays.value = '';

      if (selectedEmployeeBox) {
        selectedEmployeeBox.classList.add('hidden');
        selectedEmployeeBox.innerHTML = '';
      }

      if (employeeSearchResults) {
        employeeSearchResults.classList.add('hidden');
        employeeSearchResults.innerHTML = '';
      }

      setText('manualAbsenceMessage', '');
      setCustomSelectValue(document.getElementById('manualAbsenceTypeSelect'), 'annual', 'Annual Request');

      openModal('manualAbsenceModal');
    });

    let searchTimer;

    employeeSearchInput?.addEventListener('input', () => {
      clearTimeout(searchTimer);

      searchTimer = setTimeout(async () => {
        const term = employeeSearchInput.value.trim();

        if (term.length < 2) {
          employeeSearchResults?.classList.add('hidden');
          if (employeeSearchResults) employeeSearchResults.innerHTML = '';
          return;
        }

        const results = await searchEmployees(profile.company_id, term);

        employeeSearchResults.classList.remove('hidden');

        if (!results.length) {
          employeeSearchResults.innerHTML = `<div class="search-result-empty">No employees found.</div>`;
          return;
        }

        employeeSearchResults.innerHTML = results.map((employee) => `
          <button type="button" class="search-result-item" data-id="${employee.id}">
            <strong>${employee.display_name || employee.full_name || 'Employee'}</strong>
            <span>${employee.employee_code || employee.employee_id_display || '—'} • ${employee.job_title || '—'}</span>
          </button>
        `).join('');

        employeeSearchResults.querySelectorAll('.search-result-item').forEach((item) => {
          item.addEventListener('click', () => {
            selectedEmployee = results.find((employee) => employee.id === item.dataset.id);
            if (!selectedEmployee) return;

            employeeSearchInput.value = selectedEmployee.display_name || selectedEmployee.full_name || 'Employee';
            employeeSearchResults.classList.add('hidden');

            selectedEmployeeBox.classList.remove('hidden');
            selectedEmployeeBox.innerHTML = `
              <strong>${selectedEmployee.display_name || selectedEmployee.full_name || 'Employee'}</strong>
              <span>${selectedEmployee.employee_code || selectedEmployee.employee_id_display || '—'} • ${selectedEmployee.job_title || '—'}</span>
            `;

            updateManualDays();
          });
        });
      }, 250);
    });

    manualDayType?.addEventListener('change', updateManualDays);
    manualStartDate?.addEventListener('change', updateManualDays);
    manualEndDate?.addEventListener('change', updateManualDays);

    manualAbsenceForm?.addEventListener('submit', async (event) => {
      event.preventDefault();

      try {
        const dayType = manualDayType?.value || 'full';

        if (!selectedEmployee) {
          showMessage('manualAbsenceMessage', 'Please select an employee.', 'error');
          return;
        }

        if (!manualStartDate?.value || !manualEndDate?.value || !manualTotalDays?.value) {
          showMessage('manualAbsenceMessage', 'Please complete the dates.', 'error');
          return;
        }

        if (isHalfDay(dayType) && manualStartDate.value !== manualEndDate.value) {
          showMessage('manualAbsenceMessage', 'Half days can only be used when the start date and end date are the same.', 'error');
          return;
        }

        if (
          !currentUserIsOwner &&
          isSelectedEmployeeSelf(selectedEmployee, profile, authUserId) &&
          manualEndDate.value >= todayIso()
        ) {
          showMessage(
            'manualAbsenceMessage',
            'Admins cannot manually add their own current or future leave. Please submit a leave request instead. Past records can still be added.',
            'error'
          );
          return;
        }

        await createManualAbsence({
          employee: selectedEmployee,
          company_id: profile.company_id,
          leave_type: getCustomSelectValue('manualAbsenceTypeSelect'),
          day_type: dayType,
          start_date: manualStartDate.value,
          end_date: manualEndDate.value,
          total_days: Number(manualTotalDays.value),
          reason: manualReason?.value?.trim() || '',
          authorising_name: profile.full_name || profile.email || 'Admin',
          deduct_allowance: manualDeductAllowance?.checked ?? true
        }, authUserId);

        closeModal('manualAbsenceModal');
        await loadData();
      } catch (error) {
        showMessage('manualAbsenceMessage', error.message || 'Unable to save absence.', 'error');
      }
    });

    await loadData();
    revealApp();
  } catch (error) {
    console.error('Admin page failed:', error);

    const loader = document.getElementById('appLoader');
    if (loader) {
      loader.innerHTML = `
        <div style="padding:24px;text-align:center;">
          <h2>Admin failed to load</h2>
          <p>${error.message || 'Unknown error'}</p>
        </div>
      `;
    }
  }
}

initAdmin();
