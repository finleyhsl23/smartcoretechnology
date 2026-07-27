// Photo-required task completion. Opens a camera capture modal, uploads the
// shot as proof (linked via sitesnap_media.task_id), then marks the task
// done. The server also enforces this independently — the
// sitesnap_tasks_track_completion trigger rejects the 'done' transition
// unless a photo already references the task — so this is UX, not the only
// gate.
import { media, tasks } from "./api.js";
import { modal, toast, esc } from "./ui.js";
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
