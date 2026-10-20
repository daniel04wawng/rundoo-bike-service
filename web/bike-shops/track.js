// Landing-page usage events, sent to the same server (/api/track).
// No cookies; a random id per browser tab groups one visit's events.
let sid = '';
try {
  sid = sessionStorage.getItem('rb_sid') || Math.random().toString(36).slice(2, 12);
  sessionStorage.setItem('rb_sid', sid);
} catch {
  sid = Math.random().toString(36).slice(2, 12);
}

export function track(type, props = {}) {
  const body = JSON.stringify({ type, sid, page: location.pathname, props });
  try {
    if (navigator.sendBeacon?.(`/api/track`, new Blob([body], { type: 'text/plain' }))) return;
  } catch {}
  fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body, keepalive: true }).catch(() => {});
}

const label = (el) => (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
const where = (el) => el.closest('section[id], header, footer')?.id || el.closest('header, footer')?.tagName.toLowerCase() || el.closest('section')?.getAttribute('aria-labelledby') || 'page';

export function startTracking() {
  const q = new URLSearchParams(location.search);
  let referrer = '';
  try { referrer = document.referrer ? new URL(document.referrer).hostname : ''; } catch {}
  track('page_view', { referrer: referrer || undefined, utm_source: q.get('utm_source') || undefined, utm_campaign: q.get('utm_campaign') || undefined });

  // Clicks: CTAs, step tabs, source links.
  document.addEventListener('click', (e) => {
    const el = e.target.closest('a, button');
    if (!el) return;
    if (el.getAttribute('role') === 'tab') return track('step_tab', { step: el.querySelector('.step-title')?.textContent });
    if (el.classList.contains('ref')) return track('source_click', { label: el.getAttribute('aria-label')?.replace('Source: ', '') });
    if (el.closest('.faq')) return;
    track('cta_click', { cta: label(el), where: where(el) });
  }, true);

  // FAQ opens (toggle doesn't bubble, so listen in capture).
  document.addEventListener('toggle', (e) => {
    if (e.target.matches?.('.faq details') && e.target.open) track('faq_open', { question: e.target.querySelector('summary')?.textContent });
  }, true);

  // Video: plays and how far people watch.
  const marks = new Set();
  document.addEventListener('play', (e) => {
    if (e.target.tagName === 'VIDEO') track('video_play', { at: Math.round(e.target.currentTime) });
  }, true);
  document.addEventListener('timeupdate', (e) => {
    const v = e.target;
    if (v.tagName !== 'VIDEO' || !v.duration) return;
    for (const p of [25, 50, 75, 100]) {
      if (!marks.has(p) && v.currentTime / v.duration >= (p === 100 ? 0.97 : p / 100)) {
        marks.add(p);
        track('video_progress', { percent: p });
      }
    }
  }, true);

  // Sections scrolled into view, once each.
  if ('IntersectionObserver' in window) {
    const seen = new Set();
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        const name = en.target.id || en.target.getAttribute('aria-labelledby');
        if (en.isIntersecting && name && !seen.has(name)) {
          seen.add(name);
          track('section_view', { section: name });
          io.unobserve(en.target);
        }
      }
    }, { threshold: 0.35 });
    document.querySelectorAll('main section').forEach((s) => io.observe(s));
  }
}
