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
  "clear",
  "exit",
];

const MATTER_SRC = "/vendor/matter-0.20.0.min.js";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const wideQuery = window.matchMedia("(min-width: 900px)");
const bootStarted = performance.now();

let meData = null;
let projectItems = [];
let stackLabels = [];
let physicsToken = 0;
let physicsState = null;
let physicsVisible = false;
let matterPromise = null;

function showStatus(message) {
  const el = document.getElementById("status");
  el.hidden = false;
  el.textContent = message;
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

function finishBoot() {
  const wait = reduceMotion ? 0 : Math.max(0, 1000 - (performance.now() - bootStarted));
  window.setTimeout(() => {
    document.body.classList.add("is-ready");
    const preloader = document.getElementById("preloader");
    if (!preloader) {
      return;
    }
    window.setTimeout(() => preloader.remove(), reduceMotion ? 0 : 500);
  }, wait);
}

function uniqueStack(projects) {
  const seen = new Set();
  const labels = [];
  for (const project of projects) {
    for (const part of project.stack || []) {
      const key = String(part).toLowerCase();
      if (!part || seen.has(key)) {
        continue;
      }
      seen.add(key);
      labels.push(part);
    }
  }
  return labels;
}

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
  const name = me.name || "";
  document.title = name || "aboutme";
  const heading = document.getElementById("name");
  heading.textContent = name;
  heading.dataset.text = name;
  document.getElementById("headline").textContent = me.headline || "";

  const about = document.getElementById("about");
  const aboutSection = document.getElementById("about-section");
  if (me.about) {
    about.textContent = me.about;
    aboutSection.hidden = false;
  }

  const socials = document.getElementById("socials");
  socials.replaceChildren();
  for (const item of me.socials || []) {
    const link = linkAnchor(item);
    link.rel = "me noopener noreferrer";
    socials.append(link);
  }
}

function fillProject(target, project) {
  if (project.description) {
    target.append(el("p", "desc", project.description));
  }
  if (project.stack?.length) {
    const stack = el("p", "stack");
    for (const item of project.stack) {
      stack.append(el("span", null, item));
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
    const preview = document.getElementById("project-preview");
    preview.replaceChildren();
    fillProject(preview, project);
  }
}

function bindStrip(strip) {
  const track = strip.querySelector(".strip-track");
  if (!track) {
    return;
  }
  let x = 0;
  let drag = null;

  function limit() {
    return Math.min(0, strip.clientWidth - track.scrollWidth);
  }

  function apply() {
    x = Math.min(0, Math.max(limit(), x));
    track.style.transform = `translate3d(${x}px, 0, 0)`;
  }

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
      x -= 96;
      apply();
    } else if (event.key === "ArrowLeft") {
      x += 96;
      apply();
    }
  });
  window.addEventListener("resize", apply);
}

function renderProjects(payload) {
  const section = document.getElementById("projects-section");
  const index = document.getElementById("project-index");
  const strip = document.getElementById("project-strip");
  projectItems = payload.projects || [];
  if (!projectItems.length) {
    return;
  }

  index.replaceChildren();
  const track = el("div", "strip-track");
  projectItems.forEach((project, projectIndex) => {
    const item = el("li");
    const button = el("button", null, project.title || project.slug || "проект");
    button.type = "button";
    button.addEventListener("mouseenter", () => selectProject(projectIndex));
    button.addEventListener("focus", () => selectProject(projectIndex));
    item.append(button);
    index.append(item);

    const card = el("article", "card");
    card.append(el("h3", null, project.title || project.slug || "проект"));
    fillProject(card, project);
    track.append(card);
  });

  strip.replaceChildren(track);
  bindStrip(strip);
  selectProject(0);
  section.hidden = false;
}

// --- Скиллы: капсулы на Matter.js -------------------------------------------

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

function mountPhysics(Matter, labels) {
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
  const styles = getComputedStyle(document.documentElement);
  const gold = styles.getPropertyValue("--gold").trim() || "#e4c36a";
  const shade = styles.getPropertyValue("--shade").trim() || "#0c100b";
  const font = '14px "Segoe UI", system-ui, sans-serif';
  const measure = render.context;
  measure.font = font;

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
  const bodies = labels.slice(0, 24).map((label, index) => {
    const capsuleWidth = Math.max(72, Math.ceil(measure.measureText(label).width) + 36);
    const capsuleHeight = 36;
    const span = Math.max(width - capsuleWidth - 24, 1);
    const x = capsuleWidth / 2 + 12 + Math.random() * span;
    // Капсулы стартуют над видимой областью и падают по очереди.
    const y = -capsuleHeight - index * 46;
    const body = Matter.Bodies.rectangle(x, y, capsuleWidth, capsuleHeight, {
      chamfer: { radius: capsuleHeight / 2 },
      restitution: 0.45,
      friction: 0.12,
      frictionAir: 0.02,
      label,
      render: { fillStyle: gold, strokeStyle: gold, lineWidth: 0 },
    });
    Matter.Body.setAngle(body, (Math.random() - 0.5) * 0.6);
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

  Matter.Events.on(render, "afterRender", () => {
    const context = render.context;
    context.save();
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.font = font;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = shade;
    for (const body of bodies) {
      context.save();
      context.translate(body.position.x, body.position.y);
      context.rotate(body.angle);
      context.fillText(body.label, 0, 0);
      context.restore();
    }
    context.restore();
  });

  const runner = Matter.Runner.create();
  Matter.Runner.run(runner, engine);
  Matter.Render.run(render);
  return { engine, render, runner, bodies, width };
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
    Matter.Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.3);
  }
  return true;
}

