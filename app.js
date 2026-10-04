const SEGMENTS_INDEX_URL = "./segments/segments.json";

const feedEl = document.getElementById("feed");
const topicsEl = document.getElementById("topics");
const segmentsEl = document.getElementById("segments");
const sentinelEl = document.getElementById("sentinel");
const statusEl = document.getElementById("status");
const qEl = document.getElementById("q");
const clearTopicEl = document.getElementById("clearTopic");
const toTopEl = document.getElementById("toTop");
const toggleNavFabEl = document.getElementById("toggleNavFab");
const navEl = document.querySelector(".nav");

let nextId = 1;
let activeTopic = null;
let query = "";
let isAppending = false;
let navOpen = true;

const byId = new Map(); // id -> { cardEl, navEl, data }
const cards = []; // ordered list of ids

let segmentSlugs = null; // loaded from segments/segments.json
let segmentIdx = 0; // progresses once; stops at the end
let metaBySlug = new Map(); // slug -> meta json

let feedComplete = false;

function segmentBasePath(slug) {
  return `./segments/${encodeURIComponent(slug)}`;
}

function metaUrl(slug) {
  return `${segmentBasePath(slug)}/meta.json`;
}

function fileUrl(slug, filename) {
  return `${segmentBasePath(slug)}/${filename}`;
}

function nextSlug() {
  if (!segmentSlugs?.length) return null;
  if (segmentIdx >= segmentSlugs.length) return null;
  const slug = segmentSlugs[segmentIdx];
  segmentIdx += 1;
  return slug;
}

async function loadSegmentsIndex() {
  const res = await fetch(SEGMENTS_INDEX_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load segments index (${res.status})`);
  const json = await res.json();
  if (!json?.segments?.length) throw new Error("Segments index is empty");
  return json.segments;
}

async function loadMeta(slug) {
  const res = await fetch(metaUrl(slug), { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load meta for ${slug} (${res.status})`);
  return await res.json();
}

function normalizeTopics(meta) {
  if (Array.isArray(meta?.topics) && meta.topics.length) return meta.topics.map(String);
  if (typeof meta?.topic === "string" && meta.topic.trim()) return [meta.topic.trim()];
  return ["Unknown"];
}

async function urlExistsNonEmpty(url) {
  try {
    const r = await fetch(url, { method: "HEAD", cache: "no-store" });
    if (!r.ok) return false;
    const len = Number(r.headers.get("content-length") || "0");
    return len > 0;
  } catch {
    return false;
  }
}

function createCard(data) {
  const card = document.createElement("article");
  card.className = "card";
  card.id = `seg-${data.id}`;
  card.dataset.topic = data.topic;
  card.dataset.topics = (data.topics || []).join(",").toLowerCase();
  card.dataset.title = data.title.toLowerCase();
  card.dataset.text = (data.text || "").toLowerCase();

  const inner = document.createElement("div");
  inner.className = "card__inner";

  const title = document.createElement("div");
  title.className = "card__title";
  title.textContent = data.title;

  const text = document.createElement("div");
  text.className = "card__text";
  text.textContent = data.text || "Loading…";

  const actions = document.createElement("div");
  actions.className = "actions";

  const jumpBtn = document.createElement("button");
  jumpBtn.className = "chip";
  jumpBtn.type = "button";
  jumpBtn.textContent = data.topic;
  jumpBtn.setAttribute("aria-pressed", "false");
  jumpBtn.addEventListener("click", () => {
    setActiveTopic(data.topic);
    scrollToSegment(data.id);
  });

  const copyBtn = document.createElement("button");
  copyBtn.className = "chip chip--ghost";
  copyBtn.type = "button";
  copyBtn.textContent = "Copy link";
  copyBtn.addEventListener("click", async () => {
    const url = new URL(window.location.href);
    url.hash = `seg-${data.id}`;
    try {
      await navigator.clipboard.writeText(url.toString());
      setStatus(`Copied #${data.id}`);
    } catch {
      setStatus("Copy failed");
    }
  });

  actions.append(jumpBtn, copyBtn);

  inner.append(title, text);
  card.append(inner);

  if (data.media?.type === "image") {
    const media = document.createElement("div");
    media.className = "card__media";
    const img = document.createElement("img");
    img.loading = "lazy";
    img.decoding = "async";
    img.src = data.media.src;
    img.alt = data.media.alt;
    media.append(img);
    card.append(media);
  } else if (data.media?.type === "video") {
    const media = document.createElement("div");
    media.className = "card__media";
    const v = document.createElement("video");
    v.controls = true;
    v.preload = "metadata";
    v.src = data.media.src;
    v.addEventListener("error", () => {
      const msg = document.createElement("div");
      msg.className = "card__inner";
      msg.innerHTML = `<div class="muted">Video unavailable</div>`;
      media.replaceChildren(msg);
    });
    media.append(v);
    card.append(media);
  }

  const footer = document.createElement("div");
  footer.className = "card__footer";
  footer.append(actions);
  card.append(footer);

  return { card, textEl: text };
}

