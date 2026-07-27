// Photo-required task completion. Opens a camera capture modal, uploads the
// shot as proof (linked via sitesnap_media.task_id), then marks the task
// done. The server also enforces this independently — the
// sitesnap_tasks_track_completion trigger rejects the 'done' transition
// unless a photo already references the task — so this is UX, not the only
// gate.
import { media, tasks } from "./api.js";
import { modal, toast, esc, confirmDialog } from "./ui.js";
import { renderPhotoCaptureStep } from "./camera.js";
import { getCurrentPosition } from "./geo.js";

/**
 * @param {object} task - must have id, project_id, title
 * @param {object} opts
 *   opts.companyId, opts.employeeId
 *   opts.onDone(updatedTask)  - called after the task is successfully marked done
 *   opts.onCancel()           - called if the user backs out without completing
 */
export function completeTaskWithPhoto(task, { companyId, employeeId, onDone, onCancel } = {}) {
  let completed = false;

  const overlay = modal(`
    <div class="modal-header"><h3>Complete Task</h3><button class="modal-close">&times;</button></div>
    <div class="modal-body">
      <p class="text-muted" style="margin:0 0 12px">Take a photo to mark "${esc(task.title)}" as done.</p>
      <div id="taskCamHost"></div>
      <div style="text-align:center;margin-top:14px">
        <label class="btn" style="cursor:pointer">Upload photo from device<input type="file" accept="image/*" id="taskFilePick" style="display:none"/></label>
      </div>
      <div id="taskCamError" class="form-error"></div>
    </div>
  `, { onClose: () => { if (!completed) onCancel?.(); } });

  const host = overlay.querySelector("#taskCamHost");
  renderPhotoCaptureStep(host, {
    title: "Photo proof",
    onCancel: () => overlay.close(),
    onCaptured: ({ blob, width, height }) => finish({ blob, width, height, ext: "jpg" }),
  });

  overlay.querySelector("#taskFilePick").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    finish({ blob: file, ext: (file.name.split(".").pop() || "jpg") });
  });

  async function finish({ blob, width, height, ext }) {
    host.innerHTML = `<div class="sl-state"><div class="sl-spinner"></div><p>Uploading photo…</p></div>`;
    overlay.querySelector("#taskCamError").textContent = "";
    try {
      const position = await getCurrentPosition();
      const mediaId = crypto.randomUUID();
      const path = `${companyId}/${task.project_id}/${mediaId}.${ext}`;
      await media.uploadFile(path, blob);
      await media.create({
        id: mediaId, company_id: companyId, project_id: task.project_id, task_id: task.id,
        media_type: "photo", storage_path: path,
        caption: `Proof: ${task.title}`,
        latitude: position?.latitude ?? null, longitude: position?.longitude ?? null,
        uploaded_by: employeeId, file_size_bytes: blob.size, width: width || null, height: height || null,
      });
      const updated = await tasks.update(task.id, { status: "done" });
      completed = true;
      overlay.close();
      toast("success", "Task completed");
      onDone?.(updated);
    } catch (e) {
      overlay.querySelector("#taskCamError").textContent = e.message || "Could not complete task.";
      host.innerHTML = `<p class="text-muted">Something went wrong. Close this and try again.</p>`;
    }
  }
}

/**
 * Reverts a completed task back to open, deleting its proof photo(s) first
 * (both the storage file and the sitesnap_media row) — confirmed since it's
 * destructive. The task can only be marked done again by taking a new one.
 *
 * @param {object} task - a task row with its embedded sitesnap_media!task_id array
 * @param {object} opts.onDone(updatedTask) - called after the task is reopened
 */
export function reopenTask(task, { onDone } = {}) {
  const shots = task.sitesnap_media || [];
  const message = shots.length
    ? `This will delete the attached proof photo — you'll need to retake it to mark "${task.title}" done again.`
    : `Mark "${task.title}" as not done?`;
  confirmDialog("Undo completion?", message, async () => {
    try {
      for (const shot of shots) {
        await media.removeFile(shot.storage_path).catch(() => {});
        await media.remove(shot.id);
      }
      const updated = await tasks.update(task.id, { status: "open" });
      toast("success", "Task reopened");
      onDone?.(updated);
    } catch (e) {
      toast("error", "Couldn't reopen task", e.message || "");
    }
  }, { confirmLabel: "Undo" });
}

/**
 * @param {object} task - a task row with its embedded sitesnap_media!task_id array
 */
export async function viewTaskPhoto(task) {
  const shot = (task.sitesnap_media || [])[0];
  if (!shot) { toast("error", "No photo attached to this task."); return; }

  const overlay = modal(`<div class="modal-body"><div class="sl-state"><div class="sl-spinner"></div></div></div>`, { size: "wide" });
  try {
    const url = await media.signedUrl(shot.storage_path);
    overlay.querySelector(".modal").innerHTML = `
      <div class="modal-header"><h3>Task Photo</h3><button class="modal-close">&times;</button></div>
      <div class="modal-body sl-media-viewer">
        <div class="sl-media-viewer-frame"><img src="${url}" alt="Task completion photo"/></div>
      </div>`;
    overlay.querySelectorAll(".modal-close").forEach(b => b.addEventListener("click", () => overlay.close()));
  } catch (e) {
    overlay.close();
    toast("error", "Couldn't load photo", e.message || "");
  }
}
