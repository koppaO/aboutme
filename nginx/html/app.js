// Команды, которые терминал готов выполнить. Убери имя из списка — команда исчезнет
// из help, автодополнения и перестанет запускаться. Новые команды описываются в COMMAND_LIBRARY.
const ENABLED_COMMANDS = [
  "help",
  "whoami",
  "about",
  "skills",
  "projects",
  "links",
  "open",
  "clips",
  "status",
  "theme",
  "lang",
  "matrix",
  "party",
  "clear",
  "exit",
];

const MATTER_SRC = "/vendor/matter-0.20.0.min.js";
const MEDIA_PATH = /^\/media\/[A-Za-z0-9._-]+$/;

const I18N = window.aboutmeI18n;
const t = (key, vars) => I18N.t(key, vars);
const pick = (value) => I18N.pick(value);

const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const wideQuery = window.matchMedia("(min-width: 900px)");
const bootStarted = performance.now();

let meData = null;
let projectsData = null;
let projectItems = [];
let selectedProject = 0;
let physicsToken = 0;
let physicsState = null;
let physicsVisible = false;
let matterPromise = null;
let player = null;
let statusKey = null;

function calm() {
  return motionQuery.matches;
}

function showStatus(key) {
  statusKey = key;
  const node = document.getElementById("status");
  node.hidden = false;
  node.textContent = t(key);
}