function createSegmentLink(data) {
  const li = document.createElement("li");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "segLink";
  btn.setAttribute("aria-current", "false");
  btn.innerHTML = `
    <div class="segLink__meta">${escapeHtml(data.topic)}</div>
    <div class="segLink__title">${escapeHtml(data.title)}</div>
  `;
  btn.addEventListener("click", () => {
    scrollToSegment(data.id);
    if (window.matchMedia("(max-width: 960px)").matches) setNavOpen(false);
  });
  li.append(btn);
  return { li, btn };
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#039;";
      default:
        return c;
    }
  });
}

function setStatus(s) {
  statusEl.textContent = s;
}

function setNavOpen(open) {
  navOpen = open;
  navEl.dataset.open = String(open);
  toggleNavFabEl?.setAttribute("aria-expanded", String(open));
}

function scrollToSegment(id) {
  const rec = byId.get(id);
  if (!rec) return;
  rec.cardEl.scrollIntoView({ behavior: "smooth", block: "start" });
  history.replaceState(null, "", `#seg-${id}`);
}

function setActiveTopic(topicOrNull) {
  activeTopic = topicOrNull;
  for (const btn of topicsEl.querySelectorAll("button[data-topic]")) {
    const t = btn.getAttribute("data-topic");
    btn.setAttribute("aria-pressed", String(t === activeTopic));
  }
  applyFilters();
}

function setQuery(q) {
  query = q.trim().toLowerCase();
  applyFilters();
}

function matches(rec) {
  if (activeTopic && !rec.data.topics.includes(activeTopic)) return false;
  if (!query) return true;

  const inTopic = rec.data.topics.join(" ").toLowerCase().includes(query);
  const inTitle = rec.data.title.toLowerCase().includes(query);
  const inText = rec.data.text.toLowerCase().includes(query);
  return inTopic || inTitle || inText;
}

function applyFilters() {
  let visibleCount = 0;
  for (const id of cards) {
    const rec = byId.get(id);
    const ok = matches(rec);
    rec.cardEl.style.display = ok ? "" : "none";
    rec.navEl.style.display = ok ? "" : "none";
    if (ok) visibleCount++;
  }
  const topicLabel = activeTopic ? ` · ${activeTopic}` : "";
  const qLabel = query ? ` · “${query}”` : "";
  setStatus(`${visibleCount} visible${topicLabel}${qLabel}`);
}

function updateEndState() {
  feedComplete = !!segmentSlugs && segmentIdx >= segmentSlugs.length;
  if (feedComplete) setStatus("End of segments");
}

function appendBatch(count = 10) {
  if (isAppending) return;
  if (!segmentSlugs) return;
  if (feedComplete) return 0;
  isAppending = true;
  const fragCards = document.createDocumentFragment();
  const fragNav = document.createDocumentFragment();

  const start = nextId;
  let appended = 0;
  for (let i = 0; i < count; i++) {
    const id = nextId++;
    const slug = nextSlug();
    if (!slug) {
      nextId -= 1;
      break;
    }

    const meta = metaBySlug.get(slug);
    const topics = normalizeTopics(meta);
    const topic = topics[0] || "Unknown";

    const image = meta?.files?.image ? fileUrl(slug, meta.files.image) : null;

    const data = {
      id,
      topic,
      topics,
      title: slug,
      text: "",
      media: {
        type: "image",
        src: image || "",
        alt: "Segment image",
      },
      _slug: slug,
    };

    const { card: cardEl, textEl } = createCard(data);
    const { li: navEl, btn: navBtn } = createSegmentLink(data);

    byId.set(id, { cardEl, navEl, navBtn, data, textEl });
    cards.push(id);

    fragCards.append(cardEl);
    fragNav.append(navEl);
    appended += 1;

    // Load segment text and (optionally) swap to video.
    void hydrateSegment(id).catch(() => {});
  }

  feedEl.append(fragCards);
  segmentsEl.append(fragNav);

  const end = nextId - 1;
  if (appended > 0) setStatus(`Loaded #${start}–#${end}`);

  applyFilters();
  if (appended > 0) observeNewCards(start, end);
  isAppending = false;
  updateEndState();
  return appended;
}

