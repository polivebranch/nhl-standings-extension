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
let listeners;
let observations;
let originalPushState;

beforeEach(() => {
  jest.useFakeTimers();
  listeners = jest.spyOn(window, 'addEventListener');
  observations = jest.spyOn(MutationObserver.prototype, 'observe');
  originalPushState = history.pushState;
  // Reset DOM
  document.body.innerHTML = '';

  // Re-require the module fresh for each test so the IIFE side-effects
  // (MutationObserver, history patches) are not carried over.
  jest.resetModules();
  ext = require('./content.js');
});

afterEach(() => {
  listeners.mock.calls.forEach((args) => window.removeEventListener(...args));
  observations.mock.contexts.forEach((observer) => observer.disconnect());
  history.pushState = originalPushState;
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// -------------------------------------------------------------------------
// Unit tests for pure helper functions
// -------------------------------------------------------------------------

describe('formatPct', () => {
  test('formats a decimal as .NNN with no leading zero', () => {
    const { formatPct } = ext;
    expect(formatPct(0.756)).toBe('.756');
    expect(formatPct(1.0)).toBe('1.000');
    expect(formatPct(0)).toBe('.000');
    expect(formatPct(0.5)).toBe('.500');
  });

  test('handles edge cases gracefully', () => {
    const { formatPct } = ext;
    expect(formatPct(NaN)).toBe('.000');
    expect(formatPct(Infinity)).toBe('.000');
    expect(formatPct(-Infinity)).toBe('.000');
  });

  describe('two-system columns and local sorting', () => {
    const highDumb = { ...TEAM_A, team: 'Overtime', gp: 10, w: 8, rw: 1, ot: 0, pts: 16, ppct: '.800' };
    const highThree = { ...TEAM_B, team: 'Regulation', gp: 10, w: 6, rw: 6, ot: 0, pts: 12, ppct: '.600' };

    function header(table, label) {
      return Array.from(table.tHead.rows[0].cells).find((cell) => ext.getHeaderText(cell) === label);
    }

    function teams(table) {
      return Array.from(table.querySelectorAll('tbody th[scope="row"]'), (cell) => cell.textContent.trim());
    }

    function click(table, label) {
      header(table, label).querySelector('button').click();
    }

    test('shows adjacent 3-point and 2-point columns with accurate values', () => {
      const table = insertTable(buildTableRealDOM([TEAM_A, TEAM_C]));
      ext.processAllTables();
      const labels = Array.from(table.tHead.rows[0].cells, ext.getHeaderText);
      const start = labels.indexOf('PTS');
      expect(labels.slice(start, start + 4)).toEqual(['PTS', 'P%', 'DPTS', 'DP%']);
      const rows = table.tBodies[0].rows;
      expect(rows[0].querySelector('[data-col="dpts"]').textContent).toBe('97');
      expect(rows[0].querySelector('[data-col="dpct"]').textContent).toBe('.693');
      expect(rows[1].querySelector('[data-col="dpts"]').textContent).toBe('0');
      expect(rows[1].querySelector('[data-col="dpct"]').textContent).toBe('.000');
      expect(rows[0].cells.length).toBe(table.tHead.rows[0].cells.length);
    });

    test('starts in 3-point order, toggles PTS, and suppresses native sorting', () => {
      const table = insertTable(buildTableRealDOM([highDumb, highThree]));
      const nativeSort = jest.fn();
      table.addEventListener('click', nativeSort);
      ext.processAllTables();
      expect(teams(table)).toEqual(['Regulation', 'Overtime']);
      expect(header(table, 'PTS').getAttribute('aria-sort')).toBe('descending');
      click(table, 'PTS');
      expect(teams(table)).toEqual(['Overtime', 'Regulation']);
      expect(header(table, 'PTS').getAttribute('aria-sort')).toBe('ascending');
      click(table, 'PTS');
      expect(teams(table)).toEqual(['Regulation', 'Overtime']);
      expect(nativeSort).not.toHaveBeenCalled();
    });

    test.each(['DPTS', 'DP%', 'P%', 'W', 'OTW', 'L', 'GP', 'GF', 'DIFF'])('%s toggles locally with one active indicator', (column) => {
      const table = insertTable(buildTableRealDOM([highDumb, highThree]));
      ext.processAllTables();
      click(table, column);
      expect(header(table, column).getAttribute('aria-sort')).toBe('descending');
      click(table, column);
      expect(header(table, column).getAttribute('aria-sort')).toBe('ascending');
      expect(table.querySelectorAll('thead th[aria-sort="ascending"]').length).toBe(1);
      if (column !== 'PTS') expect(header(table, 'PTS').getAttribute('aria-sort')).toBe('none');
    });

    test('DPTS and DP% sort by the 2-point system, not the 3-point system', () => {
      const table = insertTable(buildTableRealDOM([highDumb, highThree]));
      ext.processAllTables();
      for (const column of ['DPTS', 'DP%']) {
        click(table, column);
        expect(teams(table)).toEqual(['Overtime', 'Regulation']);
        click(table, column);
        expect(teams(table)).toEqual(['Regulation', 'Overtime']);
      }
    });

    test('sorts percentages with full precision rather than rounded text', () => {
      const table = insertTable(buildTableRealDOM([
        { ...TEAM_A, team: 'Lower', gp: 10001, w: 5000, rw: 0, ot: 0 },
        { ...TEAM_A, team: 'Higher', gp: 10000, w: 5000, rw: 0, ot: 0 },
      ]));
      ext.processAllTables();
      click(table, 'P%');
      expect(teams(table)).toEqual(['Higher', 'Lower']);
      expect(Array.from(table.querySelectorAll('[data-col="pptg"]')).slice(1).map((cell) => cell.textContent))
        .toEqual(['.333', '.333']);
      click(table, 'DP%');
      expect(teams(table)).toEqual(['Higher', 'Lower']);
    });

    test('uses numeric comparison for points rather than lexicographic ordering', () => {
      const table = insertTable(buildTableRealDOM([
        { ...TEAM_A, team: 'Nine', gp: 10, w: 3, rw: 3, ot: 0 },
        { ...TEAM_B, team: 'Twelve', gp: 10, w: 4, rw: 4, ot: 0 },
      ]));
      ext.processAllTables();
      expect(teams(table)).toEqual(['Twelve', 'Nine']);
      click(table, 'PTS');
      expect(teams(table)).toEqual(['Nine', 'Twelve']);
    });

    test.each(['division', 'conference', 'league', 'wildcard'])('preserves %s tables when sorting all group headers', (view) => {
      const tableCount = { division: 4, conference: 2, league: 1, wildcard: 6 };
      document.body.innerHTML = Array.from({ length: tableCount[view] }, () =>
        buildTableRealDOM([highDumb, highThree])).join('');
      ext.processAllTables();
      const tables = Array.from(document.querySelectorAll('table'));
      click(tables[0], 'PTS');
      tables.forEach((table) => expect(teams(table)).toEqual(['Overtime', 'Regulation']));
      click(tables[tables.length - 1], 'PTS');
      tables.forEach((table) => expect(teams(table)).toEqual(['Regulation', 'Overtime']));
    });

    test('preserves section dividers and multiple tbody boundaries', () => {
      const table = insertTable(buildTableRealDOM([highDumb, highThree, highDumb, highThree]));
      const divider = document.createElement('tr');
      divider.innerHTML = '<th colspan="17">Division</th>';
      table.tBodies[0].rows[2].before(divider);
      const secondBody = document.createElement('tbody');
      secondBody.innerHTML = buildTableRealDOM([highDumb, highThree]).match(/<tbody>(.*)<\/tbody>/)[1];
      table.append(secondBody);
      ext.processAllTables();
      expect(teams(table)).toEqual(['Regulation', 'Overtime', 'Regulation', 'Overtime', 'Regulation', 'Overtime']);
      expect(table.tBodies[0].rows[2]).toBe(divider);
      expect(divider.cells[0].colSpan).toBe(table.tHead.rows[0].cells.length);
      click(table, 'PTS');
      expect(teams(table)).toEqual(['Overtime', 'Regulation', 'Overtime', 'Regulation', 'Overtime', 'Regulation']);
      expect(table.tBodies[0].rows[2]).toBe(divider);
    });

    test('sorts by team name and leaves tied values in source order', () => {
      const table = insertTable(buildTableRealDOM([TEAM_B, TEAM_A]));
      ext.processAllTables();
      click(table, 'TEAM');
      expect(teams(table)).toEqual([TEAM_A.team, TEAM_B.team]);
      click(table, 'TEAM');
      expect(teams(table)).toEqual([TEAM_B.team, TEAM_A.team]);
      click(table, 'S/O');
      expect(teams(table)).toEqual([TEAM_A.team, TEAM_B.team]);
    });

    test('supports actual button/div headers without data-col attributes', () => {
      const table = insertTable(buildTableRealDOM([highDumb, highThree]));
      table.querySelectorAll('[data-col]').forEach((cell) => cell.removeAttribute('data-col'));
      table.querySelectorAll('thead button').forEach((button) => {
        button.innerHTML = `<div class="sortable-table-header"><div></div>${button.textContent}<div><svg></svg></div></div>`;
      });
      ext.processAllTables();
      expect(header(table, 'OTW').querySelector('.sortable-table-header')).not.toBeNull();
      click(table, 'PTS');
      expect(teams(table)).toEqual(['Overtime', 'Regulation']);
      expect(header(table, 'PTS').querySelector('.sortable-table-header')).not.toBeNull();
      expect(header(table, 'DPTS').querySelector('button').title).toBe('DPTS');
    });

    test('makes plain headers keyboard-operable sort buttons', () => {
      const table = insertTable(buildTable([highDumb, highThree]));
      ext.processAllTables();
      const button = header(table, 'DPTS').querySelector('button');
      expect(button.type).toBe('button');
      button.click();
      expect(header(table, 'DPTS').getAttribute('aria-sort')).toBe('descending');
    });

    test('restores original nodes before a native tab update and reapplies sorting', () => {
      const table = insertTable(buildTableRealDOM([highDumb, highThree]));
      const originalRows = Array.from(table.tBodies[0].rows);
      const originalHeaders = Array.from(table.tHead.rows[0].cells);
      ext.processAllTables();
      click(table, 'DPTS');
      const tab = document.createElement('button');
      document.body.append(tab);
      tab.addEventListener('click', () => {
        expect(Array.from(table.tBodies[0].rows)).toEqual(originalRows);
        expect(Array.from(table.tHead.rows[0].cells)).toEqual(originalHeaders);
        expect(header(table, 'OT').textContent).toBe('OT');
        table.outerHTML = buildTableRealDOM([highThree, highDumb]);
      });
      tab.click();
      jest.advanceTimersByTime(200);
      const replacement = document.querySelector('table');
      expect(teams(replacement)).toEqual(['Overtime', 'Regulation']);
      expect(header(replacement, 'DPTS').getAttribute('aria-sort')).toBe('descending');
      expect(replacement.querySelectorAll('thead [data-col="dpts"]')).toHaveLength(1);
    });

    test('processes replacement bodies and keeps them when restoring for navigation', () => {
      const table = insertTable(buildTableRealDOM([TEAM_A]));
      ext.processAllTables();
      table.tBodies[0].innerHTML = buildTableRealDOM([highDumb, highThree]).match(/<tbody>(.*)<\/tbody>/)[1];
      ext.processAllTables();
      expect(teams(table)).toEqual(['Regulation', 'Overtime']);
      const tab = document.createElement('button');
      document.body.append(tab);
      tab.click();
      expect(teams(table)).toEqual(['Overtime', 'Regulation']);
      expect(table.querySelectorAll('thead [data-col="dpts"]')).toHaveLength(0);
      jest.advanceTimersByTime(200);
      expect(teams(table)).toEqual(['Regulation', 'Overtime']);
    });

    test('updates ranks using 3-point standings, independently of the sorted column', () => {
      const table = insertTable(buildTableRealDOM([highDumb, highThree]));
      table.tHead.rows[0].insertAdjacentHTML('afterbegin', '<th>Rank</th>');
      Array.from(table.tBodies[0].rows).forEach((row, i) => row.insertAdjacentHTML('afterbegin', `<td>${i + 1}</td>`));
      ext.processAllTables();
      expect(teams(table)).toEqual(['Regulation', 'Overtime']);
      expect(Array.from(table.tBodies[0].rows, (row) => row.cells[0].textContent)).toEqual(['1', '2']);
      click(table, 'DPTS');
      expect(teams(table)).toEqual(['Overtime', 'Regulation']);
      expect(Array.from(table.tBodies[0].rows, (row) => row.cells[0].textContent)).toEqual(['2', '1']);
      click(table, 'RANK');
      click(table, 'RANK');
      expect(teams(table)).toEqual(['Regulation', 'Overtime']);
    });

    test('automatically processes new DOM without observing its own changes repeatedly', async () => {
      const table = insertTable(buildTableRealDOM([highDumb, highThree]));
      await Promise.resolve();
      jest.advanceTimersByTime(200);
      expect(teams(table)).toEqual(['Regulation', 'Overtime']);
      await Promise.resolve();
      expect(jest.getTimerCount()).toBe(0);
      click(table, 'PTS');
      await Promise.resolve();
      expect(teams(table)).toEqual(['Overtime', 'Regulation']);
      expect(jest.getTimerCount()).toBe(0);
    });

    test('normalizes alternate percentage headers and handles tables without ROW', () => {
      const table = insertTable(buildTableRealDOM([TEAM_A]));
      header(table, 'P%').querySelector('span').textContent = 'PCT';
      const rowIndex = Array.from(table.tHead.rows[0].cells).indexOf(header(table, 'ROW'));
      table.tHead.rows[0].cells[rowIndex].remove();
      table.tBodies[0].rows[0].cells[rowIndex].remove();
      ext.processAllTables();
      expect(header(table, 'P%')).toBeDefined();
      expect(header(table, 'PCT')).toBeUndefined();
      expect(table.tBodies[0].rows[0].cells.length).toBe(table.tHead.rows[0].cells.length);
      click(table, 'P%');
      expect(header(table, 'P%').getAttribute('aria-sort')).toBe('descending');
    });
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
