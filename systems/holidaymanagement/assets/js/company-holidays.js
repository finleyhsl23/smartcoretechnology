import { requireAdminPageAccess } from '../../shared/guards.js';
import { signOut } from '../../shared/auth.js';
import { showMessage, renderEmptyState, escapeHtml } from '../../shared/ui.js';
import { formatDate } from '../../shared/dates.js';
import * as api from '../../shared/api.js';

const ctx = await requireAdminPageAccess();
if (ctx) {
  const { profile } = ctx;
  const list = document.getElementById('holidayList');
  const form = document.getElementById('companyHolidayForm');
  const importBtn = document.getElementById('importBankHolidaysBtn');
  const importYear = document.getElementById('importHolidayYear');

  document.getElementById('logoutBtn')?.addEventListener('click', async () => { await signOut(); location.href = './login.html'; });
  if (importYear) importYear.value = new Date().getFullYear();

  async function load() {
    const holidays = await api.getHolidays(profile.company_id).catch(() => []);
    if (!holidays.length) return renderEmptyState(list, 'No holidays found yet. You can import UK bank holidays or add company holidays manually.');
    list.innerHTML = holidays.map(h => `
      <article class="leave-card">
        <div class="leave-card-top">
          <div>
            <p class="leave-card-title">${escapeHtml(h.name || 'Holiday')}</p>
            <p class="leave-card-subtitle">${formatDate(h.holiday_date)} • ${h.type === 'bank' ? 'Bank Holiday' : 'Company Holiday'}</p>
          </div>
          ${h.type === 'company' ? `<button class="btn btn-danger" data-delete="${h.id}" type="button">Delete</button>` : ''}
        </div>
      </article>`).join('');
  }

  form?.addEventListener('submit', async event => {
    event.preventDefault();
    try {
      await api.addCompanyHoliday({ company_id: profile.company_id, name: document.getElementById('holidayName').value.trim(), holiday_date: document.getElementById('holidayDate').value, type: 'company' });
      form.reset();
      showMessage('companyHolidayMessage', 'Company holiday added.', 'success');
      await load();
    } catch (error) {
      showMessage('companyHolidayMessage', error.message || 'Could not add holiday.', 'error');
    }
  });

  list?.addEventListener('click', async event => {
    const btn = event.target.closest('[data-delete]');
    if (!btn) return;
    if (!confirm('Delete this company holiday?')) return;
    await api.deleteCompanyHoliday(btn.dataset.delete);
    await load();
  });

  importBtn?.addEventListener('click', async () => {
    try {
      importBtn.disabled = true;
      showMessage('companyHolidayMessage', 'Importing GOV.UK bank holidays...', 'info');
      const company = await api.getCompany(profile.company_id);
      const result = await api.importBankHolidays({
        company_id: profile.company_id,
        region: company.default_bank_holiday_region || profile.default_bank_holiday_region || 'england-and-wales',
        year: Number(importYear.value || new Date().getFullYear())
      });
      showMessage('companyHolidayMessage', `Imported ${result.imported || 0} bank holidays.`, 'success');
      await load();
    } catch (error) {
      showMessage('companyHolidayMessage', error.message || 'Could not import bank holidays.', 'error');
    } finally {
      importBtn.disabled = false;
    }
  });

  await load();
}
