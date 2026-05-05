<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />

  <title>Company Holidays</title>

  <link rel="icon" href="/images/smartfitsfavicon.png" />
  <link rel="stylesheet" href="/holidaymanagement/assets/css/holidaymanagement.css?v=180" />
</head>

<body class="app-page">
  <div id="appLoader" class="page-loader">Loading company holidays...</div>

  <div class="app-layout hidden" id="appLayout">
    <aside class="sidebar glass-card">
      <div class="brand-wrap">
        <img src="/images/smartfitslogo.png" alt="Smartfits" class="sidebar-logo" data-theme-logo />
        <div>
          <h2>Holiday Management</h2>
          <p class="muted small">SmartCore / Smartfits</p>
        </div>
      </div>

      <nav class="sidebar-nav">
        <a href="./home.html" class="nav-link">Dashboard</a>
        <a href="./calendar.html" class="nav-link">Calendar</a>
        <a href="./request.html" class="nav-link">Request Leave</a>
        <a href="./my-leave.html" class="nav-link">My Leave</a>
        <a href="./employee-management.html" class="nav-link admin-only-link">Employee Management</a>
        <a href="./company-holidays.html" class="nav-link admin-only-link active">Company Holidays</a>
        <a href="./admin.html" class="nav-link admin-only-link">Admin</a>
      </nav>

      <button class="btn btn-secondary btn-block" id="logoutBtn">Sign Out</button>
    </aside>

    <main class="main-content">
      <header class="topbar glass-card">
        <div>
          <h1>Company Holidays</h1>
          <p class="muted">Manage bank holidays and company holidays.</p>
        </div>
      </header>

      <section class="content-grid">
        <div class="glass-card panel">
          <div class="panel-header panel-stack-mobile">
            <div>
              <h2>Holiday Calendar</h2>
              <p class="muted">Click a date to see holiday details.</p>
            </div>

            <div class="calendar-nav-actions">
              <button class="btn btn-secondary" id="prevHolidayMonthBtn" type="button">← Previous</button>
              <strong id="holidayMonthLabel">Month</strong>
              <button class="btn btn-secondary" id="nextHolidayMonthBtn" type="button">Next →</button>
            </div>
          </div>

          <div class="calendar-grid" id="holidayCalendarGrid"></div>
        </div>

        <div class="glass-card panel">
          <div class="panel-header">
            <div>
              <h2>Add Company Holiday</h2>
              <p class="muted">Bank holidays are shown automatically. Add your own company closure days here.</p>
            </div>
          </div>

          <form id="companyHolidayForm" class="form-grid">
            <div class="field full-width">
              <label>Holiday Name</label>
              <input id="holidayName" required placeholder="e.g. Christmas Closure" />
            </div>

            <div class="field full-width">
              <label>Date</label>
              <input id="holidayDate" type="date" required />
            </div>

            <div class="full-width">
              <button class="btn btn-primary" type="submit">Add Holiday</button>
            </div>
          </form>

          <div id="companyHolidayMessage" class="form-message"></div>

          <div class="modal-section">
            <h3>Upcoming Holidays</h3>
            <div id="holidayList" class="card-list compact-list"></div>
            <button class="btn btn-secondary btn-block hidden" id="loadMoreHolidaysBtn" type="button">Load More</button>
          </div>
        </div>
      </section>
    </main>
  </div>

  <div class="modal-backdrop hidden" id="holidayViewModal">
    <div class="modal-card glass-card">
      <div class="modal-header">
        <div>
          <h2 id="holidayViewTitle">Holiday</h2>
          <p class="muted" id="holidayViewSubtitle">Holiday details</p>
        </div>
        <button class="btn btn-secondary" data-close-modal="holidayViewModal" type="button">Close</button>
      </div>

      <div id="holidayViewContent" class="card-list"></div>
    </div>
  </div>

  <div class="modal-backdrop hidden" id="holidayEditModal">
    <div class="modal-card glass-card">
      <div class="modal-header">
        <div>
          <h2>Edit Company Holiday</h2>
          <p class="muted">Change the name or date, or delete the holiday.</p>
        </div>
        <button class="btn btn-secondary" data-close-modal="holidayEditModal" type="button">Close</button>
      </div>

      <form id="holidayEditForm" class="form-grid">
        <input type="hidden" id="editHolidayId" />

        <div class="field full-width">
          <label>Holiday Name</label>
          <input id="editHolidayName" required />
        </div>

        <div class="field full-width">
          <label>Date</label>
          <input id="editHolidayDate" type="date" required />
        </div>

        <div class="modal-actions full-width">
          <button class="btn btn-danger" id="deleteHolidayBtn" type="button">Delete</button>
          <button class="btn btn-secondary" data-close-modal="holidayEditModal" type="button">Cancel</button>
          <button class="btn btn-primary" type="submit">Save Changes</button>
        </div>
      </form>

      <div id="holidayEditMessage" class="form-message"></div>
    </div>
  </div>

  <script type="module" src="/holidaymanagement/assets/js/company-holidays.js?v=180"></script>
</body>
</html>