async function loadJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${path}: ${response.status}`);
  }
  return response.json();
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text != null) {
    node.textContent = text;
  }
  return node;
}

function safeUrl(raw) {
  try {
    const url = new URL(raw, window.location.href);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch (err) {
    return null;
  }
}

// Плеер берёт файлы только со своего /media/: CSP всё равно не пустит внешние адреса.
function mediaUrl(raw) {
  if (typeof raw !== "string" || raw.length > 500 || !MEDIA_PATH.test(raw) || raw.includes("..")) {
    return null;
  }
  return raw;
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// --- Радуга: насыщенные цвета с контрастом к текущему фону ---------------------

function parseHex(value) {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value || "");
  if (!match) {
    return null;
  }
  let hex = match[1];
  if (hex.length === 3) {
    hex = [...hex].map((char) => char + char).join("");
  }
  return [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
}

function hslToRgb(hue, saturation, lightness) {
  const shift = (n) => (n + hue / 30) % 12;
  const amount = saturation * Math.min(lightness, 1 - lightness);
  const channel = (n) => lightness - amount * Math.max(-1, Math.min(shift(n) - 3, 9 - shift(n), 1));
  return [channel(0), channel(8), channel(4)].map((value) => Math.round(value * 255));
}

function luminance(rgb) {
  const linear = (value) => {
    const v = value / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
}

function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

const rainbowCache = { key: "", table: [] };

// Для каждого оттенка подбираем светлоту: на белом жёлтый и бирюзовый темнеют,
// на тёмно-синем синий и фиолетовый светлеют. Так след одинаково читается на любом фоне.
function rainbowTable() {
  const bg = parseHex(cssVar("--bg")) || [255, 255, 255];
  const key = bg.join(",");
  if (rainbowCache.key === key) {
    return rainbowCache.table;
  }
  const darkBg = luminance(bg) < 0.2;
  const target = darkBg ? 4.5 : 3.6;
  const table = [];
  for (let hue = 0; hue < 360; hue += 1) {
    let lightness = darkBg ? 0.58 : 0.5;
    let rgb = hslToRgb(hue, 0.95, lightness);
    while (contrast(rgb, bg) < target && lightness > 0.12 && lightness < 0.92) {
      lightness += darkBg ? 0.02 : -0.02;
      rgb = hslToRgb(hue, 0.95, lightness);
    }
    table.push(rgb);
  }
  rainbowCache.key = key;
  rainbowCache.table = table;
  return table;
}

function rainbow(hue, alpha = 1) {
  const index = Math.round(((hue % 360) + 360) % 360) % 360;
  const [r, g, b] = rainbowTable()[index];
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// --- Загрузка ------------------------------------------------------------------

function finishBoot() {
  const wait = calm() ? 0 : Math.max(0, 900 - (performance.now() - bootStarted));
  window.setTimeout(() => {
    document.body.classList.add("is-ready");
    const preloader = document.getElementById("preloader");
    if (preloader) {
      window.setTimeout(() => preloader.remove(), calm() ? 0 : 450);
    }
  }, wait);
}

// --- О себе, плеер, таймлайн --------------------------------------------------

function linkAnchor(link) {
  const anchor = el("a", null, link.name);
  const href = safeUrl(link.url);
  if (href) {
    anchor.href = href;
  }
  anchor.rel = "noopener noreferrer";
  anchor.target = "_blank";
  return anchor;
}

function renderMe(me) {
  const name = typeof me.name === "string" ? me.name : "";
  document.title = name || "koppaO";
  const heading = document.getElementById("name");
  heading.textContent = name;
  document.getElementById("headline").textContent = pick(me.headline);

  const aboutText = pick(me.about);
  document.getElementById("about").textContent = aboutText;

  const socials = document.getElementById("socials");
  socials.replaceChildren();
  for (const item of me.socials || []) {
    const entry = el("li");
    const link = linkAnchor(item);
    link.rel = "me noopener noreferrer";
    entry.append(link);
    socials.append(entry);
  }
  document.getElementById("about-text").hidden = !aboutText && !socials.childElementCount;

  const hasPlayer = renderPlayer(me.now_playing);
  document.getElementById("about-section").hidden = !aboutText && !socials.childElementCount && !hasPlayer;
  document.getElementById("about-body").classList.toggle("split", hasPlayer && !document.getElementById("about-text").hidden);

  renderTimeline(me.timeline);
}

function validTrack(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const src = mediaUrl(raw.src);
  if (!title || !src) {
    return null;
  }
  return {
    title,
    artist: typeof raw.artist === "string" ? raw.artist.trim() : "",
    src,
    cover: raw.cover == null ? null : mediaUrl(raw.cover),
  };
}

function updatePlayerLabels() {
  if (!player) {
    return;
  }
  const playing = !player.audio.paused && !player.audio.ended;
  player.icon.textContent = playing ? "❚❚" : "▶";
  player.word.textContent = t(playing ? "player.pause" : "player.play");
  player.button.setAttribute("aria-label", t(playing ? "player.pauseAria" : "player.playAria", { title: player.track.title }));
  player.error.textContent = t("player.error");
}

function stopPlayer() {
  if (!player) {
    return;
  }
  player.audio.pause();
  player.audio.removeAttribute("src");
  player.audio.load();
  player.root.remove();
  player = null;
}

function renderPlayer(raw) {
  const box = document.getElementById("player");
  const track = validTrack(raw);
  if (!track) {
    stopPlayer();
    box.hidden = true;
    return false;
  }
  if (player && player.track.src === track.src && player.track.cover === track.cover) {
    player.track = track;
    player.title.textContent = track.title;
    player.artist.textContent = track.artist;
    player.artist.hidden = !track.artist;
    updatePlayerLabels();
    box.hidden = false;
    return true;
  }
  stopPlayer();

  const vinyl = el("div", "vinyl");
  const disc = el("div", "disc");
  disc.setAttribute("aria-hidden", "true");
  const label = el("div", "disc-label");
  if (track.cover) {
    const img = el("img");
    img.alt = "";
    img.decoding = "async";
    img.loading = "lazy";
    img.addEventListener("error", () => img.remove());
    img.src = track.cover;
    label.append(img);
  }
  disc.append(label);

  const info = el("div", "track");
  const title = el("p", "track-title", track.title);
  const artist = el("p", "track-artist", track.artist);
  artist.hidden = !track.artist;
  const button = el("button", "play-btn");
  button.type = "button";
  const icon = el("span", null);
  icon.setAttribute("aria-hidden", "true");
  const word = el("span", null);
  button.append(icon, word);
  const error = el("p", "player-error");
  error.hidden = true;
  error.setAttribute("role", "status");
  info.append(title, artist, button, error);
  vinyl.append(disc, info);

  // Никакого автоплея: файл не грузится, пока не нажмут «Слушать».
  const audio = document.createElement("audio");
  audio.preload = "none";
  audio.src = track.src;

  const sync = () => {
    box.classList.toggle("is-playing", !audio.paused && !audio.ended);
    updatePlayerLabels();
  };
  for (const name of ["play", "playing", "pause", "ended"]) {
    audio.addEventListener(name, sync);
  }
  // Текст ставится уже после показа блока, иначе role="status" его не озвучит.
  const showError = () => {
    sync();
    error.hidden = false;
    error.textContent = "";
    window.setTimeout(() => {
      error.textContent = t("player.error");
    }, 50);
  };
  audio.addEventListener("error", showError);
  button.addEventListener("click", () => {
    if (audio.paused || audio.ended) {
      error.hidden = true;
      audio.play().catch((err) => {
        console.error(err);
        showError();
      });
    } else {
      audio.pause();
    }
  });

  const wrapper = el("div", null);
  wrapper.append(vinyl, audio);
  box.append(wrapper);
  player = { root: wrapper, audio, button, icon, word, title, artist, error, track };
  updatePlayerLabels();
  box.hidden = false;
  return true;
}

function timelineMeta(item) {
  const parts = [];
  const place = pick(item.place);
  if (place) {
    parts.push(place);
  }
  if (["study", "work", "project"].includes(item.kind)) {
    parts.push(t(`timeline.${item.kind}`));
  }
  return parts.join(", ");
}

function renderTimeline(raw) {
  const section = document.getElementById("timeline-section");
  const list = document.getElementById("timeline");
  list.replaceChildren();
  const items = (Array.isArray(raw) ? raw : []).filter(
    (item) => item && typeof item.start === "string" && item.start && pick(item.title),
  );
  if (!items.length) {
    section.hidden = true;
    return;
  }
  items.forEach((item, index) => {
    const entry = el("li");
    const end = typeof item.end === "string" && item.end ? item.end : t("timeline.now");
    entry.append(el("p", "tl-when", `${item.start} – ${end}`));
    const dot = el("span", "tl-dot");
    dot.setAttribute("aria-hidden", "true");
    // Маркеры идут по кругу радуги от первого события к последнему.
    dot.dataset.hue = String(Math.round((index / Math.max(items.length, 2)) * 300));
    dot.style.setProperty("background", rainbow(Number(dot.dataset.hue)));
    entry.append(dot);
    entry.append(el("h3", "tl-title", pick(item.title)));
    const meta = timelineMeta(item);
    if (meta) {
      entry.append(el("p", "tl-meta", meta));
    }
    list.append(entry);
  });
  section.hidden = false;
}

function recolorTimeline() {
  for (const dot of document.querySelectorAll(".tl-dot")) {
    dot.style.setProperty("background", rainbow(Number(dot.dataset.hue) || 0));
  }
}

// --- Проекты --------------------------------------------------------------------

function projectTitle(project) {
  return project.title || project.slug || t("project.fallback");
}

function fillProject(target, project) {
  const description = pick(project.description);
  if (description) {
    target.append(el("p", "desc", description));
  }
  if (project.stack?.length) {
    const stack = el("ul", "stack");
    for (const item of project.stack) {
      stack.append(el("li", null, item));
    }
    target.append(stack);
  }
  if (project.links?.length) {
    const links = el("ul", "links");
    for (const link of project.links) {
      const item = el("li");
      item.append(linkAnchor(link));
      links.append(item);
    }
    target.append(links);
  }
}

function selectProject(index) {
  const buttons = document.querySelectorAll("#project-index button");
  buttons.forEach((button, buttonIndex) => {
    if (buttonIndex === index) {
      button.setAttribute("aria-current", "true");
    } else {
      button.removeAttribute("aria-current");
    }
  });
  const project = projectItems[index];
  if (project) {
    selectedProject = index;
    const preview = document.getElementById("project-preview");
    preview.replaceChildren();
    fillProject(preview, project);
    trailInvalidate();
  }
}

function bindStrip(strip) {
  let x = 0;
  let drag = null;

  const track = () => strip.querySelector(".strip-track");

  function limit() {
    const node = track();
    return node ? Math.min(0, strip.clientWidth - node.scrollWidth) : 0;
  }

  function apply() {
    const node = track();
    if (!node) {
      return;
    }
    x = Math.min(0, Math.max(limit(), x));
    node.style.transform = `translate3d(${x}px, 0, 0)`;
  }

  strip.addEventListener("aboutme:reset", () => {
    x = 0;
    apply();
  });

  strip.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    drag = {
      id: event.pointerId,
      startX: event.clientX,
      origin: x,
      moved: false,
    };
  });

  strip.addEventListener("pointermove", (event) => {
    if (!drag || drag.id !== event.pointerId) {
      return;
    }
    const delta = event.clientX - drag.startX;
    if (!drag.moved && Math.abs(delta) > 4) {
      // Захватываем указатель только когда это точно перетаскивание:
      // иначе клик уходит ленте, а не ссылке в карточке.
      drag.moved = true;
      strip.classList.add("is-drag");
      strip.setPointerCapture(event.pointerId);
    }
    if (drag.moved) {
      x = drag.origin + delta;
      apply();
    }
  });

  function endDrag(event) {
    if (!drag || drag.id !== event.pointerId) {
      return;
    }
    if (drag.moved) {
      strip.dataset.suppress = "1";
      window.setTimeout(() => delete strip.dataset.suppress, 0);
    }
    drag = null;
    strip.classList.remove("is-drag");
  }

  strip.addEventListener("pointerup", endDrag);
  strip.addEventListener("pointercancel", endDrag);
  strip.addEventListener(
    "click",
    (event) => {
      if (strip.dataset.suppress !== "1") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      delete strip.dataset.suppress;
    },
    true,
  );
  strip.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      x -= 120;
      apply();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      x += 120;
      apply();
    }
  });
  // Ссылка в карточке получила фокус с клавиатуры — подвигаем ленту, чтобы её было видно.
  strip.addEventListener("focusin", (event) => {
    const card = event.target.closest?.(".card");
    if (!card) {
      return;
    }
    const left = card.offsetLeft;
    if (left + x < 0 || left + card.offsetWidth + x > strip.clientWidth) {
      x = -left;
      apply();
    }
  });
  window.addEventListener("resize", apply);
}

function renderProjects(payload) {
  const section = document.getElementById("projects-section");
  const index = document.getElementById("project-index");
  const strip = document.getElementById("project-strip");
  projectItems = Array.isArray(payload?.projects) ? payload.projects : [];
  if (!projectItems.length) {
    section.hidden = true;
    return;
  }

  index.replaceChildren();
  const track = el("div", "strip-track");
  projectItems.forEach((project, projectIndex) => {
    const item = el("li");
    const button = el("button", null, projectTitle(project));
    button.type = "button";
    button.setAttribute("aria-controls", "project-preview");
    button.addEventListener("mouseenter", () => selectProject(projectIndex));
    button.addEventListener("focus", () => selectProject(projectIndex));
    button.addEventListener("click", () => selectProject(projectIndex));
    item.append(button);
    index.append(item);

    const card = el("article", "card");
    card.append(el("h3", null, projectTitle(project)));
    fillProject(card, project);
    track.append(card);
  });

  strip.replaceChildren(track);
  strip.dispatchEvent(new Event("aboutme:reset"));
  selectProject(Math.min(selectedProject, projectItems.length - 1));
  section.hidden = false;
}

// --- Скиллы: капсулы на Matter.js -------------------------------------------

const CAPSULE_FONT = '600 15px "Mona Sans", "Onest", "Segoe UI", system-ui, sans-serif';
const SKILL_KINDS = ["language", "framework", "database", "infra", "tool"];
const SKILL_LIMIT = 40;
const RECOLOR_MS = 260;

// Цвета категорий взяты из палитры шлейфа. Текст на капсуле — чёрный или белый,
// что контрастнее; у всех пяти цветов это не меньше 4.5:1.
const SKILL_COLORS = {
  language: "#583af7",
  framework: "#f73678",
  database: "#19c3e6",
  infra: "#f5c400",
  tool: "#5fed83",
};

// Старый api не знает категорий: угадываем по имени, остальное считаем инструментом.
const KIND_GUESS = new Map(
  Object.entries({
    language: [
      "python", "javascript", "js", "typescript", "ts", "go", "golang", "rust", "c", "c++", "cpp",
      "c#", "java", "kotlin", "swift", "ruby", "php", "bash", "shell", "sql", "lua", "dart",
      "scala", "haskell", "elixir", "html", "css",
    ],
    framework: [
      "fastapi", "django", "flask", "react", "vue", "svelte", "angular", "next.js", "nextjs",
      "nuxt", "express", "node.js", "nodejs", "spring", "pydantic", "sqlalchemy", "celery",
      "aiogram", "tailwind", "matter.js",
    ],
    database: [
      "postgres", "postgresql", "mysql", "mariadb", "sqlite", "redis", "mongodb", "mongo",
      "clickhouse", "elasticsearch",
    ],
    infra: [
      "docker", "docker compose", "nginx", "linux", "kubernetes", "k8s", "github actions", "ci",
      "aws", "terraform", "ansible", "caddy", "traefik", "systemd", "wireguard", "vps",
    ],
  }).flatMap(([kind, names]) => names.map((name) => [name, kind])),
);

let skillItems = [];
let skillFilter = null;

function guessKind(name) {
  return KIND_GUESS.get(name.toLowerCase()) || "tool";
}

function collectSkills(me, projects) {
  const seen = new Set();
  const items = [];
  const add = (raw, kind) => {
    const name = typeof raw === "string" ? raw.trim() : "";
    const key = name.toLowerCase();
    if (!name || seen.has(key) || items.length >= SKILL_LIMIT) {
      return;
    }
    seen.add(key);
    items.push({ name, kind: SKILL_KINDS.includes(kind) ? kind : guessKind(name), order: items.length });
  };
  if (Array.isArray(me?.skills)) {
    for (const skill of me.skills) {
      if (skill && typeof skill === "object") {
        add(skill.name, skill.kind);
      }
    }
  }
  if (!items.length) {
    for (const project of projects) {
      for (const part of project.stack || []) {
        add(String(part), null);
      }
    }
  }
  // Капсулы падают группами: языки, фреймворки, базы, инфраструктура, инструменты.
  return items.sort(
    (a, b) => SKILL_KINDS.indexOf(a.kind) - SKILL_KINDS.indexOf(b.kind) || a.order - b.order,
  );
}

function inkFor(fill) {
  const rgb = parseHex(fill) || [0, 0, 0];
  return contrast(rgb, [0, 0, 0]) >= contrast(rgb, [255, 255, 255]) ? "#000000" : "#ffffff";
}

function skillPaint(kind) {
  if (skillFilter && skillFilter !== kind) {
    return { fill: cssVar("--dim-fill") || "#e6e6e6", text: cssVar("--dim-ink") || "#4d4d4d" };
  }
  const fill = SKILL_COLORS[kind] || SKILL_COLORS.tool;
  return { fill, text: inkFor(fill) };
}

function mixHex(from, to, k) {
  const a = parseHex(from) || [0, 0, 0];
  const b = parseHex(to) || [0, 0, 0];
  const channel = (i) => Math.round(a[i] + (b[i] - a[i]) * k);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

function loadMatter() {
  if (window.Matter) {
    return Promise.resolve(window.Matter);
  }
  if (!matterPromise) {
    matterPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = MATTER_SRC;
      script.onload = () => resolve(window.Matter);
      script.onerror = () => {
        matterPromise = null;
        reject(new Error("matter"));
      };
      document.head.append(script);
    });
  }
  return matterPromise;
}

function stopPhysics() {
  const state = physicsState;
  physicsState = null;
  const section = document.getElementById("skills-section");
  const world = document.getElementById("skills-world");
  section.classList.remove("is-physics");
  world.hidden = true;
  if (!state) {
    world.replaceChildren();
    return;
  }
  const Matter = window.Matter;
  Matter.Render.stop(state.render);
  Matter.Runner.stop(state.runner);
  Matter.Composite.clear(state.engine.world, false);
  Matter.Engine.clear(state.engine);
  if (state.render.canvas) {
    state.render.canvas.remove();
  }
  state.render.canvas = null;
  state.render.context = null;
  state.render.textures = {};
  world.replaceChildren();
}

function mountPhysics(Matter, items) {
  const worldEl = document.getElementById("skills-world");
  const section = document.getElementById("skills-section");
  worldEl.hidden = false;
  section.classList.add("is-physics");
  const width = worldEl.clientWidth || 640;
  const height = worldEl.clientHeight || 280;
  const engine = Matter.Engine.create();
  engine.gravity.y = 1;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const render = Matter.Render.create({
    element: worldEl,
    engine,
    options: {
      width,
      height,
      wireframes: false,
      background: "transparent",
      pixelRatio: ratio,
    },
  });
  const measure = render.context;
  measure.font = CAPSULE_FONT;

  const walls = [
    Matter.Bodies.rectangle(width / 2, height + 24, width + 120, 48, {
      isStatic: true,
      render: { visible: false },
    }),
    Matter.Bodies.rectangle(-24, height / 2 - height, 48, height * 4, {
      isStatic: true,
      render: { visible: false },
    }),
    Matter.Bodies.rectangle(width + 24, height / 2 - height, 48, height * 4, {
      isStatic: true,
      render: { visible: false },
    }),
  ];
  const capsuleHeight = 38;
  let dropY = -capsuleHeight;
  let lastKind = null;
  const bodies = items.map((item) => {
    const capsuleWidth = Math.max(72, Math.ceil(measure.measureText(item.name).width) + 40);
    const span = Math.max(width - capsuleWidth - 24, 1);
    const x = capsuleWidth / 2 + 12 + Math.random() * span;
    // Капсулы стартуют над видимой областью; между категориями пауза побольше,
    // чтобы группы падали отдельно.
    dropY -= lastKind && lastKind !== item.kind ? 140 : 46;
    lastKind = item.kind;
    const paint = skillPaint(item.kind);
    const body = Matter.Bodies.rectangle(x, dropY, capsuleWidth, capsuleHeight, {
      chamfer: { radius: capsuleHeight / 2 },
      restitution: 0.4,
      friction: 0.12,
      frictionAir: 0.02,
      // Бесконечная инерция: капсула не вращается, надпись всегда горизонтальная.
      inertia: Infinity,
      label: item.name,
      render: { fillStyle: paint.fill, strokeStyle: paint.fill, lineWidth: 0 },
    });
    Matter.Body.setInertia(body, Infinity);
    Matter.Body.setAngle(body, 0);
    body.plugin.skill = { kind: item.kind, from: paint, to: paint, started: 0, text: paint.text };
    return body;
  });
  Matter.Composite.add(engine.world, [...walls, ...bodies]);

  const mouse = Matter.Mouse.create(render.canvas);
  if (mouse.mousewheel) {
    mouse.element.removeEventListener("wheel", mouse.mousewheel);
    mouse.element.removeEventListener("mousewheel", mouse.mousewheel);
    mouse.element.removeEventListener("DOMMouseScroll", mouse.mousewheel);
  }
  // Курсор ушёл с холста — отпускаем капсулу, иначе она «прилипает» к мыши.
  render.canvas.addEventListener("mouseleave", (event) => mouse.mouseup(event));
  const mouseConstraint = Matter.MouseConstraint.create(engine, {
    mouse,
    constraint: { stiffness: 0.2, render: { visible: false } },
  });
  Matter.Composite.add(engine.world, mouseConstraint);
  render.mouse = mouse;

  // Плавная перекраска при фильтре и смене темы: цвет тянется от старого к новому.
  Matter.Events.on(render, "beforeRender", () => {
    const now = performance.now();
    for (const body of bodies) {
      const paint = body.plugin.skill;
      const k = paint.started ? Math.min(1, (now - paint.started) / RECOLOR_MS) : 1;
      body.render.fillStyle = k < 1 ? mixHex(paint.from.fill, paint.to.fill, k) : paint.to.fill;
      paint.text = k < 0.5 ? paint.from.text : paint.to.text;
    }
  });

  Matter.Events.on(render, "afterRender", () => {
    const context = render.context;
    context.save();
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.font = CAPSULE_FONT;
    context.textAlign = "center";
    context.textBaseline = "middle";
    for (const body of bodies) {
      context.fillStyle = body.plugin.skill.text;
      context.fillText(body.label, body.position.x, body.position.y + 1);
    }
    context.restore();
  });

  const runner = Matter.Runner.create();
  Matter.Runner.run(runner, engine);
  Matter.Render.run(render);
  return { engine, render, runner, bodies, width };
}

function recolorPhysics() {
  if (!physicsState) {
    return;
  }
  const now = performance.now();
  for (const body of physicsState.bodies) {
    const paint = body.plugin.skill;
    const next = skillPaint(paint.kind);
    if (next.fill === paint.to.fill && next.text === paint.to.text) {
      continue;
    }
    paint.from = paint.to;
    paint.to = next;
    paint.started = now;
  }
}

function shakeSkills() {
  const Matter = window.Matter;
  if (!physicsState || !Matter) {
    return false;
  }
  for (const body of physicsState.bodies) {
    Matter.Body.setVelocity(body, {
      x: (Math.random() - 0.5) * 14,
      y: -8 - Math.random() * 10,
    });
  }
  return true;
}

function paintChip(node, kind) {
  const fill = SKILL_COLORS[kind] || SKILL_COLORS.tool;
  node.style.setProperty("--chip", fill);
  node.style.setProperty("--chip-ink", inkFor(fill));
}

function applySkillFilter() {
  for (const button of document.querySelectorAll("#skill-filter button")) {
    button.setAttribute("aria-pressed", button.dataset.kind === skillFilter ? "true" : "false");
  }
  const chips = document.getElementById("skills-static");
  chips.classList.toggle("is-filtered", Boolean(skillFilter));
  for (const chip of chips.children) {
    chip.classList.toggle("is-match", chip.dataset.kind === skillFilter);
  }
  recolorPhysics();
}

function renderSkillFilter() {
  const box = document.getElementById("skill-filter");
  box.replaceChildren();
  const kinds = SKILL_KINDS.filter((kind) => skillItems.some((item) => item.kind === kind));
  if (!kinds.includes(skillFilter)) {
    skillFilter = null;
  }
  for (const kind of kinds) {
    const button = el("button", "kind-btn");
    button.type = "button";
    button.dataset.kind = kind;
    const dot = el("span", "kind-dot");
    dot.setAttribute("aria-hidden", "true");
    paintChip(dot, kind);
    button.append(dot, el("span", null, t(`kind.${kind}`)));
    button.addEventListener("click", () => {
      skillFilter = skillFilter === kind ? null : kind;
      applySkillFilter();
    });
    box.append(button);
  }
  box.hidden = kinds.length < 2;
}

function renderSkillChips() {
  const box = document.getElementById("skills-static");
  box.replaceChildren();
  for (const item of skillItems) {
    const chip = el("li", "chip", item.name);
    chip.dataset.kind = item.kind;
    paintChip(chip, item.kind);
    box.append(chip);
  }
  renderSkillFilter();
  applySkillFilter();
}

async function syncSkills() {
  const token = ++physicsToken;
  const section = document.getElementById("skills-section");
  if (!skillItems.length) {
    stopPhysics();
    section.hidden = true;
    return;
  }
  section.hidden = false;
  renderSkillChips();
  const usePhysics = wideQuery.matches && !calm() && physicsVisible;
  if (!usePhysics) {
    if (!wideQuery.matches || calm()) {
      stopPhysics();
    }
    return;
  }
  const worldEl = document.getElementById("skills-world");
  if (physicsState && physicsState.width === worldEl.clientWidth) {
    return;
  }
  try {
    const Matter = await loadMatter();
    try {
      await document.fonts?.load(CAPSULE_FONT);
    } catch (err) {
      // Шрифт не догрузился — капсулы измерятся запасным.
    }
    if (token !== physicsToken || !wideQuery.matches) {
      return;
    }
    stopPhysics();
    physicsState = mountPhysics(Matter, skillItems);
    trailInvalidate();
  } catch (err) {
    console.error(err);
    stopPhysics();
  }
}

function watchSkills() {
  const section = document.getElementById("skills-section");
  if (!("IntersectionObserver" in window)) {
    physicsVisible = true;
    syncSkills();
    return;
  }
  // Мир с капсулами создаём, только когда секция доехала до экрана:
  // так видно, как они падают, и Matter.js не грузится зря.
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        physicsVisible = true;
        syncSkills();
      }
    },
    { rootMargin: "0px 0px -20% 0px" },
  );
  observer.observe(section);

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      const worldEl = document.getElementById("skills-world");
      if (physicsState && physicsState.width !== worldEl.clientWidth) {
        syncSkills();
      }
    }, 250);
  });
}

// --- Радужный шлейф: цветные клетки под курсором --------------------------------

const GLYPH_CHARSET = "01{}[]<>/\\|=+-*#$%&?!~^:;ABCDEFabcdef";
const TRAIL_CELL = 20;
// Клетка гаснет по своему таймеру, а не потому что кончился пул: пул растёт по мере
// надобности, потолок нужен только на случай очень резкого движения.
const TRAIL_POOL_MAX = 64;
const TRAIL_LIFE = 420;
const TRAIL_GAP = 40;
const TRAIL_CHARS = "->+=<*&/#%";
const TRAIL_PALETTE = ["#f73678", "#ff7a1a", "#f5c400", "#5fed83", "#19c3e6", "#583af7", "#ae85ff"];
// Клетки ложатся только внутрь этих блоков, сетка выровнена по их краям.
const TRAIL_ZONES = [
  "#hero",
  ".row:not([hidden]) > .row-title",
  ".row:not([hidden]) > .row-body:not(.split):not(.work)",
  ".row:not([hidden]) > .row-body.split > :not(#player)",
  ".row:not([hidden]) > .work > *",
].join(", ");
// Вокруг текста и всего, с чем можно взаимодействовать, держим отступ в две клетки.
const TRAIL_AVOID = "a, button, input, textarea, select, img, .chip, .kind-btn";
// Эти места закрыты целиком: пластинка с кнопкой, капсулы, лента проектов.
const TRAIL_CLOSED = "#player, .skills-world, .strip";

function randomGlyph() {
  return GLYPH_CHARSET[Math.floor(Math.random() * GLYPH_CHARSET.length)];
}

let trailInvalidate = () => {};

function setupTrail() {
  const fine = window.matchMedia("(pointer: fine)");
  const main = document.getElementById("main");
  const header = document.querySelector(".masthead");
  const terminal = document.getElementById("terminal");
  const layer = el("div", "trail");
  layer.setAttribute("aria-hidden", "true");
  const pool = [];
  document.body.append(layer);

  let layout = null;
  let lastKey = "";
  let color = 0;

  function acquire() {
    const idle = pool.find((slot) => !slot.busy);
    if (idle) {
      return idle;
    }
    if (pool.length < TRAIL_POOL_MAX) {
      const cell = el("div", "trail-cell");
      const tile = el("span", "trail-tile");
      cell.append(tile);
      layer.append(cell);
      const slot = { cell, tile, timer: 0, busy: false, born: 0 };
      pool.push(slot);
      return slot;
    }
    return pool.reduce((oldest, slot) => (slot.born < oldest.born ? slot : oldest));
  }

  // Всё считается в координатах документа, поэтому прокрутка кэш не портит.
  // Пересчёт нужен, только когда меняется сама раскладка.
  function measure() {
    const sx = window.scrollX;
    const sy = window.scrollY;
    const box = (rect, pad) => ({
      left: rect.left + sx - pad,
      top: rect.top + sy - pad,
      right: rect.right + sx + pad,
      bottom: rect.bottom + sy + pad,
    });
    const zones = [];
    for (const node of document.querySelectorAll(TRAIL_ZONES)) {
      const rect = node.getBoundingClientRect();
      if (rect.width >= TRAIL_CELL + 2 && rect.height >= TRAIL_CELL + 2) {
        // Минус пиксель с каждой стороны: клетка не должна лечь на линию сетки.
        zones.push(box(rect, -1));
      }
    }
    const avoid = [];
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.data.trim()) {
        continue;
      }
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        avoid.push(box(rect, TRAIL_GAP));
      }
    }
    for (const node of main.querySelectorAll(TRAIL_AVOID)) {
      const rect = node.getBoundingClientRect();
      if (rect.width || rect.height) {
        avoid.push(box(rect, TRAIL_GAP));
      }
    }
    for (const node of main.querySelectorAll(TRAIL_CLOSED)) {
      const rect = node.getBoundingClientRect();
      if (rect.width || rect.height) {
        avoid.push(box(rect, 0));
      }
    }
    const sticky = getComputedStyle(header).position === "sticky";
    const headerRect = header.getBoundingClientRect();
    return { zones, avoid, sticky, headerBottom: sticky ? headerRect.height : headerRect.bottom + sy };
  }

  trailInvalidate = () => {
    layout = null;
    lastKey = "";
  };

  function hideAll() {
    for (const slot of pool) {
      window.clearTimeout(slot.timer);
      slot.cell.classList.remove("is-on");
      slot.busy = false;
    }
    lastKey = "";
  }

  function free(left, top) {
    const right = left + TRAIL_CELL;
    const bottom = top + TRAIL_CELL;
    return !layout.avoid.some(
      (rect) => left < rect.right && right > rect.left && top < rect.bottom && bottom > rect.top,
    );
  }

  function show(left, top) {
    const slot = acquire();
    slot.busy = true;
    slot.born = performance.now();
    window.clearTimeout(slot.timer);
    slot.cell.classList.remove("is-on");
    slot.cell.style.transform = `translate(${left - window.scrollX}px, ${top - window.scrollY}px)`;
    const fill = TRAIL_PALETTE[color];
    color = (color + 1) % TRAIL_PALETTE.length;
    slot.tile.style.setProperty("--trail-fill", fill);
    slot.tile.style.setProperty("--trail-ink", inkFor(fill));
    slot.tile.textContent = TRAIL_CHARS[Math.floor(Math.random() * TRAIL_CHARS.length)];
    // Класс ставится в следующем кадре, чтобы квадрат вырос из нуля, а не появился сразу.
    window.requestAnimationFrame(() => slot.cell.classList.add("is-on"));
    slot.timer = window.setTimeout(() => {
      slot.cell.classList.remove("is-on");
      // Клетка свободна, когда квадрат успел схлопнуться.
      slot.timer = window.setTimeout(() => {
        slot.busy = false;
      }, 120);
    }, TRAIL_LIFE);
  }

  function onMove(event) {
    if (event.pointerType === "touch" || !fine.matches || calm() || !terminal.hidden) {
      return;
    }
    if (document.querySelector(".fx")) {
      return;
    }
    if (!layout) {
      layout = measure();
    }
    const x = event.clientX + window.scrollX;
    const y = event.clientY + window.scrollY;
    if ((layout.sticky ? event.clientY : y) < layout.headerBottom + TRAIL_CELL) {
      return;
    }
    const index = layout.zones.findIndex(
      (zone) => x >= zone.left && x < zone.right && y >= zone.top && y < zone.bottom,
    );
    if (index < 0) {
      lastKey = "";
      return;
    }
    const zone = layout.zones[index];
    const col = Math.floor((x - zone.left) / TRAIL_CELL);
    const row = Math.floor((y - zone.top) / TRAIL_CELL);
    const key = `${index}:${col}:${row}`;
    if (key === lastKey) {
      return;
    }
    lastKey = key;
    const left = zone.left + col * TRAIL_CELL;
    const top = zone.top + row * TRAIL_CELL;
    if (left + TRAIL_CELL > zone.right || top + TRAIL_CELL > zone.bottom || !free(left, top)) {
      return;
    }
    show(left, top);
  }

  window.addEventListener("pointermove", onMove, { passive: true });
  // Клетки висят в fixed-слое: при прокрутке они бы уехали от своей ячейки, поэтому гаснут.
  window.addEventListener("scroll", hideAll, { passive: true });
  window.addEventListener("resize", trailInvalidate);
  window.addEventListener("aboutme:lang", trailInvalidate);
  document.addEventListener("pointerleave", () => {
    lastKey = "";
  });
  if ("ResizeObserver" in window) {
    new ResizeObserver(trailInvalidate).observe(main);
  }
  document.fonts?.ready.then(trailInvalidate);
}

// --- Эффекты терминала: matrix и party ------------------------------------------

function fxCanvas(passive) {
  const canvas = el("canvas", passive ? "fx is-passive" : "fx");
  canvas.setAttribute("aria-hidden", "true");
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(window.innerWidth * ratio);
  canvas.height = Math.round(window.innerHeight * ratio);
  document.body.append(canvas);
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { canvas, context, width: window.innerWidth, height: window.innerHeight };
}

let matrixStop = null;

function startMatrix(onExit) {
  if (matrixStop) {
    return;
  }
  const { canvas, context, width, height } = fxCanvas(false);
  const bg = parseHex(cssVar("--bg")) || [255, 255, 255];
  const head = cssVar("--signal") || "#000000";
  const trail = cssVar("--muted") || "#5c5c5c";
  const SIZE = 16;
  const drops = Array.from({ length: Math.ceil(width / SIZE) }, () => Math.floor(Math.random() * -40));
  let frame = 0;
  let lastStep = 0;

  context.font = `500 ${SIZE - 2}px "Monaspace Neon", ui-monospace, Consolas, monospace`;
  context.textAlign = "center";

  function tick(now) {
    frame = window.requestAnimationFrame(tick);
    if (now - lastStep < 50) {
      return;
    }
    lastStep = now;
    context.fillStyle = `rgba(${bg[0]}, ${bg[1]}, ${bg[2]}, 0.16)`;
    context.fillRect(0, 0, width, height);
    drops.forEach((row, column) => {
      const x = column * SIZE + SIZE / 2;
      if (row >= 0) {
        context.fillStyle = trail;
        context.fillText(randomGlyph(), x, (row - 1) * SIZE);
        context.fillStyle = head;
        context.fillText(randomGlyph(), x, row * SIZE);
      }
      drops[column] = row * SIZE > height && Math.random() > 0.96 ? Math.floor(Math.random() * -12) : row + 1;
    });
  }

  function stop(event) {
    if (event) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    window.cancelAnimationFrame(frame);
    window.removeEventListener("keydown", stop, true);
    canvas.removeEventListener("pointerdown", stop);
    canvas.remove();
    matrixStop = null;
    onExit();
  }

  context.fillStyle = `rgb(${bg[0]}, ${bg[1]}, ${bg[2]})`;
  context.fillRect(0, 0, width, height);
  frame = window.requestAnimationFrame(tick);
  // Слушатель в фазе захвата: Esc закрывает только дождь, а не терминал под ним.
  window.addEventListener("keydown", stop, true);
  canvas.addEventListener("pointerdown", stop);
  matrixStop = stop;
}

function startParty() {
  const { canvas, context, width, height } = fxCanvas(true);
  const COUNT = 160;
  const LIFE = 1400;
  const started = performance.now();
  const originX = width / 2;
  const originY = height / 2;
  const sparks = Array.from({ length: COUNT }, (_, index) => {
    const angle = (index / COUNT) * Math.PI * 2 + Math.random() * 0.2;
    const speed = 4 + Math.random() * 9;
    return {
      x: originX,
      y: originY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 3,
      hue: (index / COUNT) * 360,
      ch: randomGlyph(),
    };
  });
  context.font = `700 18px "Monaspace Neon", ui-monospace, Consolas, monospace`;
  context.textAlign = "center";
  context.textBaseline = "middle";

  function tick(now) {
    const age = now - started;
    context.clearRect(0, 0, width, height);
    if (age >= LIFE) {
      canvas.remove();
      return;
    }
    const alpha = 1 - (age / LIFE) ** 2;
    for (const spark of sparks) {
      spark.vy += 0.25;
      spark.vx *= 0.985;
      spark.x += spark.vx;
      spark.y += spark.vy;
      context.fillStyle = rainbow(spark.hue, alpha.toFixed(3));
      context.fillText(spark.ch, spark.x, spark.y);
    }
    window.requestAnimationFrame(tick);
  }

  window.requestAnimationFrame(tick);
  shakeSkills();
}

// --- Терминал ------------------------------------------------------------------

function printLine(text, kind) {
  const log = document.getElementById("terminal-log");
  log.append(el("p", kind ? `is-${kind}` : null, text));
  log.scrollTop = log.scrollHeight;
}

function healthLine(payload, ok) {
  if (!ok || !payload) {
    return t("term.apiDown");
  }
  const api = payload.status === "ok";
  const db = payload.database === "ok";
  if (api && db) {
    return t("term.allOk");
  }
  return t("term.health", { api: payload.status || t("term.none"), db: payload.database || t("term.none") });
}

function scrollToSection(id) {
  const section = document.getElementById(id);
  if (!section || section.hidden) {
    printLine(t("term.emptySection"), "muted");
    return false;
  }
  section.scrollIntoView({ behavior: calm() ? "auto" : "smooth", block: "start" });
  return true;
}

function openTargets() {
  const targets = [];
  for (const item of meData?.socials || []) {
    targets.push({ name: item.name, url: item.url });
  }
  for (const project of projectItems) {
    for (const link of project.links || []) {
      const title = project.title || project.slug;
      targets.push({ name: title ? `${title}/${link.name}` : link.name, url: link.url });
    }
  }
  return targets.filter((target) => target.name && safeUrl(target.url));
}

function slug(text) {
  return String(text).toLowerCase().replace(/\s+/g, "-");
}

const COMMAND_LIBRARY = {
  help: {
    about: "cmd.help",
    run({ commands }) {
      for (const [name, command] of commands) {
        const usage = command.usage ? `${name} ${t(command.usage)}` : name;
        printLine(`${usage.padEnd(18)} ${t(command.about)}`, "muted");
      }
    },
  },
  whoami: {
    about: "cmd.whoami",
    run() {
      if (!meData?.name) {
        printLine(t("term.unknownYet"), "muted");
        return;
      }
      printLine(meData.name);
      const headline = pick(meData.headline);
      if (headline) {
        printLine(headline, "muted");
      }
    },
  },
  about: {
    about: "cmd.about",
    run({ close }) {
      if (scrollToSection("about-section")) {
        close();
      }
    },
  },
  skills: {
    about: "cmd.skills",
    run({ close }) {
      if (!scrollToSection("skills-section")) {
        return;
      }
      close();
      window.setTimeout(shakeSkills, calm() ? 0 : 450);
    },
  },
  projects: {
    about: "cmd.projects",
    run({ close }) {
      if (scrollToSection("projects-section")) {
        close();
      }
    },
  },
  links: {
    about: "cmd.links",
    run() {
      const targets = openTargets();
      if (!targets.length) {
        printLine(t("term.noLinks"), "muted");
        return;
      }
      for (const target of targets) {
        printLine(`${slug(target.name).padEnd(18)} ${target.url}`, "muted");
      }
      printLine(t("term.openHint"), "muted");
    },
  },
  open: {
    usage: "cmd.openUsage",
    about: "cmd.open",
    complete() {
      return openTargets().map((target) => slug(target.name));
    },
    run({ args }) {
      const wanted = slug(args.join(" "));
      if (!wanted) {
        printLine(t("term.whichLink"), "error");
        return;
      }
      const targets = openTargets();
      const target =
        targets.find((item) => slug(item.name) === wanted) ||
        targets.find((item) => slug(item.name).startsWith(wanted));
      if (!target) {
        printLine(t("term.noLink", { name: wanted }), "error");
        return;
      }
      printLine(t("term.opening", { url: target.url }), "muted");
      window.open(safeUrl(target.url), "_blank", "noopener,noreferrer");
    },
  },
  clips: {
    about: "cmd.clips",
    run() {
      window.location.assign("/clips.html");
    },
  },
  status: {
    about: "cmd.status",
    async run() {
      try {
        const payload = await loadJson("/api/health");
        printLine(healthLine(payload, true));
      } catch (err) {
        console.error(err);
        printLine(healthLine(null, false), "error");
      }
    },
  },
  theme: {
    usage: "[light|dark]",
    about: "cmd.theme",
    complete() {
      return ["light", "dark"];
    },
    run({ args }) {
      const wanted = args[0];
      const theme = window.aboutmeTheme;
      if (!wanted) {
        theme.toggle();
      } else if (wanted === "light" || wanted === "dark") {
        theme.set(wanted);
      } else {
        printLine(t("term.themeBad"), "error");
        return;
      }
      printLine(t("term.themeSet", { theme: theme.get() }));
    },
  },
  lang: {
    usage: "[ru|en]",
    about: "cmd.lang",
    complete() {
      return I18N.langs;
    },
    run({ args }) {
      const wanted = args[0] || (I18N.get() === "ru" ? "en" : "ru");
      if (!I18N.set(wanted)) {
        printLine(t("term.langBad"), "error");
        return;
      }
      printLine(t("term.langSet", { lang: I18N.get() }));
    },
  },
  matrix: {
    about: "cmd.matrix",
    run({ focusInput }) {
      if (calm()) {
        printLine(t("term.matrixStill"), "muted");
        return;
      }
      printLine(t("term.matrixOn"), "muted");
      startMatrix(() => {
        printLine(t("term.matrixOff"), "muted");
        focusInput();
      });
    },
  },
  party: {
    about: "cmd.party",
    run() {
      if (calm()) {
        printLine(t("term.partyStill"));
        return;
      }
      printLine(t("term.party"));
      startParty();
    },
  },
  clear: {
    about: "cmd.clear",
    run() {
      document.getElementById("terminal-log").replaceChildren();
    },
  },
  exit: {
    about: "cmd.exit",
    run({ close }) {
      close();
    },
  },
};

function enabledCommands() {
  const commands = new Map();
  for (const name of ENABLED_COMMANDS) {
    if (Object.hasOwn(COMMAND_LIBRARY, name)) {
      commands.set(name, COMMAND_LIBRARY[name]);
    }
  }
  return commands;
}

function commonPrefix(words) {
  if (!words.length) {
    return "";
  }
  let prefix = words[0];
  for (const word of words.slice(1)) {
    while (!word.startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
    }
  }
  return prefix;
}

function setupTerminal() {
  const terminal = document.getElementById("terminal");
  const menuBtn = document.getElementById("menu-btn");
  const form = document.getElementById("terminal-form");
  const input = document.getElementById("terminal-input");
  const outside = document.querySelectorAll("[data-inert-with-terminal]");
  const commands = enabledCommands();
  const history = [];
  let historyIndex = 0;
  let hinted = false;

  function setOutsideInert(value) {
    for (const node of outside) {
      node.inert = value;
    }
  }

  function openTerminal() {
    terminal.hidden = false;
    menuBtn.setAttribute("aria-expanded", "true");
    setOutsideInert(true);
    if (!hinted) {
      hinted = true;
      printLine(t("term.welcome"), "muted");
    }
    input.focus();
  }

  function closeTerminal() {
    if (matrixStop) {
      matrixStop();
    }
    terminal.hidden = true;
    menuBtn.setAttribute("aria-expanded", "false");
    setOutsideInert(false);
    menuBtn.focus({ preventScroll: true });
  }

  function complete() {
    const value = input.value.replace(/^\s+/, "").toLowerCase();
    const parts = value.split(/\s+/);
    let options;
    let head = "";
    let partial;
    if (parts.length === 1) {
      options = [...commands.keys()];
      partial = parts[0];
    } else {
      const command = commands.get(parts[0]);
      if (!command?.complete) {
        return;
      }
      options = command.complete();
      head = `${parts[0]} `;
      partial = parts.slice(1).join("-");
    }
    const matches = options.filter((option) => option.startsWith(partial));
    if (!matches.length) {
      return;
    }
    if (matches.length === 1) {
      input.value = `${head}${matches[0]}${parts.length === 1 && commands.get(matches[0])?.usage ? " " : ""}`;
      return;
    }
    const prefix = commonPrefix(matches);
    if (prefix.length > partial.length) {
      input.value = `${head}${prefix}`;
      return;
    }
    printLine(matches.join("  "), "muted");
  }

  menuBtn.addEventListener("click", () => {
    if (terminal.hidden) {
      openTerminal();
    } else {
      closeTerminal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (terminal.hidden) {
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if (!typing && !event.ctrlKey && !event.metaKey && !event.altKey && (event.key === "`" || event.key === "/")) {
        event.preventDefault();
        openTerminal();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeTerminal();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      if (document.activeElement === input) {
        complete();
      } else {
        input.focus();
      }
    }
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowUp" && history.length) {
      event.preventDefault();
      historyIndex = Math.max(0, historyIndex - 1);
      input.value = history[historyIndex];
    } else if (event.key === "ArrowDown" && history.length) {
      event.preventDefault();
      historyIndex = Math.min(history.length, historyIndex + 1);
      input.value = history[historyIndex] || "";
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const raw = input.value.trim();
    input.value = "";
    if (!raw) {
      return;
    }
    if (history[history.length - 1] !== raw) {
      history.push(raw);
    }
    historyIndex = history.length;
    printLine(`> ${raw}`, "input");
    const [name, ...args] = raw.toLowerCase().split(/\s+/);
    const command = commands.get(name);
    if (!command) {
      printLine(t("term.unknown"), "error");
      return;
    }
    try {
      await command.run({ args, commands, close: closeTerminal, focusInput: () => input.focus() });
    } catch (err) {
      console.error(err);
      printLine(t("term.crashed"), "error");
    }
  });
}

// --- Смена языка и темы ----------------------------------------------------------

function rerender() {
  if (meData) {
    renderMe(meData);
  }
  if (projectsData) {
    renderProjects(projectsData);
  }
  if (statusKey) {
    showStatus(statusKey);
  }
  if (skillItems.length) {
    renderSkillFilter();
    applySkillFilter();
  }
  trailInvalidate();
}

window.addEventListener("aboutme:lang", rerender);
window.addEventListener("aboutme:theme", () => {
  recolorTimeline();
  recolorPhysics();
});

wideQuery.addEventListener("change", () => {
  syncSkills();
});

motionQuery.addEventListener("change", () => {
  syncSkills();
});

async function main() {
  setupTrail();
  bindStrip(document.getElementById("project-strip"));
  try {
    const [me, projects] = await Promise.all([loadJson("/api/me"), loadJson("/api/projects")]);
    meData = me;
    projectsData = projects;
    renderMe(me);
    renderProjects(projects);
    skillItems = collectSkills(me, projectItems);
    syncSkills();
    trailInvalidate();
    watchSkills();
  } catch (err) {
    showStatus("status.loadFail");
    console.error(err);
  } finally {
    finishBoot();
    setupTerminal();
  }
}

main();
