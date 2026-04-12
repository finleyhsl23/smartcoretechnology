export function showMessage(elementId, message, type = 'info') {
  const el = document.getElementById(elementId);
  if (!el) return;

  el.textContent = message;

  if (type === 'error') {
    el.style.color = '#ff9a97';
  } else if (type === 'success') {
    el.style.color = '#7ee4b3';
  } else {
    el.style.color = '#9fb1c9';
  }
}

export function setLoadingButton(button, isLoading, loadingText = 'Please wait...') {
  if (!button) return;

  if (isLoading) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.textContent = loadingText;
  } else {
    button.disabled = false;
    button.textContent = button.dataset.originalText || button.textContent;
  }
}

export function revealApp() {
  const loader = document.getElementById('appLoader');
  const app = document.getElementById('appLayout');

  if (loader) loader.classList.add('hidden');
  if (app) app.classList.remove('hidden');
}

export function showPageError(error, context = 'Page failed to load') {
  console.error(context, error);
  const loader = document.getElementById('appLoader');
  if (!loader) return;

  loader.classList.remove('hidden');
  loader.innerHTML = `
    <div style="max-width:720px; text-align:center;">
      <h2 style="margin:0 0 12px;">${context}</h2>
      <p style="margin:0 0 8px;">${error?.message || 'Unknown error'}</p>
    </div>
  `;
}

export function renderEmptyState(container, text = 'Nothing to show yet.') {
  if (!container) return;
  container.innerHTML = `<div class="empty-state">${text}</div>`;
}

export function badgeClass(value) {
  const lower = String(value || '').toLowerCase();
  if (lower === 'pending') return 'badge badge-pending';
  if (lower === 'approved') return 'badge badge-approved';
  if (lower === 'rejected') return 'badge badge-rejected';
  if (lower === 'annual') return 'badge badge-annual';
  if (lower === 'sick') return 'badge badge-sick';
  if (lower === 'other') return 'badge badge-other';
  if (lower === 'birthday') return 'badge badge-birthday';
  return 'badge';
}
