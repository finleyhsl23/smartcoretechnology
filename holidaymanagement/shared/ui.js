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

export function renderEmptyState(container, text = 'Nothing to show yet.') {
  if (!container) return;
  container.innerHTML = `<div class="empty-state">${text}</div>`;
}

export function badgeClass(statusOrType) {
  const value = String(statusOrType || '').toLowerCase();

  if (value === 'pending') return 'badge badge-pending';
  if (value === 'approved') return 'badge badge-approved';
  if (value === 'rejected') return 'badge badge-rejected';
  if (value === 'annual') return 'badge badge-annual';
  if (value === 'sick') return 'badge badge-sick';

  return 'badge';
}
