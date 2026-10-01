const FALLBACK_NEXT = "/";

function safeNext(raw) {
  if (typeof raw !== "string" || !raw || raw.length > 500) {
    return FALLBACK_NEXT;
  }
  if (!raw.startsWith("/") || raw.startsWith("//") || /[\u0000-\u001F\u007F\\]/.test(raw)) {
    return FALLBACK_NEXT;
  }
  return raw;
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
