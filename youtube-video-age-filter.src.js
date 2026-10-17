// ==UserScript==
// @name         YouTube Video Age Filter
// @namespace    local.youtube-video-age-filter
// @version      1.2.0
// @description  Filter Popular channel videos by upload age using YouTube's native pagination.
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
  const CHIP_BAR = 'chip-bar-view-model, yt-chip-cloud-renderer';
  const CHIP = '[role="tab"], yt-chip-cloud-chip-renderer';
  const UNITS = ['days', 'weeks', 'months', 'years'];
  let settings = { amount: 12, unit: 'months' };
  try {
    const saved = GM_getValue(KEY, {});
    settings = { amount: saved?.amount ?? 12, unit: saved?.unit ?? 'months' };
  } catch {}
  if (!Number.isInteger(settings.amount) || settings.amount < 1 || settings.amount > 10000) settings.amount = 12;
  if (!UNITS.includes(settings.unit)) settings.unit = 'months';

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
    #${PREFIX}-panel { display: flex; align-items: center; align-self: center; flex: 1 1 0%; min-width: 0; height: 32px; margin-inline-start: 16px; margin-inline-end: calc(var(--ytd-rich-grid-item-margin, 16px) / 2); overflow-x: auto; scrollbar-width: none; color: var(--yt-spec-text-primary, var(--paper-checkbox-label-color, CanvasText)); font-family: Roboto, Arial, sans-serif; font-size: 14px; white-space: nowrap; }
    #${PREFIX}-panel::-webkit-scrollbar { display: none; }
    #${PREFIX}-panel .${PREFIX}-controls { display: flex; align-items: center; flex: 0 0 auto; gap: 8px; margin-inline-start: auto; }
    #${PREFIX}-panel button { flex: 0 0 auto; }
    #${PREFIX}-panel button:disabled { cursor: default; }
    #${PREFIX}-panel button:disabled > span { opacity: .5; }
    #${PREFIX}-panel button:focus-visible { outline: 2px solid currentColor; outline-offset: -2px; border-radius: 8px; }
    #${PREFIX}-panel button:not(:disabled):hover .ytSpecTouchFeedbackShapeFill { opacity: .1; }
    #${PREFIX}-panel input, #${PREFIX}-panel select { font: inherit; outline-offset: -2px; }
    #${PREFIX}-panel input { width: 68px; padding-inline: 8px; }
    #${PREFIX}-panel select { width: auto; padding-inline: 8px; cursor: pointer; }
    #${PREFIX}-panel option { color: var(--yt-spec-text-primary, CanvasText); background: var(--yt-spec-base-background, Canvas); }
    html[dark] #${PREFIX}-panel input, html[dark] #${PREFIX}-panel select { color-scheme: dark; }
    #${PREFIX}-panel [hidden] { display: none !important; }
    #${PREFIX}-panel .${PREFIX}-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  `;
  document.head.append(style);

  function element(tag, text, parent, attrs = {}) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    if (parent) parent.append(node);
    return node;
  }

  function chipButton(text, parent, attrs = {}) {
    const button = element('button', '', parent, { type: 'button', class: 'ytChipShapeButtonReset', ...attrs });
    const shape = element('span', '', button, { class: 'ytChipShapeChip ytChipShapeInactive ytChipShapeOnlyTextPadding' });
    element('span', text, shape, { class: 'ytChipShapeText' });
    const feedback = element('span', '', shape, { class: 'ytSpecTouchFeedbackShapeHost ytSpecTouchFeedbackShapeTouchResponse', 'aria-hidden': 'true' });
    element('span', '', feedback, { class: 'ytSpecTouchFeedbackShapeFill' });
    return button;
  }

  function isPopular(bar) {
    const selected = bar?.querySelector('[role="tab"][aria-selected="true"], yt-chip-cloud-chip-renderer[selected]:not([selected="false"])');
    return !!selected && [selected.textContent, selected.getAttribute('aria-label')]
      .some(value => /^(popular|популярные)$/iu.test((value || '').trim()));
  }

  function panelContainer(bar) {
    return bar.matches('chip-bar-view-model') ? bar : bar.querySelector('#container');
  }

  function chipBar(grid) {
    const scope = grid.closest('ytd-browse') || grid;
    return [...grid.querySelectorAll(CHIP_BAR), ...scope.querySelectorAll(CHIP_BAR)]
      .find(node => panelContainer(node) && !node.closest('[hidden]') && node.getClientRects().length) || null;
  }

  function placePanel(state, bar) {
    const container = panelContainer(bar);
    state.bar = bar;
    if (state.panel.parentElement !== container) container.append(state.panel);
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
    current.panel.remove();
    current = null;
  }

  function mount(grid, bar) {
    const panel = element('div', '', null, { id: `${PREFIX}-panel`, role: 'group', 'aria-label': 'Video upload age filter' });
    const controls = element('div', '', panel, { class: `${PREFIX}-controls` });
    const amount = element('input', '', controls, { type: 'number', required: '', min: '1', max: '10000', step: '1', class: 'ytChipShapeChip ytChipShapeInactive', 'aria-label': 'Maximum video age', title: 'Within the last' });
    amount.value = String(settings.amount);
    const unit = element('select', '', controls, { class: 'ytChipShapeChip ytChipShapeInactive', 'aria-label': 'Age unit' });
    for (const value of UNITS) element('option', value, unit, { value });
    unit.value = settings.unit;
    const more = chipButton('Load more', controls, { 'aria-label': 'Load next page', title: 'Load one more page through normal YouTube scrolling', 'aria-describedby': `${PREFIX}-progress` });
    const find = chipButton('Find 20 more', controls, { title: 'Load until 20 more matching videos appear or 10 pages have loaded', 'aria-describedby': `${PREFIX}-progress` });
    const cancel = chipButton('Stop', controls, { title: 'Stop loading more videos' });
    const status = element('span', '', panel, { id: `${PREFIX}-status`, class: `${PREFIX}-sr-only`, role: 'status', 'aria-live': 'polite' });
    const progress = element('span', '', panel, { id: `${PREFIX}-progress`, class: `${PREFIX}-sr-only`, role: 'status', 'aria-live': 'polite' });
    current = { grid, panel, status, progress, more, find, cancel, running: false, message: '', stats: {}, restore: null, awaiting: null };
    placePanel(current, bar);
    const change = () => {
      if (!amount.checkValidity()) { amount.reportValidity(); return; }
      stop();
      settings = { amount: Number(amount.value), unit: unit.value };
      save();
      refresh();
    };
    for (const control of [amount, unit]) control.addEventListener('change', change);
    amount.addEventListener('input', () => { if (amount.checkValidity()) change(); });
    more.addEventListener('click', () => loadMore(1, Infinity));
    find.addEventListener('click', () => loadMore(10, 20));
    cancel.addEventListener('click', () => { stop('Stopped.'); refresh(); });
  }

  function cards(state) {
    return [...state.grid.querySelectorAll(ITEM)].filter(card => card.querySelector('a[href*="/watch?v="]'));
  }

  function refresh() {
    window.clearTimeout(scheduled);
    scheduled = 0;
    const grid = activeGrid();
    const bar = grid && chipBar(grid);
    const active = isPopular(bar);
    if (current && (grid !== current.grid || !active)) unmount();
    if (!active) return;
    if (!current) mount(grid, bar);
    else placePanel(current, bar);
    const state = current;
    grid.classList.add(`${PREFIX}-active`);
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
      const show = result === 'recent';
      card.classList.toggle(`${PREFIX}-hidden`, !show);
      if (show) stats.shown++;
      if (result !== 'recent') stats[result]++;
    }
    state.stats = stats;
    const continuation = grid.querySelector(CONTINUATION);
    const label = `${stats.shown} shown / ${stats.loaded} loaded · ${stats.old} too old · ${stats.boundary} at cutoff · ${stats.unknown} unknown · Order: Popular`;
    if (state.status.textContent !== label) state.status.textContent = label;
    const message = state.message || (continuation ? 'More videos may match. Use Load more or Find 20 more.' : 'No further page is currently offered by YouTube.');
    if (state.progress.textContent !== message) state.progress.textContent = message;
    state.more.disabled = state.find.disabled = state.running || !continuation;
    state.cancel.disabled = !state.running;
    state.cancel.hidden = !state.running;
    state.more.title = state.message || 'Load one more page through normal YouTube scrolling';
    state.find.title = state.message || 'Load until 20 more matching videos appear or 10 pages have loaded';
    state.panel.setAttribute('aria-busy', String(state.running));
  }

  function schedule() {
    if (!scheduled) scheduled = window.setTimeout(refresh, 80);
  }

  const wait = ms => new Promise(resolve => window.setTimeout(resolve, ms));

  async function loadMore(maxPages, target) {
    refresh();
    if (!current || current.running || document.hidden) return;
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
        if (id !== runId || current !== state) return;
        continuation.scrollIntoView({ block: 'end', behavior: 'instant' });
        const started = Date.now();
        let changed = false;
        while (Date.now() - started < 15000) {
          await wait(150);
          refresh();
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
        if (id !== runId || current !== state) return;
        if (!changed) { state.message = 'YouTube did not load another page. Try again, or select Latest or Oldest for native scrolling.'; break; }
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
    if (records.some(record => !(record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement)?.closest(`#${PREFIX}-panel`))) schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-selected', 'selected', 'hidden'] });
  document.addEventListener('yt-navigate-start', () => { navigationPending = true; unmount(); });
  document.addEventListener('yt-navigate-finish', () => { navigationPending = false; schedule(); });
  document.addEventListener('yt-page-data-updated', schedule);
  window.addEventListener('popstate', schedule);
  document.addEventListener('click', event => {
    const chip = event.target.closest?.(CHIP);
    if (!chip?.closest(CHIP_BAR)) return;
    if (current?.bar.contains(chip)) unmount();
    schedule();
  }, true);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && current?.running) { stop('Paused because this tab is in the background.'); refresh(); }
  });
  refresh();
})();
