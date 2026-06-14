export function revealApp() {
  const loader = document.getElementById('appLoader');
  const layout = document.getElementById('appLayout');
  if (loader) loader.classList.add('hidden');
  if (layout) layout.classList.remove('hidden');
}

export function showMessage(elementId, message, type = 'info') {
  const el = document.getElementById(elementId);
  if (!el) return;
  const colours = { error: '#ff9a97', success: '#7ee4b3', info: '#9fb1c9', warning: '#ffcf7a' };
  el.textContent = message;
  el.style.color = colours[type] || colours.info;
}

export function setLoadingButton(button, isLoading, loadingText = 'Saving...') {
  if (!button) return;
  if (isLoading) {
    button.dataset.originalText = button.textContent;
    button.textContent = loadingText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

export function showPageError(error, context = '') {
  const loader = document.getElementById('appLoader');
  if (loader) {
    loader.innerHTML = `<div style="text-align:center;padding:32px">
      <p style="color:#ff9a97;font-size:1rem;margin:0 0 8px">${context ? context + ': ' : ''}Error</p>
      <p style="color:#9fb1c9;font-size:0.9rem;margin:0">${error?.message || String(error)}</p>
    </div>`;
  }
}

export function badgeClass(value) {
  const map = {
    pending: 'badge-pending', approved: 'badge-approved', rejected: 'badge-rejected',
    cancelled: 'badge-cancelled', cancel_requested: 'badge-cancel-requested',
    annual: 'badge-annual', sick: 'badge-sick', other: 'badge-other',
    active: 'badge-active', inactive: 'badge-inactive', invited: 'badge-invited',
    admin: 'badge-admin', owner: 'badge-owner', employee: 'badge-employee',
    bank: 'badge-bank', company: 'badge-company'
  };
  return 'badge ' + (map[String(value || '').toLowerCase()] || 'badge-other');
}

export function formatDate(dateStr, opts = {}) {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric', ...opts
    });
  } catch { return dateStr; }
}

export function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
  );
}

export function initCloseOnBackdrop(backdropId, closeBtn) {
  const backdrop = document.getElementById(backdropId);
  if (!backdrop) return;
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.classList.add('hidden'); });
  if (closeBtn) closeBtn.addEventListener('click', () => backdrop.classList.add('hidden'));
}
