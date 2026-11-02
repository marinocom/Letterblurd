/*
 * Letterblurd content script.
 *
 * On Letterboxd film pages it hides the ratings histogram and the average
 * behind a blurred decoy (the same natural-looking distribution for every
 * film, so the blur can't leak the real shape). The real chart comes back
 * when you rate the film, or when you click "Reveal anyway?".
 */
(() => {
  "use strict";

  const api = globalThis.browser ?? globalThis.chrome;

  // ---------------------------------------------------------------------------
  // Selectors. Letterboxd can change its markup; if something breaks, this is
  // the place to fix it.
  // ---------------------------------------------------------------------------
  const SEL = {
    chart: ".ratings-histogram-chart",
    histogram: ".rating-histogram",
    bars: ".rating-histogram ul",
    average: ".average-rating, .display-rating",
  };

  // Ways the signed-in user's own rating shows up in the sidebar. Each returns
  // a rating in half-stars (1-10) or 0 when not rated.
  const RATING_PROBES = [
    {
      name: "rateit[data-rateit-value]",
      read: () => maxOf(document.querySelectorAll(".rateit[data-rateit-value]"),
        (el) => el.getAttribute("data-rateit-value")),
    },
    {
      name: "rateit-range[aria-valuenow]",
      read: () => maxOf(document.querySelectorAll(".rateit-range[aria-valuenow], .rateit [role='slider'][aria-valuenow]"),
        (el) => el.getAttribute("aria-valuenow")),
    },
    {
      name: "rateit hidden input",
      read: () => maxOf(document.querySelectorAll(".rateit input, input.rateit-field, .rating-ux input[name='rating']"),
        (el) => el.value),
    },
    {
      name: "rateit-selected width",
      read: () => maxOf(document.querySelectorAll(".rateit .rateit-selected"),
        (el) => parseFloat(el.style.width) > 0 ? 1 : 0),
    },
    {
      name: "actions panel rated-N",
      read: () => maxOf(document.querySelectorAll(".js-actions-panel .rating[class*='rated-'], .actions-panel .rating[class*='rated-']"),
        (el) => (el.className.match(/\brated-(\d+)\b/) || [])[1]),
    },
  ];

  // Decoy bar heights (½★ to 5★), as a share of the tallest bar. A generic,
  // slightly left-skewed bell shape like most films have.
  const DECOY_SHAPE = [4, 6, 7, 14, 18, 42, 58, 100, 64, 30];
  const DECOY_AVERAGE = "3.5";

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const state = {
    enabled: true,
    rated: false, // sticky for this page view once detected
    revealed: false, // "Reveal anyway?" was clicked
  };

  const debug = (() => {
    try { return localStorage.getItem("letterblurd:debug") === "1"; } catch { return false; }
  })();
  const log = (...args) => { if (debug) console.log("[Letterblurd]", ...args); };

  function maxOf(nodes, pick) {
    let best = 0;
    for (const el of nodes) {
      const n = parseFloat(pick(el));
      if (Number.isFinite(n) && n > best) best = n;
    }
    return best;
  }

  function detectRating() {
    for (const probe of RATING_PROBES) {
      let value = 0;
      try { value = probe.read(); } catch { value = 0; }
      if (value > 0) return { value, source: probe.name };
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------------
  function buildDecoy() {
    const decoy = document.createElement("div");
    decoy.className = "lbb-decoy";
    decoy.setAttribute("aria-hidden", "true");
    for (const h of DECOY_SHAPE) {
      const bar = document.createElement("span");
      bar.style.height = `${h}%`;
      decoy.appendChild(bar);
    }
    return decoy;
  }

  function placeOverlays(chart) {
    placeFakeAverage(chart);
    const histogram = chart.querySelector(SEL.histogram);
    const decoy = chart.querySelector(".lbb-decoy");
    if (!histogram || !decoy) return;

    const box = histogram.getBoundingClientRect();
    const ul = chart.querySelector(SEL.bars);
    const ulBox = ul ? ul.getBoundingClientRect() : null;

    // Prefer the real bars' area; fall back to the histogram minus the star icons.
    let left = 22;
    let right = 22;
    if (ulBox && ulBox.width > 20) {
      left = Math.max(0, ulBox.left - box.left);
      right = Math.max(0, box.right - ulBox.right);
    }
    const height = Math.max(24, box.height || 44);
    Object.assign(decoy.style, {
      left: `${left}px`,
      right: `${right}px`,
      bottom: "0px",
      height: `${height}px`,
    });
  }

  // The fake average lives in the chart (not inside the real average, which is
  // hidden with opacity) and sits exactly on top of where the real one is.
  function placeFakeAverage(chart) {
    const fake = chart.querySelector(":scope > .lbb-fake-avg");
    const average = chart.querySelector(SEL.average);
    if (!fake || !average) return;
    const c = chart.getBoundingClientRect();
    const a = average.getBoundingClientRect();
    if (!a.width && !a.height) return;
    Object.assign(fake.style, {
      left: `${a.left - c.left}px`,
      top: `${a.top - c.top}px`,
      width: `${a.width}px`,
      height: `${a.height}px`,
    });
    // Copy the real number's type so the blur reads like the real thing.
    const type = getComputedStyle(chart.querySelector(".display-rating") || average);
    Object.assign(fake.style, {
      fontSize: type.fontSize,
      fontWeight: type.fontWeight,
      fontFamily: type.fontFamily,
      color: type.color,
    });
  }

  // Make el a positioning context without moving it if it already is one.
  function anchor(el) {
    if (el && getComputedStyle(el).position === "static") el.classList.add("lbb-anchor");
  }

  function manage(chart) {
    if (chart.classList.contains("lbb-managed")) return;
    chart.classList.add("lbb-managed");
    anchor(chart);

    const histogram = chart.querySelector(SEL.histogram);
    if (histogram) {
      anchor(histogram);
      histogram.appendChild(buildDecoy());
    }

    if (chart.querySelector(SEL.average)) {
      const fake = document.createElement("span");
      fake.className = "lbb-fake-avg";
      fake.setAttribute("aria-hidden", "true");
      fake.textContent = DECOY_AVERAGE;
      chart.appendChild(fake);
    }
    placeOverlays(chart);
    // Keep overlays lined up when fonts load or the sidebar reflows.
    if ("ResizeObserver" in window) new ResizeObserver(() => placeOverlays(chart)).observe(chart);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "lbb-reveal";
    button.textContent = "Reveal anyway?";
    button.title = "Show this film's ratings before you've rated it";
    button.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      state.revealed = true;
      log("revealed manually");
      render();
    });
    chart.appendChild(button);
    log("managing ratings chart", chart);
  }

  function render() {
    const root = document.documentElement;
    const unlocked = state.rated || state.revealed;
    root.classList.toggle("lbb-off", !state.enabled);
    root.classList.toggle("lbb-unlocked", unlocked);

    for (const chart of document.querySelectorAll(SEL.chart)) {
      if (!chart.querySelector(SEL.histogram) && !chart.querySelector(SEL.average)) continue;
      manage(chart);
      const button = chart.querySelector(".lbb-reveal");
      if (button) button.tabIndex = state.enabled && !unlocked ? 0 : -1;
    }
  }

  function check() {
    if (!state.rated) {
      const hit = detectRating();
      if (hit) {
        state.rated = true;
        log(`rating detected (${hit.value}/10 half-stars) via ${hit.source}`);
      }
    }
    render();
  }

  // Coalesce bursts of DOM changes into one check per frame.
  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; check(); });
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-rateit-value", "aria-valuenow", "value", "class", "style"],
  });

  // Fallback in case a rating lands in a way the observer can't see.
  setInterval(() => {
    if (!state.rated && !document.hidden) check();
  }, 1500);

  api.storage.sync.get({ enabled: true }, (items) => {
    state.enabled = items?.enabled !== false;
    schedule();
  });

  api.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.enabled) {
      state.enabled = changes.enabled.newValue !== false;
      schedule();
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", schedule, { once: true });
  }
  schedule();
})();
