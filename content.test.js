/**
 * Tests for content.js
 *
 * Uses jsdom (via jest-environment-jsdom) to simulate a browser DOM and
 * verifies that the extension correctly transforms NHL standings tables.
 */

'use strict';

// -------------------------------------------------------------------------
// Helpers to build mock NHL standings tables
// -------------------------------------------------------------------------

/**
 * Build an HTML string for a mock NHL standings table.
 *
 * Columns (in NHL.com order):
 *   GP | W | L | OT | PTS | P% | RW | ROW | GF | GA | DIFF | HOME | AWAY | S/O | L10 | STRK
 *
 * @param {Array<Object>} rows - array of per-team stat objects
 * @returns {string} HTML table string
 */
function buildTable(rows) {
  const headers = ['GP', 'W', 'L', 'OT', 'PTS', 'P%', 'RW', 'ROW', 'GF', 'GA', 'DIFF', 'HOME', 'AWAY', 'S/O', 'L10', 'STRK'];
  const headerHtml = headers.map((h) => `<th>${h}</th>`).join('');

  const rowsHtml = rows
    .map((r) => {
      const cells = [
        r.gp, r.w, r.l, r.ot, r.pts, r.ppct, r.rw, r.row,
        r.gf, r.ga, r.diff, r.home, r.away, r.so, r.l10, r.strk,
      ]
        .map((v) => `<td>${v}</td>`)
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');

  return `<table><thead><tr>${headerHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>`;
}

/**
 * Build an HTML string for a mock table that uses data-col attributes
 * (matching the real NHL.com DOM structure).
 */
function buildTableWithDataCol(rows) {
  const colDefs = [
    { label: 'GP', col: 'gp' },
    { label: 'W', col: 'w' },
    { label: 'L', col: 'l' },
    { label: 'OT', col: 'ot' },
    { label: 'PTS', col: 'pts' },
    { label: 'P%', col: 'pptg' },
    { label: 'RW', col: 'rw' },
    { label: 'ROW', col: 'row' },
    { label: 'GF', col: 'gf' },
    { label: 'GA', col: 'ga' },
    { label: 'DIFF', col: 'diff' },
    { label: 'HOME', col: 'home' },
    { label: 'AWAY', col: 'away' },
    { label: 'S/O', col: 'so' },
    { label: 'L10', col: 'l10' },
    { label: 'STRK', col: 'strk' },
  ];

  const headerHtml = colDefs.map(({ label, col }) => `<th data-col="${col}">${label}</th>`).join('');

  const rowsHtml = rows
    .map((r) => {
      const cellValues = [r.gp, r.w, r.l, r.ot, r.pts, r.ppct, r.rw, r.row, r.gf, r.ga, r.diff, r.home, r.away, r.so, r.l10, r.strk];
      const cells = colDefs
        .map(({ col }, i) => `<td data-col="${col}">${cellValues[i]}</td>`)
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');

  return `<table><thead><tr>${headerHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>`;
}

/**
 * Build an HTML string that closely mirrors the real NHL.com standings DOM:
 * - Each header <th> wraps a sortable <button> containing a <span> with the label
 * - Each data <td> carries a data-col attribute
 * - A non-stats "Team" column (no data-col) precedes the numeric columns
 *
 * This structure is used for integration tests against the live-DOM shape.
 */
function buildTableRealDOM(rows) {
  const colDefs = [
    { label: 'GP', col: 'gp', key: 'gp' },
    { label: 'W', col: 'w', key: 'w' },
    { label: 'L', col: 'l', key: 'l' },
    { label: 'OT', col: 'ot', key: 'ot' },
    { label: 'PTS', col: 'pts', key: 'pts' },
    { label: 'P%', col: 'pptg', key: 'ppct' },
    { label: 'RW', col: 'rw', key: 'rw' },
    { label: 'ROW', col: 'row', key: 'row' },
    { label: 'GF', col: 'gf', key: 'gf' },
    { label: 'GA', col: 'ga', key: 'ga' },
    { label: 'DIFF', col: 'diff', key: 'diff' },
    { label: 'HOME', col: 'home', key: 'home' },
    { label: 'AWAY', col: 'away', key: 'away' },
    { label: 'S/O', col: 'so', key: 'so' },
    { label: 'L10', col: 'l10', key: 'l10' },
    { label: 'STRK', col: 'strk', key: 'strk' },
  ];

  // Team name column (no data-col) + sortable button/span headers for stats
  const teamTh = `<th class="nhl-standings__team-col">Team</th>`;
  const statThs = colDefs
    .map(({ label, col }) => `<th data-col="${col}"><button type="button"><span>${label}</span></button></th>`)
    .join('');

  const rowsHtml = rows
    .map((r) => {
      // Real NHL.com uses <th scope="row"> (not <td>) for the team name cell
      const teamTh = `<th scope="row" class="sc-shnyN hGfDpn rt-td left-aligned"><span>${r.team || 'Team'}</span></th>`;
      const statTds = colDefs
        .map(({ col, key }) => `<td data-col="${col}">${r[key]}</td>`)
        .join('');
      return `<tr>${teamTh}${statTds}</tr>`;
    })
    .join('');

  return `<table><thead><tr>${teamTh}${statThs}</tr></thead><tbody>${rowsHtml}</tbody></table>`;
}

/** Insert an HTML string into document.body and return the table element. */
function insertTable(html) {
  document.body.innerHTML = html;
  return document.querySelector('table');
}

// -------------------------------------------------------------------------
// Sample team data
// -------------------------------------------------------------------------

const TEAM_A = {
  team: 'Boston Bruins',
  gp: 70, w: 45, l: 18, ot: 7, pts: 97, ppct: '.693', rw: 37, row: 42,
  gf: 220, ga: 175, diff: 45, home: '25-8-3', away: '20-10-4', so: '3-1', l10: '7-2-1', strk: 'W3',
};

// Team with zero OT wins (all wins are regulation)
const TEAM_B = {
  team: 'Toronto Maple Leafs',
  gp: 60, w: 30, l: 25, ot: 5, pts: 65, ppct: '.542', rw: 30, row: 30,
  gf: 180, ga: 190, diff: -10, home: '18-12-2', away: '12-13-3', so: '0-0', l10: '5-5-0', strk: 'L1',
};

// Team with no games played yet
const TEAM_C = {
  team: 'Expansion Team',
  gp: 0, w: 0, l: 0, ot: 0, pts: 0, ppct: '.000', rw: 0, row: 0,
  gf: 0, ga: 0, diff: 0, home: '0-0-0', away: '0-0-0', so: '0-0', l10: '0-0-0', strk: '-',
};

// -------------------------------------------------------------------------
// Load content.js into the jsdom environment
// -------------------------------------------------------------------------

let ext;

beforeEach(() => {
  // Reset DOM
  document.body.innerHTML = '';

  // Re-require the module fresh for each test so the IIFE side-effects
  // (MutationObserver, history patches) are not carried over.
  jest.resetModules();
  ext = require('./content.js');
});

// -------------------------------------------------------------------------
// Unit tests for pure helper functions
// -------------------------------------------------------------------------

describe('formatPct', () => {
  const { formatPct } = require('./content.js');

  test('formats a decimal as .NNN with no leading zero', () => {
    expect(formatPct(0.756)).toBe('.756');
    expect(formatPct(1.0)).toBe('1.000');
    expect(formatPct(0)).toBe('.000');
    expect(formatPct(0.5)).toBe('.500');
  });

  test('handles edge cases gracefully', () => {
    expect(formatPct(NaN)).toBe('.000');
    expect(formatPct(Infinity)).toBe('.000');
    expect(formatPct(-Infinity)).toBe('.000');
  });
});

// -------------------------------------------------------------------------
// Integration tests: processAllTables
// -------------------------------------------------------------------------

describe('processAllTables – plain text headers', () => {
  test('inserts OTW header after W', () => {
    insertTable(buildTable([TEAM_A]));
    ext.processAllTables();

    const headers = Array.from(document.querySelectorAll('thead th')).map((th) => th.textContent.trim());
    const wIdx = headers.indexOf('W');
    const otwIdx = headers.indexOf('OTW');

    expect(wIdx).toBeGreaterThanOrEqual(0);
    expect(otwIdx).toBe(wIdx + 1);
  });

  test('renames OT header to OTL', () => {
    insertTable(buildTable([TEAM_A]));
    ext.processAllTables();

    const headers = Array.from(document.querySelectorAll('thead th')).map((th) => th.textContent.trim());
    expect(headers).not.toContain('OT');
    expect(headers).toContain('OTL');
  });

  test('removes RW and ROW headers', () => {
    insertTable(buildTable([TEAM_A]));
    ext.processAllTables();

    const headers = Array.from(document.querySelectorAll('thead th')).map((th) => th.textContent.trim());
    expect(headers).not.toContain('RW');
    expect(headers).not.toContain('ROW');
  });

  test('updates W cell to show regulation wins', () => {
    insertTable(buildTable([TEAM_A]));
    ext.processAllTables();

    // After processing, the new W column value should equal RW (37)
    const wIdx = Array.from(document.querySelectorAll('thead th'))
      .map((th) => th.textContent.trim())
      .indexOf('W');
    const wCell = document.querySelector('tbody tr td:nth-child(' + (wIdx + 1) + ')');
    expect(wCell.textContent.trim()).toBe(String(TEAM_A.rw));
  });

  test('OTW cell value is totalW minus RW', () => {
    insertTable(buildTable([TEAM_A]));
    ext.processAllTables();

    const headers = Array.from(document.querySelectorAll('thead th')).map((th) => th.textContent.trim());
    const otwIdx = headers.indexOf('OTW');
    const otwCell = document.querySelector('tbody tr td:nth-child(' + (otwIdx + 1) + ')');
    const expectedOtw = TEAM_A.w - TEAM_A.rw;
    expect(otwCell.textContent.trim()).toBe(String(expectedOtw));
  });

  test('recomputes PTS as RW*3 + OTW*2 + OTL*1', () => {
    insertTable(buildTable([TEAM_A]));
    ext.processAllTables();

    const headers = Array.from(document.querySelectorAll('thead th')).map((th) => th.textContent.trim());
    const ptsIdx = headers.indexOf('PTS');
    const ptsCell = document.querySelector('tbody tr td:nth-child(' + (ptsIdx + 1) + ')');

    const otw = TEAM_A.w - TEAM_A.rw;
    const expectedPts = TEAM_A.rw * 3 + otw * 2 + TEAM_A.ot * 1;
    expect(ptsCell.textContent.trim()).toBe(String(expectedPts));
  });

  test('recomputes P% as PTS / (GP * 3)', () => {
    insertTable(buildTable([TEAM_A]));
    ext.processAllTables();

    const headers = Array.from(document.querySelectorAll('thead th')).map((th) => th.textContent.trim());
    const ppctIdx = headers.indexOf('P%');
    const ppctCell = document.querySelector('tbody tr td:nth-child(' + (ppctIdx + 1) + ')');

    const otw = TEAM_A.w - TEAM_A.rw;
    const newPts = TEAM_A.rw * 3 + otw * 2 + TEAM_A.ot;
    const expectedPpct = (newPts / (TEAM_A.gp * 3)).toFixed(3).replace(/^0\./, '.');
    expect(ppctCell.textContent.trim()).toBe(expectedPpct);
  });

  test('handles team with zero OT wins (all wins are regulation)', () => {
    insertTable(buildTable([TEAM_B]));
    ext.processAllTables();

    const headers = Array.from(document.querySelectorAll('thead th')).map((th) => th.textContent.trim());
    const otwIdx = headers.indexOf('OTW');
    const otwCell = document.querySelector('tbody tr td:nth-child(' + (otwIdx + 1) + ')');
    expect(otwCell.textContent.trim()).toBe('0');
  });

  test('handles team with zero games played (no division by zero)', () => {
    insertTable(buildTable([TEAM_C]));
    ext.processAllTables();

    const headers = Array.from(document.querySelectorAll('thead th')).map((th) => th.textContent.trim());
    const ppctIdx = headers.indexOf('P%');
    const ppctCell = document.querySelector('tbody tr td:nth-child(' + (ppctIdx + 1) + ')');
    expect(ppctCell.textContent.trim()).toBe('.000');
  });

  test('does not process the same table twice', () => {
    insertTable(buildTable([TEAM_A]));
    ext.processAllTables();
    ext.processAllTables();

    // OTW header should appear exactly once
    const otwHeaders = document.querySelectorAll('thead th');
    const otwCount = Array.from(otwHeaders).filter((th) => th.textContent.trim() === 'OTW').length;
    expect(otwCount).toBe(1);
  });

  test('ignores tables without RW column', () => {
    document.body.innerHTML = '<table><thead><tr><th>GP</th><th>W</th><th>L</th></tr></thead><tbody><tr><td>82</td><td>45</td><td>37</td></tr></tbody></table>';
    ext.processAllTables();

    const headers = Array.from(document.querySelectorAll('thead th')).map((th) => th.textContent.trim());
    expect(headers).not.toContain('OTW');
  });

  test('multiple tables are each processed independently', () => {
    document.body.innerHTML = buildTable([TEAM_A]) + buildTable([TEAM_B]);
    ext.processAllTables();

    const tables = document.querySelectorAll('table');
    expect(tables.length).toBe(2);
    tables.forEach((t) => {
      const headers = Array.from(t.querySelectorAll('thead th')).map((th) => th.textContent.trim());
      expect(headers).toContain('OTW');
      expect(headers).not.toContain('RW');
    });
  });
});

describe('processAllTables – data-col attribute headers', () => {
  test('processes table using data-col attributes', () => {
    insertTable(buildTableWithDataCol([TEAM_A]));
    ext.processAllTables();

    const otwHeader = document.querySelector('thead th[data-col="otw"]');
    expect(otwHeader).not.toBeNull();
    expect(otwHeader.textContent.trim()).toBe('OTW');
  });

  test('OTW cell gets data-col="otw" attribute', () => {
    insertTable(buildTableWithDataCol([TEAM_A]));
    ext.processAllTables();

    const otwCell = document.querySelector('tbody td[data-col="otw"]');
    expect(otwCell).not.toBeNull();
    const expectedOtw = TEAM_A.w - TEAM_A.rw;
    expect(otwCell.textContent.trim()).toBe(String(expectedOtw));
  });

  test('removes RW and ROW cells with data-col attributes', () => {
    insertTable(buildTableWithDataCol([TEAM_A]));
    ext.processAllTables();

    expect(document.querySelector('td[data-col="rw"]')).toBeNull();
    expect(document.querySelector('td[data-col="row"]')).toBeNull();
    expect(document.querySelector('th[data-col="rw"]')).toBeNull();
    expect(document.querySelector('th[data-col="row"]')).toBeNull();
  });

  test('correct PTS for TEAM_A with data-col', () => {
    insertTable(buildTableWithDataCol([TEAM_A]));
    ext.processAllTables();

    const ptsCell = document.querySelector('tbody td[data-col="pts"]');
    const otw = TEAM_A.w - TEAM_A.rw;
    const expectedPts = TEAM_A.rw * 3 + otw * 2 + TEAM_A.ot;
    expect(ptsCell.textContent.trim()).toBe(String(expectedPts));
  });
});

// -------------------------------------------------------------------------
// Real DOM structure tests: <button><span> headers + Team column
// Mirrors the actual NHL.com standings table DOM shape as served by the site.
// -------------------------------------------------------------------------

describe('processAllTables – real NHL.com DOM shape (button/span headers + Team column)', () => {
  test('inserts OTW header after W inside the button/span structure', () => {
    insertTable(buildTableRealDOM([TEAM_A]));
    ext.processAllTables();

    const otwHeader = document.querySelector('thead th[data-col="otw"]');
    expect(otwHeader).not.toBeNull();
    // The cloned header must expose the updated label through its button > span
    expect(otwHeader.textContent.trim()).toBe('OTW');
  });

  test('OTW header is placed immediately after the W header', () => {
    insertTable(buildTableRealDOM([TEAM_A]));
    ext.processAllTables();

    const headers = Array.from(document.querySelectorAll('thead th'));
    const wIdx = headers.findIndex((th) => th.getAttribute('data-col') === 'w');
    const otwIdx = headers.findIndex((th) => th.getAttribute('data-col') === 'otw');
    expect(wIdx).toBeGreaterThanOrEqual(0);
    expect(otwIdx).toBe(wIdx + 1);
  });

  test('OT header text is renamed to OTL', () => {
    insertTable(buildTableRealDOM([TEAM_A]));
    ext.processAllTables();

    const otHeader = document.querySelector('thead th[data-col="ot"]');
    expect(otHeader).not.toBeNull();
    expect(otHeader.textContent.trim()).toBe('OTL');
  });

  test('RW and ROW headers and cells are removed', () => {
    insertTable(buildTableRealDOM([TEAM_A]));
    ext.processAllTables();

    expect(document.querySelector('th[data-col="rw"]')).toBeNull();
    expect(document.querySelector('th[data-col="row"]')).toBeNull();
    expect(document.querySelector('td[data-col="rw"]')).toBeNull();
    expect(document.querySelector('td[data-col="row"]')).toBeNull();
  });

  test('W cell is updated to regulation wins (RW)', () => {
    insertTable(buildTableRealDOM([TEAM_A]));
    ext.processAllTables();

    const wCell = document.querySelector('tbody td[data-col="w"]');
    expect(wCell.textContent.trim()).toBe(String(TEAM_A.rw));
  });

  test('OTW cell value equals total wins minus regulation wins', () => {
    insertTable(buildTableRealDOM([TEAM_A]));
    ext.processAllTables();

    const otwCell = document.querySelector('tbody td[data-col="otw"]');
    expect(otwCell).not.toBeNull();
    expect(otwCell.textContent.trim()).toBe(String(TEAM_A.w - TEAM_A.rw));
  });

  test('PTS recomputed as RW×3 + OTW×2 + OTL×1', () => {
    insertTable(buildTableRealDOM([TEAM_A]));
    ext.processAllTables();

    const otw = TEAM_A.w - TEAM_A.rw;
    const expectedPts = TEAM_A.rw * 3 + otw * 2 + TEAM_A.ot;
    const ptsCell = document.querySelector('tbody td[data-col="pts"]');
    expect(ptsCell.textContent.trim()).toBe(String(expectedPts));
  });

  test('P% (pptg) recomputed as PTS / (GP × 3)', () => {
    insertTable(buildTableRealDOM([TEAM_A]));
    ext.processAllTables();

    const otw = TEAM_A.w - TEAM_A.rw;
    const newPts = TEAM_A.rw * 3 + otw * 2 + TEAM_A.ot;
    const expectedPpct = (newPts / (TEAM_A.gp * 3)).toFixed(3).replace(/^0\./, '.');
    const ppctCell = document.querySelector('tbody td[data-col="pptg"]');
    expect(ppctCell.textContent.trim()).toBe(expectedPpct);
  });

  test('non-stats Team column is left untouched', () => {
    insertTable(buildTableRealDOM([TEAM_A]));
    ext.processAllTables();

    // Real NHL.com uses <th scope="row"> for the team name cell in data rows
    const teamCell = document.querySelector('tbody th[scope="row"]');
    expect(teamCell).not.toBeNull();
    expect(teamCell.textContent.trim()).toBe(TEAM_A.team);
  });

  test('multiple rows are each independently transformed', () => {
    insertTable(buildTableRealDOM([TEAM_A, TEAM_B]));
    ext.processAllTables();

    const otwCells = document.querySelectorAll('tbody td[data-col="otw"]');
    expect(otwCells.length).toBe(2);

    // TEAM_A: 45-37 = 8 OTW
    expect(otwCells[0].textContent.trim()).toBe(String(TEAM_A.w - TEAM_A.rw));
    // TEAM_B: 30-30 = 0 OTW
    expect(otwCells[1].textContent.trim()).toBe('0');
  });

  test('idempotent: processing the same real-DOM table twice leaves headers unchanged', () => {
    insertTable(buildTableRealDOM([TEAM_A]));
    ext.processAllTables();
    ext.processAllTables();

    const otwHeaders = Array.from(document.querySelectorAll('thead th')).filter(
      (th) => th.getAttribute('data-col') === 'otw'
    );
    expect(otwHeaders.length).toBe(1);
  });
});
