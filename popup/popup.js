"use strict";

const api = globalThis.browser ?? globalThis.chrome;
const toggle = document.getElementById("enabled");
const status = document.getElementById("status");

function show(enabled) {
  toggle.checked = enabled;
  status.textContent = enabled
    ? "Ratings stay hidden until you rate the film."
    : "Paused. Ratings are visible everywhere.";
}

api.storage.sync.get({ enabled: true }, (items) => show(items?.enabled !== false));

toggle.addEventListener("change", () => {
  const enabled = toggle.checked;
  show(enabled);
  api.storage.sync.set({ enabled });
});

document.getElementById("version").textContent = `v${api.runtime.getManifest().version}`;
