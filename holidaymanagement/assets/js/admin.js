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
  leaveTypeLabel
} from '../../shared/api.js';
import { formatDate, calculateBusinessDays, isDateInRange } from '../../shared/dates.js';

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function calendarDays(startDate, endDate) {
  if (!startDate || !endDate) return 0;

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (end < start) return 0;

  return Math.ceil((end - start) / 86400000) + 1;
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
        if (openSelect !== selectEl) {
          openSelect.classList.remove('open');
        }
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

function valueOrDash(value) {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

function renderDetailTile(label, value) {
  return `
    <div class="detail-tile">
      <span class="detail-label">${label}</span>
      <div class="detail-value">${valueOrDash(value)}</div>
    </div>
  `;
}

function renderEmployeeProfile(employee) {
  const container = document.getElementById('employeeProfileContent');
  if (!container) return;

  if (!employee) {
    container.innerHTML = `<div class="empty-state">No employee profile found.</div>`;
    return;
  }

  const hiddenKeys = new Set([
    'display_name',
    'employee_name',
    'employee_id_display'
  ]);

  const entries = Object.entries(employee).filter(([key]) => !hiddenKeys.has(key));

  container.innerHTML = entries.map(([key, value]) => {
    const label = key
      .replaceAll('_', ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());

    return renderDetailTile(label, value);
  }).join('');
}

function setDeductAllowanceVisibility(action, leaveType) {
  const actionModal = document.getElementById('requestActionModal');
  const checkbox = document.getElementById('requestDeductAllowance');
  const row = document.getElementById('requestDeductAllowanceRow');

  const shouldShow =
    action === 'approve' &&
    ['annual', 'other'].includes(leaveType);

  if (actionModal) {
    actionModal.dataset.actionType = action;
    actionModal.dataset.leaveType = leaveType;
  }

  if (checkbox) {
    checkbox.checked = true;
  }

  if (row) {
    row.classList.toggle('hidden', !shouldShow);
    row.style.display = shouldShow ? 'flex' : 'none';
  }
}

function renderLeaveHistory(entries) {
  if (!entries || !entries.length) {
    return '<div class="empty-state">No leave history found.</div>';
  }

  return entries.slice(0, 8).map((entry) => `
    <article class="leave-card">
      <p class="leave-card-title">${leaveTypeLabel(entry.leave_type)} • ${entry.status}</p>
      <p class="leave-card-subtitle">${formatDate(entry.start_date)} to ${formatDate(entry.end_date)} • ${entry.total_days} day(s)</p>
    </article>
  `).join('');
}

async function initAdmin() {
  try {
    const auth = await requireAdminPageAccess();
    if (!auth) return;

    const { profile } = auth;

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
    const manualStartDate = document.getElementById('manualStartDate');
    const manualEndDate = document.getElementById('manualEndDate');
    const manualTotalDays = document.getElementById('manualTotalDays');

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
      } catch (error) {
        console.warn('Sick records failed to load:', error);
        sickRecords = [];
      }

      const todayIso = new Date().toISOString().slice(0, 10);

      setText('adminPendingCount', requests.filter((request) => request.status === 'pending').length);

      setText('adminCancelCount', requests.filter((request) => request.status === 'cancel_requested').length);

      setText(
        'adminApprovedToday',
        requests.filter((request) =>
          request.status === 'approved' &&
          request.approved_at &&
          request.approved_at.slice(0, 10) === todayIso
        ).length
      );

      setText(
        'adminOffToday',
        requests.filter((request) =>
          request.status === 'approved' &&
          isDateInRange(todayIso, request.start_date, request.end_date)
        ).length
      );

      const openSickCount = sickRecords.filter((record) => !record.end_date).length;
      const sickTodayCount = sickRecords.filter((record) =>
        record.sick_date === todayIso ||
        record.start_date === todayIso ||
        (
          record.start_date &&
          record.start_date <= todayIso &&
          (!record.end_date || record.end_date >= todayIso)
        )
      ).length;

      setText('adminSickOpen', openSickCount);
      setText('adminSickToday', sickTodayCount || openSickCount);

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
              <p class="leave-card-subtitle">${formatDate(item.start_date)} to ${formatDate(item.end_date)} • ${item.total_days} day(s)</p>
            </div>

            <div class="badge badge-${item.status}">${item.status}</div>
          </div>

          <div class="leave-card-bottom admin-request-bottom">
            <div>
              <p class="leave-card-subtitle"><strong>Reason:</strong> ${item.reason || 'No reason provided'}</p>
              <p class="leave-card-subtitle"><strong>Notes:</strong> ${item.notes || 'No notes added'}</p>
              ${
                item.cancellation_reason
                  ? `<p class="leave-card-subtitle"><strong>Cancellation reason:</strong> ${item.cancellation_reason}</p>`
                  : ''
              }
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

    adminLeaveList?.addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;

      const action = button.dataset.action;
      const request = requests.find((item) => item.id === button.dataset.id);

      if (!request) return;

      selectedRequest = request;

      if (['approve', 'reject', 'cancel', 'approve-cancel', 'reject-cancel'].includes(action)) {
        pendingAction = action;

        if (requestActionNote) {
          requestActionNote.value = '';
        }

        const titles = {
          approve: 'Approve Request',
          reject: 'Reject Request',
          cancel: 'Cancel Leave',
          'approve-cancel': 'Approve Cancellation',
          'reject-cancel': 'Reject Cancellation'
        };

        setText('requestActionTitle', titles[action] || 'Confirm Action');
        setText('requestActionSubtitle', `${request.employee_name || 'Employee'} • ${leaveTypeLabel(request.leave_type)}`);

        setDeductAllowanceVisibility(action, request.leave_type);

        openModal('requestActionModal');
        return;
      }

      if (action === 'amend') {
        setText('amendSubtitle', `${request.employee_name || 'Employee'} • ${leaveTypeLabel(request.leave_type)}`);

        const amendStart = document.getElementById('amendStartDate');
        const amendEnd = document.getElementById('amendEndDate');
        const amendTotal = document.getElementById('amendTotalDays');
        const amendReason = document.getElementById('amendReason');

        if (amendStart) amendStart.value = request.start_date || '';
        if (amendEnd) amendEnd.value = request.end_date || '';
        if (amendTotal) amendTotal.value = request.total_days || '';
        if (amendReason) amendReason.value = '';

        openModal('amendModal');
        return;
      }

      if (action === 'more-info') {
        try {
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
              ${renderDetailTile('Status', request.status)}
              ${renderDetailTile('Total Days', request.total_days)}
              ${renderDetailTile('Start Date', formatDate(request.start_date))}
              ${renderDetailTile('End Date', formatDate(request.end_date))}
              ${renderDetailTile('Deducts Allowance', request.deduct_allowance ? 'Yes' : 'No')}
              ${renderDetailTile('Annual Allowance', summary.balance?.total_allowance ?? '—')}
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

            ${
              request.cancellation_reason
                ? `
                  <div class="modal-section">
                    <h3>Cancellation Reason</h3>
                    <p class="muted">${request.cancellation_reason}</p>
                  </div>
                `
                : ''
            }

            ${
              request.cancel_admin_reason
                ? `
                  <div class="modal-section">
                    <h3>Admin Cancellation Reason</h3>
                    <p class="muted">${request.cancel_admin_reason}</p>
                  </div>
                `
                : ''
            }

            ${
              request.amendment_reason
                ? `
                  <div class="modal-section">
                    <h3>Amendment Reason</h3>
                    <p class="muted">${request.amendment_reason}</p>
                  </div>
                `
                : ''
            }

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
        } catch (error) {
          console.error('More Info failed:', error);
          alert(error.message || 'More Info failed to load.');
        }

        return;
      }
    });

    confirmRequestActionBtn?.addEventListener('click', async () => {
      if (!selectedRequest || !pendingAction) return;

      try {
        confirmRequestActionBtn.disabled = true;

        const note = requestActionNote?.value?.trim() || '';
        const deductAllowance = document.getElementById('requestDeductAllowance')?.checked ?? true;

        if (pendingAction === 'approve') {
          await approveLeaveRequest(selectedRequest, profile.id, note, deductAllowance);
        }

        if (pendingAction === 'reject') {
          await rejectLeaveRequest(selectedRequest, profile.id, note);
        }

        if (pendingAction === 'cancel' || pendingAction === 'approve-cancel') {
          await cancelLeaveRequestAdmin(selectedRequest, profile.id, note);
        }

        if (pendingAction === 'reject-cancel') {
          await approveLeaveRequest(
            {
              ...selectedRequest,
              status: 'pending'
            },
            profile.id,
            note,
            selectedRequest.deduct_allowance
          );
        }

        closeModal('requestActionModal');
        await loadData();
      } catch (error) {
        alert(error.message || 'Unable to update request.');
      } finally {
        confirmRequestActionBtn.disabled = false;
      }
    });

    document.getElementById('openManualAbsenceBtn')?.addEventListener('click', () => {
      selectedEmployee = null;
      manualAbsenceForm?.reset();

      if (selectedEmployeeBox) {
        selectedEmployeeBox.classList.add('hidden');
        selectedEmployeeBox.innerHTML = '';
      }

      if (employeeSearchResults) {
        employeeSearchResults.classList.add('hidden');
        employeeSearchResults.innerHTML = '';
      }

      setText('manualAbsenceMessage', '');

      const authorisingInput = document.getElementById('manualAuthorisingUser');
      if (authorisingInput) {
        authorisingInput.value = profile.full_name || profile.email || 'Signed in admin';
      }

      setCustomSelectValue(
        document.getElementById('manualAbsenceTypeSelect'),
        'annual',
        'Annual Request'
      );

      const manualDeductRow = document.getElementById('manualDeductAllowance')?.closest('.toggle-row');
      if (manualDeductRow) {
        manualDeductRow.style.display = 'flex';
        manualDeductRow.classList.remove('hidden');
      }

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

        try {
          const results = await searchEmployees(profile.company_id, term);

          if (!employeeSearchResults) return;

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

              if (selectedEmployeeBox) {
                selectedEmployeeBox.classList.remove('hidden');
                selectedEmployeeBox.innerHTML = `
                  <strong>${selectedEmployee.display_name || selectedEmployee.full_name || 'Employee'}</strong>
                  <span>${selectedEmployee.employee_code || selectedEmployee.employee_id_display || '—'} • ${selectedEmployee.job_title || '—'}</span>
                `;
              }
            });
          });
        } catch (error) {
          console.error('Employee search failed:', error);
          if (employeeSearchResults) {
            employeeSearchResults.classList.remove('hidden');
            employeeSearchResults.innerHTML = `<div class="search-result-empty">${error.message || 'Search failed.'}</div>`;
          }
        }
      }, 250);
    });

    function updateManualDays() {
      if (!manualStartDate || !manualEndDate || !manualTotalDays) return;

      const type = getCustomSelectValue('manualAbsenceTypeSelect');
      const start = manualStartDate.value;
      const end = manualEndDate.value;

      const total =
        type === 'annual'
          ? calculateBusinessDays(start, end)
          : calendarDays(start, end);

      manualTotalDays.value = total > 0 ? String(total) : '';

      const manualDeductRow = document.getElementById('manualDeductAllowance')?.closest('.toggle-row');

      if (manualDeductRow) {
        manualDeductRow.style.display = ['annual', 'other'].includes(type) ? 'flex' : 'none';
        manualDeductRow.classList.toggle('hidden', !['annual', 'other'].includes(type));
      }
    }

    manualStartDate?.addEventListener('change', updateManualDays);
    manualEndDate?.addEventListener('change', updateManualDays);

    const amendStart = document.getElementById('amendStartDate');
    const amendEnd = document.getElementById('amendEndDate');
    const amendTotal = document.getElementById('amendTotalDays');

    function updateAmendDays() {
      if (!amendStart || !amendEnd || !amendTotal) return;

      const total = calculateBusinessDays(amendStart.value, amendEnd.value);
      amendTotal.value = total > 0 ? String(total) : '';
    }

    amendStart?.addEventListener('change', updateAmendDays);
    amendEnd?.addEventListener('change', updateAmendDays);

    document.getElementById('amendForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();

      if (!selectedRequest) return;

      try {
        await amendLeaveRequestAdmin(selectedRequest, profile.id, {
          start_date: amendStart?.value,
          end_date: amendEnd?.value,
          total_days: Number(amendTotal?.value || 0),
          reason: document.getElementById('amendReason')?.value?.trim() || ''
        });

        closeModal('amendModal');
        await loadData();
      } catch (error) {
        alert(error.message || 'Unable to amend leave.');
      }
    });

    manualAbsenceForm?.addEventListener('submit', async (event) => {
      event.preventDefault();

      try {
        if (!selectedEmployee) {
          showMessage('manualAbsenceMessage', 'Please select an employee.', 'error');
          return;
        }

        if (!manualStartDate?.value || !manualEndDate?.value || !manualTotalDays?.value) {
          showMessage('manualAbsenceMessage', 'Please complete the dates.', 'error');
          return;
        }

        await createManualAbsence({
          employee: selectedEmployee,
          company_id: profile.company_id,
          leave_type: getCustomSelectValue('manualAbsenceTypeSelect'),
          start_date: manualStartDate.value,
          end_date: manualEndDate.value,
          total_days: Number(manualTotalDays.value),
          reason: document.getElementById('manualReason')?.value?.trim() || '',
          authorising_name: profile.full_name || profile.email || 'Admin',
          deduct_allowance: document.getElementById('manualDeductAllowance')?.checked ?? true
        }, profile.id);

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
