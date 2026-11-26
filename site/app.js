(() => {
  const menu = document.querySelector('.menu');
  const nav = document.getElementById('nav');
  if (menu && nav) {
    menu.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      menu.setAttribute('aria-expanded', String(open));
    });
    nav.addEventListener('click', (e) => {
      if (e.target instanceof HTMLAnchorElement) {
        nav.classList.remove('open');
        menu.setAttribute('aria-expanded', 'false');
      }
    });
  }

  for (const button of document.querySelectorAll('[data-copy]')) {
    button.addEventListener('click', async () => {
      const text = button.getAttribute('data-copy') || '';
      try {
        await navigator.clipboard.writeText(text);
        const old = button.textContent;
        button.textContent = 'copied';
        setTimeout(() => { button.textContent = old; }, 1600);
      } catch {
        button.textContent = 'select & copy';
      }
    });
  }

  const toc = document.querySelector('.toc');
  const doc = document.querySelector('.doc');
  if (toc && doc && !doc.querySelector('.toc-mobile')) {
    const details = document.createElement('details');
    details.className = 'toc-mobile';
    const summary = document.createElement('summary');
    summary.textContent = 'On this page';
    const links = document.createElement('div');
    links.className = 'toc-mobile-links';
    for (const item of toc.querySelectorAll('a[href^="#"]:not(.sub)')) {
      const a = document.createElement('a');
      a.href = item.getAttribute('href');
      a.textContent = item.textContent;
      links.append(a);
    }
    details.append(summary, links);
    doc.prepend(details);
  }

  const tocLinks = [...document.querySelectorAll('.toc a[href^="#"]')];
  if (tocLinks.length) {
    const byId = new Map(tocLinks.map((a) => [decodeURIComponent(a.hash.slice(1)), a]));
    const targets = [...byId.keys()].map((id) => document.getElementById(id)).filter(Boolean);
    let current = null;
    const setActive = (id) => {
      if (id === current) return;
      current = id;
      for (const a of tocLinks) a.classList.remove('active');
      const a = byId.get(id);
      if (a) a.classList.add('active');
    };
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActive(visible[0].target.id);
    }, { rootMargin: '-90px 0px -68% 0px', threshold: 0 });
    for (const target of targets) observer.observe(target);
  }
})();
