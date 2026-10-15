// Админка: формы для /api/me, /api/projects, /api/theme и POST /api/users.
// Разметка строится только через createElement и textContent: данные из API
// никогда не попадают в страницу как HTML. Лимиты повторяют app/schemas.py,
// но проверка на клиенте лишь подсказка, решает сервер.
(function () {
  "use strict";

  var LOGIN_URL = "/login.html?next=/admin.html";
  var LIMITS = {
    name: 100,
    headline: 200,
    about: 5000,
    label: 80,
    url: 500,
    title: 200,
    description: 2000,
    stackItem: 50,
    slug: 80,
    socials: 20,
    projects: 50,
    stack: 20,
    links: 10,
    timeline: 30,
    skills: 40,
    skill: 50,
    date: 20,
    track: 200,
    login: 32,
    passwordMin: 8,
    passwordMax: 256,
  };
  var MEDIA = /^\/media\/[A-Za-z0-9._-]+$/;
  var COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
  var LOGIN = /^[a-zA-Z0-9_-]{1,32}$/;
  var COLOR_KEYS = ["--bg", "--ink", "--muted", "--line", "--panel", "--signal"];
  var COLOR_NAMES = {
    "--bg": "Фон",
    "--ink": "Текст",
    "--muted": "Второстепенный текст",
    "--line": "Линии",
    "--panel": "Панели",
    "--signal": "Акцент",
  };
  var MODES = [
    ["light", "Светлая"],
    ["dark", "Тёмная"],
  ];
  var SKILL_KINDS = [
    ["language", "Язык"],
    ["framework", "Фреймворк"],
    ["database", "База данных"],
    ["infra", "Инфраструктура"],
    ["tool", "Инструмент"],
  ];
  var KINDS = [
    ["study", "Учёба"],
    ["work", "Работа"],
    ["project", "Проект"],
  ];
  // В порядке разделов на странице.
  var SECTIONS = [
    { key: "me", id: "me-section", nav: "О себе" },
    { key: "projects", id: "projects-section", nav: "Проекты" },
    { key: "theme", id: "theme-section", nav: "Тема" },
    { key: "users", id: "users-section", nav: "Пользователи" },
  ];
  var DETAILS = {
    "invalid about": "Имя обязательно.",
    "invalid text": "Обязательное текстовое поле пустое или в нём не текст.",
    "invalid links": "У каждой ссылки нужны название и адрес http(s)://.",
    "invalid url": "Адрес ссылки должен начинаться с http:// или https://.",
    "invalid timeline": "Таймлайн: проверь начало, название и тип событий.",
    "invalid now_playing": "Плеер: нужно название трека.",
    "invalid media": "Трек и обложка — только /media/<файл>, без папок и «..».",
    "invalid projects": "У каждого проекта нужно название, в стеке не должно быть пустых пунктов.",
    "invalid theme": "Нужны обе темы и все шесть цветов.",
    "invalid color": "Цвет записывается как #rgb или #rrggbb.",
    "invalid user": "Логин и роль — латиница, цифры, _ и -. Пароль от 8 символов. Роль должна существовать.",
    "invalid login": "Логин — латиница, цифры, _ и -, до 32 символов.",
    "invalid skills": "Стек: у каждой технологии нужны название и категория, всего не больше 40.",
    "duplicate skill": "Стек: технологии повторяются (регистр не важен).",
  };

  var checks = new WeakMap();
  var dirty = new Set();
  var uid = 0;

  // --- DOM ------------------------------------------------------------------------

  function el(tag, props, children) {
    var node = document.createElement(tag);
    var value;
    Object.keys(props || {}).forEach(function (key) {
      var prop = props[key];
      if (prop == null || prop === false) {
        return;
      }
      if (key === "text") {
        node.textContent = String(prop);
      } else if (key === "className") {
        node.className = prop;
      } else if (key === "value") {
        value = prop;
      } else if (key === "checked" || key === "disabled") {
        node[key] = Boolean(prop);
      } else if (key.slice(0, 2) === "on" && typeof prop === "function") {
        node.addEventListener(key.slice(2), prop);
      } else {
        node.setAttribute(key, prop === true ? "" : String(prop));
      }
    });
    (children || []).forEach(function (child) {
      if (child != null) {
        node.append(child);
      }
    });
    if (value !== undefined) {
      node.value = String(value);
    }
    return node;
  }

  function nextId(prefix) {
    uid += 1;
    return prefix + "-" + uid;
  }

  function str(value) {
    return typeof value === "string" ? value : "";
  }

  function loc(value) {
    if (typeof value === "string") {
      return { ru: value, en: "" };
    }
    var source = value && typeof value === "object" ? value : {};
    return { ru: str(source.ru), en: str(source.en) };
  }

  function trimLoc(value) {
    return { ru: value.ru.trim(), en: value.en.trim() };
  }

  function check(input, fn) {
    checks.set(input, fn);
    input.addEventListener("input", function () {
      input.setCustomValidity("");
      input.removeAttribute("aria-invalid");
    });
    return input;
  }

  function runChecks(form) {
    var inputs = form.querySelectorAll("input, textarea, select");
    for (var i = 0; i < inputs.length; i += 1) {
      var input = inputs[i];
      var fn = checks.get(input);
      var off = input.matches(":disabled");
      var message = fn && !off ? fn(input.value.trim()) || "" : "";
      input.setCustomValidity(message);
      if (message || (!off && !input.checkValidity())) {
        input.setAttribute("aria-invalid", "true");
      } else {
        input.removeAttribute("aria-invalid");
      }
    }
  }

  // Поле с подписью; значение сразу пишется в obj[key].
  function field(label, obj, key, opts) {
    var o = opts || {};
    var input = el(o.multiline ? "textarea" : "input", {
      type: o.multiline ? null : o.type || "text",
      value: obj[key] == null ? "" : obj[key],
      maxlength: o.max,
      required: o.required,
      placeholder: o.placeholder,
      autocomplete: o.autocomplete || "off",
      spellcheck: o.spellcheck === false ? "false" : null,
      inputmode: o.inputmode,
      rows: o.rows,
      lang: o.lang,
    });
    input.addEventListener("input", function () {
      obj[key] = input.value;
    });
    if (o.check) {
      check(input, o.check);
    }
    var hint = o.hint ? el("span", { className: "field-hint", id: nextId("hint"), text: o.hint }) : null;
    if (hint) {
      input.setAttribute("aria-describedby", hint.id);
    }
    var node = el("label", { className: "field" + (o.wide ? " is-wide" : "") }, [
      el("span", { className: "field-label", text: label }),
      input,
      hint,
    ]);
    return { node: node, input: input };
  }

  // Пара полей ru/en для Localized.
  function pair(label, value, opts) {
    var o = opts || {};
    var ru = field(label + " · RU", value, "ru", {
      max: o.max,
      required: o.required,
      multiline: o.multiline,
      rows: o.rows,
      lang: "ru",
    });
    var en = field(label + " · EN", value, "en", {
      max: o.max,
      multiline: o.multiline,
      rows: o.rows,
      lang: "en",
    });
    return el("div", { className: "pair" }, [ru.node, en.node]);
  }

  function checkbox(label, obj, key, onChange) {
    var input = el("input", { type: "checkbox", checked: obj[key] });
    input.addEventListener("change", function () {
      obj[key] = input.checked;
      if (onChange) {
        onChange(input.checked);
      }
    });
    return { node: el("label", { className: "check" }, [input, el("span", { text: label })]), input: input };
  }

  function select(label, obj, key, options) {
    var input = el(
      "select",
      { value: obj[key] },
      options.map(function (option) {
        return el("option", { value: option[0], text: option[1] });
      })
    );
    input.addEventListener("change", function () {
      obj[key] = input.value;
    });
    return el("label", { className: "field" }, [el("span", { className: "field-label", text: label }), input]);
  }

  function knownKind(value, options, fallback) {
    return options.some(function (option) {
      return option[0] === value;
    })
      ? value
      : fallback;
  }

  function button(text, opts) {
    var o = opts || {};
    return el("button", {
      type: o.type || "button",
      className: o.className || "btn",
      text: text,
      "aria-label": o.label,
      disabled: o.disabled,
      onclick: o.onclick,
    });
  }

  function setStatus(node, message, kind) {
    node.textContent = message || "";
    node.hidden = !message;
    node.classList.toggle("is-error", kind === "error");
    node.classList.toggle("is-ok", kind === "ok");
  }

  // Список с добавлением, удалением и, по желанию, перестановкой.
  function listEditor(opts) {
    var items = opts.items;
    var listNode = el("ol", { className: "items" });
    var counter = el("span", { className: "items-count", "aria-live": "polite" });
    var addBtn = button(opts.addLabel, {
      onclick: function () {
        if (items.length >= opts.max) {
          return;
        }
        items.push(opts.create());
        render({ index: items.length - 1, first: true });
      },
    });

    function move(index, delta) {
      var target = index + delta;
      if (target < 0 || target >= items.length) {
        return;
      }
      var item = items.splice(index, 1)[0];
      items.splice(target, 0, item);
      render({ index: target, move: delta < 0 ? "up" : "down" });
    }

    function remove(index) {
      items.splice(index, 1);
      render({ add: true });
    }

    function render(focus) {
      listNode.replaceChildren();
      items.forEach(function (item, index) {
        var name = opts.itemLabel(index);
        var tools = el("div", { className: "item-tools" });
        if (opts.movable) {
          tools.append(
            button("↑", {
              label: "Выше: " + name,
              disabled: index === 0,
              onclick: function () {
                move(index, -1);
              },
            }),
            button("↓", {
              label: "Ниже: " + name,
              disabled: index === items.length - 1,
              onclick: function () {
                move(index, 1);
              },
            })
          );
        }
        tools.append(
          button("Удалить", {
            label: "Удалить: " + name,
            className: "btn is-danger",
            onclick: function () {
              remove(index);
            },
          })
        );
        var body = el("div", { className: "item-body" }, opts.renderItem(item, index));
        listNode.append(
          el("li", { className: "item" }, [
            el("fieldset", null, [el("legend", { text: name }), body, tools]),
          ])
        );
      });
      addBtn.disabled = items.length >= opts.max;
      counter.textContent = items.length + " из " + opts.max;
      if (focus) {
        if (opts.onChange) {
          opts.onChange();
        }
        var li = focus.index != null ? listNode.children[focus.index] : null;
        var target = null;
        if (li && focus.first) {
          target = li.querySelector("input, textarea, select");
        } else if (li && focus.move) {
          var moves = li.querySelectorAll(":scope > fieldset > .item-tools button");
          target = focus.move === "up" ? moves[0] : moves[1];
          if (target && target.disabled) {
            target = focus.move === "up" ? moves[1] : moves[0];
          }
        } else if (focus.add) {
          target = addBtn.disabled ? null : addBtn;
        }
        if (target) {
          target.focus();
        }
      }
    }

    render(null);
    return el("div", { className: "list" }, [
      listNode,
      el("div", { className: "list-foot" }, [addBtn, counter]),
    ]);
  }

  // --- Проверки --------------------------------------------------------------------

  function checkUrl(value) {
    if (!value) {
      return "Нужен адрес.";
    }
    if (value.length > LIMITS.url) {
      return "Адрес длиннее " + LIMITS.url + " символов.";
    }
    var scheme = value.split(":", 1)[0].toLowerCase();
    var parsed = null;
    try {
      parsed = new URL(value);
    } catch (err) {
      parsed = null;
    }
    if (!parsed || (scheme !== "http" && scheme !== "https") || !parsed.hostname) {
      return "Адрес должен начинаться с http:// или https://.";
    }
    return "";
  }

  function checkMedia(required) {
    return function (value) {
      if (!value) {
        return required ? "Нужен путь к файлу." : "";
      }
      var name = value.slice("/media/".length);
      if (!MEDIA.test(value) || value.indexOf("..") >= 0 || !name.replace(/\./g, "")) {
        return "Только /media/<файл>: латиница, цифры, точка, _ и -, без папок и «..».";
      }
      return "";
    };
  }

  function checkStack(value) {
    var parts = splitStack(value);
    if (parts.length > LIMITS.stack) {
      return "В стеке не больше " + LIMITS.stack + " пунктов.";
    }
    for (var i = 0; i < parts.length; i += 1) {
      if (parts[i].length > LIMITS.stackItem) {
        return "Пункт стека длиннее " + LIMITS.stackItem + " символов: " + parts[i].slice(0, 20) + "…";
      }
    }
    return "";
  }

  function splitStack(value) {
    return value
      .split(",")
      .map(function (part) {
        return part.trim();
      })
      .filter(Boolean);
  }

  function checkColor(value) {
    return COLOR.test(value) ? "" : "Цвет как #rgb или #rrggbb.";
  }

  function checkLogin(value) {
    return LOGIN.test(value) ? "" : "Латиница, цифры, _ и -, от 1 до 32 символов.";
  }

  // --- Сеть ------------------------------------------------------------------------

  async function api(method, path, body) {
    var init = { method: method, cache: "no-store", credentials: "same-origin", headers: {} };
    if (body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    var response;
    try {
      response = await fetch("/api" + path, init);
    } catch (err) {
      return { status: 0, data: null };
    }
    var data = null;
    try {
      data = await response.json();
    } catch (err) {
      data = null;
    }
    return { status: response.status, data: data };
  }

  function toLogin() {
    dirty.clear();
    window.setTimeout(function () {
      window.location.assign(LOGIN_URL);
    }, 1200);
  }

  function errorText(result) {
    var detail = result.data && typeof result.data.detail === "string" ? result.data.detail : "";
    switch (result.status) {
      case 0:
        return "Нет связи с API. Проверь сеть и попробуй ещё раз.";
      case 400:
        return "Сервер не смог разобрать запрос.";
      case 401:
        return "Сессия закончилась. Перевожу на страницу входа…";
      case 403:
        return "Нет прав на это действие, или запрос ушёл не с адреса сайта.";
      case 409:
        return "Пользователь с таким логином уже есть.";
      case 413:
        return "Слишком много данных за раз.";
      case 422:
        return (
          "Сервер не принял данные. " +
          (Object.prototype.hasOwnProperty.call(DETAILS, detail) ? DETAILS[detail] : "Проверь поля формы.")
        );
      case 429:
        return "Слишком много попыток. Подожди минуту.";
      default:
        return "Ошибка сервера (" + result.status + "). Попробуй позже.";
    }
  }

  // Общая форма раздела: проверка, подтверждение, отправка, ответ сервера.
  function sectionForm(opts) {
    var status = el("p", { className: "form-status", "aria-live": "polite", hidden: true });
    var submit = button(opts.submitLabel || "Сохранить", { type: "submit", className: "btn is-primary" });
    var form = el("form", { className: "admin-form", novalidate: true, "aria-label": opts.label });
    form.append(
      el("div", { className: "form-fields" }, opts.fields),
      el("div", { className: "form-actions" }, [submit, status])
    );
    form.addEventListener("input", function () {
      dirty.add(opts.key);
    });
    form.addEventListener("change", function () {
      dirty.add(opts.key);
    });
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      runChecks(form);
      if (!form.checkValidity()) {
        setStatus(status, "Проверь отмеченные поля.", "error");
        form.reportValidity();
        return;
      }
      var payload = opts.collect();
      if (!window.confirm(opts.confirm)) {
        return;
      }
      submit.disabled = true;
      setStatus(status, "Сохраняю…");
      var result = await api(opts.method, opts.path, payload);
      submit.disabled = false;
      // Для формы пользователя: пароль уходит один раз и в DOM не остаётся.
      if (opts.after) {
        opts.after();
      }
      if (result.status === 200 || result.status === 201) {
        dirty.delete(opts.key);
        var message = opts.done(result.data);
        setStatus(status, message || "Сохранено.", "ok");
        return;
      }
      setStatus(status, errorText(result), "error");
      if (result.status === 401) {
        toLogin();
      }
    });
    return { form: form, status: status };
  }

  function mount(sectionId, node) {
    var slot = document.querySelector("#" + sectionId + " [data-slot]");
    slot.replaceChildren(node);
  }

  function markDirty(key) {
    return function () {
      dirty.add(key);
    };
  }

  // --- О себе ----------------------------------------------------------------------

  function renderMe(data, note) {
    var source = data && typeof data === "object" ? data : {};
    var playing = source.now_playing && typeof source.now_playing === "object" ? source.now_playing : null;
    var model = {
      name: str(source.name),
      headline: loc(source.headline),
      about: loc(source.about),
      socials: (Array.isArray(source.socials) ? source.socials : []).map(function (item) {
        return { name: str(item && item.name), url: str(item && item.url) };
      }),
      timeline: (Array.isArray(source.timeline) ? source.timeline : []).map(function (item) {
        var event = item && typeof item === "object" ? item : {};
        return {
          start: str(event.start),
          end: str(event.end),
          present: event.end == null || event.end === "",
          title: loc(event.title),
          place: loc(event.place),
          kind: knownKind(event.kind, KINDS, "study"),
        };
      }),
      skills: (Array.isArray(source.skills) ? source.skills : []).map(function (item) {
        return {
          name: str(item && item.name),
          kind: knownKind(item && item.kind, SKILL_KINDS, "tool"),
        };
      }),
      playing: {
        on: Boolean(playing),
        title: str(playing && playing.title),
        artist: str(playing && playing.artist),
        src: str(playing && playing.src),
        cover: str(playing && playing.cover),
      },
    };

    var socials = listEditor({
      items: model.socials,
      max: LIMITS.socials,
      addLabel: "Добавить ссылку",
      itemLabel: function (index) {
        return "Ссылка " + (index + 1);
      },
      create: function () {
        return { name: "", url: "https://" };
      },
      movable: true,
      onChange: markDirty("me"),
      renderItem: function (item) {
        return [
          field("Название", item, "name", { max: LIMITS.label, required: true }).node,
          field("Адрес", item, "url", {
            type: "url",
            max: LIMITS.url,
            required: true,
            spellcheck: false,
            check: checkUrl,
          }).node,
        ];
      },
    });

    var timeline = listEditor({
      items: model.timeline,
      max: LIMITS.timeline,
      addLabel: "Добавить событие",
      itemLabel: function (index) {
        return "Событие " + (index + 1);
      },
      create: function () {
        return {
          start: String(new Date().getFullYear()),
          end: "",
          present: true,
          title: { ru: "", en: "" },
          place: { ru: "", en: "" },
          kind: "project",
        };
      },
      movable: true,
      onChange: markDirty("me"),
      renderItem: function (item) {
        var end = field("Конец", item, "end", {
          max: LIMITS.date,
          hint: "Год или год-месяц.",
        });
        // У отключённого поля подсказка «2027» читалась бы как дата конца.
        function setPresent(on) {
          end.input.disabled = on;
          end.input.required = !on;
          end.input.placeholder = on ? "" : "2027";
        }
        setPresent(item.present);
        var present = checkbox("По сей день", item, "present", function (on) {
          setPresent(on);
          end.input.setCustomValidity("");
          end.input.removeAttribute("aria-invalid");
        });
        return [
          el("div", { className: "pair is-dates" }, [
            field("Начало", item, "start", {
              max: LIMITS.date,
              required: true,
              placeholder: "2023",
              hint: "Год или год-месяц.",
            }).node,
            el("div", { className: "field" }, [end.node, present.node]),
          ]),
          pair("Название", item.title, { max: LIMITS.title, required: true }),
          pair("Место", item.place, { max: LIMITS.title }),
          select("Тип", item, "kind", KINDS),
        ];
      },
    });

    // Повторы ищем без учёта регистра, как сервер.
    function checkSkillName(value) {
      var key = value.toLowerCase();
      var count = model.skills.filter(function (skill) {
        return skill.name.trim().toLowerCase() === key;
      }).length;
      return count > 1 ? "«" + value + "» уже есть в стеке." : "";
    }

    var skills = listEditor({
      items: model.skills,
      max: LIMITS.skills,
      addLabel: "Добавить технологию",
      itemLabel: function (index) {
        return "Технология " + (index + 1);
      },
      create: function () {
        return { name: "", kind: "tool" };
      },
      movable: true,
      onChange: markDirty("me"),
      renderItem: function (item) {
        return [
          el("div", { className: "pair is-skill" }, [
            field("Название", item, "name", {
              max: LIMITS.skill,
              required: true,
              spellcheck: false,
              check: checkSkillName,
            }).node,
            select("Категория", item, "kind", SKILL_KINDS),
          ]),
        ];
      },
    });

    var player = el("fieldset", { className: "player-fields", disabled: !model.playing.on }, [
      el("legend", { className: "visually-hidden", text: "Трек" }),
      el("div", { className: "pair" }, [
        field("Название трека", model.playing, "title", { max: LIMITS.track, required: true }).node,
        field("Исполнитель", model.playing, "artist", { max: LIMITS.track }).node,
      ]),
      el("div", { className: "pair" }, [
        field("Файл трека", model.playing, "src", {
          max: LIMITS.url,
          required: true,
          placeholder: "/media/track.mp3",
          spellcheck: false,
          check: checkMedia(true),
          hint: "Только /media/<файл>.",
        }).node,
        field("Обложка", model.playing, "cover", {
          max: LIMITS.url,
          placeholder: "/media/cover.webp",
          spellcheck: false,
          check: checkMedia(false),
          hint: "Необязательно. Только /media/<файл>.",
        }).node,
      ]),
    ]);
    var playerToggle = checkbox("Показывать плеер на главной", model.playing, "on", function (on) {
      player.disabled = !on;
    });

    var section = sectionForm({
      key: "me",
      label: "О себе",
      method: "PUT",
      path: "/me",
      confirm: "Сохранить раздел «О себе»? Он заменится целиком.",
      fields: [
        el("div", { className: "group" }, [
          field("Имя", model, "name", { max: LIMITS.name, required: true }).node,
          pair("Подзаголовок", model.headline, { max: LIMITS.headline }),
          pair("О себе", model.about, { max: LIMITS.about, multiline: true, rows: 6 }),
        ]),
        el("div", { className: "group" }, [el("h3", { text: "Ссылки" }), socials]),
        el("div", { className: "group" }, [el("h3", { text: "Таймлайн" }), timeline]),
        el("div", { className: "group" }, [
          el("h3", { text: "Стек" }),
          el("p", {
            className: "field-hint",
            text: "Пустой список — главная соберёт стек из проектов. Порядок здесь — порядок на сайте.",
          }),
          skills,
        ]),
        el("div", { className: "group" }, [el("h3", { text: "Сейчас играет" }), playerToggle.node, player]),
      ],
      collect: function () {
        return {
          name: model.name.trim(),
          headline: trimLoc(model.headline),
          about: trimLoc(model.about),
          socials: model.socials.map(function (item) {
            return { name: item.name.trim(), url: item.url.trim() };
          }),
          skills: model.skills.map(function (item) {
            return { name: item.name.trim(), kind: item.kind };
          }),
          timeline: model.timeline.map(function (item) {
            return {
              start: item.start.trim(),
              end: item.present ? null : item.end.trim() || null,
              title: trimLoc(item.title),
              place: trimLoc(item.place),
              kind: item.kind,
            };
          }),
          now_playing: model.playing.on
            ? {
                title: model.playing.title.trim(),
                artist: model.playing.artist.trim(),
                src: model.playing.src.trim(),
                cover: model.playing.cover.trim() || null,
              }
            : null,
        };
      },
      done: function (saved) {
        renderMe(saved, "Сохранено. Главная покажет изменения после обновления страницы.");
      },
    });
    if (note) {
      setStatus(section.status, note, "ok");
    }
    mount("me-section", section.form);
  }

  // --- Проекты ---------------------------------------------------------------------

  function renderProjects(data, note) {
    var list = data && Array.isArray(data.projects) ? data.projects : [];
    var model = list.map(function (raw) {
      var item = raw && typeof raw === "object" ? raw : {};
      return {
        slug: str(item.slug),
        title: str(item.title),
        description: loc(item.description),
        stack: (Array.isArray(item.stack) ? item.stack : []).filter(function (part) {
          return typeof part === "string";
        }).join(", "),
        links: (Array.isArray(item.links) ? item.links : []).map(function (link) {
          return { name: str(link && link.name), url: str(link && link.url) };
        }),
      };
    });

    var projects = listEditor({
      items: model,
      max: LIMITS.projects,
      addLabel: "Добавить проект",
      itemLabel: function (index) {
        return "Проект " + (index + 1);
      },
      create: function () {
        return { slug: "", title: "", description: { ru: "", en: "" }, stack: "", links: [] };
      },
      movable: true,
      onChange: markDirty("projects"),
      renderItem: function (item) {
        var links = listEditor({
          items: item.links,
          max: LIMITS.links,
          addLabel: "Добавить ссылку",
          itemLabel: function (index) {
            return "Ссылка " + (index + 1);
          },
          create: function () {
            return { name: "", url: "https://" };
          },
          movable: false,
          onChange: markDirty("projects"),
          renderItem: function (link) {
            return [
              field("Название", link, "name", { max: LIMITS.label, required: true }).node,
              field("Адрес", link, "url", {
                type: "url",
                max: LIMITS.url,
                required: true,
                spellcheck: false,
                check: checkUrl,
              }).node,
            ];
          },
        });
        return [
          el("div", { className: "pair" }, [
            field("Название", item, "title", { max: LIMITS.title, required: true }).node,
            field("Slug", item, "slug", {
              max: LIMITS.slug,
              spellcheck: false,
              hint: "Пусто — возьмётся название.",
            }).node,
          ]),
          pair("Описание", item.description, { max: LIMITS.description, multiline: true, rows: 4 }),
          field("Стек", item, "stack", {
            max: (LIMITS.stackItem + 2) * LIMITS.stack,
            spellcheck: false,
            check: checkStack,
            hint: "Через запятую: FastAPI, nginx, Postgres.",
            wide: true,
          }).node,
          el("div", { className: "sublist" }, [el("h4", { text: "Ссылки" }), links]),
        ];
      },
    });

    var section = sectionForm({
      key: "projects",
      label: "Проекты",
      method: "PUT",
      path: "/projects",
      confirm: "Сохранить список проектов? Он заменится целиком.",
      fields: [projects],
      collect: function () {
        return {
          projects: model.map(function (item) {
            return {
              slug: item.slug.trim(),
              title: item.title.trim(),
              description: trimLoc(item.description),
              stack: splitStack(item.stack),
              links: item.links.map(function (link) {
                return { name: link.name.trim(), url: link.url.trim() };
              }),
            };
          }),
        };
      },
      done: function (saved) {
        renderProjects(saved, "Сохранено. Главная покажет изменения после обновления страницы.");
      },
    });
    if (note) {
      setStatus(section.status, note, "ok");
    }
    mount("projects-section", section.form);
  }

  // --- Тема ------------------------------------------------------------------------

  function longHex(value) {
    var v = value.toLowerCase();
    if (/^#[0-9a-f]{3}$/.test(v)) {
      return "#" + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
    }
    return /^#[0-9a-f]{6}$/.test(v) ? v : "#000000";
  }

  function renderTheme(data, note) {
    var source = data && typeof data === "object" ? data : {};
    var model = {};
    MODES.forEach(function (mode) {
      var block = source[mode[0]];
      var colors = block && typeof block === "object" && block.colors ? block.colors : {};
      model[mode[0]] = { colors: {} };
      COLOR_KEYS.forEach(function (key) {
        var value = typeof colors[key] === "string" && COLOR.test(colors[key]) ? colors[key] : "#000000";
        model[mode[0]].colors[key] = value.toLowerCase();
      });
    });

    var columns = MODES.map(function (mode) {
      var colors = model[mode[0]].colors;
      var preview = el("div", { className: "theme-preview", "aria-hidden": "true" }, [
        el("p", { className: "pv-title", text: "koppaO" }),
        el("p", { className: "pv-muted", text: "Второстепенный текст" }),
        el("div", { className: "pv-panel" }, [el("span", { className: "pv-signal", text: "акцент" })]),
      ]);
      function paint() {
        COLOR_KEYS.forEach(function (key) {
          if (COLOR.test(colors[key])) {
            preview.style.setProperty(key, colors[key]);
          }
        });
      }
      var rows = COLOR_KEYS.map(function (key) {
        var labelId = nextId("color");
        var picker = el("input", {
          type: "color",
          value: longHex(colors[key]),
          "aria-labelledby": labelId,
        });
        var text = check(
          el("input", {
            type: "text",
            value: colors[key],
            maxlength: 7,
            spellcheck: "false",
            autocomplete: "off",
            "aria-labelledby": labelId,
            required: true,
          }),
          checkColor
        );
        picker.addEventListener("input", function () {
          colors[key] = picker.value.toLowerCase();
          text.value = colors[key];
          text.setCustomValidity("");
          text.removeAttribute("aria-invalid");
          paint();
        });
        text.addEventListener("input", function () {
          colors[key] = text.value.trim().toLowerCase();
          if (COLOR.test(colors[key])) {
            picker.value = longHex(colors[key]);
            paint();
          }
        });
        return el("div", { className: "color-row" }, [
          el("span", { className: "field-label", id: labelId, text: COLOR_NAMES[key] + " " + key }),
          picker,
          text,
        ]);
      });
      paint();
      return el("fieldset", { className: "theme-col" }, [el("legend", { text: mode[1] })].concat(rows, [preview]));
    });

    var section = sectionForm({
      key: "theme",
      label: "Тема",
      method: "PUT",
      path: "/theme",
      confirm: "Сохранить цвета обеих тем?",
      fields: [el("div", { className: "theme-grid" }, columns)],
      collect: function () {
        var body = {};
        MODES.forEach(function (mode) {
          body[mode[0]] = { colors: Object.assign({}, model[mode[0]].colors) };
        });
        return body;
      },
      done: function (saved) {
        renderTheme(saved, "Сохранено. Новые цвета применятся после обновления страницы.");
      },
    });
    if (note) {
      setStatus(section.status, note, "ok");
    }
    mount("theme-section", section.form);
  }

  // --- Пользователи ----------------------------------------------------------------

  function renderUsers() {
    var model = { login: "", password: "", role: "admin" };
    var login = field("Логин", model, "login", {
      max: LIMITS.login,
      required: true,
      spellcheck: false,
      autocomplete: "off",
      check: checkLogin,
      hint: "Латиница, цифры, _ и -.",
    });
    var password = field("Пароль", model, "password", {
      type: "password",
      max: LIMITS.passwordMax,
      required: true,
      autocomplete: "new-password",
      check: function (value) {
        return value.length < LIMITS.passwordMin ? "Пароль от " + LIMITS.passwordMin + " символов." : "";
      },
      hint: "От " + LIMITS.passwordMin + " символов. После отправки поле очищается.",
    });
    password.input.minLength = LIMITS.passwordMin;
    var role = field("Роль", model, "role", {
      max: LIMITS.login,
      required: true,
      spellcheck: false,
      check: checkLogin,
      hint: "Роль должна уже существовать, например admin.",
    });

    function forgetPassword() {
      model.password = "";
      password.input.value = "";
    }

    var section = sectionForm({
      key: "users",
      label: "Новый пользователь",
      method: "POST",
      path: "/users",
      submitLabel: "Создать",
      confirm: "Создать пользователя?",
      fields: [el("div", { className: "group is-narrow" }, [login.node, password.node, role.node])],
      collect: function () {
        // Пароль идёт в тело как есть: пробелы по краям — часть пароля.
        return { login: model.login.trim(), password: password.input.value, role: model.role.trim() };
      },
      after: forgetPassword,
      done: function (created) {
        model.login = "";
        login.input.value = "";
        var who = created && typeof created.login === "string" ? created.login : "";
        var as = created && typeof created.role === "string" ? created.role : "";
        return "Создан пользователь " + who + " с ролью " + as + ".";
      },
    });
    mount("users-section", section.form);
  }

  // --- Старт -----------------------------------------------------------------------

  var globalStatus = document.getElementById("status");

  function fail(message) {
    setStatus(globalStatus, message, "error");
  }

  async function loadSection(key, render) {
    var result = await api("GET", "/" + key);
    if (result.status === 200) {
      render(result.data);
      return;
    }
    mount(
      key + "-section",
      el("p", { className: "form-status is-error", text: "Не удалось загрузить данные. " + errorText(result) })
    );
  }

  async function main() {
    var session = await api("GET", "/session");
    if (session.status === 401) {
      window.location.replace(LOGIN_URL);
      return;
    }
    if (session.status !== 200 || !session.data) {
      document.getElementById("whoami").textContent = "Вход не подтверждён.";
      fail(errorText(session));
      return;
    }
    var who = typeof session.data.login === "string" ? session.data.login : "";
    var resources = Array.isArray(session.data.resources) ? session.data.resources : [];
    document.getElementById("whoami").textContent = "Вы вошли как " + who + ".";

    var logout = document.getElementById("logout");
    logout.hidden = false;
    logout.addEventListener("click", async function () {
      if (dirty.size && !window.confirm("Есть несохранённые изменения. Всё равно выйти?")) {
        return;
      }
      logout.disabled = true;
      var result = await api("POST", "/logout");
      logout.disabled = false;
      if (result.status === 200) {
        dirty.clear();
        window.location.replace("/");
        return;
      }
      fail("Выйти не получилось. " + errorText(result));
    });

    var nav = document.getElementById("admin-nav");
    var visible = SECTIONS.filter(function (section) {
      return resources.indexOf(section.key) >= 0;
    });
    if (!visible.length) {
      fail("У этой роли нет разделов для правки.");
      return;
    }
    visible.forEach(function (section) {
      nav.append(el("a", { href: "#" + section.id, text: section.nav }));
      document.getElementById(section.id).hidden = false;
    });

    var loads = [];
    if (resources.indexOf("me") >= 0) {
      loads.push(loadSection("me", renderMe));
    }
    if (resources.indexOf("projects") >= 0) {
      loads.push(loadSection("projects", renderProjects));
    }
    if (resources.indexOf("theme") >= 0) {
      loads.push(loadSection("theme", renderTheme));
    }
    if (resources.indexOf("users") >= 0) {
      renderUsers();
    }
    await Promise.all(loads);
  }

  window.addEventListener("beforeunload", function (event) {
    if (dirty.size) {
      event.preventDefault();
      event.returnValue = "";
    }
  });

  main().catch(function (err) {
    fail("Админка не загрузилась. Обнови страницу.");
    console.error(err);
  });
})();
