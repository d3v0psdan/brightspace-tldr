// Kanban board for the Work To Do page. Reads items out of the D2L shadow DOM,
// remembers them across the list's pages, and keeps statuses and notes in chrome.storage.
(() => {
  const STATUSES = { todo: 'To Do', doing: 'In Progress', done: 'Done' };
  const GROUPS = { status: 'Status', class: 'Class', week: 'Week' };
  const WEEK_COLUMNS = ['Overdue', 'This week', 'Next week', 'Later'];
  const OVERDUE_DAY_LIMIT = 84; // the page's own overdue-day-limit; older items drop off the board
  const TYPE_ICONS = { assignment: 'assignments', quiz: 'quizzing', discussion: 'discussions' };
  const COURSE_HUES = 8; // .course-0 to .course-7 in the CSS below

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
    root.addEventListener('dragstart', onDragStart);
    root.addEventListener('dragover', onDragOver);
    root.addEventListener('drop', onDrop);
    root.addEventListener('dragend', clearDragState);
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
    else if (action === 'show-hidden') board.showHidden = !board.showHidden;
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
    if (action !== 'status') return;
    updateCard(cardId(e.target), () => ({ status: e.target.value }));
    save();
    render();
  }

  function onDragStart(e) {
    const dragged = e.target.closest('.card');
    e.dataTransfer.setData('text/plain', dragged.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
    dragged.classList.add('dragging');
  }

  function onDragOver(e) {
    const column = e.target.closest('[data-status]');
    if (!column) return;
    e.preventDefault();
    host.shadowRoot.querySelectorAll('.over').forEach(other => other !== column && other.classList.remove('over'));
    column.classList.add('over');
  }

  function onDrop(e) {
    const column = e.target.closest('[data-status]');
    if (!column) return;
    e.preventDefault();
    updateCard(e.dataTransfer.getData('text/plain'), () => ({ status: column.dataset.status }));
    save();
    render();
  }

  function clearDragState() {
    host.shadowRoot.querySelectorAll('.over, .dragging').forEach(el => el.classList.remove('over', 'dragging'));
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

  // "DMIT2015 - Enterprise Application Development (A01.1261)" -> "Enterprise Application Development"
  function courseName(code) {
    const item = Object.values(board.items).find(each => courseCode(each.course) === code);
    return item?.course.split(' - ').slice(1).join(' - ').replace(/\s*\(.*\)$/, '') || '';
  }

  function courseCodes() {
    return [...new Set(Object.values(board.items).map(item => courseCode(item.course)))].sort();
  }

  function courseClass(code) {
    return `course-${courseCodes().indexOf(code) % COURSE_HUES}`;
  }

  function icon(name) {
    return `<svg class="icon" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">${ICONS[name]}</svg>`;
  }

  function render() {
    const target = collections();
    if (target) target.style.display = board.view === 'board' ? 'none' : '';
    const root = host.shadowRoot;
    root.querySelector('.bar').innerHTML = toolbar();
    root.querySelector('.board').innerHTML = board.view === 'board' ? columns().map(column).join('') : '';
  }

  function segmented(label, options, isPressed, attribute) {
    const buttons = Object.entries(options)
      .map(([key, text]) => `<button data-${attribute}="${key}" aria-pressed="${isPressed(key)}">${text}</button>`).join('');
    return `<div class="segmented" role="group" aria-label="${label}">${buttons}</div>`;
  }

  function toolbar() {
    const views = segmented('View', { list: 'List', board: 'Board' }, key => board.view === key, 'view');
    if (board.view !== 'board') return `<div class="row">${views}</div>`;

    const hiddenCount = Object.keys(board.items).filter(id => card(id).hidden).length;
    const chips = [`<button class="chip" data-course="" aria-pressed="${!board.course}">All classes</button>`,
      ...courseCodes().map(code => `<button class="chip ${courseClass(code)}" data-course="${escape(code)}"`
        + ` aria-pressed="${board.course === code}" title="${escape(courseName(code))}">`
        + `<span class="dot"></span>${escape(code)}</button>`)].join('');
    return `
      <div class="row">
        ${views}
        <span class="hint">${Object.keys(board.items).length} items saved. Open each page of the list once so the board sees them all.</span>
        <button class="ghost" data-action="reset">${icon('undo')}Reset to defaults</button>
      </div>
      <div class="row">
        <span class="label">Group by</span>
        ${segmented('Group by', GROUPS, key => board.groupBy === key, 'group')}
        <span class="divider" aria-hidden="true"></span>
        <div class="chips">${chips}</div>
        <button class="ghost" data-action="show-hidden" aria-pressed="${board.showHidden}">
          ${icon(board.showHidden ? 'visibility-show' : 'visibility-hide')}Show hidden (${hiddenCount})</button>
      </div>`;
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
    return [...new Set(items.map(item => courseCode(item.course)))].sort().map(code => ({
      title: code,
      subtitle: courseName(code),
      course: code,
      items: items.filter(item => courseCode(item.course) === code),
    }));
  }

  function byDoneThenDue(a, b) {
    const done = item => card(item.id).status === 'done' ? 1 : 0;
    return done(a) - done(b) || (a.due || '9999').localeCompare(b.due || '9999');
  }

  function column({ status, title, subtitle, course, items }) {
    const empty = status ? 'Drop cards here' : 'Nothing due';
    return `<section class="column ${course ? courseClass(course) : ''}" ${status ? `data-status="${status}"` : ''}>
      <header class="column-head">
        <h3>${course ? '<span class="dot"></span>' : ''}${escape(title)}</h3>
        <span class="count">${items.length}</span>
      </header>
      ${subtitle ? `<p class="column-sub">${escape(subtitle)}</p>` : ''}
      <div class="cards">${items.map(cardHtml).join('') || `<p class="empty">${empty}</p>`}</div>
    </section>`;
  }

  function cardHtml(item) {
    const { status, note, hidden } = card(item.id);
    const days = daysUntil(item.due);
    const isSettled = days === null || status === 'done';
    const urgency = isSettled ? '' : days < 0 ? 'late' : days === 0 ? 'today' : days <= 2 ? 'soon' : '';
    const code = courseCode(item.course);
    const isDraggable = board.groupBy === 'status';
    const hideLabel = hidden ? 'Unhide' : 'Hide';
    const pill = board.groupBy === 'class' ? ''
      : `<span class="pill" title="${escape(item.course)}"><span class="dot"></span>${escape(code)}</span>`;
    const title = item.href ? `<a href="${escape(item.href)}">${escape(item.title)}</a>` : escape(item.title);
    const options = Object.entries(STATUSES)
      .map(([key, label]) => `<option value="${key}" ${key === status ? 'selected' : ''}>${label}</option>`).join('');
    return `<article class="card ${courseClass(code)} ${status} ${hidden ? 'is-hidden' : ''}" data-id="${escape(item.id)}"
        draggable="${isDraggable}">
      <div class="card-top">
        ${pill}
        <span class="badge ${urgency}">${dueBadge(days)}</span>
        ${isDraggable ? `<span class="grip">${icon('dragger')}</span>` : ''}
      </div>
      <h4 class="title"><span class="type" title="${escape(item.type)}">${icon(TYPE_ICONS[item.type] || 'assignments')}</span>${title}</h4>
      <p class="due">${icon('calendar')}${formatDue(item.due)}</p>
      <textarea class="note" data-action="note" rows="1" placeholder="Add a note" aria-label="Note">${escape(note)}</textarea>
      <div class="card-actions">
        <select data-action="status" aria-label="Status">${options}</select>
        <button class="icon-button" data-action="hide" aria-label="${hideLabel}" title="${hideLabel}">
          ${icon(hidden ? 'visibility-show' : 'visibility-hide')}</button>
      </div>
    </article>`;
  }

  function escape(text) {
    return String(text).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
  }

  // Colors are Brightspace's --d2l-color-* tokens, with their published values as fallbacks.
  // Depth borrows Laravel Cloud's ring-plus-soft-shadow (rest/hover) and 5-layer falloff (dragging).
  const CSS = `
    :host {
      all: initial; display: block; margin: 8px 0 32px;
      font-family: inherit; font-size: 14px; line-height: 1.45; color: var(--ferrite);
      --ferrite: var(--d2l-color-ferrite, #202122);
      --tungsten: var(--d2l-color-tungsten, #494c4e);
      --galena: var(--d2l-color-galena, #6e7477);
      --chromite: var(--d2l-color-chromite, #90989d);
      --mica: var(--d2l-color-mica, #cdd5dc);
      --gypsum: var(--d2l-color-gypsum, #e3e9f1);
      --sylvite: var(--d2l-color-sylvite, #f1f5fb);
      --regolith: var(--d2l-color-regolith, #f9fbff);
      --white: var(--d2l-color-white, #fff);
      --celestine: var(--d2l-color-celestine, #006fbf);
      --celestine-dark: var(--d2l-color-celestine-minus-1, #004489);
      --celestine-tint: var(--d2l-color-celestine-plus-2, #e8f8ff);
      --ring: rgb(0 111 191 / 0.14);
      --ring-strong: rgb(0 111 191 / 0.55);
      --ease: cubic-bezier(0.4, 0, 0.2, 1);
      --shadow-rest: 0 0 0 1px rgb(32 33 34 / 0.06), 0 1px 2px rgb(0 0 0 / 0.06), 0 1px 3px rgb(0 0 0 / 0.06);
      --shadow-hover: 0 0 0 3px var(--ring), 0 0 0 1px var(--ring-strong), 0 1px 3px rgb(0 0 0 / 0.1), 0 1px 2px rgb(0 0 0 / 0.06);
      --shadow-lifted: 0 56px 16px transparent, 0 36px 14px rgb(0 0 0 / 0.02), 0 20px 12px rgb(0 0 0 / 0.08),
        0 9px 9px rgb(0 0 0 / 0.13), 0 2px 5px rgb(0 0 0 / 0.15);
    }
    .course-0 { --hue: var(--d2l-color-celestine, #006fbf); --ink: var(--d2l-color-celestine-minus-1, #004489); --tint: var(--d2l-color-celestine-plus-2, #e8f8ff); }
    .course-1 { --hue: var(--d2l-color-olivine, #46a661); --ink: var(--d2l-color-olivine-minus-1, #027a21); --tint: var(--d2l-color-olivine-plus-1, #e7ffe3); }
    .course-2 { --hue: var(--d2l-color-fluorite, #9d1fd4); --ink: var(--d2l-color-fluorite-minus-1, #6900a0); --tint: var(--d2l-color-fluorite-plus-2, #f9ebff); }
    .course-3 { --hue: var(--d2l-color-carnelian, #e87511); --ink: var(--d2l-color-carnelian-minus-1, #ba4700); --tint: var(--d2l-color-carnelian-plus-1, #fff3e0); }
    .course-4 { --hue: var(--d2l-color-zircon, #008eab); --ink: var(--d2l-color-zircon-minus-1, #035670); --tint: var(--d2l-color-zircon-plus-2, #e0feff); }
    .course-5 { --hue: var(--d2l-color-tourmaline, #d40067); --ink: var(--d2l-color-tourmaline-minus-1, #990056); --tint: var(--d2l-color-tourmaline-plus-2, #ffebf6); }
    .course-6 { --hue: var(--d2l-color-amethyst, #6038ff); --ink: var(--d2l-color-amethyst-minus-1, #4500db); --tint: var(--d2l-color-amethyst-plus-2, #f2f0ff); }
    .course-7 { --hue: var(--d2l-color-citrine-minus-1, #c47400); --ink: var(--d2l-color-citrine-minus-2, #7a4300); --tint: var(--d2l-color-citrine-plus-1, #fff9d6); }

    *, *::before, *::after { box-sizing: border-box; }
    button, select, textarea { font: inherit; color: inherit; }
    :focus-visible { outline: 2px solid var(--celestine); outline-offset: 2px; }
    .icon { width: 16px; height: 16px; flex: none; }
    .dot { width: 8px; height: 8px; flex: none; border-radius: 50%; background: var(--hue, var(--chromite)); }

    .bar { display: grid; gap: 14px; margin-bottom: 24px; }
    .row { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 16px; }
    .hint { flex: 1; min-width: 240px; color: var(--galena); font-size: 13px; }
    .label { color: var(--galena); font-size: 12px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
    .divider { width: 1px; height: 24px; background: var(--gypsum); }

    .segmented { display: inline-flex; gap: 2px; padding: 3px; border-radius: 10px; background: var(--sylvite);
      box-shadow: inset 0 0 0 1px var(--gypsum); }
    .segmented button { padding: 6px 14px; border: 0; border-radius: 7px; background: transparent; color: var(--tungsten);
      font-weight: 700; cursor: pointer;
      transition: background-color 150ms var(--ease), box-shadow 150ms var(--ease), color 150ms var(--ease); }
    .segmented button:hover { color: var(--ferrite); }
    .segmented button[aria-pressed="true"] { background: var(--white); color: var(--celestine-dark); box-shadow: var(--shadow-rest); }

    .chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .chip { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border: 0; border-radius: 999px;
      background: var(--tint, var(--white)); color: var(--ink, var(--tungsten)); font-size: 13px; font-weight: 700; cursor: pointer;
      box-shadow: inset 0 0 0 1px var(--gypsum); transition: box-shadow 150ms var(--ease), background-color 150ms var(--ease); }
    .chip:hover { box-shadow: inset 0 0 0 1px var(--hue, var(--mica)); }
    .chip[aria-pressed="true"] { background: var(--hue, var(--ferrite)); color: var(--white); box-shadow: 0 0 0 3px var(--tint, var(--gypsum)); }
    .chip[aria-pressed="true"] .dot { background: var(--white); }

    .ghost { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border: 0; border-radius: 8px;
      background: transparent; color: var(--tungsten); font-size: 13px; font-weight: 700; cursor: pointer;
      transition: background-color 150ms var(--ease), color 150ms var(--ease); }
    .ghost:hover, .ghost[aria-pressed="true"] { background: var(--sylvite); color: var(--ferrite); }

    .board { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; align-items: start; }
    .column { padding: 16px 12px 12px; border-radius: 14px; background: var(--regolith);
      box-shadow: inset 0 0 0 1px var(--gypsum); transition: background-color 150ms var(--ease), box-shadow 150ms var(--ease); }
    .column.over { background: var(--celestine-tint); box-shadow: inset 0 0 0 2px var(--ring-strong); }
    .column-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 4px; }
    .column h3 { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 15px; font-weight: 700; letter-spacing: -0.01em; }
    .column-sub { margin: 4px 4px 0; color: var(--galena); font-size: 12px; }
    .count { min-width: 24px; padding: 1px 8px; border-radius: 999px; background: var(--white); color: var(--tungsten);
      font-size: 12px; font-weight: 700; text-align: center; box-shadow: inset 0 0 0 1px var(--gypsum); }
    .cards { display: grid; gap: 10px; margin-top: 14px; }
    .empty { margin: 0; padding: 20px 8px; border: 1px dashed var(--mica); border-radius: 10px; color: var(--galena);
      font-size: 13px; text-align: center; }

    .card { display: grid; gap: 8px; padding: 12px 14px; border-radius: 10px; background: var(--white); box-shadow: var(--shadow-rest);
      transition: box-shadow 150ms var(--ease), transform 150ms var(--ease), opacity 150ms var(--ease); }
    .card:hover { box-shadow: var(--shadow-hover); }
    .card[draggable="true"] { cursor: grab; }
    .card[draggable="true"]:hover { transform: translateY(-1px); }
    .card.dragging { box-shadow: var(--shadow-lifted); opacity: 0.85; }
    .card.done { background: var(--regolith); }
    .card.done .title, .card.done .due { color: var(--galena); }
    .card.done .title a { color: inherit; text-decoration: line-through; }
    .card.is-hidden { opacity: 0.5; box-shadow: inset 0 0 0 1px var(--mica); }

    .card-top { display: flex; align-items: center; gap: 8px; min-height: 22px; }
    .pill { display: inline-flex; align-items: center; gap: 6px; padding: 2px 9px 2px 7px; border-radius: 999px;
      background: var(--tint); color: var(--ink); font-size: 12px; font-weight: 700; }
    .badge { margin-left: auto; padding: 2px 8px; border-radius: 6px; background: var(--sylvite); color: var(--tungsten);
      font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .badge:empty { display: none; }
    .badge.late { background: var(--d2l-color-cinnabar, #cd2026); color: var(--white); }
    .badge.today { background: var(--d2l-color-carnelian-plus-1, #fff3e0); color: var(--d2l-color-carnelian-minus-1, #ba4700); }
    .badge.soon { background: var(--d2l-color-citrine-plus-1, #fff9d6); color: var(--d2l-color-citrine-minus-2, #7a4300); }
    .grip { display: flex; color: var(--chromite); }
    .badge:empty + .grip { margin-left: auto; }

    .title { display: flex; gap: 8px; margin: 0; font-size: 14px; font-weight: 700; line-height: 1.35; }
    .title a { color: var(--ferrite); text-decoration: none; }
    .title a:hover { color: var(--celestine); text-decoration: underline; text-underline-offset: 2px; }
    .type { display: flex; padding-top: 1px; color: var(--galena); }
    .due { display: flex; align-items: center; gap: 6px; margin: 0; color: var(--galena); font-size: 13px; }
    .due .icon { width: 14px; height: 14px; }

    .note { width: 100%; min-height: 32px; max-height: 140px; padding: 6px 8px; field-sizing: content; resize: none;
      border: 0; border-radius: 8px; background: var(--regolith); box-shadow: inset 0 0 0 1px var(--gypsum);
      font-size: 13px; line-height: 1.4; transition: box-shadow 150ms var(--ease), background-color 150ms var(--ease); }
    .note::placeholder { color: var(--chromite); }
    .note:focus { outline: 0; background: var(--white); box-shadow: 0 0 0 3px var(--ring), inset 0 0 0 1px var(--ring-strong); }

    .card-actions { display: flex; align-items: center; gap: 8px; }
    .card-actions select { flex: 1; min-width: 0; padding: 5px 8px; border: 0; border-radius: 8px; background: var(--white);
      box-shadow: inset 0 0 0 1px var(--mica); font-size: 13px; cursor: pointer; }
    .icon-button { display: flex; padding: 6px; border: 0; border-radius: 8px; background: transparent; color: var(--galena);
      cursor: pointer; transition: background-color 150ms var(--ease), color 150ms var(--ease); }
    .icon-button:hover { background: var(--sylvite); color: var(--ferrite); }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { transition: none !important; }
      .card[draggable="true"]:hover { transform: none; }
    }
  `;
})();
