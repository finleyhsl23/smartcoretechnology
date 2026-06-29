import { sb } from "./supabase.js";

export const DEFAULT_COMPANY_LABELS = { prospect: "Prospect", active: "Active", inactive: "Inactive", churned: "Churned" };
export const DEFAULT_LEAD_LABELS = {
  new: "New", contacted: "Contacted", qualified: "Qualified",
  proposal_sent: "Proposal Sent", negotiation: "Negotiation", won: "Won", lost: "Lost",
};

let _labels = { company: {}, lead: {} };

export async function loadStatusLabels(tenantId) {
  const { data } = await sb().from("crm_settings").select("status_labels").eq("tenant_id", tenantId).maybeSingle();
  _labels = { company: data?.status_labels?.company || {}, lead: data?.status_labels?.lead || {} };
  return _labels;
}

export function getCompanyLabel(status) {
  return _labels.company[status] || DEFAULT_COMPANY_LABELS[status] || status;
}

export function getLeadLabel(status) {
  return _labels.lead[status] || DEFAULT_LEAD_LABELS[status] || status;
}

export function getStatusLabels() {
  return _labels;
}

export async function saveStatusLabels(tenantId, labels) {
  const { error } = await sb().from("crm_settings").update({ status_labels: labels }).eq("tenant_id", tenantId);
  if (error) throw error;
  _labels = labels;
}
