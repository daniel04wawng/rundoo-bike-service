import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { config } from './config.js';
import './landing.css';

const IMG = '/bike-shops';

// ---------- Book a demo: external link when configured, else the on-page form ----------
function BookLink({ className = 'btn primary', children = 'Book a demo' }) {
  if (config.bookingUrl) {
    return <a className={className} href={config.bookingUrl} target="_blank" rel="noopener">{children}</a>;
  }
  const onClick = (e) => {
    e.preventDefault();
    const target = document.getElementById('book');
    target?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    setTimeout(() => document.getElementById('f-name')?.focus({ preventScroll: true }), prefersReducedMotion() ? 0 : 450);
    history.replaceState(null, '', '#book');
  };
  return <a className={className} href="#book" onClick={onClick}>{children}</a>;
}

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function Wordmark({ light }) {
  return (
    <span className={`wordmark ${light ? 'light' : ''}`}>
      <span className="wordmark-mark" aria-hidden="true">R</span>
      <span>Rundoo</span>
    </span>
  );
}

// ---------- Nav ----------
function Nav() {
  return (
    <header className="nav">
      <div className="wrap nav-inner">
        <a href="#top" className="nav-brand" aria-label="Rundoo for Bike Shops, back to top">
          <Wordmark />
          <span className="nav-vertical">Bike Shops</span>
        </a>
        <nav aria-label="Page sections" className="nav-links">
          <a href="#how">How it works</a>
          <a href="#sourcing">Sourcing</a>
          <a href="#compare">Compare</a>
          <a href="#faq">FAQ</a>
        </nav>
        <BookLink className="btn primary sm" />
      </div>
    </header>
  );
}

// ---------- Hero (the walkthrough video lives here) ----------
function embedUrl(url) {
  try {
    const u = new URL(url, window.location.href);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') return `https://www.youtube-nocookie.com/embed/${u.pathname.slice(1)}?cc_load_policy=1&rel=0`;
    if (host.endsWith('youtube.com') && u.searchParams.get('v')) return `https://www.youtube-nocookie.com/embed/${u.searchParams.get('v')}?cc_load_policy=1&rel=0`;
    if (host === 'vimeo.com' && /^\/\d+/.test(u.pathname)) return `https://player.vimeo.com/video${u.pathname}`;
    return u.href;
  } catch {
    return null;
  }
}

const hasVideo = Boolean(config.videoUrl);
const isFileVideo = hasVideo && /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(config.videoUrl);

function Hero() {
  const videoRef = useRef(null);
  const watch = (e) => {
    e.preventDefault();
    const el = document.getElementById('video');
    el?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
    // User-initiated, so playing with sound is fine; no autoplay anywhere.
    if (videoRef.current) videoRef.current.play().catch(() => {});
    else el?.querySelector('iframe')?.focus();
    history.replaceState(null, '', '#video');
  };
  return (
    <section className="hero" id="top">
      <div className="wrap hero-copy">
        <p className="eyebrow">Rundoo for Bike Shops</p>
        <h1>Less time at the screen. More time on the bike.</h1>
        <p className="lede">
          Describe the job. Rundoo’s AI finds parts that fit, checks your stock and suppliers, and builds the work order.
          You make the calls, then get back to building.
        </p>
        <div className="cta-row">
          <BookLink className="btn primary lg" />
          {hasVideo ? (
            <a className="btn ghost lg" href="#video" onClick={watch}>
              <span className="play-glyph" aria-hidden="true" />
              Watch the workflow
            </a>
          ) : (
            <a className="btn ghost lg" href="#how">See how it works</a>
          )}
        </div>
        <p className="fine">Repairs, upgrades and custom builds.</p>
      </div>
      {hasVideo ? <HeroVideo videoRef={videoRef} /> : <HeroStill />}
    </section>
  );
}

function HeroVideo({ videoRef }) {
  return (
    <div className="wrap hero-visual video" id="video">
      <figure className="frame hero-frame">
        {isFileVideo ? (
          <video
            ref={videoRef}
            controls
            playsInline
            preload="metadata"
            poster={config.videoPoster}
            aria-label="Rundoo for Bike Shops walkthrough: one job from request to customer approval"
          >
            <source src={config.videoUrl} />
            {config.captionsUrl && <track kind="captions" src={config.captionsUrl} srcLang="en" label="English" default />}
            Your browser can’t play this video. <a href={config.videoUrl}>Download the walkthrough</a>.
          </video>
        ) : (
          <div className="video-ratio">
            <iframe
              src={embedUrl(config.videoUrl)}
              title="Rundoo for Bike Shops walkthrough"
              allow="fullscreen; picture-in-picture; encrypted-media"
              allowFullScreen
            />
          </div>
        )}
      </figure>
    </div>
  );
}

