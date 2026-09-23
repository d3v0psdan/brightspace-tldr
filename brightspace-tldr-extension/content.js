// Descriptions live 5+ shadow roots deep, so normal CSS can't reach them.
const SEL = 'd2l-activity-description-assignment, d2l-activity-description-quiz';
const LINES = 2;

function clamp(el) {
  if (el.dataset.tldr) return;
  el.dataset.tldr = '1';
  Object.assign(el.style, {
    display: '-webkit-box',
    webkitBoxOrient: 'vertical',
    webkitLineClamp: LINES,
    overflow: 'hidden'
  });

  const btn = document.createElement('button');
  btn.slot = 'supporting-info';
  btn.textContent = 'Show more';
  btn.style.cssText = 'margin-top:4px;font-size:12px;cursor:pointer;border:2px solid #3B82F6;color:#3B82F6;background:none;border-radius:4px;padding:2px 8px;';
  btn.onclick = e => {
    e.preventDefault(); // it's inside the assignment <a>, don't navigate
    e.stopPropagation();
    const open = el.style.webkitLineClamp === 'unset';
    el.style.webkitLineClamp = open ? LINES : 'unset';
    btn.textContent = open ? 'Show more' : 'Show less';
  };
  el.after(btn);
}

function walk(root) {
  root.querySelectorAll('*').forEach(el => {
    if (el.matches(SEL)) clamp(el);
    if (el.shadowRoot) walk(el.shadowRoot);
  });
}

// ponytail: polling because MutationObserver can't see inside shadow roots.
// Swap for per-root observers if it ever feels sluggish.
setInterval(() => walk(document), 1000);
