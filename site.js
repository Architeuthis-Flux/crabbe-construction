// Photo viewer: tap a photo to see it large. Arrow keys or the buttons move between photos;
// Esc, the close button or a tap outside the photo closes it. Without JS the links just open the photo.
const shots = [...document.querySelectorAll('a.zoom')];
if (shots.length && window.HTMLDialogElement) {
  const box = document.createElement('dialog');
  box.className = 'lightbox';
  box.innerHTML = '<img alt="">'
    + '<button type="button" data-act="close" aria-label="Close">&times;</button>'
    + (shots.length > 1
      ? '<button type="button" data-act="prev" aria-label="Previous photo">&lsaquo;</button>'
        + '<button type="button" data-act="next" aria-label="Next photo">&rsaquo;</button>'
      : '');
  document.body.append(box);
  const img = box.querySelector('img');
  let at = 0;
  const show = (n) => {
    at = (n + shots.length) % shots.length;
    img.src = shots[at].href;
    img.alt = shots[at].querySelector('img').alt;
  };
  shots.forEach((a, n) => a.addEventListener('click', (e) => { e.preventDefault(); show(n); box.showModal(); }));
  box.addEventListener('click', (e) => {
    const act = e.target.dataset.act;
    if (act === 'prev') show(at - 1);
    else if (act === 'next') show(at + 1);
    else if (e.target !== img) box.close();
  });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') show(at - 1);
    if (e.key === 'ArrowRight') show(at + 1);
  });
}

// Motion on the home page. Skipped entirely for people who ask their device for less motion;
// without JS the page is simply still, with the first photo showing.
const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Hero slideshow: fades to the next photo every few seconds; arrows and dots to move by hand.
const hero = document.querySelector('.hero');
const slides = hero ? [...hero.querySelectorAll('img.slide')] : [];
if (slides.length > 1) {
  const nav = document.createElement('div');
  nav.className = 'hero-nav';
  nav.innerHTML = '<button type="button" data-go="-1" aria-label="Previous photo">&lsaquo;</button>'
    + slides.map((_, n) => `<button type="button" class="dot" data-to="${n}" aria-label="Photo ${n + 1} of ${slides.length}"></button>`).join('')
    + '<button type="button" data-go="1" aria-label="Next photo">&rsaquo;</button>';
  hero.append(nav);
  const dots = [...nav.querySelectorAll('.dot')];
  let on = 0;
  let timer = 0;
  const go = (n) => {
    on = (n + slides.length) % slides.length;
    slides.forEach((img, i) => img.classList.toggle('on', i === on));
    dots.forEach((d, i) => (i === on ? d.setAttribute('aria-current', 'true') : d.removeAttribute('aria-current')));
  };
  const play = () => {
    clearInterval(timer);
    if (!calm && !document.hidden) timer = setInterval(() => go(on + 1), 5000);
  };
  nav.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    go(b.dataset.to !== undefined ? Number(b.dataset.to) : on + Number(b.dataset.go));
    play();                                             // a hand move restarts the clock
  });
  document.addEventListener('visibilitychange', play);
  go(0);
  play();
}

if (!calm) {
  // Fade in: only blocks that start below the screen, so nothing already in view ever blinks.
  if ('IntersectionObserver' in window) {
    const seen = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); seen.unobserve(e.target); }
    }, { rootMargin: '0px 0px -10% 0px' });
    const blocks = '.intro-box, .clients-text, .point, .approach .wrap > *, .title, .service, .philosophy, .portrait, .experience, .section-head, .card, .more, .area .wrap > *, .contact .wrap > *, .gallery > a';
    for (const el of document.querySelectorAll(blocks)) {
      if (el.getBoundingClientRect().top > innerHeight) { el.classList.add('reveal'); seen.observe(el); }
    }
  }

  // Parallax: the big "Services" word slides sideways as it passes. (The photos behind the hero and
  // Services stay still while the page moves over them; that is done in site.css, not here.)
  const ghost = document.querySelector('.ghost');
  if (ghost) {
    let queued = false;
    const drift = () => {
      queued = false;
      const r = ghost.getBoundingClientRect();
      if (r.bottom > 0 && r.top < innerHeight) ghost.style.setProperty('--drift', Math.round((r.top - innerHeight / 2) * 0.12) + 'px');
    };
    addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(drift); } }, { passive: true });
    drift();
  }
}

// Contact form: send the message without leaving the page, and say plainly whether it went.
// Without JS the form posts the ordinary way and the mail service shows its own thank-you page.
const form = document.querySelector('form.form');
if (form) {
  const note = form.querySelector('.form-note');
  const button = form.querySelector('button');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    button.disabled = true;
    note.className = 'form-note';
    note.textContent = 'Sending…';
    try {
      const res = await fetch(form.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.success) throw new Error(out.message || 'not sent');
      form.reset();
      note.textContent = 'Thank you. Your message is on its way, and we will be in touch soon.';
    } catch {
      note.className = 'form-note bad';
      note.textContent = 'Sorry, the message did not go through. Please call us instead.';
    }
    button.disabled = false;
  });
}
