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

function renderName(name) {
  const h1 = document.getElementById("name");
  h1.replaceChildren();
  const parts = name.match(/^(.*?)([A-Z0-9])$/);
  if (parts && parts[1]) {
    h1.append(el("span", "given", parts[1]));
    h1.append(el("span", "mark", parts[2]));
  } else {
    h1.textContent = name;
  }
}

function renderHealth(payload, ok) {
  const line = document.getElementById("health");
  const stamp = document.getElementById("tb-health");
  if (!ok || !payload) {
    line.textContent = "health · api down";
    line.classList.add("is-down");
    stamp.textContent = "api down";
    return;
  }
  const api = payload.status === "ok" ? "ok" : payload.status || "fail";
  const db = payload.database || "—";
  line.textContent = `health · api ${api} · pg ${db}`;
  line.classList.toggle("is-down", api !== "ok" || db !== "ok");
  stamp.textContent = `api ${api} · pg ${db}`;
}

function renderMe(me) {
  const name = me.name || "";
  document.title = name || "aboutme";
  renderName(name);
  document.getElementById("headline").textContent = me.headline || "";
  document.getElementById("tb-owner").textContent = name || "—";

  const about = document.getElementById("about");
  const aboutSection = document.getElementById("about-section");
  if (me.about) {
    about.textContent = me.about;
    aboutSection.hidden = false;
  }

  const socials = document.getElementById("socials");
  socials.replaceChildren();
  for (const item of me.socials || []) {
    const a = el("a", null, item.name);
    a.href = item.url;
    a.rel = "me noopener noreferrer";
    a.target = "_blank";
    socials.append(a);
  }
}

function renderProjects(payload) {
  const section = document.getElementById("projects-section");
  const list = document.getElementById("projects");
  const projects = payload.projects || [];
  if (!projects.length) {
    return;
  }

  list.replaceChildren();
  for (const project of projects) {
    const tr = el("tr");
    tr.append(el("td", "unit", project.title || project.slug || "unit"));
    tr.append(el("td", "role", project.description || ""));

    const stackCell = el("td");
    const stack = el("p", "stack");
    for (const item of project.stack || []) {
      stack.append(el("span", null, item));
    }
    stackCell.append(stack);
    tr.append(stackCell);

    const refCell = el("td");
    const refs = el("ul", "refs");
    for (const link of project.links || []) {
      const item = el("li");
      const a = el("a", null, link.name);
      a.href = link.url;
      a.rel = "noopener noreferrer";
      a.target = "_blank";
      item.append(a);
      refs.append(item);
    }
    refCell.append(refs);
    tr.append(refCell);
    list.append(tr);
  }
  section.hidden = false;
}

async function main() {
  try {
    const [me, projects, health] = await Promise.all([
      loadJson("/api/me"),
      loadJson("/api/projects"),
      loadJson("/api/health").catch(() => null),
    ]);
    renderMe(me);
    renderProjects(projects);
    renderHealth(health, Boolean(health));
  } catch (err) {
    showStatus("Не удалось загрузить данные с API.");
    renderHealth(null, false);
    console.error(err);
  } finally {
    document.body.classList.remove("is-loading");
  }
}

main();
