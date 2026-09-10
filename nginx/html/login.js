const FALLBACK_NEXT = "/apps.html";
const ALLOWED_NEXT_HOSTS = new Set([
  "koppa0.dev",
  "money.koppa0.dev",
  "travel.koppa0.dev",
]);

function safeNext(raw) {
  if (!raw) {
    return FALLBACK_NEXT;
  }
  if (raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("\\")) {
    return raw;
  }
  try {
    const url = new URL(raw);
    if (url.protocol === "https:" && ALLOWED_NEXT_HOSTS.has(url.hostname)) {
      return url.href;
    }
  } catch (_err) {
    return FALLBACK_NEXT;
  }
  return FALLBACK_NEXT;
}

function nextTarget() {
  const params = new URLSearchParams(window.location.search);
  return safeNext(params.get("next"));
}

function showStatus(message) {
  const el = document.getElementById("status");
  el.hidden = false;
  el.textContent = message;
}

function loginError(status) {
  if (status === 429) {
    return "Слишком много попыток. Подожди минуту.";
  }
  if (status === 403) {
    return "Вход только с https://koppa0.dev";
  }
  if (status === 404 || status >= 500) {
    return "Не удалось связаться с API.";
  }
  return "Неверный логин или пароль.";
}

async function main() {
  const form = document.getElementById("login-form");
  try {
    const session = await fetch("/api/session", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (session.ok) {
      window.location.replace(nextTarget());
      return;
    }
  } catch (err) {
    showStatus("Не удалось связаться с API.");
    console.error(err);
  } finally {
    document.body.classList.remove("is-loading");
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const login = document.getElementById("login").value;
    const password = document.getElementById("password").value;
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login, password }),
      });
      if (!response.ok) {
        showStatus(loginError(response.status));
        return;
      }
      window.location.replace(nextTarget());
    } catch (err) {
      showStatus("Не удалось связаться с API.");
      console.error(err);
    }
  });
}

main();
