function showStatus(message) {
  const el = document.getElementById("status");
  el.hidden = false;
  el.textContent = message;
}

function loginUrl() {
  const next = `${window.location.pathname}${window.location.search}`;
  return `/login.html?next=${encodeURIComponent(next || "/apps.html")}`;
}

async function main() {
  const headline = document.getElementById("headline");
  const apps = document.getElementById("apps-section");
  const logout = document.getElementById("logout");

  logout.addEventListener("click", async () => {
    try {
      await fetch("/api/logout", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
      });
    } catch (err) {
      console.error(err);
    }
    window.location.replace("/login.html");
  });

  try {
    const authz = await fetch("/api/authz", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (authz.status === 401) {
      window.location.replace(loginUrl());
      return;
    }
    if (authz.status === 403) {
      logout.hidden = false;
      headline.hidden = false;
      headline.textContent = "Сессия есть, права apps нет.";
      showStatus("Нет доступа к приложениям.");
      return;
    }
    if (!authz.ok) {
      showStatus("Не удалось проверить доступ.");
      return;
    }
    logout.hidden = false;
    const session = await fetch("/api/session", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (session.ok) {
      const body = await session.json();
      headline.hidden = false;
      headline.textContent = body.login ? `Вход: ${body.login}` : "";
    }
    apps.hidden = false;
  } catch (err) {
    showStatus("Не удалось связаться с API.");
    console.error(err);
  } finally {
    document.body.classList.remove("is-loading");
  }
}

main();