function renderSkillChips() {
  const box = document.getElementById("skills-static");
  box.replaceChildren();
  for (const label of stackLabels) {
    box.append(el("span", "chip", label));
  }
}

async function syncSkills() {
  const token = ++physicsToken;
  const section = document.getElementById("skills-section");
  if (!stackLabels.length) {
    stopPhysics();
    section.hidden = true;
    return;
  }
  section.hidden = false;
  renderSkillChips();
  const usePhysics = wideQuery.matches && !reduceMotion && physicsVisible;
  if (!usePhysics) {
    if (!wideQuery.matches || reduceMotion) {
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
    if (token !== physicsToken || !wideQuery.matches) {
      return;
    }
    stopPhysics();
    physicsState = mountPhysics(Matter, stackLabels);
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

// --- Радужные символы под курсором в первом экране ----------------------------

function setupGlyphField() {
  const canvas = document.getElementById("glyphs");
  if (!canvas || reduceMotion) {
    return;
  }
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }
  canvas.hidden = false;

  const CELL = 18;
  const LIFE = 900;
  const RADIUS = 1.7;
  const CHARSET = "01{}[]<>/\\|=+-*#$%&?!~^:;ABCDEFabcdef";
  const cells = new Map();
  let columns = 0;
  let rows = 0;
  let ratio = 1;
  let last = null;
  let frame = 0;

  function randomChar() {
    return CHARSET[Math.floor(Math.random() * CHARSET.length)];
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    columns = Math.ceil(rect.width / CELL);
    rows = Math.ceil(rect.height / CELL);
    cells.clear();
  }

  function light(x, y, now) {
    const col = Math.floor(x / CELL);
    const row = Math.floor(y / CELL);
    const reach = Math.ceil(RADIUS);
    for (let dy = -reach; dy <= reach; dy += 1) {
      for (let dx = -reach; dx <= reach; dx += 1) {
        const c = col + dx;
        const r = row + dy;
        if (c < 0 || r < 0 || c >= columns || r >= rows) {
          continue;
        }
        const distance = Math.hypot(dx, dy);
        if (distance > RADIUS || Math.random() > 0.75 - distance * 0.25) {
          continue;
        }
        cells.set(r * columns + c, {
          c,
          r,
          ch: randomChar(),
          hue: (now / 8 + c * 9 + r * 4) % 360,
          born: now - distance * 90,
        });
      }
    }
  }

  function draw() {
    frame = 0;
    const now = performance.now();
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, canvas.width / ratio, canvas.height / ratio);
    context.font = `600 ${Math.round(CELL * 0.78)}px ui-monospace, "Cascadia Mono", Consolas, monospace`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    for (const [key, cell] of cells) {
      const age = now - cell.born;
      if (age >= LIFE) {
        cells.delete(key);
        continue;
      }
      if (Math.random() < 0.06) {
        cell.ch = randomChar();
      }
      const alpha = 1 - (age / LIFE) ** 2;
      context.fillStyle = `hsla(${cell.hue}, 95%, 66%, ${alpha.toFixed(3)})`;
      context.fillText(cell.ch, cell.c * CELL + CELL / 2, cell.r * CELL + CELL / 2);
    }
    if (cells.size) {
      frame = window.requestAnimationFrame(draw);
    }
  }

  function onMove(event) {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
      last = null;
      return;
    }
    const now = performance.now();
    // Быстрое движение даёт редкие события: заполняем путь между ними.
    if (last) {
      const steps = Math.min(24, Math.floor(Math.hypot(x - last.x, y - last.y) / (CELL / 2)));
      for (let step = 1; step < steps; step += 1) {
        const t = step / steps;
        light(last.x + (x - last.x) * t, last.y + (y - last.y) * t, now);
      }
    }
    light(x, y, now);
    last = { x, y };
    if (!frame) {
      frame = window.requestAnimationFrame(draw);
    }
  }

  resize();
  window.addEventListener("resize", resize);
  window.addEventListener("pointermove", onMove, { passive: true });
  document.addEventListener("pointerleave", () => {
    last = null;
  });
}

// --- Появление секций при скролле --------------------------------------------

