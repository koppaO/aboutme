// Тема ставится до первой отрисовки: скрипт подключён в <head> без defer.
// Выбор пользователя живёт в localStorage, без него — системная тема.
// Цвета из /api/theme перекрывают значения из styles.css для текущей темы.
(function () {
  var CHOICE_KEY = "aboutme-theme-choice";
  var COLORS_KEY = "aboutme-theme-colors";
  var LEGACY_KEY = "aboutme-theme";
  var THEMES = ["light", "dark"];
  var KEYS = ["--bg", "--ink", "--muted", "--line", "--panel", "--signal"];
  var COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
  var root = document.documentElement;
  var system = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  var palettes = null;

  function read(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (err) {
      return null;
    }
  }

  function write(key, value) {
    try {
      if (value == null) {
        window.localStorage.removeItem(key);
      } else {
        window.localStorage.setItem(key, value);
      }
    } catch (err) {
      // Без storage выбор просто не переживёт перезагрузку.
    }
  }

  function storedChoice() {
    var value = read(CHOICE_KEY);
    return THEMES.indexOf(value) >= 0 ? value : null;
  }

  function systemTheme() {
    return system && system.matches ? "dark" : "light";
  }

  function current() {
    return root.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  // Берём только новый формат {light: {colors}, dark: {colors}} и только шесть известных ключей.
  // Старый ответ ({colors, sun, grain, tree}) даёт null и молча игнорируется.
  function clean(payload) {
    if (!payload || typeof payload !== "object") {
      return null;
    }
    var result = {};
    var found = false;
    THEMES.forEach(function (name) {
      var block = payload[name];
      var colors = block && typeof block === "object" ? block.colors : null;
      if (!colors || typeof colors !== "object") {
        return;
      }
      var palette = {};
      KEYS.forEach(function (key) {
        var value = colors[key];
        if (typeof value === "string" && COLOR.test(value)) {
          palette[key] = value;
        }
      });
      result[name] = palette;
      found = true;
    });
    return found ? result : null;
  }

  function paint() {
    var palette = (palettes && palettes[current()]) || {};
    KEYS.forEach(function (key) {
      if (palette[key]) {
        root.style.setProperty(key, palette[key]);
      } else {
        root.style.removeProperty(key);
      }
    });
    syncThemeColor();
  }

  // В <head> два theme-color по prefers-color-scheme. Если тему выбрали вручную
  // или она пришла из api, панель браузера должна совпасть с фоном страницы.
  function syncThemeColor() {
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    var bg = window.getComputedStyle(root).getPropertyValue("--bg").trim();
    if (!bg) {
      return;
    }
    for (var i = 0; i < metas.length; i += 1) {
      metas[i].setAttribute("content", bg);
    }
  }

  function syncButtons() {
    var dark = current() === "dark";
    var buttons = document.querySelectorAll("[data-theme-toggle]");
    for (var i = 0; i < buttons.length; i += 1) {
      buttons[i].setAttribute("aria-pressed", dark ? "true" : "false");
    }
  }

  function apply(name) {
    var next = name === "dark" ? "dark" : "light";
    var changed = next !== root.getAttribute("data-theme");
    root.setAttribute("data-theme", next);
    paint();
    syncButtons();
    if (changed) {
      window.dispatchEvent(new CustomEvent("aboutme:theme", { detail: { theme: next } }));
    }
  }

  function set(name, remember) {
    if (remember) {
      write(CHOICE_KEY, name === "dark" ? "dark" : "light");
    }
    apply(name);
  }

  write(LEGACY_KEY, null);
  try {
    palettes = clean(JSON.parse(read(COLORS_KEY) || "null"));
  } catch (err) {
    palettes = null;
  }
  apply(storedChoice() || systemTheme());

  if (system) {
    var follow = function () {
      if (!storedChoice()) {
        apply(systemTheme());
      }
    };
    if (system.addEventListener) {
      system.addEventListener("change", follow);
    } else if (system.addListener) {
      system.addListener(follow);
    }
  }

  window.aboutmeTheme = {
    get: current,
    set: function (name) {
      set(name, true);
    },
    toggle: function () {
      set(current() === "dark" ? "light" : "dark", true);
    },
  };

  document.addEventListener("DOMContentLoaded", function () {
    syncButtons();
    var buttons = document.querySelectorAll("[data-theme-toggle]");
    for (var i = 0; i < buttons.length; i += 1) {
      buttons[i].addEventListener("click", window.aboutmeTheme.toggle);
    }
  });

  fetch("/api/theme", { cache: "no-store" })
    .then(function (response) {
      return response.ok ? response.json() : null;
    })
    .then(function (payload) {
      var next = clean(payload);
      if (!next) {
        return;
      }
      palettes = next;
      write(COLORS_KEY, JSON.stringify(next));
      paint();
      window.dispatchEvent(new CustomEvent("aboutme:theme", { detail: { theme: current() } }));
    })
    .catch(function () {});
})();
