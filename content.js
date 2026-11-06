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
 *   DPTS / DP% - NHL's original 2-point-system points and percentage
 *   RW  - removed (data merged into W)
 *   ROW - removed
 */

(function () {
  'use strict';

  /** data-col value to assign the new OTW column */
  const OTW_COL = 'otw';
  const tableStates = new WeakMap();
  const rowValues = new WeakMap();
  let activeSort = { column: 'PTS', direction: 'descending' };

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
    const inner = th.querySelector('.sortable-table-header, button, span');
    if (inner) {
      const walker = document.createTreeWalker(inner, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (node.textContent.trim() && !node.parentElement.closest('svg, [aria-hidden="true"]')) {
          return node.textContent.trim().toUpperCase();
        }
      }
    }
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
    const inner = th.querySelector('.sortable-table-header, button, span');
    if (inner) {
      const walker = document.createTreeWalker(inner, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (!node.textContent.trim() || node.parentElement.closest('svg, [aria-hidden="true"]')) continue;
        node.textContent = text;
        return;
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

  function snapshotDOM(root) {
    const nodes = [root, ...root.querySelectorAll('*')].map((element) => ({
      element,
      children: Array.from(element.childNodes),
      attributes: Array.from(element.attributes, (attr) => [attr.name, attr.value]),
    }));
    const text = nodes.flatMap(({ children }) => children)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => [node, node.textContent]);
    return () => {
      for (const { element, children, attributes } of nodes) {
        element.replaceChildren(...children);
        Array.from(element.attributes).forEach((attr) => element.removeAttribute(attr.name));
        attributes.forEach(([name, value]) => element.setAttribute(name, value));
      }
      text.forEach(([node, value]) => { node.textContent = value; });
    };
  }

  /**
   * Process a single standings table: insert OTW column, rename OTL,
   * show both points systems, remove RW / ROW, and sort within groups.
   * @param {HTMLTableElement} table
   */
  function processTable(table) {
    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody');
    if (!thead || !tbody) return;

    const headerRow = thead.querySelector('tr');
    if (!headerRow) return;

    const processed = isProcessed(table);
    let state = tableStates.get(table);
    if (processed && !state) return;
    const headers = processed ? state.headers : Array.from(headerRow.cells);
    const colMap = processed ? state.colMap : buildColMap(headerRow);

    // Require the source statistics needed by both points systems.
    if (['gp', 'w', 'ot', 'pts', 'ppct', 'rw'].some((key) => colMap[key] === undefined)) return;

    if (!processed) {
      state = { headers, colMap, restoreHeader: snapshotDOM(headerRow), rows: new Map() };
      tableStates.set(table, state);
    }

    // --- Process data rows first (before altering header structure) ---
    const rows = Array.from(table.tBodies).flatMap((body) => Array.from(body.rows));
    rows.forEach((row, order) => {
      if (row.querySelector(`td[data-col="${OTW_COL}"]`)) return;
      if (!state.rows.has(row)) state.rows.set(row, { restore: snapshotDOM(row), order });
      // Include NHL's <th scope="row"> team cell when indexing statistics.
      const cells = Array.from(row.cells);
      if (cells.length !== headers.length || cells.some((cell) => cell.colSpan > 1)) {
        if (!processed) cells.forEach((cell) => {
          if (cell.colSpan >= headers.length) cell.colSpan += colMap.row === undefined ? 2 : 1;
        });
        return;
      }

      const gp = parseInt(cells[colMap.gp]?.textContent.trim() || '0', 10) || 0;
      const totalW = parseInt(cells[colMap.w]?.textContent.trim() || '0', 10) || 0;
      const rw = parseInt(cells[colMap.rw]?.textContent.trim() || '0', 10) || 0;
      const otl = parseInt(cells[colMap.ot]?.textContent.trim() || '0', 10) || 0;

      const otw = Math.max(0, totalW - rw);
      const newPts = rw * 3 + otw * 2 + otl;
      const newPpct = gp > 0 ? newPts / (gp * 3) : 0;
      const dumbPts = totalW * 2 + otl;
      const dumbPpct = gp > 0 ? dumbPts / (gp * 2) : 0;
      rowValues.set(row, { 'P%': newPpct, 'DP%': dumbPpct, order });

      const dptsCell = cells[colMap.pts].cloneNode(false);
      dptsCell.setAttribute('data-col', 'dpts');
      dptsCell.textContent = dumbPts;
      const dpctCell = cells[colMap.ppct].cloneNode(false);
      dpctCell.setAttribute('data-col', 'dpct');
      dpctCell.textContent = formatPct(dumbPpct);
      cells[colMap.ppct].after(dptsCell, dpctCell);

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

    if (processed) {
      sortTable(table);
      return;
    }

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

    const dptsHeader = headers[colMap.pts].cloneNode(true);
    dptsHeader.setAttribute('data-col', 'dpts');
    setHeaderText(dptsHeader, 'DPTS');
    const dpctHeader = headers[colMap.ppct].cloneNode(true);
    dpctHeader.setAttribute('data-col', 'dpct');
    setHeaderText(dpctHeader, 'DP%');
    headers[colMap.ppct].after(dptsHeader, dpctHeader);
    setHeaderText(headers[colMap.ppct], 'P%');

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
    sortTable(table);
  }

  function sortValue(row, index, column) {
    const exact = rowValues.get(row)?.[column];
    if (exact !== undefined) return exact;
    const cell = row.cells[index];
    const text = cell?.textContent.trim() || '';
    if (column === 'TEAM') {
      return cell.querySelector('a[aria-label]')?.getAttribute('aria-label') || text;
    }
    if (/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)) return Number(text);
    if (column === 'STRK' && /^[WL]\d+$/.test(text)) {
      return Number(text.slice(1)) * (text[0] === 'W' ? 1 : -1);
    }
    return text;
  }

  function sortTable(table) {
    const headers = Array.from(table.tHead.rows[0].cells);
    const index = headers.findIndex((header) => getHeaderText(header) === activeSort.column);
    if (index < 0) return;
    const rankIndex = headers.findIndex((header) => getHeaderText(header) === 'RANK');
    const ptsIndex = headers.findIndex((header) => getHeaderText(header) === 'PTS');
    const multiplier = activeSort.direction === 'ascending' ? 1 : -1;
    const compare = (a, b) => {
      const left = sortValue(a, index, activeSort.column);
      const right = sortValue(b, index, activeSort.column);
      const result = typeof left === 'number' && typeof right === 'number'
        ? left - right
        : String(left).localeCompare(String(right), undefined, { numeric: true });
      return result * multiplier || rowValues.get(a).order - rowValues.get(b).order;
    };

    // Each table/body or section-delimited run is a group in the selected NHL view.
    for (const body of table.tBodies) {
      let group = [];
      const flush = () => {
        if (rankIndex >= 0) {
          [...group].sort((a, b) =>
            Number(b.cells[ptsIndex].textContent) - Number(a.cells[ptsIndex].textContent) ||
            rowValues.get(a).order - rowValues.get(b).order)
            .forEach((row, i) => {
              rowValues.get(row).RANK = i + 1;
              row.cells[rankIndex].textContent = i + 1;
            });
        }
        const sorted = [...group].sort(compare);
        if (sorted.some((row, i) => row !== group[i])) {
          const end = group[group.length - 1].nextSibling;
          sorted.forEach((row) => body.insertBefore(row, end));
        }
        group = [];
      };
      for (const row of Array.from(body.rows)) {
        Array.from(row.cells).forEach((cell, i) => {
          cell.classList.remove('sorted', 'sorted-0', 'sorted-asc', 'sorted-desc');
          if (i === index && rowValues.has(row)) {
            cell.classList.add('sorted', 'sorted-0', multiplier === 1 ? 'sorted-asc' : 'sorted-desc');
          }
        });
        if (row.cells.length === headers.length && rowValues.has(row)) group.push(row);
        else flush();
      }
      flush();
    }

    headers.forEach((header, i) => {
      const column = getHeaderText(header);
      const direction = i === index ? activeSort.direction : 'none';
      header.setAttribute('aria-sort', direction);
      header.classList.remove('sorted', 'sorted-0', 'sorted-asc', 'sorted-desc');
      if (i === index) header.classList.add('sorted', 'sorted-0', multiplier === 1 ? 'sorted-asc' : 'sorted-desc');
      let button = header.querySelector('button');
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.append(...header.childNodes);
        header.append(button);
      }
      button.title = column;
      button.setAttribute('aria-label', `${column}, ${direction === 'none' ? 'sortable' : `sorted ${direction}`}`);
      header.querySelectorAll('svg').forEach((icon) => { icon.style.display = 'none'; });
      let indicator = button.querySelector('[data-nhl-sort-indicator]');
      if (i === index && !indicator) {
        indicator = document.createElement('span');
        indicator.setAttribute('data-nhl-sort-indicator', '');
        indicator.setAttribute('aria-hidden', 'true');
        button.append(indicator);
      }
      if (indicator) {
        indicator.style.cssText = i === index
          ? `display:inline-block;margin-left:4px;border-left:4px solid transparent;border-right:4px solid transparent;border-${multiplier === 1 ? 'bottom' : 'top'}:5px solid currentColor`
          : 'display:none';
      }
    });
  }

  // Capture before the site's React handlers so NHL's 2-point sort never runs.
  window.addEventListener('click', (event) => {
    const header = event.target instanceof Element ? event.target.closest('thead th') : null;
    const table = header?.closest('table');
    if (!table || !tableStates.has(table) || !isProcessed(table)) {
      restoreTables();
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    const column = getHeaderText(header);
    activeSort = {
      column,
      direction: activeSort.column === column && activeSort.direction === 'descending'
        ? 'ascending'
        : column === 'TEAM' && activeSort.column !== column ? 'ascending' : 'descending',
    };
    processAllTables();
  }, true);

  function restoreTables() {
    observer.disconnect();
    document.querySelectorAll('table').forEach((table) => {
      const state = tableStates.get(table);
      if (state && isProcessed(table)) {
        state.restoreHeader();
        for (const body of table.tBodies) {
          const rows = Array.from(body.rows);
          rows.forEach((row) => state.rows.get(row)?.restore());
          [...rows].sort((a, b) => (state.rows.get(a)?.order ?? rows.indexOf(a)) -
            (state.rows.get(b)?.order ?? rows.indexOf(b)))
            .forEach((row) => body.append(row));
        }
      }
      tableStates.delete(table);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(processAllTables, 150);
  }

  // Give React its original nodes/order back before tabs, dates or filters update.
  window.addEventListener('change', restoreTables, true);
  window.addEventListener('keydown', (event) => {
    if (['Enter', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key) &&
        event.target instanceof Element && !event.target.closest('table')) restoreTables();
  }, true);

  /** Process every table on the page. */
  function processAllTables() {
    // Don't observe our own cell insertions and row moves.
    observer.disconnect();
    try {
      document.querySelectorAll('table').forEach(processTable);
    } finally {
      observer.observe(document.body, { childList: true, subtree: true });
    }
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
    restoreTables();
    origPushState(...args);
    // New content will be loaded; the observer will pick it up automatically
    // since the new tables won't have our OTW header yet.
  };

  window.addEventListener('popstate', restoreTables);

  // Expose internals for unit testing
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { formatPct, getHeaderText, setHeaderText, buildColMap, isProcessed, processTable, processAllTables };
  }
})();
