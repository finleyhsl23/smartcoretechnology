import { requireAuth, isAdminProfile } from '../../shared/guards.js';
import { getDashboardData } from '../../shared/api.js';
import { revealApp, badgeClass, formatDate, escapeHtml } from '../../shared/ui.js';

let ctx, allData;
let activeFilter = 'onLeave';

async function init() {
  ctx = await requireAuth();
  if (!ctx) return;

  const { session, profile, company } = ctx;

  // Populate sidebar company pill
  const initials = company.name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  document.getElementById('companyAvatar').textContent = initials;
  document.getElementById('companyName').textContent = company.name;
  document.getElementById('companyRole').textContent = company.role || 'Employee';
  document.getElementById('welcomeText').textContent =
    `Welcome back, ${profile?.full_name?.split(' ')[0] || session.user.email}`;

  try {
    allData = await getDashboardData(company.id, session.user.id);
  } catch (err) {
    document.getElementById('mainPanelList').innerHTML =
      `<p class="empty-state muted">Error loading data: ${escapeHtml(err.message)}</p>`;
    revealApp();
    return;
  }

  renderStats();
  renderSidePanel();
  setActiveFilter('onLeave');
  revealApp();

  // Stat card click handlers
  document.getElementById('statOnLeave').addEventListener('click', () => setActiveFilter('onLeave'));
  document.getElementById('statUpcoming').addEventListener('click', () => setActiveFilter('upcoming'));
  document.getElementById('statPending').addEventListener('click', () => setActiveFilter('pending'));
}

function renderStats() {
  const { onLeaveToday, upcomingLeave, pendingRequests, totalEmployees, activeEmployees } = allData;

  document.getElementById('statOnLeaveVal').textContent = onLeaveToday.length;
  document.getElementById('statOnLeaveSub').textContent = onLeaveToday.length === 1 ? 'person' : 'people';
  document.getElementById('statUpcomingVal').textContent = upcomingLeave.length;
  document.getElementById('statPendingVal').textContent = pendingRequests.length;
  document.getElementById('statEmployeesVal').textContent = totalEmployees;
  document.getElementById('statEmployeesSub').textContent = `${activeEmployees} active`;

  const badge = document.getElementById('pendingBadge');
  if (pendingRequests.length > 0) {
    badge.textContent = pendingRequests.length;
    badge.classList.remove('hidden');
  }
}

function setActiveFilter(filter) {
  activeFilter = filter;
  ['statOnLeave','statUpcoming','statPending'].forEach(id => {
    document.getElementById(id)?.classList.remove('active-stat-button');
  });

  const labels = { onLeave: 'On Leave Today', upcoming: 'Upcoming Leave (7 days)', pending: 'Awaiting Approval' };
  const lists  = { onLeave: allData.onLeaveToday, upcoming: allData.upcomingLeave, pending: allData.pendingRequests };

  document.getElementById(`stat${filter.charAt(0).toUpperCase() + filter.slice(1)}`)?.classList.add('active-stat-button');
  document.getElementById('mainPanelTitle').textContent = labels[filter];
  renderMainPanel(lists[filter], filter);
}

function renderMainPanel(items, type) {
  const list = document.getElementById('mainPanelList');
  if (!items.length) {
    list.innerHTML = `<p class="empty-state muted">Nothing to show here.</p>`;
    return;
  }
  list.innerHTML = items.map(r => {
    const name = r.employees?.full_name || '—';
    const dept = r.employees?.department || '';
    const typeLabel = r.leave_type ? r.leave_type.charAt(0).toUpperCase() + r.leave_type.slice(1) : '';
    return `
      <div class="leave-card compact">
        <div class="leave-card-top">
          <div class="leave-card-main">
            <p class="leave-card-title">${escapeHtml(name)}</p>
            <p class="leave-card-subtitle">${escapeHtml(dept)}</p>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
            <span class="${badgeClass(r.leave_type)}">${escapeHtml(typeLabel)}</span>
            <span class="${badgeClass(r.status)}">${escapeHtml(r.status)}</span>
          </div>
        </div>
        <div class="leave-card-bottom">
          <span class="muted small">${formatDate(r.start_date)} — ${formatDate(r.end_date)}</span>
          <span class="muted small">${r.days_requested} day${r.days_requested !== 1 ? 's' : ''}</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderSidePanel() {
  const { todayHoliday, birthdays, anniversaries } = allData;

  // Today panel
  const todayText = document.getElementById('todayHolidayText');
  if (todayHoliday) {
    todayText.innerHTML = `<span class="${badgeClass('bank')}">${escapeHtml(todayHoliday.name)}</span>`;
  } else {
    const d = new Date();
    todayText.textContent = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  // Birthdays
  const bList = document.getElementById('birthdayList');
  if (!birthdays.length) {
    bList.innerHTML = `<p class="empty-state muted small">No upcoming birthdays.</p>`;
  } else {
    bList.innerHTML = birthdays.slice(0, 5).map(e => `
      <div class="mini-list-row">
        <span>${escapeHtml(e.full_name)}</span>
        <span class="muted small">${e.days_until === 0 ? 'Today 🎂' : `in ${e.days_until}d`}</span>
      </div>
    `).join('');
  }

  // Anniversaries
  const aList = document.getElementById('anniversaryList');
  if (!anniversaries.length) {
    aList.innerHTML = `<p class="empty-state muted small">No upcoming anniversaries.</p>`;
  } else {
    aList.innerHTML = anniversaries.slice(0, 5).map(e => `
      <div class="mini-list-row">
        <span>${escapeHtml(e.full_name)}</span>
        <span class="muted small">${e.years}yr — ${e.days_until === 0 ? 'Today' : `in ${e.days_until}d`}</span>
      </div>
    `).join('');
  }
}

init();
