// Browser notifications for SiteSnap. Deliberately scoped to what's real:
// this fires via the page's own Notification API while a SiteSnap tab is
// open (foreground or backgrounded within the same browser session) — it is
// NOT push-to-closed-browser, which would need a service worker + Push API
// + a server-side push endpoint this platform doesn't have yet.
import { sb } from "./supabase.js";

export function isSupported() {
  return "Notification" in window;
}

export function notifyIfPermitted(title, options = {}) {
  if (!isSupported() || Notification.permission !== "granted") return null;
  try {
    return new Notification(title, options);
  } catch {
    return null;
  }
}

/**
 * Fires a browser notification the moment a task is newly assigned to this
 * employee — either created with them as assignee, or reassigned to them.
 * Returns the Supabase Realtime channel so the caller can unsubscribe if
 * they ever need to (not required for a page that just stays open).
 */
export function subscribeToTaskAssignments({ employeeId }) {
  return sb().channel(`sitesnap-tasks-assigned-${employeeId}`)
    .on("postgres_changes", {
      event: "*", schema: "public", table: "sitesnap_tasks",
      filter: `assignee_employee_id=eq.${employeeId}`,
    }, (payload) => {
      const isNewAssignment = payload.eventType === "INSERT"
        || (payload.eventType === "UPDATE" && payload.old?.assignee_employee_id !== payload.new?.assignee_employee_id);
      if (!isNewAssignment) return;

      const n = notifyIfPermitted("New task assigned to you", { body: payload.new.title });
      if (n) n.onclick = () => { window.focus(); window.location.href = "/systems/sitesnap/tasks.html"; };
    })
    .subscribe();
}
