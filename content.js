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
  const legendStates = new Map();
  const standingsCache = new Map();
  const scheduleCache = new Map();
  let activeSort = { column: 'PTS', direction: 'descending' };
  let rankingColumn = 'PTS';

  function requestJSON(url) {
    return Promise.resolve().then(() => fetch(url)).then((response) => {
      if (!response.ok) throw new Error(`NHL request failed (${response.status}): ${url}`);
      return response.json();
    });
  }

  function groupName(table) {
    for (let parent = table.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      const heading = Array.from(parent.children).find((child) =>
        child.matches('h1, h2, h3, h4, h5, h6, [role="heading"]'));
      if (heading) return heading.textContent.trim();
      if (parent.querySelectorAll('table').length > 1) break;
    }
    return '';
  }

  function teamKey(row) {
    const team = row.querySelector('th[scope="row"]');
    return (team?.querySelector('img')?.getAttribute('src')?.match(/\/([A-Z]{2,3})_(?:light|dark)\.svg/)?.[1] ||
      team?.querySelector('a[aria-label]')?.getAttribute('aria-label') ||
      team?.textContent.trim() || '').toUpperCase();
  }

  function standingsDate() {
    return location.pathname.match(/^\/standings(?:\/(\d{4}-\d{2}-\d{2}))?(?:\/|$)/)?.[1] || 'now';
  }

  function loadStandings() {
    if (!/^\/standings(?:\/|$)/.test(location.pathname)) return null;
    const date = standingsDate();
    if (standingsCache.has(date)) return standingsCache.get(date);
    const entry = { status: 'loading', teams: new Map(), date };
    standingsCache.set(date, entry);
    requestJSON(`https://api-web.nhle.com/v1/standings/${date}`)
      .then((data) => {
        if (!Array.isArray(data.standings) || !data.standings.length) {
          throw new Error('NHL standings response contains no teams');
        }
        for (const team of data.standings) {
          if (!team.teamAbbrev?.default || !team.teamName?.default ||
              !team.divisionName || !team.conferenceName ||
              !['leagueSequence', 'conferenceSequence', 'divisionSequence'].every((key) =>
                Number.isInteger(team[key]) && team[key] > 0)) {
            throw new Error('NHL standings response is missing team affiliations or tie-break rankings');
          }
          entry.teams.set(team.teamAbbrev.default.toUpperCase(), team);
          entry.teams.set(team.teamName.default.toUpperCase(), team);
        }
        entry.status = 'ready';
        scheduleProcessing();
      })
      .catch((error) => {
        entry.status = 'error';
        console.error('[NHL 3-point standings] Unable to load playoff and tie-break data:', error);
        scheduleProcessing();
      });
    return entry;
  }

  function compareStandingsPrefix(a, b, column) {
    const left = rowValues.get(a);
    const right = rowValues.get(b);
    return right[column] - left[column] || left.gp - right.gp ||
      right.rw - left.rw || right.row - left.row || right.totalW - left.totalW;
  }

  function compareNativeOrder(a, b, sequence, standings) {
    const left = rowValues.get(a);
    const right = rowValues.get(b);
    const nativeLeft = standings?.teams.get(left.team)?.[sequence];
    const nativeRight = standings?.teams.get(right.team)?.[sequence];
    return (nativeLeft !== undefined && nativeRight !== undefined ? nativeLeft - nativeRight : 0) ||
      left.order - right.order;
  }

  /** Load one club's current-season schedule (cached) for head-to-head tie-breaks. */
  function loadClubGames(team, season) {
    const key = `${season}:${team}`;
    if (scheduleCache.has(key)) return scheduleCache.get(key);
    const entry = { status: 'loading', games: [] };
    scheduleCache.set(key, entry);
    requestJSON(`https://api-web.nhle.com/v1/club-schedule-season/${team}/${season}`)
      .then((data) => {
        if (!Array.isArray(data.games)) throw new Error('NHL schedule response contains no games');
        entry.games = data.games;
        entry.status = 'ready';
        scheduleProcessing();
      })
      .catch((error) => {
        entry.status = 'error';
        console.error('[NHL 3-point standings] Unable to load head-to-head games:', error);
        scheduleProcessing();
      });
    return entry;
  }

  /**
   * Points earned in completed regular-season games among the tied teams.
   * PTS: regulation win 3, OT/SO win 2, OT/SO loss 1. DPTS: win 2, OT/SO loss 1.
   * For two tied teams with an odd number of meetings, the first game in the
   * city with the extra home game is excluded, per NHL rules.
   */
  function headToHeadPoints(teams, games, column, throughDate) {
    const tied = new Set(teams);
    const seen = new Set();
    let meetings = games.filter((game) => {
      if (seen.has(game.id)) return false;
      seen.add(game.id);
      return game.gameType === 2 && ['OFF', 'FINAL'].includes(game.gameState) &&
        tied.has(game.homeTeam?.abbrev) && tied.has(game.awayTeam?.abbrev) &&
        game.homeTeam.abbrev !== game.awayTeam.abbrev &&
        Number.isFinite(game.homeTeam.score) && Number.isFinite(game.awayTeam.score) &&
        game.homeTeam.score !== game.awayTeam.score &&
        (!throughDate || game.gameDate <= throughDate);
    }).sort((a, b) => String(a.gameDate).localeCompare(String(b.gameDate)) || a.id - b.id);
    if (tied.size === 2 && meetings.length % 2 === 1) {
      const homeGames = new Map();
      meetings.forEach((game) => homeGames.set(game.homeTeam.abbrev, (homeGames.get(game.homeTeam.abbrev) || 0) + 1));
      const extraHome = [...homeGames].sort((a, b) => b[1] - a[1])[0][0];
      const skipped = meetings.find((game) => game.homeTeam.abbrev === extraHome);
      meetings = meetings.filter((game) => game !== skipped);
    }
    const points = new Map(teams.map((team) => [team, 0]));
    meetings.forEach((game) => {
      const homeWon = game.homeTeam.score > game.awayTeam.score;
      const winner = homeWon ? game.homeTeam.abbrev : game.awayTeam.abbrev;
      const loser = homeWon ? game.awayTeam.abbrev : game.homeTeam.abbrev;
      const extra = ['OT', 'SO'].includes(game.gameOutcome?.lastPeriodType) ||
        (game.periodDescriptor?.number || 0) > 3;
      points.set(winner, points.get(winner) + (column === 'PTS' && !extra ? 3 : 2));
      if (extra) points.set(loser, points.get(loser) + 1);
    });
    return points;
  }

  /** Resolve a run of teams tied through total wins by head-to-head points. */
  function rankHeadToHead(rows, column, standings) {
    const teams = rows.map((row) => standings?.teams.get(rowValues.get(row).team)?.teamAbbrev?.default);
    const season = standings?.teams.get(rowValues.get(rows[0]).team)?.seasonId;
    if (!season || teams.some((team) => !team) || new Set(teams).size !== teams.length) return null;
    const schedules = teams.map((team) => loadClubGames(team, season));
    if (schedules.some((schedule) => schedule.status !== 'ready')) return null;
    const throughDate = standings.date !== 'now' ? standings.date : null;
    return headToHeadPoints(teams, schedules.flatMap((schedule) => schedule.games), column, throughDate);
  }

  function rankStandings(rows, column, sequence, standings) {
    const ranked = [...rows].sort((a, b) => compareStandingsPrefix(a, b, column) ||
      compareNativeOrder(a, b, sequence, standings));
    // Head-to-head among teams tied through total wins; if those games are
    // unavailable (or still tied), NHL's official order supplies DIFF/GF etc.
    for (let start = 0; start < ranked.length;) {
      let end = start + 1;
      while (end < ranked.length && !compareStandingsPrefix(ranked[start], ranked[end], column)) end++;
      if (end - start > 1) {
        const tied = ranked.slice(start, end);
        const points = rankHeadToHead(tied, column, standings);
        if (points) {
          const abbrev = (row) => standings.teams.get(rowValues.get(row).team).teamAbbrev.default;
          tied.sort((a, b) => points.get(abbrev(b)) - points.get(abbrev(a)) ||
            compareNativeOrder(a, b, sequence, standings));
          ranked.splice(start, tied.length, ...tied);
        }
      }
      start = end;
    }
    return ranked;
  }

  function regroupWildcards(tables, standings) {
    const assignments = [];
    for (const wildcard of tables.filter((table) => tableStates.get(table).wildcard)) {
      const wildState = tableStates.get(wildcard);
      const originalTeam = Array.from(wildState.rows.keys()).find((row) => rowValues.has(row));
      const conference = standings.teams.get(rowValues.get(originalTeam)?.team)?.conferenceName;
      const divisions = tables.filter((table) => {
        const state = tableStates.get(table);
        return !state.wildcard && Array.from(standings.teams.values()).some((team) =>
          team.conferenceName === conference && team.divisionName === state.group);
      });
      if (!conference || divisions.length !== 2) return false;
      const rows = [wildcard, ...divisions].flatMap((table) =>
        Array.from(table.tBodies).flatMap((body) => Array.from(body.rows)).filter((row) => rowValues.has(row)));
      const expectedTeams = new Set(Array.from(standings.teams.values())
        .filter((team) => team.conferenceName === conference));
      if (rows.length !== expectedTeams.size || new Set(rows.map((row) =>
        standings.teams.get(rowValues.get(row).team))).size !== expectedTeams.size ||
          rows.some((row) => !expectedTeams.has(standings.teams.get(rowValues.get(row).team)))) return false;
      const qualifiers = new Set();
      for (const division of divisions) {
        const candidates = rows.filter((row) =>
          standings.teams.get(rowValues.get(row).team).divisionName === tableStates.get(division).group);
        rankStandings(candidates, rankingColumn, 'divisionSequence', standings).slice(0, 3).forEach((row) => {
          qualifiers.add(row);
          assignments.push({ row, body: division.tBodies[0] });
        });
      }
      rows.filter((row) => !qualifiers.has(row)).forEach((row) =>
        assignments.push({ row, body: wildcard.tBodies[0] }));
    }
    assignments.forEach(({ row, body }) => body.append(row));
    return true;
  }

  function showStandingsStatus(tables, message) {
    let status = document.querySelector('[data-nhl-standings-status]');
    if (!message) {
      status?.remove();
      return;
    }
    if (!status) {
      status = document.createElement('p');
      status.setAttribute('data-nhl-standings-status', '');
      status.setAttribute('role', 'status');
      tables[0].parentElement.before(status);
    }
    if (status.textContent !== message) status.textContent = message;
  }

  function updateLegend() {
    for (const [legend] of legendStates) {
      if (!legend.isConnected) legendStates.delete(legend);
    }
    document.querySelectorAll('[aria-label="Legend Information"]').forEach((legend) => {
      if (legendStates.has(legend)) return;
      const entries = new Map(Array.from(legend.querySelectorAll('span'))
        .filter((span) => span.children.length === 2 && span.children[0].tagName === 'SPAN')
        .map((span) => [span.children[0].textContent.trim().toUpperCase(), span]));
      if (!entries.has('W') || !entries.has('PTS') || !entries.has('P%')) return;
      legendStates.set(legend, snapshotDOM(legend));
      const setEntry = (element, label, description) => {
        element.children[0].textContent = label;
        element.children[1].textContent = ` - ${description}`;
      };
      setEntry(entries.get('W'), 'W', 'Regulation wins (3 points)');
      const otw = entries.get('W').cloneNode(true);
      setEntry(otw, 'OTW', 'Overtime/shootout wins (2 points)');
      entries.get('W').after(otw);
      if (entries.has('OT')) setEntry(entries.get('OT'), 'OTL', 'Overtime/shootout losses (1 point)');
      setEntry(entries.get('PTS'), 'PTS', '3-point-system points: W x 3 + OTW x 2 + OTL');
      setEntry(entries.get('P%'), 'P%', '3-point-system points percentage: PTS / (GP x 3)');
      const dpts = entries.get('PTS').cloneNode(true);
      setEntry(dpts, 'DPTS', 'Dumb points: NHL 2-point-system points, (W + OTW) x 2 + OTL');
      const dpct = entries.get('P%').cloneNode(true);
      setEntry(dpct, 'DP%', 'Dumb points percentage: DPTS / (GP x 2)');
      entries.get('P%').after(dpts, dpct);
      entries.get('RW')?.remove();
      entries.get('ROW')?.remove();
      const note = document.createElement('p');
      note.textContent = 'Rank and playoff groups follow the last selected points system (PTS/P% or DPTS/DP%). ' +
        'Tie-breaks: fewer GP, regulation wins, regulation plus overtime wins (original ROW), total wins (W + OTW), ' +
        'then head-to-head points among tied teams (3-point for PTS, 2-point for DPTS) from this season\'s games, ' +
        'then NHL official order (DIFF, GF). ' +
        'Clinch and elimination symbols remain official NHL two-point results.';
      legend.append(note);
    });
  }

  function clearSortClasses(element) {
    [element, ...element.querySelectorAll('[class]')].forEach((node) => {
      Array.from(node.classList).filter((name) => /^sorted(?:-\d+|-asc|-desc)?$/.test(name))
        .forEach((name) => node.classList.remove(name));
    });
  }

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
      const group = groupName(table);
      state = {
        headers, colMap, group,
        wildcard: /^wild card$/i.test(group) || !!table.querySelector('.wildcard-standings-cutoff-row'),
        restoreHeader: snapshotDOM(headerRow), rows: new Map(),
      };
      tableStates.set(table, state);
    }

    // --- Process data rows first (before altering header structure) ---
    const rows = Array.from(table.tBodies).flatMap((body) => Array.from(body.rows));
    rows.forEach((row, order) => {
      if (row.querySelector(`td[data-col="${OTW_COL}"]`)) return;
      if (!state.rows.has(row)) state.rows.set(row, { restore: snapshotDOM(row), body: row.parentElement, order });
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
      const rowWins = colMap.row === undefined ? totalW : Number(cells[colMap.row].textContent.trim());
      rowValues.set(row, {
        PTS: newPts, DPTS: dumbPts, 'P%': newPpct, 'DP%': dumbPpct,
        gp, rw, row: rowWins, totalW, order, team: teamKey(row),
      });

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

    if (processed) return;

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

  function sortTable(table, standings, playoffGroupsReady) {
    const headers = Array.from(table.tHead.rows[0].cells);
    const index = headers.findIndex((header) => getHeaderText(header) === activeSort.column);
    if (index < 0) return;
    const rankIndex = headers.findIndex((header) => getHeaderText(header) === 'RANK');
    const state = tableStates.get(table);
    const division = standings && Array.from(standings.teams.values()).some((team) => team.divisionName === state.group);
    const sequence = division ? 'divisionSequence' :
      state.wildcard || /eastern|western/i.test(state.group) ? 'conferenceSequence' : 'leagueSequence';
    let rankOrder = new Map();
    const multiplier = activeSort.direction === 'ascending' ? 1 : -1;
    const compare = (a, b) => {
      if (activeSort.column === 'PTS' || activeSort.column === 'DPTS') {
        return (rankOrder.get(a) - rankOrder.get(b)) * -multiplier;
      }
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
        const ranked = rankStandings(group, rankingColumn, sequence, standings);
        rankOrder = new Map(ranked.map((row, i) => [row, i]));
        if (rankIndex >= 0) {
          ranked
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
        if (state.wildcard && playoffGroupsReady && ['PTS', 'DPTS'].includes(activeSort.column) && sorted.length > 2) {
          const secondQualifier = ranked[1];
          secondQualifier.setAttribute('data-nhl-cutoff', multiplier === -1 ? 'after' : 'before');
        }
        group = [];
      };
      for (const row of Array.from(body.rows)) {
        row.classList.remove('wildcard-standings-cutoff-row');
        row.removeAttribute('data-nhl-cutoff');
        Array.from(row.cells).forEach((cell, i) => {
          clearSortClasses(cell);
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
      clearSortClasses(header);
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
    if (['PTS', 'P%'].includes(column)) rankingColumn = 'PTS';
    if (['DPTS', 'DP%'].includes(column)) rankingColumn = 'DPTS';
    processAllTables();
  }, true);

  function restoreTables() {
    observer.disconnect();
    const originalBodies = new Map();
    document.querySelectorAll('table').forEach((table) => {
      const state = tableStates.get(table);
      if (state && isProcessed(table)) {
        state.restoreHeader();
        state.rows.forEach((original, row) => {
          if (!row.isConnected || !original.body.isConnected) return;
          original.restore();
          if (!originalBodies.has(original.body)) originalBodies.set(original.body, []);
          originalBodies.get(original.body).push({ row, order: original.order });
        });
      }
      tableStates.delete(table);
    });
    originalBodies.forEach((rows, body) => rows.sort((a, b) => a.order - b.order)
      .forEach(({ row }) => body.append(row)));
    legendStates.forEach((restore, legend) => { if (legend.isConnected) restore(); });
    legendStates.clear();
    document.querySelector('[data-nhl-standings-status]')?.remove();
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
      const tables = Array.from(document.querySelectorAll('table'))
        .filter((table) => tableStates.has(table) && isProcessed(table));
      if (!tables.length) return;
      const standings = loadStandings();
      const wildcards = tables.some((table) => tableStates.get(table).wildcard);
      const ready = standings?.status === 'ready';
      const regrouped = ready && (!wildcards || regroupWildcards(tables, standings));
      tables.forEach((table) => sortTable(table, ready ? standings : null, regrouped));
      updateLegend();
      showStandingsStatus(tables,
        standings?.status === 'loading' ? 'Loading NHL playoff and tie-break rankings...' :
          standings?.status === 'error' ? 'Unable to load NHL playoff and tie-break rankings. Original playoff groups are retained; reload the page to retry.' :
            wildcards && ready && !regrouped ? 'NHL team data does not match the displayed playoff groups. Reload the page to refresh standings.' : '');
    } finally {
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  // --- MutationObserver: react to dynamically rendered content ---

  let debounceTimer = null;

  function scheduleProcessing() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(processAllTables, 150);
  }

  const observer = new MutationObserver(scheduleProcessing);

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
    module.exports = { headToHeadPoints, formatPct, getHeaderText, setHeaderText, buildColMap, isProcessed, processTable, processAllTables };
  }
})();
