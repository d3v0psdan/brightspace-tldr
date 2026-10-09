// Kanban board for the Work To Do page. Reads items out of the D2L shadow DOM,
// remembers them across the list's pages, and keeps statuses and notes in chrome.storage.
(() => {
  const STATUSES = { todo: 'To Do', doing: 'In Progress', done: 'Done' };
  const GROUPS = { status: 'Status', class: 'Class', week: 'Week' };
  const WEEK_COLUMNS = ['Overdue', 'This week', 'Next week', 'Later'];
  const OVERDUE_DAY_LIMIT = 84; // the page's own overdue-day-limit; older items drop off the board
  const GOLDEN_ANGLE = 137.5; // spreads course hues as far apart as possible

  const defaults = () => ({ cards: {}, groupBy: 'status', course: '', showHidden: false });
  let board = { items: {}, view: 'list', ...defaults() };
  let host;

  chrome.storage.local.get('board', ({ board: saved }) => {
    board = { ...board, ...saved };
    // ponytail: polling for the same reason as content.js (shadow roots hide mutations).
    setInterval(tick, 1000);
  });

  function tick() {
    const target = collections();
    if (!target) return;
    if (!host?.isConnected) mount(target);
    if (merge(scrape(target))) save();
    else return;
    render();
  }

  function collections() {
    return document.querySelector('d2l-w2d-work-to-do')?.shadowRoot?.querySelector('d2l-w2d-collections');
  }

  // Headings and lists are siblings in page order: an h2 opens Overdue or Upcoming,
  // an h3 carries the due date for the list that follows it.
  function scrape(target) {
    const found = [];
    let isOverdue = false;
    let due = null;
    for (const el of target.shadowRoot?.querySelectorAll('h2, h3, d2l-w2d-list') || []) {
      const text = el.textContent.trim();
      if (el.localName === 'h2') isOverdue = text.startsWith('Overdue');
      else if (el.localName === 'h3') due = parseHeading(text, isOverdue);
      else el.shadowRoot?.querySelectorAll('[role="listitem"]').forEach(item => found.push(readItem(item, due)));
    }
    return found.filter(Boolean);
  }

  function readItem(item, due) {
    const root = item.shadowRoot;
    const name = root?.querySelector('.d2l-w2d-list-item-name');
    const title = name?.getAttribute('_label');
    if (!title) return null; // still loading
    const course = root.querySelector('d2l-w2d-attribute-list span')?.textContent.trim() || 'Other';
    const link = item.getAttribute('action-href') || ''; // some quizzes have no link
    const href = link.startsWith('https://') ? link : '';
    const type = item.localName.replace('d2l-w2d-list-item-', '');
    return { id: `${href || course}|${title}`, title, course, href, due, type };
  }

  function merge(found) {
    const before = JSON.stringify(board.items);
    found.forEach(item => { board.items[item.id] = item; });
    for (const [id, item] of Object.entries(board.items)) {
      if (daysUntil(item.due) < -OVERDUE_DAY_LIMIT) delete board.items[id];
    }
    return JSON.stringify(board.items) !== before;
  }

  function save() {
    chrome.storage.local.set({ board });
  }

  function mount(target) {
    host = document.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style><div class="bar"></div><div class="board"></div>`;
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('dragstart', e => e.dataTransfer.setData('text/plain', e.target.closest('.card').dataset.id));
    root.addEventListener('dragover', e => { if (e.target.closest('[data-status]')) e.preventDefault(); });
    root.addEventListener('drop', onDrop);
    target.before(host);
    render();
  }

  function onClick(e) {
    const button = e.target.closest('button');
    if (!button) return;
    const { view, group, course, action } = button.dataset;
    if (view) board.view = view;
    else if (group) board.groupBy = group;
    else if (course !== undefined) board.course = course;
    else if (action === 'hide') updateCard(cardId(button), card => ({ hidden: !card.hidden }));
    else if (action === 'reset') {
      if (!confirm('Reset the board? This clears every status, note and hidden item.')) return;
      board = { ...board, ...defaults() };
    }
    else return;
    save();
    render();
  }

  function onChange(e) {
    const { action } = e.target.dataset;
    if (action === 'note') {
      // Saved on blur without a re-render, so the click that caused the blur still lands.
      updateCard(cardId(e.target), () => ({ note: e.target.value }));
      save();
      return;
    }
    if (action === 'status') updateCard(cardId(e.target), () => ({ status: e.target.value }));
    else if (action === 'show-hidden') board.showHidden = e.target.checked;
    else return;
    save();
    render();
  }

  function onDrop(e) {
    const column = e.target.closest('[data-status]');
    if (!column) return;
    e.preventDefault();
    updateCard(e.dataTransfer.getData('text/plain'), () => ({ status: column.dataset.status }));
    save();
    render();
  }

  function card(id) {
    return board.cards[id] || { status: 'todo', note: '', hidden: false };
  }

  function updateCard(id, change) {
    board.cards[id] = { ...card(id), ...change(card(id)) };
  }

  function cardId(el) {
    return el.closest('.card').dataset.id;
  }

  function courseCode(course) {
    return course.split(' - ')[0];
  }

  function courseCodes() {
    return [...new Set(Object.values(board.items).map(item => courseCode(item.course)))].sort();
  }

  function colorFor(code) {
    return `hsl(${(courseCodes().indexOf(code) * GOLDEN_ANGLE) % 360} 60% 40%)`;
  }

  function render() {
    const target = collections();
    if (target) target.style.display = board.view === 'board' ? 'none' : '';
    const root = host.shadowRoot;
    root.querySelector('.bar').innerHTML = toolbar();
    root.querySelector('.board').innerHTML = board.view === 'board' ? columns().map(column).join('') : '';
  }

  function toolbar() {
    const pressed = on => `aria-pressed="${on}"`;
    const views = `<div class="group"><button data-view="list" ${pressed(board.view === 'list')}>List</button>`
      + `<button data-view="board" ${pressed(board.view === 'board')}>Board</button></div>`;
    if (board.view !== 'board') return views;

    const groups = Object.entries(GROUPS)
      .map(([key, label]) => `<button data-group="${key}" ${pressed(board.groupBy === key)}>${label}</button>`).join('');
    const chips = [`<button class="chip" data-course="" ${pressed(!board.course)}>All</button>`,
      ...courseCodes().map(code => `<button class="chip" data-course="${escape(code)}" ${pressed(board.course === code)}`
        + ` style="--course:${colorFor(code)}">${escape(code)}</button>`)].join('');
    const hiddenCount = Object.keys(board.items).filter(id => card(id).hidden).length;
    return `${views}<span class="label">Group by</span><div class="group">${groups}</div>${chips}
      <label class="label"><input type="checkbox" data-action="show-hidden" ${board.showHidden ? 'checked' : ''}>
        Show hidden (${hiddenCount})</label>
      <button class="reset" data-action="reset">Reset to defaults</button>
      <p class="hint">${Object.keys(board.items).length} items. Work To Do splits its list into pages; open each page once and the board remembers them.</p>`;
  }

  function columns() {
    const items = Object.values(board.items)
      .filter(item => !board.course || courseCode(item.course) === board.course)
      .filter(item => board.showHidden || !card(item.id).hidden)
      .sort(byDoneThenDue);
    if (board.groupBy === 'status') {
      return Object.entries(STATUSES)
        .map(([status, title]) => ({ status, title, items: items.filter(item => card(item.id).status === status) }));
    }
    if (board.groupBy === 'week') {
      return WEEK_COLUMNS.map(title => ({ title, items: items.filter(item => weekBucket(daysUntil(item.due)) === title) }));
    }
    return [...new Set(items.map(item => courseCode(item.course)))].sort()
      .map(code => ({ title: code, items: items.filter(item => courseCode(item.course) === code) }));
  }

  function byDoneThenDue(a, b) {
    const done = item => card(item.id).status === 'done' ? 1 : 0;
    return done(a) - done(b) || (a.due || '9999').localeCompare(b.due || '9999');
  }

  function column({ status, title, items }) {
    return `<section class="column" ${status ? `data-status="${status}"` : ''}>
      <h3>${escape(title)} <span class="count">${items.length}</span></h3>
      ${items.map(cardHtml).join('') || '<p class="empty">Nothing here</p>'}
    </section>`;
  }

  function cardHtml(item) {
    const { status, note, hidden } = card(item.id);
    const days = daysUntil(item.due);
    const urgency = days === null ? '' : days < 0 ? 'late' : days <= 2 ? 'soon' : '';
    const code = courseCode(item.course);
    const title = item.href ? `<a href="${escape(item.href)}">${escape(item.title)}</a>` : escape(item.title);
    const options = Object.entries(STATUSES)
      .map(([key, label]) => `<option value="${key}" ${key === status ? 'selected' : ''}>${label}</option>`).join('');
    return `<article class="card ${status} ${hidden ? 'hidden' : ''}" data-id="${escape(item.id)}"
        draggable="${board.groupBy === 'status'}" style="--course:${colorFor(code)}">
      <div class="meta"><span class="course" title="${escape(item.course)}">${escape(code)}</span>
        <span>${escape(item.type)}</span><span class="badge ${urgency}">${dueBadge(days)}</span></div>
      <div class="title">${title}</div>
      <div class="due">${formatDue(item.due)}</div>
      <textarea data-action="note" rows="1" placeholder="Add a note" aria-label="Note">${escape(note)}</textarea>
      <div class="actions">
        <select data-action="status" aria-label="Status">${options}</select>
        <button data-action="hide">${hidden ? 'Unhide' : 'Hide'}</button>
      </div>
    </article>`;
  }

  function escape(text) {
    return String(text).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
  }

  const CSS = `
    :host { display: block; margin-bottom: 24px; }
    button, select, textarea { font: inherit; }
    .bar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 16px; }
    .group { display: inline-flex; border: 1px solid #cdd5dc; border-radius: 6px; overflow: hidden; }
    .group button { border: 0; background: #fff; color: #202122; padding: 6px 14px; cursor: pointer; }
    .group button[aria-pressed="true"] { background: #006fbf; color: #fff; }
    .label { color: #494c4e; font-size: 14px; }
    .chip { --course: #494c4e; border: 1px solid var(--course); color: var(--course); background: #fff;
      border-radius: 999px; padding: 3px 12px; font-size: 13px; cursor: pointer; }
    .chip[aria-pressed="true"] { background: var(--course); color: #fff; }
    .reset { margin-left: auto; border: 1px solid #cdd5dc; background: #fff; border-radius: 6px; padding: 6px 12px; cursor: pointer; }
    .hint { width: 100%; margin: 0; color: #6e7376; font-size: 13px; }
    .board { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(240px, 1fr); gap: 16px;
      align-items: start; overflow-x: auto; }
    .column { background: #f1f5fb; border-radius: 8px; padding: 12px; min-height: 120px; }
    .column h3 { display: flex; justify-content: space-between; margin: 0 0 12px; font-size: 16px; }
    .count { background: #fff; border-radius: 999px; padding: 0 8px; font-size: 13px; }
    .empty { color: #6e7376; font-size: 13px; }
    .card { background: #fff; border: 1px solid #e3e9f1; border-radius: 6px;
      padding: 10px; margin-bottom: 10px; font-size: 13px; }
    .card[draggable="true"] { cursor: grab; }
    .card.done { opacity: 0.6; }
    .card.done .title { text-decoration: line-through; }
    .card.hidden { opacity: 0.45; border-style: dashed; }
    .meta { display: flex; gap: 8px; align-items: center; color: #6e7376; text-transform: capitalize; }
    .course { color: var(--course); font-weight: 700; text-transform: none; }
    .course::before { content: ''; display: inline-block; width: 8px; height: 8px; margin-right: 6px;
      border-radius: 50%; background: var(--course); }
    .badge { margin-left: auto; padding: 1px 6px; border-radius: 4px; background: #e3e9f1; color: #202122; font-weight: 700; font-size: 12px; }
    .badge:empty { display: none; }
    .badge.late { background: #cd2026; color: #fff; }
    .badge.soon { background: #ffba59; }
    .title { margin: 6px 0 2px; font-size: 14px; color: #202122; }
    .title a { color: #006fbf; }
    .due { color: #6e7376; }
    textarea { box-sizing: border-box; width: 100%; margin-top: 8px; padding: 4px 6px; border: 1px solid #e3e9f1;
      border-radius: 4px; resize: vertical; }
    .actions { display: flex; gap: 8px; margin-top: 6px; }
    .actions select { flex: 1; }
    .actions button { border: 1px solid #cdd5dc; background: #fff; border-radius: 4px; cursor: pointer; }
  `;
})();
