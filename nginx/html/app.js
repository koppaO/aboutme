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

function renderMe(me) {
  document.title = me.name || "aboutme";
  document.getElementById("name").textContent = me.name || "";
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
    const li = el("li");
    const top = el("div", "project-top");
    top.append(el("h3", null, project.title || project.slug || "project"));
    li.append(top);

    if (project.description) {
      li.append(el("p", "desc", project.description));
    }

    if (project.stack?.length) {
      const stack = el("p", "stack");
      for (const item of project.stack) {
        stack.append(el("span", null, item));
      }
      li.append(stack);
    }

    if (project.links?.length) {
      const links = el("ul", "links");
      for (const link of project.links) {
        const item = el("li");
        const a = el("a", null, link.name);
        a.href = link.url;
        a.rel = "noopener noreferrer";
        a.target = "_blank";
        item.append(a);
        links.append(item);
      }
      li.append(links);
    }

    list.append(li);
  }
  section.hidden = false;
}

async function main() {
  try {
    const [me, projects] = await Promise.all([
      loadJson("/api/me"),
      loadJson("/api/projects"),
    ]);
    renderMe(me);
    renderProjects(projects);
  } catch (err) {
    showStatus("Не удалось загрузить данные с API.");
    console.error(err);
  } finally {
    document.body.classList.remove("is-loading");
  }
}

main();
