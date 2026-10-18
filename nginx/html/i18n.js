// Строки интерфейса на двух языках. Подключается в <head>, чтобы <html lang> встал
// до отрисовки, а data-i18n-узлы перевелись сразу после разбора страницы.
(function () {
  var STORAGE_KEY = "aboutme-lang";
  var LANGS = ["ru", "en"];

  var DICT = {
    ru: {
      skip: "К содержимому",
      loading: "загрузка",
      "nav.label": "Разделы",
      "nav.about": "О себе",
      "nav.projects": "Проекты",
      "nav.clips": "Клипы",
      "lang.label": "Язык",
      "theme.dark": "Тёмная тема",
      "term.open": "/ терминал",
      "term.label": "Терминал",
      "term.input": "Команда",
      "term.hint": "Tab — дополнить, ↑↓ — история, Esc — закрыть",
      "section.about": "О себе",
      "section.playing": "Сейчас играет",
      "section.timeline": "Таймлайн",
      "section.stack": "Стек",
      "section.projects": "Проекты",
      "skills.filter": "Категории стека",
      "kind.language": "Языки",
      "kind.framework": "Фреймворки",
      "kind.database": "Базы данных",
      "kind.infra": "Инфраструктура",
      "kind.tool": "Инструменты",
      "projects.strip": "Лента проектов, листается стрелками",
      "project.fallback": "проект",
      "player.play": "Слушать",
      "player.pause": "Пауза",
      "player.playAria": "Слушать «{title}»",
      "player.pauseAria": "Пауза: «{title}»",
      "player.error": "Трек не загрузился.",
      "timeline.now": "сейчас",
      "timeline.study": "учёба",
      "timeline.work": "работа",
      "timeline.project": "проект",
      "footer.built": "Сайт работает на своём API: nginx и FastAPI.",
      "footer.hint": "Нажми /, чтобы открыть терминал.",
      "status.loadFail": "Не удалось загрузить данные с API. Обнови страницу через минуту.",
      "clips.title": "Клипы",
      "clips.headline": "Здесь будут короткие видео с проектов.",
      "clips.soonTitle": "Скоро",
      "clips.soon": "Список клипов появится позже. А пока загляни в проекты на главной.",
      "login.title": "Вход",
      "login.headline": "Служебный вход для владельца сайта.",
      "login.formTitle": "Аккаунт",
      "login.login": "Логин",
      "login.password": "Пароль",
      "login.submit": "Войти",
      "login.tooMany": "Слишком много попыток. Попробуй через минуту.",
      "login.origin": "Вход работает только с https://koppa0.dev",
      "login.noApi": "Не удалось связаться с API.",
      "login.wrong": "Неверный логин или пароль.",
      "cmd.help": "список команд",
      "cmd.whoami": "кто здесь живёт",
      "cmd.about": "к разделу «О себе»",
      "cmd.skills": "к стеку и встряхнуть капсулы",
      "cmd.projects": "к проектам",
      "cmd.links": "все ссылки",
      "cmd.open": "открыть ссылку из links",
      "cmd.openUsage": "<имя>",
      "cmd.clips": "страница с клипами",
      "cmd.status": "здоровье API и базы",
      "cmd.theme": "светлая или тёмная тема",
      "cmd.lang": "язык интерфейса",
      "cmd.matrix": "дождь из символов",
      "cmd.party": "радужный всплеск",
      "cmd.clear": "очистить экран",
      "cmd.exit": "закрыть терминал",
      "term.welcome": "help — список команд",
      "term.unknown": "нет такой команды. help — список.",
      "term.crashed": "команда упала, подробности в консоли",
      "term.unknownYet": "пока неизвестно",
      "term.emptySection": "раздел пуст",
      "term.noLinks": "ссылок нет",
      "term.openHint": "open <имя> — открыть",
      "term.whichLink": "какую? links — список",
      "term.noLink": "нет ссылки «{name}». links — список",
      "term.opening": "открываю {url}",
      "term.apiDown": "API сейчас недоступен",
      "term.allOk": "Сервисы в порядке",
      "term.health": "API: {api}, база: {db}",
      "term.none": "нет",
      "term.themeNow": "тема: {theme}",
      "term.themeSet": "тема: {theme}",
      "term.themeBad": "theme light или theme dark",
      "term.langNow": "язык: {lang}",
      "term.langSet": "язык: {lang}",
      "term.langBad": "lang ru или lang en",
      "term.matrixOn": "matrix: любая клавиша или клик — выход",
      "term.matrixOff": "matrix: выход",
      "term.matrixStill": "matrix: анимация выключена в настройках системы (reduced motion).",
      "term.party": "party!",
      "term.partyStill": "party: без анимации, раз система просит меньше движения. Всё равно ура.",
    },
    en: {
      skip: "Skip to content",
      loading: "loading",
      "nav.label": "Sections",
      "nav.about": "About",
      "nav.projects": "Projects",
      "nav.clips": "Clips",
      "lang.label": "Language",
      "theme.dark": "Dark theme",
      "term.open": "/ terminal",
      "term.label": "Terminal",
      "term.input": "Command",
      "term.hint": "Tab to complete, ↑↓ for history, Esc to close",
      "section.about": "About",
      "section.playing": "Now playing",
      "section.timeline": "Timeline",
      "section.stack": "Stack",
      "section.projects": "Projects",
      "skills.filter": "Stack categories",
      "kind.language": "Languages",
      "kind.framework": "Frameworks",
      "kind.database": "Databases",
      "kind.infra": "Infrastructure",
      "kind.tool": "Tools",
      "projects.strip": "Projects strip, scroll with arrow keys",
      "project.fallback": "project",
      "player.play": "Play",
      "player.pause": "Pause",
      "player.playAria": "Play “{title}”",
      "player.pauseAria": "Pause “{title}”",
      "player.error": "The track didn’t load.",
      "timeline.now": "now",
      "timeline.study": "study",
      "timeline.work": "work",
      "timeline.project": "project",
      "footer.built": "This site runs on its own API: nginx and FastAPI.",
      "footer.hint": "Press / to open the terminal.",
      "status.loadFail": "Couldn’t load data from the API. Refresh in a minute.",
      "clips.title": "Clips",
      "clips.headline": "Short videos from my projects will live here.",
      "clips.soonTitle": "Soon",
      "clips.soon": "The clip list is coming later. Meanwhile, check the projects on the main page.",
      "login.title": "Sign in",
      "login.headline": "Owner sign-in.",
      "login.formTitle": "Account",
      "login.login": "Login",
      "login.password": "Password",
      "login.submit": "Sign in",
      "login.tooMany": "Too many attempts. Try again in a minute.",
      "login.origin": "Sign-in only works on https://koppa0.dev",
      "login.noApi": "Couldn’t reach the API.",
      "login.wrong": "Wrong login or password.",
      "cmd.help": "list commands",
      "cmd.whoami": "who lives here",
      "cmd.about": "go to About",
      "cmd.skills": "go to the stack and shake the capsules",
      "cmd.projects": "go to Projects",
      "cmd.links": "all links",
      "cmd.open": "open a link from links",
      "cmd.openUsage": "<name>",
      "cmd.clips": "clips page",
      "cmd.status": "API and database health",
      "cmd.theme": "light or dark theme",
      "cmd.lang": "interface language",
      "cmd.matrix": "falling characters",
      "cmd.party": "rainbow burst",
      "cmd.clear": "clear the screen",
      "cmd.exit": "close the terminal",
      "term.welcome": "help lists commands",
      "term.unknown": "no such command. Try help.",
      "term.crashed": "the command failed, see the console",
      "term.unknownYet": "unknown so far",
      "term.emptySection": "this section is empty",
      "term.noLinks": "no links",
      "term.openHint": "open <name> to open one",
      "term.whichLink": "which one? links lists them",
      "term.noLink": "no link “{name}”. links lists them",
      "term.opening": "opening {url}",
      "term.apiDown": "The API is unavailable",
      "term.allOk": "All services are fine",
      "term.health": "API: {api}, database: {db}",
      "term.none": "none",
      "term.themeNow": "theme: {theme}",
      "term.themeSet": "theme: {theme}",
      "term.themeBad": "theme light or theme dark",
      "term.langNow": "language: {lang}",
      "term.langSet": "language: {lang}",
      "term.langBad": "lang ru or lang en",
      "term.matrixOn": "matrix: press any key or click to exit",
      "term.matrixOff": "matrix: done",
      "term.matrixStill": "matrix: animation is off because your system asks for reduced motion.",
      "term.party": "party!",
      "term.partyStill": "party: no animation, since your system asks for reduced motion. Still, hooray.",
    },
  };

  var root = document.documentElement;
  var lang = "ru";

  function stored() {
    try {
      var value = window.localStorage.getItem(STORAGE_KEY);
      return LANGS.indexOf(value) >= 0 ? value : null;
    } catch (err) {
      return null;
    }
  }

  function t(key, vars) {
    var table = DICT[lang] || DICT.ru;
    var text = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : DICT.ru[key];
    if (text == null) {
      return key;
    }
    if (vars) {
      text = text.replace(/\{(\w+)\}/g, function (match, name) {
        return Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match;
      });
    }
    return text;
  }

  // Переводимое поле из API: новая форма {ru, en} или старая строка.
  // Пустой перевод откатывается на ru.
  function pick(value) {
    if (typeof value === "string") {
      return value;
    }
    if (!value || typeof value !== "object") {
      return "";
    }
    var own = typeof value[lang] === "string" ? value[lang] : "";
    if (own.trim()) {
      return own;
    }
    return typeof value.ru === "string" ? value.ru : "";
  }

  function translate(scope) {
    var base = scope || document;
    var nodes = base.querySelectorAll("[data-i18n]");
    for (var i = 0; i < nodes.length; i += 1) {
      nodes[i].textContent = t(nodes[i].getAttribute("data-i18n"));
    }
    var labelled = base.querySelectorAll("[data-i18n-aria-label]");
    for (var j = 0; j < labelled.length; j += 1) {
      labelled[j].setAttribute("aria-label", t(labelled[j].getAttribute("data-i18n-aria-label")));
    }
    var titled = base.querySelectorAll("[data-i18n-title]");
    for (var m = 0; m < titled.length; m += 1) {
      titled[m].setAttribute("title", t(titled[m].getAttribute("data-i18n-title")));
    }
    var buttons = base.querySelectorAll("[data-lang]");
    for (var k = 0; k < buttons.length; k += 1) {
      buttons[k].setAttribute("aria-pressed", buttons[k].getAttribute("data-lang") === lang ? "true" : "false");
    }
  }

  function set(next, remember) {
    if (LANGS.indexOf(next) < 0) {
      return false;
    }
    var changed = next !== lang;
    lang = next;
    root.setAttribute("lang", next);
    if (remember) {
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch (err) {
        // Без storage язык сбросится при перезагрузке.
      }
    }
    if (document.readyState !== "loading") {
      translate();
    }
    if (changed) {
      window.dispatchEvent(new CustomEvent("aboutme:lang", { detail: { lang: next } }));
    }
    return true;
  }

  lang = stored() || "ru";
  root.setAttribute("lang", lang);

  window.aboutmeI18n = {
    t: t,
    pick: pick,
    get: function () {
      return lang;
    },
    set: function (next) {
      return set(next, true);
    },
    langs: LANGS.slice(),
    translate: translate,
  };

  document.addEventListener("DOMContentLoaded", function () {
    translate();
    var buttons = document.querySelectorAll("[data-lang]");
    for (var i = 0; i < buttons.length; i += 1) {
      buttons[i].addEventListener("click", function (event) {
        set(event.currentTarget.getAttribute("data-lang"), true);
      });
    }
  });
})();