function HeroStill() {
  return (
    <div className="wrap hero-visual">
      <figure className="frame hero-frame">
        <img
          src={`${IMG}/hero.png`}
          width="2880" height="1260"
          alt="Rundoo work order WO-1042 for Maya Chen's road bike with 105 R7000 2x11. The in-stock Shimano CS-R7000 11-30T cassette is selected, a chain is recommended, and the work order totals $134.39 so far."
        />
      </figure>
      <figure className="hero-phone" aria-label="Customer's phone">
        <img
          src={`${IMG}/phone-approved.png`}
          width="600" height="1250"
          alt="The customer's text message with the itemized $212.78 quote, marked approved."
        />
      </figure>
    </div>
  );
}

// ---------- Why shops choose it ----------
const WHY = [
  ['No more online research', 'Rundoo goes through manufacturer specs, your inventory and your suppliers for you. Parts that fit arrive with a one-line reason and the source behind it.'],
  ['The right part, before you pay for it', 'Every part is checked against what is actually on the bike before your shop orders it. Fewer surprises at the bench.'],
  ['Approvals without the phone tag', 'Customers get an itemized quote by text and approve with one tap. It lands on the work order, so you never chase it.'],
  ['You stay in control', 'Rundoo does the prep work. You approve every part and every price before anything reaches a customer, at your labor rates.'],
];

