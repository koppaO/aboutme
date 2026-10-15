(function () {
  var STORAGE_KEY = "aboutme-theme";
  var root = document.documentElement;

  function apply(theme) {
    if (!theme || typeof theme !== "object") {
      return;
    }
    var colors = theme.colors || {};
    Object.keys(colors).forEach(function (key) {
      if (key.indexOf("--") === 0 && typeof colors[key] === "string") {
        root.style.setProperty(key, colors[key]);
      }
    });
    var sun = theme.sun;
    if (sun && typeof sun.top === "number" && typeof sun.right === "number" && typeof sun.size === "number") {
      root.style.setProperty("--sun-top", sun.top + "%");
      root.style.setProperty("--sun-right", sun.right + "%");
      root.style.setProperty("--sun-size", "min(" + sun.size + "vw, 22rem)");
    }
    if (theme.grain && typeof theme.grain.opacity === "number") {
      root.style.setProperty("--grain-opacity", String(theme.grain.opacity));
    }
    if (theme.tree && typeof theme.tree.opacity === "number") {
      root.style.setProperty("--tree-opacity", String(theme.tree.opacity));
    }
  }

  try {
    apply(JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null"));
  } catch (err) {
    // Сохранённой темы нет или storage недоступен: остаются цвета из styles.css.
  }

  fetch("/api/theme", { cache: "no-store" })
    .then(function (response) {
      return response.ok ? response.json() : null;
    })
    .then(function (theme) {
      apply(theme);
      if (theme) {
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
        } catch (err) {
          // Без storage тема просто не переживёт перезагрузку.
        }
      }
    })
    .catch(function () {});
})();
