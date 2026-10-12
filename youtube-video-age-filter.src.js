// ==UserScript==
// @name         YouTube Video Age Filter
// @namespace    local.youtube-video-age-filter
// @version      1.0.2
// @description  Filter channel videos by upload age while keeping YouTube's native order and pagination.
// @match        https://www.youtube.com/*
// @run-at       document-idle
// @sandbox      DOM
// @grant        GM_getValue
// @grant        GM_setValue
// @noframes
// @updateURL    https://raw.githubusercontent.com/sashokey/youtube-video-age-filter/master/youtube-video-age-filter.user.js
// @downloadURL  https://raw.githubusercontent.com/sashokey/youtube-video-age-filter/master/youtube-video-age-filter.user.js
// ==/UserScript==

(() => {
  'use strict';

  const KEY = 'youtube-video-age-filter-v1';
  const PREFIX = 'yt-age-filter';
  const ITEM = 'ytd-rich-item-renderer, ytd-grid-video-renderer';
  const CONTINUATION = 'ytd-continuation-item-renderer';
  const UNITS = ['days', 'weeks', 'months', 'years'];
  const defaults = { enabled: true, amount: 12, unit: 'months', uncertain: false };
  let settings = { ...defaults };
  try { settings = { ...defaults, ...GM_getValue(KEY, {}) }; } catch {}
  if (!Number.isInteger(settings.amount) || settings.amount < 1 || settings.amount > 10000) settings.amount = 12;
  if (!UNITS.includes(settings.unit)) settings.unit = 'months';
  settings.enabled = settings.enabled === true;
  settings.uncertain = settings.uncertain === true;

  function subtractMonths(time, amount) {
    const date = new Date(time);
    const day = date.getDate();
    date.setDate(1);
    date.setMonth(date.getMonth() - amount);
    const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    date.setDate(Math.min(day, last));
    return date.getTime();
  }

  function subtract(time, amount, unit) {
    if (unit === 'months') return subtractMonths(time, amount);
    if (unit === 'years') return subtractMonths(time, amount * 12);
    return time - amount * { seconds: 1000, minutes: 60000, hours: 3600000, days: 86400000, weeks: 604800000 }[unit];
  }

  function ageRange(value, now) {
    const text = String(value).toLowerCase().replace(/\u00a0|\u202f/g, ' ').trim();
    const match = text.match(/(?:^|\s)(\d+)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?|секунд\S*|сек\.?|минут\S*|мин\.?|час\S*|ч\.?|дней|день|дня|дн\.?|недел\S*|нед\.?|месяц\S*|мес\.?|год\S*|года|лет|г\.?)\s+(?:ago|назад)(?:$|[\s.,])/u);
    if (!match) return null;
    const amount = Number(match[1]);
    const token = match[2];
    let unit;
    if (/^(second|sec|сек)/u.test(token)) unit = 'seconds';
    else if (/^(minute|min|мин)/u.test(token)) unit = 'minutes';
    else if (/^(hour|hr|час|ч)/u.test(token)) unit = 'hours';
    else if (/^(day|д)/u.test(token)) unit = 'days';
    else if (/^(week|нед)/u.test(token)) unit = 'weeks';
    else if (/^(month|мес)/u.test(token)) unit = 'months';
    else unit = 'years';
    return { oldest: subtract(now, amount + 1, unit), newest: subtract(now, amount, unit) };
  }

  function classify(range, cutoff) {
    if (!range) return 'unknown';
    if (range.newest <= cutoff) return 'old';
    if (range.oldest >= cutoff) return 'recent';
    return 'boundary';
  }

  function readAge(card, now) {
    const nodes = card.querySelectorAll('.ytContentMetadataViewModelMetadataText, #metadata-line > span, time[datetime]');
    for (const node of nodes) {
      const exact = node.getAttribute('datetime');
      if (exact && /^\d{4}-\d{2}-\d{2}T/.test(exact)) {
        const time = Date.parse(exact);
        if (Number.isFinite(time)) return { oldest: time, newest: time + 1 };
      }
      for (const value of [node.getAttribute('aria-label'), node.textContent]) {
        const range = ageRange(value || '', now);
        if (range) return range;
      }
    }
    return null;
  }

  let current = null;
  let scheduled = 0;
  let navigationPending = false;
  let runId = 0;
  const style = document.createElement('style');
  style.id = `${PREFIX}-style`;
  style.textContent = `
    .${PREFIX}-hidden { display: none !important; }
    .${PREFIX}-active:not(.${PREFIX}-loading) ${CONTINUATION} { display: none !important; }
    .${PREFIX}-active ytd-rich-grid-row { display: contents !important; }
    .${PREFIX}-active ytd-rich-grid-row > #contents { display: contents !important; }
    .${PREFIX}-active ${ITEM} { margin-left: calc(var(--ytd-rich-grid-item-margin, 16px) / 2) !important; margin-right: calc(var(--ytd-rich-grid-item-margin, 16px) / 2) !important; }
    #${PREFIX}-panel, #${PREFIX}-footer { display: block; width: 100%; box-sizing: border-box; margin: 12px 0; }
    #${PREFIX}-footer[hidden] { display: none !important; }
  `;
  document.head.append(style);

  function element(tag, text, parent, attrs = {}) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    if (parent) parent.append(node);
    return node;
  }

  function shadowHost(id, parent) {
    const host = element('div', '', parent, { id });
    const shadow = host.attachShadow({ mode: 'open' });
    element('style', `
      :host { --af-text: #171717; --af-muted: #606060; --af-bg: #f5f5f5; --af-input: #fff; --af-border: #ccc; --af-hover: #e5e5e5; color: var(--af-text); font: 14px/1.5 Arial, sans-serif; }
      :host-context([dark]) { --af-text: #f1f1f1; --af-muted: #aaa; --af-bg: #212121; --af-input: #121212; --af-border: #555; --af-hover: #333; color-scheme: dark; }
      .box { background: var(--af-bg); border: 1px solid var(--af-border); border-radius: 12px; padding: 14px 16px; }
      .row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
      label { display: inline-flex; align-items: center; gap: 7px; }
      input, select, button { color: inherit; font: inherit; border: 1px solid var(--af-border); background: var(--af-input); border-radius: 7px; padding: 6px 9px; }
      input[type=number] { width: 76px; }
      input[type=checkbox] { accent-color: #065fd4; width: 16px; height: 16px; }
      button { cursor: pointer; }
      button:hover { background: var(--af-hover); }
      button:disabled { opacity: .5; cursor: default; }
      .primary { background: #065fd4; color: #fff; border-color: #065fd4; }
      .primary:hover { background: #004ab1; }
      .note { margin: 8px 0 0; color: var(--af-muted); font-size: 12px; }
      .status { margin: 8px 0 0; }
    `, shadow);
    return { host, shadow, box: element('div', '', shadow, { class: 'box' }) };
  }

  function save() {
    try { GM_setValue(KEY, settings); } catch {}
  }

  function activeGrid() {
    if (navigationPending || !/^\/(?:@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)\/videos\/?$/.test(location.pathname)) return null;
    return [...document.querySelectorAll('ytd-browse[page-subtype="channels"] ytd-rich-grid-renderer, ytd-browse[page-subtype="channels"] ytd-grid-renderer')]
      .find(node => !node.closest('[hidden]') && node.getClientRects().length) || null;
  }

  function stop(message = '') {
    runId++;
    if (!current) return;
    current.running = false;
    current.awaiting = null;
    current.message = message;
    current.grid.classList.remove(`${PREFIX}-loading`);
    if (current.restore) {
      window.scrollTo({ top: current.restore.y, left: current.restore.x, behavior: 'instant' });
      current.restore = null;
    }
  }

  function unmount() {
    stop();
    if (!current) return;
    current.grid.classList.remove(`${PREFIX}-active`, `${PREFIX}-loading`);
    current.grid.querySelectorAll(`.${PREFIX}-hidden`).forEach(node => node.classList.remove(`${PREFIX}-hidden`));
    current.panel.host.remove();
    current.footer.host.remove();
    current = null;
  }

  function mount(grid) {
    const panel = shadowHost(`${PREFIX}-panel`, null);
    const footer = shadowHost(`${PREFIX}-footer`, null);
    grid.before(panel.host);
    grid.after(footer.host);
    const row = element('div', '', panel.box, { class: 'row' });
    const enabledLabel = element('label', '', row);
    const enabled = element('input', '', enabledLabel, { type: 'checkbox' });
    enabled.checked = settings.enabled;
    element('strong', 'Upload age', enabledLabel);
    const ageLabel = element('label', 'Within the last', row);
    const amount = element('input', '', ageLabel, { type: 'number', min: '1', max: '10000', step: '1', 'aria-label': 'Maximum video age' });
    amount.value = String(settings.amount);
    const unit = element('select', '', row, { 'aria-label': 'Age unit' });
    for (const value of UNITS) element('option', value, unit, { value });
    unit.value = settings.unit;
    const uncertainLabel = element('label', '', row);
    const uncertain = element('input', '', uncertainLabel, { type: 'checkbox' });
    uncertain.checked = settings.uncertain;
    element('span', 'Include uncertain dates', uncertainLabel);
    element('p', 'Uses the age displayed by YouTube. Rounded ages that overlap the cutoff and missing dates are excluded unless enabled above. Select Popular on YouTube to keep its popularity order.', panel.box, { class: 'note' });
    const status = element('p', '', panel.box, { class: 'status', role: 'status', 'aria-live': 'polite' });
    const buttons = element('div', '', footer.box, { class: 'row' });
    const more = element('button', 'Load next page', buttons, { type: 'button' });
    const find = element('button', 'Find 20 more', buttons, { type: 'button', class: 'primary' });
    const cancel = element('button', 'Stop', buttons, { type: 'button' });
    const progress = element('span', '', buttons, { role: 'status', 'aria-live': 'polite' });
    element('p', 'Loads through normal YouTube scrolling. Find 20 more stops after 20 matching videos or 10 pages. The page may scroll briefly while loading.', footer.box, { class: 'note' });
    current = { grid, panel, footer, amount, unit, uncertain, enabled, status, progress, more, find, cancel, running: false, message: '', stats: {}, restore: null, awaiting: null };
    const change = () => {
      if (!amount.checkValidity()) { amount.reportValidity(); return; }
      stop();
      settings = { enabled: enabled.checked, amount: Number(amount.value), unit: unit.value, uncertain: uncertain.checked };
      save();
      refresh();
    };
    for (const control of [enabled, amount, unit, uncertain]) control.addEventListener('change', change);
    amount.addEventListener('input', () => { if (amount.checkValidity()) change(); });
    more.addEventListener('click', () => loadMore(1, Infinity));
    find.addEventListener('click', () => loadMore(10, 20));
    cancel.addEventListener('click', () => { stop('Stopped.'); refresh(); });
  }

  function cards(state) {
    return [...state.grid.querySelectorAll(ITEM)].filter(card => card.querySelector('a[href*="/watch?v="]'));
  }

  function refresh() {
    scheduled = 0;
    const grid = activeGrid();
    if (current && (grid !== current.grid || !current.panel.host.isConnected)) unmount();
    if (!grid) return;
    if (!current) mount(grid);
    const state = current;
    grid.classList.toggle(`${PREFIX}-active`, settings.enabled);
    const list = cards(state);
    if (state.awaiting && list.length !== state.awaiting.count) {
      grid.classList.remove(`${PREFIX}-loading`);
      if (state.restore) {
        window.scrollTo({ top: state.restore.y, left: state.restore.x, behavior: 'instant' });
        state.restore = null;
      }
    }
    const now = Date.now();
    const cutoff = subtract(now, settings.amount, settings.unit);
    const stats = { loaded: list.length, shown: 0, old: 0, boundary: 0, unknown: 0 };
    for (const card of list) {
      const result = classify(readAge(card, now), cutoff);
      const show = !settings.enabled || result === 'recent' || (settings.uncertain && result !== 'old');
      card.classList.toggle(`${PREFIX}-hidden`, !show);
      if (show) stats.shown++;
      if (result !== 'recent') stats[result]++;
    }
    state.stats = stats;
    const continuation = grid.querySelector(CONTINUATION);
    const selected = grid.querySelector('[role="tab"][aria-selected="true"], yt-chip-cloud-chip-renderer[selected]');
    const order = selected?.textContent.trim() || 'YouTube order';
    const label = settings.enabled
      ? `${stats.shown} shown / ${stats.loaded} loaded · ${stats.old} too old · ${stats.boundary} at cutoff · ${stats.unknown} unknown · Order: ${order}`
      : `Filter off · ${stats.loaded} loaded · Native scrolling restored`;
    if (state.status.textContent !== label) state.status.textContent = label;
    const message = state.message || (continuation ? 'More videos may match. Load more below.' : 'No further page is currently offered by YouTube.');
    if (state.progress.textContent !== message) state.progress.textContent = message;
    state.more.disabled = state.find.disabled = !settings.enabled || state.running || !continuation;
    state.cancel.disabled = !state.running;
    state.footer.host.hidden = !settings.enabled;
    state.amount.disabled = state.unit.disabled = state.uncertain.disabled = !settings.enabled;
  }

  function schedule() {
    if (!scheduled) scheduled = window.setTimeout(refresh, 80);
  }

  const wait = ms => new Promise(resolve => window.setTimeout(resolve, ms));

  async function loadMore(maxPages, target) {
    if (!current || current.running || !settings.enabled) return;
    const state = current;
    const id = ++runId;
    const initialShown = state.stats.shown;
    state.running = true;
    try {
      for (let page = 0; page < maxPages; page++) {
        if (id !== runId || current !== state || document.hidden) break;
        const continuation = state.grid.querySelector(CONTINUATION);
        if (!continuation) { state.message = 'End of the list offered by YouTube.'; break; }
        const count = cards(state).length;
        state.awaiting = { count };
        state.message = `Loading page ${page + 1} / ${maxPages}...`;
        state.restore = { x: window.scrollX, y: window.scrollY };
        state.grid.classList.add(`${PREFIX}-loading`);
        refresh();
        continuation.scrollIntoView({ block: 'end', behavior: 'instant' });
        const started = Date.now();
        let changed = false;
        while (Date.now() - started < 15000) {
          await wait(150);
          if (id !== runId || current !== state || document.hidden) return;
          if (cards(state).length !== count || !state.grid.querySelector(CONTINUATION)) { changed = true; break; }
        }
        state.grid.classList.remove(`${PREFIX}-loading`);
        if (state.restore) {
          window.scrollTo({ top: state.restore.y, left: state.restore.x, behavior: 'instant' });
          state.restore = null;
        }
        state.awaiting = null;
        refresh();
        if (!changed) { state.message = 'YouTube did not load another page. Try again, or turn the filter off to use native scrolling.'; break; }
        const added = state.stats.shown - initialShown;
        state.message = `Found ${Math.max(0, added)} more matching videos.`;
        if (added >= target) break;
        if (page + 1 === maxPages) state.message += ` Scanned ${maxPages} page${maxPages === 1 ? '' : 's'}; use the button again to continue.`;
        else await wait(Math.max(0, 2000 - (Date.now() - started)));
      }
    } finally {
      if (current === state && id === runId) {
        if (document.hidden) state.message = 'Paused because this tab is in the background.';
        stop(state.message);
        state.awaiting = null;
        refresh();
      }
    }
  }

  const observer = new MutationObserver(records => {
    if (records.some(record => !record.target.closest?.(`#${PREFIX}-panel, #${PREFIX}-footer`))) schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  document.addEventListener('yt-navigate-start', () => { navigationPending = true; unmount(); });
  document.addEventListener('yt-navigate-finish', () => { navigationPending = false; schedule(); });
  document.addEventListener('yt-page-data-updated', schedule);
  window.addEventListener('popstate', schedule);
  document.addEventListener('click', event => {
    if (current && event.target.closest?.('ytd-rich-grid-renderer [role="tab"], yt-chip-cloud-chip-renderer')) { stop(); schedule(); }
  }, true);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && current?.running) { stop('Paused because this tab is in the background.'); refresh(); }
  });
  refresh();
})();