function setupReveal() {
  if (reduceMotion || !("IntersectionObserver" in window)) {
    return;
  }
  const targets = document.querySelectorAll(".reveal");
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      }
    },
    { rootMargin: "0px 0px -12% 0px" },
  );
  targets.forEach((target) => observer.observe(target));
  document.documentElement.classList.add("has-reveal");
}

// --- Терминал ------------------------------------------------------------------

function printLine(text, kind) {
  const log = document.getElementById("terminal-log");
  log.append(el("p", kind ? `is-${kind}` : null, text));
  log.scrollTop = log.scrollHeight;
}

function healthLine(payload, ok) {
  if (!ok || !payload) {
    return "API сейчас недоступен";
  }
  const api = payload.status === "ok";
  const db = payload.database === "ok";
  if (api && db) {
    return "Сервисы в порядке";
  }
  return `API: ${payload.status || "нет"} · база: ${payload.database || "нет"}`;
}

function scrollToSection(id) {
  const section = document.getElementById(id);
  if (!section || section.hidden) {
    printLine("раздел пуст", "muted");
    return false;
  }
  section.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
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
    about: "список команд",
    run({ commands }) {
      for (const [name, command] of commands) {
        const usage = command.usage ? `${name} ${command.usage}` : name;
        printLine(`${usage.padEnd(16)} ${command.about}`, "muted");
      }
    },
  },
  whoami: {
    about: "кто здесь живёт",
    run() {
      if (!meData?.name) {
        printLine("пока неизвестно", "muted");
        return;
      }
      printLine(meData.name);
      if (meData.headline) {
        printLine(meData.headline, "muted");
      }
    },
  },
  about: {
    about: "к разделу «О себе»",
    run({ close }) {
      if (scrollToSection("about-section")) {
        close();
      }
    },
  },
  skills: {
    about: "к стеку и встряхнуть капсулы",
    run({ close }) {
      if (!scrollToSection("skills-section")) {
        return;
      }
      close();
      window.setTimeout(shakeSkills, reduceMotion ? 0 : 450);
    },
  },
  projects: {
    about: "к проектам",
    run({ close }) {
      if (scrollToSection("projects-section")) {
        close();
      }
    },
  },
  links: {
    about: "все ссылки",
    run() {
      const targets = openTargets();
      if (!targets.length) {
        printLine("ссылок нет", "muted");
        return;
      }
      for (const target of targets) {
        printLine(`${slug(target.name).padEnd(16)} ${target.url}`, "muted");
      }
      printLine("open <имя> — открыть", "muted");
    },
  },
  open: {
    usage: "<имя>",
    about: "открыть ссылку из links",
    complete() {
      return openTargets().map((target) => slug(target.name));
    },
    run({ args }) {
      const wanted = slug(args.join(" "));
      if (!wanted) {
        printLine("какую? links — список", "error");
        return;
      }
      const targets = openTargets();
      const target =
        targets.find((item) => slug(item.name) === wanted) ||
        targets.find((item) => slug(item.name).startsWith(wanted));
      if (!target) {
        printLine(`нет ссылки «${wanted}». links — список`, "error");
        return;
      }
      printLine(`открываю ${target.url}`, "muted");
      window.open(safeUrl(target.url), "_blank", "noopener,noreferrer");
    },
  },
  clips: {
    about: "страница с клипами",
    run() {
      window.location.assign("/clips.html");
    },
  },
  status: {
    about: "здоровье API и базы",
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
  clear: {
    about: "очистить экран",
    run() {
      document.getElementById("terminal-log").replaceChildren();
    },
  },
  exit: {
    about: "закрыть терминал",
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
  const story = document.getElementById("story");
  const topNav = document.getElementById("top-nav");
  const commands = enabledCommands();
  const history = [];
  let historyIndex = 0;
  let hinted = false;

  function openTerminal() {
    terminal.hidden = false;
    menuBtn.setAttribute("aria-expanded", "true");
    story.inert = true;
    topNav.inert = true;
    if (!hinted) {
      hinted = true;
      printLine("help — список команд", "muted");
    }
    input.focus();
  }

  function closeTerminal() {
    terminal.hidden = true;
    menuBtn.setAttribute("aria-expanded", "false");
    story.inert = false;
    topNav.inert = false;
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
      printLine("нет такой команды. help — список.", "error");
      return;
    }
    try {
      await command.run({ args, commands, close: closeTerminal });
    } catch (err) {
      console.error(err);
      printLine("команда упала, подробности в консоли", "error");
    }
  });
}

async function main() {
  setupGlyphField();
  setupReveal();
  try {
    const [me, projects] = await Promise.all([loadJson("/api/me"), loadJson("/api/projects")]);
    meData = me;
    renderMe(me);
    renderProjects(projects);
    stackLabels = uniqueStack(projects.projects || []);
    syncSkills();
    watchSkills();
  } catch (err) {
    showStatus("Не удалось загрузить данные с API.");
    console.error(err);
  } finally {
    finishBoot();
    setupTerminal();
  }
}

wideQuery.addEventListener("change", () => {
  syncSkills();
});

main();
