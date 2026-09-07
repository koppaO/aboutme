function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function showStatus(message) {
  const el = document.getElementById("status");
  el.hidden = false;
  el.textContent = message;
}

async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`${path}: ${response.status}`);
  }
  return response.json();
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
    const a = document.createElement("a");
    a.href = item.url;
    a.textContent = item.name;
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
    const li = document.createElement("li");
    const links = (project.links || [])
      .map(
        (link) =>
          `<li><a href="${escapeHtml(link.url)}" rel="noopener noreferrer" target="_blank">${escapeHtml(link.name)}</a></li>`,
      )
      .join("");
    const stack = (project.stack || [])
      .map((item) => `<span>${escapeHtml(item)}</span>`)
      .join("");

    li.innerHTML = `
      <h3>${escapeHtml(project.title)}</h3>
      <p>${escapeHtml(project.description || "")}</p>
      ${stack ? `<p class="stack">${stack}</p>` : ""}
      ${links ? `<ul class="links">${links}</ul>` : ""}
    `;
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
  }
}

main();
