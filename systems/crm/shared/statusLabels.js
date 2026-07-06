import { sb } from "/systems/crm/shared/supabase.js";

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

export async function loadStatusLabels(tenantId) {
  try {
    const { data } = await sb()
      .from("crm_status_labels")
      .select("*")
      .eq("tenant_id", tenantId);
    if (data?.length) {
      const company = data.filter(r => r.type === "company");
      const lead    = data.filter(r => r.type === "lead");
      if (company.length) _companyStatuses = company.map(r => ({ value: r.value, label: r.label }));
      if (lead.length)    _leadStatuses    = lead.map(r => ({ value: r.value, label: r.label }));
    }
  } catch (_) {
    // table may not exist yet — fall back to defaults silently
  }
}

export function getCompanyStatuses() { return _companyStatuses; }
export function getLeadStatuses()    { return _leadStatuses; }

export function getCompanyLabel(value) {
  return _companyStatuses.find(s => s.value === value)?.label ?? value;
}

export function getLeadLabel(value) {
  return _leadStatuses.find(s => s.value === value)?.label ?? value;
}