async function hydrateSegment(instanceId) {
  const rec = byId.get(instanceId);
  if (!rec) return;
  const slug = rec.data._slug;
  if (!slug) return;
  const meta = metaBySlug.get(slug);
  if (!meta) return;

  // Text
  try {
    const res = await fetch(fileUrl(slug, meta.files.text), { cache: "no-store" });
    if (res.ok) {
      const t = (await res.text()).trim();
      rec.data.text = t;
      rec.cardEl.dataset.text = t.toLowerCase();
      rec.textEl.textContent = t || rec.textEl.textContent;
    }
  } catch {
    rec.textEl.textContent = "Failed to load segment text.";
  }

  // Media: determined by meta.json (prefer video if present + non-empty).
  try {
    const prefer = meta.render?.prefer || "image";
    const videoPath = meta.files?.video ? fileUrl(slug, meta.files.video) : null;
    const hasVideo = videoPath ? await urlExistsNonEmpty(videoPath) : false;
    if (prefer === "video" && hasVideo) {
      rec.data.media = { type: "video", src: videoPath };
      // Replace existing image media with video.
      const existingMedia = rec.cardEl.querySelector(".card__media");
      if (existingMedia) existingMedia.remove();

      const media = document.createElement("div");
      media.className = "card__media";
      const v = document.createElement("video");
      v.controls = true;
      v.preload = "metadata";
      v.src = videoPath;
      v.addEventListener("error", () => {
        const msg = document.createElement("div");
        msg.className = "card__inner";
        msg.innerHTML = `<div class="muted">Video unavailable</div>`;
        media.replaceChildren(msg);
      });
      media.append(v);
      rec.cardEl.append(media);
    }
  } catch {
    // Ignore — keep image-only.
  }

  applyFilters();
}

let currentId = null;
let cardObserver = null;

function observeNewCards(startId, endId) {
  if (!cardObserver) {
    cardObserver = new IntersectionObserver(
      (entries) => {
        // Prefer the most visible intersecting card.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (!visible.length) return;
        const el = visible[0].target;
        const id = Number(el.id.replace("seg-", ""));
        setCurrent(id);
      },
      { root: null, threshold: [0.2, 0.4, 0.65, 0.85] },
    );
  }

  for (let id = startId; id <= endId; id++) {
    const rec = byId.get(id);
    if (rec) cardObserver.observe(rec.cardEl);
  }
}

function setCurrent(id) {
  if (currentId === id) return;
  const prev = currentId ? byId.get(currentId) : null;
  const next = byId.get(id);
  currentId = id;

  if (prev) prev.navBtn.setAttribute("aria-current", "false");
  if (next) next.navBtn.setAttribute("aria-current", "true");
}

function renderTopicsFromCatalog() {
  topicsEl.replaceChildren();
  const frag = document.createDocumentFragment();
  const allTopics = [];
  for (const m of metaBySlug.values()) allTopics.push(...normalizeTopics(m));
  const unique = Array.from(new Set(allTopics)).sort((a, b) => String(a).localeCompare(String(b)));
  for (const t of unique) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    btn.textContent = t;
    btn.setAttribute("data-topic", t);
    btn.setAttribute("aria-pressed", "false");
    btn.addEventListener("click", () => setActiveTopic(t));
    frag.append(btn);
  }
  topicsEl.append(frag);
}

function wireUi() {
  qEl.addEventListener("input", () => setQuery(qEl.value));
  clearTopicEl.addEventListener("click", () => setActiveTopic(null));
  toTopEl.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

  toggleNavFabEl?.addEventListener("click", () => setNavOpen(!navOpen));

  const mq = window.matchMedia("(max-width: 960px)");
  const applyMq = () => {
    if (mq.matches) setNavOpen(false);
    else setNavOpen(true);
  };
  mq.addEventListener?.("change", applyMq);
  applyMq();

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && window.matchMedia("(max-width: 960px)").matches) {
      setNavOpen(false);
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      qEl.focus();
    }
  });
}

function startInfiniteScroll() {
  const io = new IntersectionObserver(
    (entries) => {
      const entry = entries[0];
      if (!entry.isIntersecting) return;
      const n = appendBatch(5);
      if (!n) io.disconnect();
    },
    { root: null, rootMargin: "900px 0px 900px 0px", threshold: 0.01 },
  );
  io.observe(sentinelEl);
}

function jumpFromHashIfAny() {
  const m = String(window.location.hash || "").match(/#seg-(\d+)/);
  if (!m) return;
  const id = Number(m[1]);
  // If the target isn't loaded yet, load in chunks until it exists (bounded).
  let tries = 0;
  while (!byId.has(id) && tries < 30) {
    appendBatch(12);
    tries++;
  }
  setTimeout(() => scrollToSegment(id), 0);
}

wireUi();
setStatus("Loading segments…");

(async () => {
  try {
    const slugs = await loadSegmentsIndex();
    const metas = await Promise.all(slugs.map((s) => loadMeta(s)));
    const items = slugs.map((slug, i) => ({ slug, meta: metas[i] }));

    segmentSlugs = items.map((x) => x.slug);
    metaBySlug = new Map(items.map((x) => [x.slug, x.meta]));
    segmentIdx = 0;
    feedComplete = false;

    renderTopicsFromCatalog();
    appendBatch(14);
    startInfiniteScroll();
    jumpFromHashIfAny();
  } catch (e) {
    setStatus("Failed to load segments (run via a local server).");
    const msg = document.createElement("div");
    msg.className = "card";
    msg.innerHTML = `
      <div class="card__inner">
        <div class="card__title">Segments couldn’t load</div>
        <div class="card__text">
          This page needs to be served over a local web server to load segment files.
        </div>
      </div>
    `;
    feedEl.append(msg);
  }
})();

