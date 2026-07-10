import { requireAdminPageAccess } from '../../shared/guards.js';
import { getCompanyHolidays, addCompanyHoliday, deleteCompanyHoliday, syncBankHolidays } from '../../shared/api.js';
import { revealApp, badgeClass, formatDate, showMessage, setLoadingButton, escapeHtml } from '../../shared/ui.js';

let ctx, holidays = [];

async function init() {
  ctx = await requireAdminPageAccess();
  if (!ctx) return;

  populateSidebar(ctx.company);
  await loadHolidays();
  revealApp();

  document.getElementById('addHolidayBtn').addEventListener('click', () => openModal('addHolidayModal'));
  document.getElementById('closeAddHoliday').addEventListener('click', () => closeModal('addHolidayModal'));
  document.getElementById('closeAddHoliday2').addEventListener('click', () => closeModal('addHolidayModal'));
  document.getElementById('saveHolidayBtn').addEventListener('click', saveHoliday);
  document.getElementById('syncBankBtn').addEventListener('click', () => openModal('syncBankModal'));
  document.getElementById('closeSyncModal').addEventListener('click', () => closeModal('syncBankModal'));
  document.getElementById('closeSyncModal2').addEventListener('click', () => closeModal('syncBankModal'));
  document.getElementById('confirmSyncBtn').addEventListener('click', syncBank);
}

function populateSidebar(company) {
  const initials = company.name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  document.getElementById('companyAvatar').textContent = initials;
  document.getElementById('companyName').textContent = company.name;
  document.getElementById('companyRole').textContent = company.role || 'Admin';
}

async function loadHolidays() {
  holidays = await getCompanyHolidays(ctx.company.id);
  renderList();
}

function renderList() {
  const list = document.getElementById('holidayList');
  const bank = holidays.filter(h => h.type === 'bank');
  const company = holidays.filter(h => h.type !== 'bank');
  const total = holidays.length;

  document.getElementById('holidayCount').textContent = `${total} holiday${total !== 1 ? 's' : ''}`;
  document.getElementById('bankCount').textContent = bank.length;
  document.getElementById('companyCount').textContent = company.length;
  document.getElementById('totalCount').textContent = total;

  if (!holidays.length) {
    list.innerHTML = `<p class="empty-state muted">No holidays added yet. Sync bank holidays or add your own.</p>`;
    return;
  }

  // Sort by date
  const sorted = [...holidays].sort((a, b) => a.holiday_date.localeCompare(b.holiday_date));

  list.innerHTML = sorted.map(h => `
    <div class="leave-card compact">
      <div class="leave-card-top">
        <div class="leave-card-main">
          <p class="leave-card-title">${escapeHtml(h.name)}</p>
          <p class="leave-card-subtitle">${formatDate(h.holiday_date)}</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <span class="${badgeClass(h.type === 'bank' ? 'bank' : 'company')}">${h.type === 'bank' ? 'Bank' : 'Company'}</span>
          ${h.type !== 'bank' ? `<button class="btn btn-danger icon-btn" data-del-id="${h.id}">✕</button>` : ''}
        </div>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('[data-del-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Remove this holiday?')) return;
      await deleteCompanyHoliday(btn.dataset.delId, ctx.company.id);
      await loadHolidays();
    });
  });
}

async function saveHoliday() {
  const btn = document.getElementById('saveHolidayBtn');
  const name = document.getElementById('holidayName').value.trim();
  const date = document.getElementById('holidayDate').value;

  if (!name || !date) {
    showMessage('addHolidayMsg', 'Name and date are required.', 'error');
    return;
  }

  setLoadingButton(btn, true, 'Saving...');
  showMessage('addHolidayMsg', '', 'info');

  try {
    await addCompanyHoliday(ctx.company.id, { name, holiday_date: date, type: 'company' });
    document.getElementById('holidayName').value = '';
    document.getElementById('holidayDate').value = '';
    closeModal('addHolidayModal');
    await loadHolidays();
  } catch (err) {
    showMessage('addHolidayMsg', err.message, 'error');
  } finally {
    setLoadingButton(btn, false);
  }
}

async function syncBank() {
  const btn = document.getElementById('confirmSyncBtn');
  const countryCode = document.getElementById('syncCountryCode').value;
  const yearsCount = parseInt(document.getElementById('syncYearsCount').value, 10);

  setLoadingButton(btn, true, 'Syncing...');
  showMessage('syncBankMsg', '', 'info');

  try {
    const result = await syncBankHolidays(ctx.company.id, [countryCode], yearsCount);
    await loadHolidays();
    showMessage('syncBankMsg', `Synced ${result.added ?? 0} bank holiday(s).`, 'success');
    if ((result.added ?? 0) > 0) {
      setTimeout(() => closeModal('syncBankModal'), 1500);
    }
  } catch (err) {
    showMessage('syncBankMsg', 'Sync failed: ' + err.message, 'error');
  } finally {
    setLoadingButton(btn, false);
  }
}

function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

init();