function Why() {
  return (
    <section className="section why" aria-labelledby="why-h">
      <div className="wrap why-inner">
        <div className="section-head">
          <p className="eyebrow">Why bike shops choose Rundoo</p>
          <h2 id="why-h">You got into this to build bikes.</h2>
          <p className="sub">Not to dig through spec sheets, stock counts and supplier sites. Rundoo’s AI does that part, so the hours go back to the stand.</p>
        </div>
        <dl className="why-list">
          {WHY.map(([k, v], i) => (
            <div key={k}>
              <dt><span className="why-n">{String(i + 1).padStart(2, '0')}</span>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

// ---------- Four steps ----------
const STEPS = [
  {
    n: '01',
    title: 'Describe the job',
    body: 'Enter the bike, its current components, and the repair, upgrade or custom build the customer wants.',
    note: 'The bike record fills in what is already on file.',
    img: 'step-describe.png', w: 2505, h: 620, shape: 'wide',
    alt: 'Describe job step. The request reads: Customer wants easier climbing gears for a hilly tour in 3 weeks. Budget around $250. Components on file for the bike are listed below.',
  },
  {
    n: '02',
    title: 'Find the right fit',
    body: 'Review compatible components with a short reason and alternatives. Confirm essential details only when needed.',
    note: 'Use this, Other options or Check further. You decide.',
    img: 'step-fit.png', w: 1760, h: 1050, shape: 'wide',
    alt: 'Recommended parts checked against manufacturer specs: Shimano CS-HG800-11 11-34T cassette, RD-R7000-GS rear derailleur needed for the new cassette, and a 1.85 mm cassette spacer. Each has Use this, Check further and Why it fits.',
  },
  {
    n: '03',
    title: 'Source the parts',
    body: 'Rundoo checks your shelf and your suppliers for the exact size and variant, with price and arrival. No catalog hunting.',
    note: 'Filter by lower cost, sooner, shop stock or other brand.',
    img: 'step-source.png', w: 1660, h: 868, shape: 'wide',
    alt: 'Other options for the cassette: Shimano CS-R7000 11-30T in stock with 2 available, which works with the current derailleur; and CS-R7000 11-32T, order from Coastal Bike Supply in 3 business days.',
  },
  {
    n: '04',
    title: 'Send the estimate',
    body: 'Parts and labor become the work order. Text the customer for approval and their answer updates the job.',
    note: 'Declined? Revise and resend as a new version.',
    img: 'phone-sent.png', w: 600, h: 1274, shape: 'tall',
    alt: 'Text message to Maya with the itemized quote: 11-30 cassette, new 11-speed chain, three labor lines, total $212.78, with Decline and Approve buttons.',
  },
];

function Steps() {
  const [active, setActive] = useState(0);
  const tabs = useRef([]);
  const onKey = (e) => {
    const k = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    let next = null;
    if (k) next = (active + k + STEPS.length) % STEPS.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = STEPS.length - 1;
    if (next == null) return;
    e.preventDefault();
    setActive(next);
    tabs.current[next]?.focus();
  };
  const s = STEPS[active];
  return (
    <section className="section" id="how" aria-labelledby="how-h">
      <div className="wrap">
        <div className="section-head">
          <p className="eyebrow">How it works</p>
          <h2 id="how-h">Four steps. One work order.</h2>
          <p className="sub">You make a few short decisions. Rundoo does the prep in between.</p>
        </div>
        <div className="steps">
          <div className="step-list" role="tablist" aria-label="Workflow steps" aria-orientation="vertical" onKeyDown={onKey}>
            {STEPS.map((st, i) => (
              <button
                key={st.n}
                ref={(el) => (tabs.current[i] = el)}
                role="tab"
                id={`step-tab-${i}`}
                aria-selected={active === i}
                aria-controls="step-panel"
                tabIndex={active === i ? 0 : -1}
                className={`step ${active === i ? 'on' : ''}`}
                onClick={() => setActive(i)}
              >
                <span className="step-n">{st.n}</span>
                <span className="step-text">
                  <span className="step-title">{st.title}</span>
                  <span className="step-body">{st.body}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="step-panel" id="step-panel" role="tabpanel" aria-labelledby={`step-tab-${active}`}>
            <figure className={`frame step-frame ${s.shape}`} key={s.img}>
              <img src={`${IMG}/${s.img}`} width={s.w} height={s.h} alt={s.alt} loading="lazy" />
            </figure>
            <p className="step-note"><span className="step-n sm">{s.n}</span>{s.note}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------- Inventory and suppliers ----------
const VARIANTS = [
  {
    name: 'Shimano CS-HG800-11 11-34T',
    gear: 'Lowest gear 34×34',
    fit: { ok: true, text: 'Fits with an RD-R7000-GS derailleur and a 1.85 mm spacer.' },
    stock: { tone: 'none', text: 'None on hand' },
    supply: [['Coastal Bike Supply', '3 business days'], ['Northern Parts Co.', '5 business days']],
  },
  {
    name: 'Shimano CS-R7000 11-32T',
    gear: 'Lowest gear 34×32',
    fit: { ok: true, text: 'Fits with an RD-R7000-GS derailleur. No spacer.' },
    stock: { tone: 'warn', text: '1 on hand, held for another job' },
    supply: [['Coastal Bike Supply', '3 business days']],
  },
  {
    name: 'Shimano CS-R7000 11-30T',
    gear: 'Lowest gear 34×30',
    fit: { ok: true, text: 'Fits the derailleur already on the bike.' },
    stock: { tone: 'ok', text: '2 available' },
    supply: [['Coastal Bike Supply', '3 business days']],
    pick: true,
  },
];

const PLATFORM = [
  ['Point of sale', 'Ring up the approved job at the counter.'],
  ['Inventory', 'Counts on hand and committed to other jobs.'],
  ['Purchasing', 'Vendor catalogs and purchase orders.'],
  ['Customer records', 'The bike, its parts and past work.'],
  ['Payments', 'Take payment when the bike goes home.'],
  ['Dooey', 'Rundoo’s built-in AI, across the store.'],
];

function Sourcing() {
  return (
    <section className="section alt" id="sourcing" aria-labelledby="src-h">
      <div className="wrap">
        <div className="section-head">
          <p className="eyebrow">Inventory and suppliers</p>
          <h2 id="src-h">What fits. What you have. What you can order.</h2>
          <p className="sub">No browser tabs, supplier sites or trips to the back room. Rundoo goes through each source for you and lines up the answers for the exact variant.</p>
        </div>

        <div className="sources" role="list">
          <div className="source" role="listitem">
            <span className="source-k">Fits</span>
            <b>Manufacturer specs</b>
            <p>Published compatibility charts and spec pages, checked against the parts confirmed on the bike.</p>
          </div>
          <div className="source" role="listitem">
            <span className="source-k">You have</span>
            <b>Shop inventory</b>
            <p>What is on your shelf, minus anything already committed to another work order.</p>
          </div>
          <div className="source" role="listitem">
            <span className="source-k">You can order</span>
            <b>Supplier offers</b>
            <p>Price and expected arrival from the distributors you buy from.</p>
          </div>
        </div>

        <div className="matrix" role="table" aria-label="Cassette options for WO-1042, a 105 R7000 2x11 road bike">
          <div className="matrix-row matrix-head" role="row">
            <span role="columnheader">Cassette for easier climbing</span>
            <span role="columnheader">Fits this bike</span>
            <span role="columnheader">In your shop</span>
            <span role="columnheader">From suppliers</span>
          </div>
          {VARIANTS.map((v) => (
            <div className={`matrix-row ${v.pick ? 'pick' : ''}`} role="row" key={v.name}>
              <span role="rowheader" className="m-name">
                <b>{v.name}</b>
                <small>{v.gear}</small>
                {v.pick && <em className="m-badge">Your pick</em>}
              </span>
              <span role="cell" className="m-cell"><i className="m-label">Fits this bike</i><span className="tick" aria-hidden="true">✓</span>{v.fit.text}</span>
              <span role="cell" className={`m-cell stock-${v.stock.tone}`}><i className="m-label">In your shop</i>{v.stock.text}</span>
              <span role="cell" className="m-cell"><i className="m-label">From suppliers</i>
                {v.supply.map(([s, eta]) => <span className="m-supplier" key={s}>{s}<small>{eta}</small></span>)}
              </span>
            </div>
          ))}
        </div>
        <p className="callout">
          <b>Alternatives stay connected.</b> Choose the in-stock 11-30T and Rundoo removes the derailleur and spacer the job no longer needs.
        </p>

        <div className="partners">
          <div>
            <h3>Your distributors, connected.</h3>
            <p>Rundoo purchasing already works with vendor catalogs and purchase orders. Bike distributor connections are on the roadmap. Tell us who you buy from and we’ll start there.</p>
          </div>
          <ul className="partner-tags" aria-label="Connection status">
            <li><span className="dot live" aria-hidden="true" />Vendor catalogs and purchase orders <em>Available in Rundoo</em></li>
            <li><span className="dot road" aria-hidden="true" />Bike distributor catalogs and live stock <em>Roadmap</em></li>
            <li><span className="dot road" aria-hidden="true" />Your distributor list <em>Reviewed in your demo</em></li>
          </ul>
        </div>

        <div className="platform">
          <div className="platform-copy">
            <h3>Part of the Rundoo POS.</h3>
            <p>Service runs on the same records as the rest of the store. No second system for the service desk.</p>
          </div>
          <ul className="platform-list">
            {PLATFORM.map(([k, v]) => (
              <li key={k}><b>{k}</b><span>{v}</span></li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

// ---------- Lightspeed comparison ----------
const LS_SOURCES = [
  ['Lightspeed: bike shop POS', 'https://www.lightspeedhq.com/pos/retail/bike-shop/'],
  ['Lightspeed: creating and completing work orders', 'https://retail-support.lightspeedhq.com/hc/en-us/articles/229131428-Creating-and-completing-work-orders'],
  ['Lightspeed: about bicycle integrations', 'https://retail-support.lightspeedhq.com/hc/en-us/articles/228840347-About-bicycle-integrations'],
  ['Lightspeed: creating a special order', 'https://retail-support.lightspeedhq.com/hc/en-us/articles/229130588-Creating-a-special-order'],
  ['Lightspeed AI launch, January 2026', 'https://www.lightspeedhq.com/news/lightspeed-commerce-launches-lightspeed-ai-a-new-ai-powered-intelligence-layer-for-retail-and-hospitality/'],
  ['Lightspeed AI agentic update, October 2026', 'https://www.lightspeedhq.com/news/lightspeed-ai-expands-from-insights-to-action-with-new-agentic-capabilities-for-retail/'],
];
const Ref = ({ n }) => (
  <a className="ref" href={LS_SOURCES[n - 1][1]} target="_blank" rel="noopener" aria-label={`Source: ${LS_SOURCES[n - 1][0]}`}>{n}</a>
);

function Compare() {
  return (
    <section className="section" id="compare" aria-labelledby="cmp-h">
      <div className="wrap">
        <div className="section-head">
          <p className="eyebrow">Compared with Lightspeed</p>
          <h2 id="cmp-h">Less managing. More building.</h2>
          <p className="sub">Lightspeed gives you the tools to run a bike shop. On a custom job, you still do the legwork yourself. Rundoo’s AI does it for you.</p>
        </div>
        <div className="compare">
          <div className="cmp-col">
            <h3>On Lightspeed, you do the steps</h3>
            <ol className="cmp-steps">
              <li>Research which parts fit, from spec sheets and charts.</li>
              <li>Check stock for each part.</li>
              <li>Search distributor catalogs for the exact variant.<Ref n={3} /></li>
              <li>Add each part and labor line to the work order.<Ref n={2} /></li>
              <li>Follow up with the customer for approval.<Ref n={4} /></li>
            </ol>
          </div>
          <div className="cmp-col ours">
            <h3>On Rundoo, describe the job. AI does the rest.</h3>
            <ol className="cmp-steps">
              <li><b>Researches parts that fit this bike,</b> with a reason and the manufacturer source.</li>
              <li><b>Checks your inventory first,</b> minus parts held for other jobs.</li>
              <li><b>Searches your suppliers</b> for the exact variant, price and arrival.</li>
              <li><b>Builds the work order</b> with parts and your labor rates.</li>
              <li><b>Texts the customer</b> and records their answer on the job.</li>
            </ol>
          </div>
        </div>
        <p className="cmp-note">Built specifically for bike shops. Your hours go back to the stand, and you still sign off on every part.</p>
        <div className="cmp-other">
          <p><b>Thinking about switching?</b> In the demo we’ll run a recent custom job from your shop through Rundoo and walk through what moving over would take.</p>
          <BookLink className="btn ghost sm">Book a demo</BookLink>
        </div>
      </div>
    </section>
  );
}

// ---------- Testimonials ----------
const QUOTES = [
  {
    quote: 'Custom builds used to start with a stack of spec sheets. Now I start with a short list that says why each part fits, and I make the call.',
    name: 'Renata Ilić', role: 'Owner and builder', shop: 'Spoke & Spindle', place: 'Custom workshop', mark: 'serif',
  },
  {
    quote: 'Quotes and callbacks used to eat the end of every day. Now the estimate goes out from the stand and approvals come back on their own.',
    name: 'Marcus Bell', role: 'Owner', shop: 'EASTSIDE WHEELHOUSE', place: 'Neighborhood repair shop', mark: 'caps',
  },
  {
    quote: 'Nothing gets retyped. The part a mechanic picks is the part we check in stock, order and put on the quote.',
    name: 'Dana Okafor', role: 'Service manager', shop: 'northline cycle co.', place: 'Multi-store retailer', mark: 'mono',
  },
];

function Proof() {
  return (
    <section className="section alt" aria-labelledby="proof-h">
      <div className="wrap">
        <div className="section-head">
          <p className="eyebrow">Customer stories</p>
          <h2 id="proof-h">What bike shops are saying.</h2>
        </div>
        <div className="quotes">
          {QUOTES.map((q, i) => (
            <figure className={`quote ${i === 0 ? 'lead' : ''}`} key={q.name}>
              <span className={`shopmark ${q.mark}`}>{q.shop}</span>
              <blockquote>“{q.quote}”</blockquote>
              <figcaption>
                <span className="avatar" aria-hidden="true">{q.name.split(' ').map((p) => p[0]).join('')}</span>
                <span><b>{q.name}</b><small>{q.role}, {q.place.toLowerCase()}</small></span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------- FAQ ----------
const FAQ = [
  ['Is this for everyday repairs or custom builds?',
    'Both. Use it for a brake pad swap, a drivetrain upgrade or a full custom build. It saves the most work on jobs where fit depends on several components.'],
  ['Who confirms that a component fits?',
    'You do. Rundoo checks manufacturer specs and shows the reason and sources, but nothing goes on a work order until you choose it.'],
  ['What happens if bike information is missing?',
    'Rundoo asks you only for the details it needs, such as which derailleur cage is fitted. If fit still can’t be confirmed, it says so instead of guessing, and can draft a question for your supplier.'],
  ['Can I use parts already in my shop?',
    'Yes. Your inventory is checked first and in-stock options are labeled, so you use what is on the shelf before ordering more. Parts held for other jobs are not counted.'],
  ['What happens when a recommended part is unavailable?',
    'You see supplier options with price and arrival, plus compatible alternatives by lower cost, sooner, shop stock or other brand. Related parts update automatically.'],
  ['How does the customer approve the estimate?',
    'Your customer gets a text with the itemized estimate and taps Approve or Decline. The answer lands on the work order, so you never have to chase it. A declined estimate can be revised and resent.'],
  ['What would switching from another POS involve?',
    'Service runs inside the Rundoo POS, so switching means moving your store, not just the service desk. In a demo we’ll look at your current setup and what moving your products, customers and open jobs would involve.'],
];

function Faq() {
  return (
    <section className="section" id="faq" aria-labelledby="faq-h">
      <div className="wrap faq-wrap">
        <div className="section-head">
          <p className="eyebrow">FAQ</p>
          <h2 id="faq-h">Questions from shop owners.</h2>
        </div>
        <div className="faq">
          {FAQ.map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------- Final CTA + local request form ----------
function DemoRequest() {
  const [sent, setSent] = useState(null);
  const [errors, setErrors] = useState({});
  const doneRef = useRef(null);
  useEffect(() => { if (sent) doneRef.current?.focus(); }, [sent]);

  const submit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    const errs = {};
    if (!f.name.trim()) errs.name = 'Add your name.';
    if (!f.shop.trim()) errs.shop = 'Add your shop name.';
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) errs.email = 'Add a valid email.';
    setErrors(errs);
    if (Object.keys(errs).length) {
      document.getElementById(`f-${Object.keys(errs)[0]}`)?.focus();
      return;
    }
    // Local only: nothing is sent or stored.
    setSent({ first: f.name.trim().split(/\s+/)[0], shop: f.shop.trim(), email: f.email.trim() });
  };

  if (sent) {
    return (
      <div className="request done" ref={doneRef} tabIndex={-1} role="status">
        <span className="done-check" aria-hidden="true">✓</span>
        <h3>Thanks, {sent.first}.</h3>
        <p>We have your request for {sent.shop}. Nothing is scheduled yet. We’ll reply to {sent.email} to find a time that works.</p>
        <button className="link" onClick={() => setSent(null)}>Edit request</button>
      </div>
    );
  }
  const field = (id, label, props = {}) => (
    <label className="field" htmlFor={`f-${id}`}>
      <span>{label}</span>
      <input id={`f-${id}`} name={id} aria-invalid={!!errors[id]} aria-describedby={errors[id] ? `e-${id}` : undefined} {...props} />
      {errors[id] && <small className="err" id={`e-${id}`}>{errors[id]}</small>}
    </label>
  );
  return (
    <form className="request" onSubmit={submit} noValidate aria-label="Request a demo">
      {field('name', 'Your name', { autoComplete: 'name', required: true })}
      {field('shop', 'Shop name', { autoComplete: 'organization', required: true })}
      {field('email', 'Email', { type: 'email', autoComplete: 'email', required: true })}
      <label className="field" htmlFor="f-size">
        <span>Shop size</span>
        <select id="f-size" name="size" defaultValue="">
          <option value="" disabled>Choose one</option>
          <option>Just me</option>
          <option>2 to 4 people</option>
          <option>5 or more</option>
        </select>
      </label>
      <label className="field wide" htmlFor="f-pos">
        <span>Current POS <i>(optional)</i></span>
        <input id="f-pos" name="pos" placeholder="Lightspeed, Square, spreadsheet…" />
      </label>
      <button className="btn primary lg wide" type="submit">Request a demo</button>
    </form>
  );
}

function FinalCta() {
  return (
    <section className="final" id="book" aria-labelledby="book-h">
      <div className="wrap final-inner">
        <div className="final-copy">
          <h2 id="book-h">Bring a job from this week.</h2>
          <p>We’ll run it through Rundoo with you and show where your time goes back to the bench.</p>
          <ul className="expect">
            <li>A real repair or build from your shop</li>
            <li>Your suppliers and how they’d connect</li>
            <li>What moving from your current POS involves</li>
          </ul>
          {config.bookingUrl && <BookLink className="btn light lg" />}
        </div>
        {!config.bookingUrl && <DemoRequest />}
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="wrap footer-inner">
        <Wordmark />
        <nav aria-label="Footer">
          <a href="#how">How it works</a>
          {hasVideo && <a href="#video">Walkthrough</a>}
          <a href="#faq">FAQ</a>
          <a href={config.appUrl}>Open the service desk</a>
          <a href="https://rundoo.ai/product/" target="_blank" rel="noopener">Rundoo platform</a>
        </nav>
        <p className="fine">Rundoo for Bike Shops is a product concept. Shops, quotes and suppliers shown are examples.</p>
      </div>
    </footer>
  );
}

function Landing() {
  return (
    <>
      <a className="skip" href="#how">Skip to how it works</a>
      <Nav />
      <main>
        <Hero />
        <Why />
        <Steps />
        <Sourcing />
        <Compare />
        <Proof />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}

createRoot(document.getElementById('root')).render(<Landing />);
