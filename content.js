/**
 * NHL Standings - 3-Point System Content Script
 *
 * Modifies the NHL.com standings table to use a 3-point win system:
 *   Regulation Win (W)  = 3 points
 *   OT/Shootout Win (OTW) = 2 points
 *   OT/Shootout Loss (OTL) = 1 point
 *   Regulation Loss (L) = 0 points
 *
 * Column changes:
 *   W   - updated to show regulation wins only (source: RW column)
 *   OTW - new column for OT/shootout wins (= original W minus RW)
 *   OTL - renamed from OT
 *   PTS - recomputed as W*3 + OTW*2 + OTL*1
 *   P%  - recomputed as PTS / (GP * 3)
 *   RW  - removed (data merged into W)
 *   ROW - removed
 */

(function () {
  'use strict';

  /** data-col value to assign the new OTW column */
  const OTW_COL = 'otw';

  /**
   * Format a decimal as ".NNN" matching NHL's P% display style.
   * @param {number} value - a number between 0 and 1
   * @returns {string}
   */
  function formatPct(value) {
    if (!isFinite(value) || isNaN(value)) return '.000';
    return value.toFixed(3).replace(/^0\./, '.');
  }

  /**
   * Return the visible text of a header cell, ignoring nested tooltip
   * or icon elements that may appear inside the <th>.
   * Tries the first direct text node first, then falls back to the
   * text content of the first button/span child, and finally to the
   * full textContent.
   * @param {HTMLElement} th
   * @returns {string}
   */
  function getHeaderText(th) {
    // Walk direct child text nodes first
    for (const node of th.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        const t = node.textContent.trim();
        if (t) return t.toUpperCase();
      }
    }
    // Fall back to button or span text
    const inner = th.querySelector('button, span');
    if (inner) return inner.textContent.trim().toUpperCase();
    return th.textContent.trim().toUpperCase();
  }

  /**
   * Set the visible text of a header cell, preserving any existing
   * inner structure (e.g. sort buttons) where possible.
   * @param {HTMLElement} th
   * @param {string} text
   */
  function setHeaderText(th, text) {
    // If there's a button or span, update the text inside it
    const inner = th.querySelector('button, span');
    if (inner) {
      // Find the first text node inside inner and update it
      for (const node of inner.childNodes) {
        if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
          node.textContent = text;
          return;
        }
      }
      inner.textContent = text;
      return;
    }
    // Plain text header
    th.textContent = text;
  }

  /**
   * Build a map of logical column names to their 0-based index in the
   * header row, identified by data-col attribute or visible text.
   * @param {HTMLTableRowElement} headerRow
   * @returns {Object}
   */
  function buildColMap(headerRow) {
    const map = {};
    const headers = Array.from(headerRow.querySelectorAll('th'));
    headers.forEach((th, i) => {
      const text = getHeaderText(th);
      const dataCol = (th.getAttribute('data-col') || '').toLowerCase();

      if (text === 'GP' || dataCol === 'gp') {
        map.gp = i;
      } else if (text === 'W' || dataCol === 'w') {
        map.w = i;
      } else if (text === 'L' || dataCol === 'l') {
        map.l = i;
      } else if (text === 'OT' || dataCol === 'ot') {
        map.ot = i;
      } else if (text === 'PTS' || dataCol === 'pts') {
        map.pts = i;
      } else if (
        text === 'P%' ||
        text === 'PCT' ||
        dataCol === 'pptg' ||
        dataCol === 'ppct' ||
        dataCol === 'p-percentage' ||
        dataCol === 'p%'
      ) {
        map.ppct = i;
      } else if (text === 'RW' || dataCol === 'rw') {
        map.rw = i;
      } else if (text === 'ROW' || dataCol === 'row') {
        map.row = i;
      }
    });
    return map;
  }

  /**
   * Check whether a table has already been processed by this extension.
   * We use the presence of our injected OTW header as the signal.
   * @param {HTMLTableElement} table
   * @returns {boolean}
   */
  function isProcessed(table) {
    return table.querySelector(`th[data-col="${OTW_COL}"]`) !== null;
  }

  /**
   * Process a single standings table: insert OTW column, rename OTL,
   * recompute PTS and P%, and remove RW / ROW columns.
   * @param {HTMLTableElement} table
   */
  function processTable(table) {
    if (isProcessed(table)) return;

    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody');
    if (!thead || !tbody) return;

    const headerRow = thead.querySelector('tr');
    if (!headerRow) return;

    const headers = Array.from(headerRow.querySelectorAll('th'));
    const colMap = buildColMap(headerRow);

    // Only process tables that look like NHL standings (must have W and RW)
    if (colMap.w === undefined || colMap.rw === undefined) return;

    // --- Process data rows first (before altering header structure) ---
    const rows = Array.from(tbody.querySelectorAll('tr'));
    rows.forEach((row) => {
      // Use 'th, td' so that row-header cells (<th scope="row">, used by the
      // real NHL.com table for the team name column) are included and indices
      // stay in sync with the header column map.
      const cells = Array.from(row.querySelectorAll('th, td'));
      // Skip rows that don't have enough cells (e.g. section header rows)
      if (cells.length < headers.length - 1) return;

      const gp = parseInt(cells[colMap.gp]?.textContent.trim() || '0', 10) || 0;
      const totalW = parseInt(cells[colMap.w]?.textContent.trim() || '0', 10) || 0;
      const rw = parseInt(cells[colMap.rw]?.textContent.trim() || '0', 10) || 0;
      const otl = parseInt(cells[colMap.ot]?.textContent.trim() || '0', 10) || 0;

      const otw = Math.max(0, totalW - rw);
      const newPts = rw * 3 + otw * 2 + otl;
      const newPpct = gp > 0 ? newPts / (gp * 3) : 0;

      // Update W cell to show regulation wins only
      if (cells[colMap.w]) cells[colMap.w].textContent = rw;

      // Insert new OTW cell immediately after the W cell
      if (cells[colMap.w]) {
        const otwCell = cells[colMap.w].cloneNode(false);
        otwCell.textContent = otw;
        otwCell.setAttribute('data-col', OTW_COL);
        cells[colMap.w].insertAdjacentElement('afterend', otwCell);
      }

      // Recompute PTS
      if (colMap.pts !== undefined && cells[colMap.pts]) {
        cells[colMap.pts].textContent = newPts;
      }

      // Recompute P%
      if (colMap.ppct !== undefined && cells[colMap.ppct]) {
        cells[colMap.ppct].textContent = formatPct(newPpct);
      }

      // Remove RW and ROW cells (use saved cell references, not indices,
      // because the OTW insertion shifted the live DOM but the cells
      // array still holds valid element references)
      if (cells[colMap.rw]) cells[colMap.rw].remove();
      if (colMap.row !== undefined && cells[colMap.row]) {
        cells[colMap.row].remove();
      }
    });

    // --- Update header row ---

    // Insert OTW header after W header
    const wHeaderEl = headers[colMap.w];
    if (wHeaderEl) {
      const otwHeader = wHeaderEl.cloneNode(true);
      otwHeader.removeAttribute('aria-sort');
      otwHeader.setAttribute('data-col', OTW_COL);
      setHeaderText(otwHeader, 'OTW');
      wHeaderEl.insertAdjacentElement('afterend', otwHeader);
    }

    // Rename OT → OTL
    if (colMap.ot !== undefined && headers[colMap.ot]) {
      setHeaderText(headers[colMap.ot], 'OTL');
    }

    // Remove RW header
    if (colMap.rw !== undefined && headers[colMap.rw]) {
      headers[colMap.rw].remove();
    }

    // Remove ROW header
    if (colMap.row !== undefined && headers[colMap.row]) {
      headers[colMap.row].remove();
    }
  }

  /** Process every table on the page. */
  function processAllTables() {
    document.querySelectorAll('table').forEach(processTable);
  }

  // --- MutationObserver: react to dynamically rendered content ---

  let debounceTimer = null;

  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(processAllTables, 150);
  });

  function startObserver() {
    observer.observe(document.body, { childList: true, subtree: true });
    processAllTables();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver);
  } else {
    startObserver();
  }

  // --- SPA navigation: handle URL changes without a full page reload ---

  const origPushState = history.pushState.bind(history);
  history.pushState = function (...args) {
    origPushState(...args);
    // New content will be loaded; the observer will pick it up automatically
    // since the new tables won't have our OTW header yet.
  };

  window.addEventListener('popstate', () => {
    // Same as above — observer handles re-processing of newly rendered tables
  });

  // Expose internals for unit testing
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { formatPct, getHeaderText, setHeaderText, buildColMap, isProcessed, processTable, processAllTables };
  }
})();
