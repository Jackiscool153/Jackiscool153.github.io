(() => {
  const games = window.JAXCADE_GAMES || [];
  const grid = document.getElementById('grid'), q = document.getElementById('q'), chips = document.getElementById('chips');
  const empty = document.getElementById('empty');
  let tag = 'All';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tags = ['All', ...new Set(games.flatMap((g) => g.tags))];
  chips.innerHTML = tags.map((t) => `<button class="chip${t === 'All' ? ' on' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`).join('');
  chips.addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return; tag = b.dataset.tag;
    chips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === b)); render();
  });
  grid.innerHTML = games.map((g) => `
    <a class="card" href="${esc(g.url)}" data-id="${esc(g.id)}" style="--accent:${esc(g.color)}">
      <div class="thumb"><img src="${esc(g.thumb)}" alt="${esc(g.title)} screenshot" loading="lazy">
        ${g.badge ? `<span class="badge">${esc(g.badge)}</span>` : ''}<span class="play">▶ Play</span></div>
      <div class="info"><h2>${esc(g.title)}</h2><p>${esc(g.blurb)}</p>
        <div class="tags">${g.tags.map((t) => `<span>${esc(t)}</span>`).join('')}</div></div>
    </a>`).join('');
  document.getElementById('count').textContent = `${games.length} game${games.length === 1 ? '' : 's'}`;
  function render() {
    const term = q.value.trim().toLowerCase(); let shown = 0;
    grid.querySelectorAll('.card').forEach((el) => {
      const g = games.find((x) => x.id === el.dataset.id);
      const hay = (g.title + ' ' + g.blurb + ' ' + g.tags.join(' ')).toLowerCase();
      const ok = (!term || hay.includes(term)) && (tag === 'All' || g.tags.includes(tag));
      el.classList.toggle('hidden', !ok); if (ok) shown++;
    });
    empty.classList.toggle('hidden', shown > 0); document.getElementById('emptyq').textContent = q.value;
  }
  q.addEventListener('input', render);
  addEventListener('keydown', (e) => { if (e.key === '/' && document.activeElement !== q) { e.preventDefault(); q.focus(); } });
  const init = new URLSearchParams(location.search).get('q'); if (init) { q.value = init; render(); }
})();
