// ── Searchable select ────────────────────────────────────────────────────
// Turns a plain <select> into a type-to-filter combobox everywhere in the
// module, without changing how the rest of each page reads/writes it: the
// original <select> stays in the DOM (hidden) as the source of truth, so
// existing `.value` reads and "change" listeners keep working unchanged.
// Call enhanceSelect(el) right after the <select> is rendered/populated —
// safe to call again after a re-render since it operates on whatever
// <select> element is passed in.

function escHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

export function enhanceSelect(selectEl) {
  if (!selectEl || selectEl.dataset.comboEnhanced) return;
  selectEl.dataset.comboEnhanced = "1";
  selectEl.style.display = "none";
  selectEl.setAttribute("aria-hidden", "true");
  selectEl.tabIndex = -1;

  const wrap = document.createElement("div");
  wrap.className = "pfs-combo-wrap";

  const input = document.createElement("input");
  input.type = "text";
  input.className = `pfs-combo-input ${selectEl.className || ""}`.trim();
  input.autocomplete = "off";
  input.spellcheck = false;
  if (selectEl.id) input.id = `${selectEl.id}__combo`;
  const ariaLabel = selectEl.getAttribute("aria-label");
  if (ariaLabel) input.setAttribute("aria-label", ariaLabel);
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-autocomplete", "list");

  const dropdown = document.createElement("div");
  dropdown.className = "pfs-combo-dropdown";
  dropdown.style.display = "none";
  dropdown.setAttribute("role", "listbox");

  wrap.appendChild(input);
  wrap.appendChild(dropdown);
  selectEl.insertAdjacentElement("afterend", wrap);

  let activeIndex = -1;
  let visibleOptions = [];

  const currentOptions = () =>
    Array.from(selectEl.options).map((o) => ({ value: o.value, label: o.textContent }));

  const syncInputFromSelect = () => {
    const opt = selectEl.options[selectEl.selectedIndex];
    input.value = opt ? opt.textContent : "";
  };

  const closeDropdown = () => {
    dropdown.style.display = "none";
    input.setAttribute("aria-expanded", "false");
    activeIndex = -1;
  };

  const highlight = (idx) => {
    activeIndex = idx;
    dropdown.querySelectorAll(".pfs-combo-option").forEach((el, i) => {
      el.classList.toggle("active", i === idx);
      if (i === idx) el.scrollIntoView({ block: "nearest" });
    });
  };

  const pick = (opt) => {
    selectEl.value = opt.value;
    selectEl.dispatchEvent(new Event("change", { bubbles: true }));
    syncInputFromSelect();
    closeDropdown();
  };

  const renderDropdown = (filterText) => {
    const q = (filterText || "").trim().toLowerCase();
    visibleOptions = currentOptions().filter((o) => !q || o.label.toLowerCase().includes(q));
    dropdown.innerHTML = visibleOptions.length
      ? visibleOptions.map((o) => `<button type="button" class="pfs-combo-option" data-value="${escHtml(o.value)}">${escHtml(o.label)}</button>`).join("")
      : `<div class="pfs-combo-empty">No matches</div>`;

    dropdown.querySelectorAll(".pfs-combo-option").forEach((btn, i) => {
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault(); // fire before the input's blur handler closes the dropdown
        pick(visibleOptions[i]);
      });
      btn.addEventListener("mouseenter", () => highlight(i));
    });

    dropdown.style.display = "";
    input.setAttribute("aria-expanded", "true");
    activeIndex = -1;
  };

  input.addEventListener("focus", () => renderDropdown(""));
  input.addEventListener("click", () => { if (dropdown.style.display === "none") renderDropdown(""); });
  input.addEventListener("input", () => renderDropdown(input.value));
  input.addEventListener("blur", () => {
    // Delay so a mousedown on an option can register before we snap the text back
    setTimeout(() => { closeDropdown(); syncInputFromSelect(); }, 150);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (dropdown.style.display === "none") { renderDropdown(input.value); return; }
      if (visibleOptions.length) highlight(Math.min(activeIndex + 1, visibleOptions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (visibleOptions.length) highlight(Math.max(activeIndex - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && visibleOptions[activeIndex]) pick(visibleOptions[activeIndex]);
      else if (visibleOptions.length === 1) pick(visibleOptions[0]);
    } else if (e.key === "Escape") {
      closeDropdown();
      syncInputFromSelect();
      input.blur();
    }
  });

  syncInputFromSelect();
}

/** Enhance every <select> under the given root (defaults to the whole document). */
export function enhanceAllSelects(root = document) {
  root.querySelectorAll("select").forEach((el) => enhanceSelect(el));
}
