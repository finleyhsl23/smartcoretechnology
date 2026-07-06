const DEFAULT_COMPANY_STATUSES = [
  { value: "lead",       label: "Lead" },
  { value: "prospect",   label: "Prospect" },
  { value: "active",     label: "Active Customer" },
  { value: "inactive",   label: "Inactive" },
  { value: "churned",    label: "Churned" },
];

const DEFAULT_LEAD_STATUSES = [
  { value: "new",          label: "New" },
  { value: "contacted",    label: "Contacted" },
  { value: "qualified",    label: "Qualified" },
  { value: "proposal",     label: "Proposal Sent" },
  { value: "negotiation",  label: "Negotiation" },
  { value: "won",          label: "Won" },
  { value: "lost",         label: "Lost" },
];

let _companyStatuses = [...DEFAULT_COMPANY_STATUSES];
let _leadStatuses    = [...DEFAULT_LEAD_STATUSES];

export async function loadStatusLabels(_tenantId) {
  // Uses hardcoded defaults. Custom status labels can be added later.
}

export function getCompanyStatuses() { return _companyStatuses; }
export function getLeadStatuses()    { return _leadStatuses; }

export function getCompanyLabel(value) {
  return _companyStatuses.find(s => s.value === value)?.label ?? value;
}

export function getLeadLabel(value) {
  return _leadStatuses.find(s => s.value === value)?.label ?? value;
}
