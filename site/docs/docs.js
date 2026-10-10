// Pi-Bolt documentation: copy buttons, platform tabs, the mobile menu, the current section in "On this page", and search.
(function () {
  "use strict";

  function store(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, value);
    } catch (e) {
      return null;
    }
  }

  // Code blocks: a frame with an optional label (data-label on the <pre>) and a copy button. "$ " prompts and "# ..."
  // comment lines are left out of what is copied.
  document.querySelectorAll(".doc pre").forEach(function (pre) {
    var frame = document.createElement("div");
    frame.className = "code";
    pre.parentNode.insertBefore(frame, pre);
    if (pre.dataset.label) {
      var label = document.createElement("div");
      label.className = "label";
      label.textContent = pre.dataset.label;
      frame.appendChild(label);
    }
    frame.appendChild(pre);
    var button = document.createElement("button");
    button.type = "button";
    button.className = "copy";
    button.textContent = "Copy";
    button.setAttribute("aria-label", "Copy the code");
    button.addEventListener("click", function () {
      var clone = pre.cloneNode(true);
      clone.querySelectorAll(".p, .c").forEach(function (n) { n.remove(); });
      var text = clone.textContent.split("\n").map(function (line) { return line.replace(/\s+$/, ""); })
        .filter(function (line, i, all) { return !(line === "" && (i === 0 || i === all.length - 1)); }).join("\n");
      var done = function () {
        button.textContent = "Copied";
        button.classList.add("done");
        setTimeout(function () { button.textContent = "Copy"; button.classList.remove("done"); }, 1600);
      };
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () {});
    });
    frame.appendChild(button);
  });

  // Tabs. <div class="tabs" data-group="os"> with <div data-tab="macos" data-title="macOS"> panels. Groups with the same name
  // switch together, and the choice is remembered; the first visit picks the visitor's platform.
  function guessOs() {
    var p = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent;
    if (/win/i.test(p)) return "windows";
    if (/mac/i.test(p)) return "macos";
    if (/linux|x11/i.test(p)) return "linux";
    return null;
  }
  var groups = {};
  document.querySelectorAll(".tabs").forEach(function (tabs, n) {
    var group = tabs.dataset.group || "tabs-" + n;
    var panels = Array.prototype.slice.call(tabs.querySelectorAll(":scope > [data-tab]"));
    var list = document.createElement("div");
    list.setAttribute("role", "tablist");
    var buttons = panels.map(function (panel, i) {
      var id = "tab-" + n + "-" + i;
      var b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "tab");
      b.id = id;
      b.textContent = panel.dataset.title || panel.dataset.tab;
      b.dataset.tab = panel.dataset.tab;
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", id);
      b.addEventListener("click", function () { select(group, panel.dataset.tab, true); });
      b.addEventListener("keydown", function (e) {
        var k = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!k) return;
        var next = buttons[(i + k + buttons.length) % buttons.length];
        next.focus();
        select(group, next.dataset.tab, true);
      });
      list.appendChild(b);
      return b;
    });
    tabs.insertBefore(list, tabs.firstChild);
    (groups[group] = groups[group] || []).push({ buttons: buttons, panels: panels });
  });
  function select(group, name, remember) {
    (groups[group] || []).forEach(function (set) {
      var has = set.panels.some(function (p) { return p.dataset.tab === name; });
      var pick = has ? name : set.panels[0].dataset.tab;
      set.panels.forEach(function (p) { p.hidden = p.dataset.tab !== pick; });
      set.buttons.forEach(function (b) {
        var on = b.dataset.tab === pick;
        b.setAttribute("aria-selected", String(on));
        b.tabIndex = on ? 0 : -1;
      });
    });
    if (remember) store("pibolt-docs-tab-" + group, name);
  }
  Object.keys(groups).forEach(function (group) {
    select(group, store("pibolt-docs-tab-" + group) || (group === "os" ? guessOs() : null) || "", false);
  });

  // The menu on narrow screens.
  var menu = document.querySelector(".menu");
  var sidebar = document.getElementById("sidebar");
  var scrim = document.querySelector(".scrim");
  function setMenu(open) {
    sidebar.classList.toggle("open", open);
    scrim.hidden = !open;
    menu.setAttribute("aria-expanded", String(open));
  }
  menu.addEventListener("click", function () { setMenu(!sidebar.classList.contains("open")); });
  scrim.addEventListener("click", function () { setMenu(false); });
  var current = sidebar.querySelector('[aria-current="page"]');
  if (current && current.scrollIntoView) current.scrollIntoView({ block: "nearest" });

  // "On this page": the section being read.
  var tocLinks = Array.prototype.slice.call(document.querySelectorAll(".toc a"));
  if (tocLinks.length && "IntersectionObserver" in window) {
    var headings = tocLinks.map(function (a) { return document.getElementById(a.getAttribute("href").slice(1)); });
    var visible = {};
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { visible[e.target.id] = e.isIntersecting; });
      var active = null;
      for (var i = 0; i < headings.length; i++) {
        if (visible[headings[i].id]) { active = headings[i]; break; }
      }
      if (!active) {
        for (var j = headings.length - 1; j >= 0; j--) {
          if (headings[j].getBoundingClientRect().top < 120) { active = headings[j]; break; }
        }
      }
      tocLinks.forEach(function (a) { a.classList.toggle("active", active && a.getAttribute("href") === "#" + active.id); });
    }, { rootMargin: "-70px 0px -65% 0px" });
    headings.forEach(function (h) { if (h) observer.observe(h); });
  }

  // Search over search.json (one entry per section), loaded on first use.
  var dialog = document.querySelector(".search");
  var input = dialog.querySelector("input");
  var results = dialog.querySelector(".results");
  var index = null, hits = [], selected = 0, opener = null;
  function load() {
    if (index) return Promise.resolve(index);
    return fetch("search.json").then(function (r) { return r.json(); }).then(function (data) {
      index = data.map(function (d) {
        d.hay = (d.title + " " + d.section + " " + d.text).toLowerCase();
        return d;
      });
      return index;
    });
  }
  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  }
  function mark(text, words) {
    var out = escapeHtml(text);
    words.forEach(function (w) {
      if (w.length < 2) return;
      out = out.replace(new RegExp("(" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "ig"), "<mark>$1</mark>");
    });
    return out;
  }
  function snippet(text, words) {
    var lower = text.toLowerCase(), at = -1;
    words.some(function (w) { at = lower.indexOf(w); return at >= 0; });
    if (at < 0) return text.slice(0, 140);
    var start = Math.max(0, at - 50);
    return (start > 0 ? "… " : "") + text.slice(start, start + 150);
  }
  function search(q) {
    var words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) { hits = []; draw(words); return; }
    hits = index.filter(function (d) {
      return words.every(function (w) { return d.hay.indexOf(w) >= 0; });
    }).map(function (d) {
      var score = 0, head = (d.section || d.title).toLowerCase();
      words.forEach(function (w) {
        if (head.indexOf(w) >= 0) score += 10;
        if (d.title.toLowerCase().indexOf(w) >= 0) score += 4;
        if (head.indexOf(w) === 0) score += 3;
      });
      if (!d.section) score += 1;
      return { d: d, score: score };
    }).sort(function (a, b) { return b.score - a.score; }).slice(0, 12).map(function (h) { return h.d; });
    selected = 0;
    draw(words);
  }
  function draw(words) {
    results.textContent = "";
    if (!input.value.trim()) return;
    if (!hits.length) {
      var li = document.createElement("li");
      li.className = "empty";
      li.textContent = "No results for “" + input.value.trim() + "”.";
      results.appendChild(li);
      return;
    }
    hits.forEach(function (d, i) {
      var li = document.createElement("li");
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", String(i === selected));
      li.innerHTML = '<a href="' + d.url + '"><span class="where">' + escapeHtml(d.title) + "</span>" +
        '<span class="what">' + mark(d.section || d.title, words) + "</span>" +
        '<span class="snip">' + mark(snippet(d.text, words), words) + "</span></a>";
      li.addEventListener("mousemove", function () { if (selected !== i) { selected = i; highlight(); } });
      results.appendChild(li);
    });
  }
  function highlight() {
    Array.prototype.forEach.call(results.children, function (li, i) { li.setAttribute("aria-selected", String(i === selected)); });
    var el = results.children[selected];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  }
  function open() {
    opener = document.activeElement;
    dialog.hidden = false;
    document.body.style.overflow = "hidden";
    input.focus();
    input.select();
    load().then(function () { if (input.value) search(input.value); }, function () {});
  }
  function close() {
    dialog.hidden = true;
    document.body.style.overflow = "";
    if (opener && opener.focus) opener.focus();
  }
  document.querySelector(".search-open").addEventListener("click", open);
  dialog.addEventListener("click", function (e) { if (e.target === dialog) close(); });
  results.addEventListener("click", function (e) { if (e.target.closest("a")) close(); });
  input.addEventListener("input", function () { load().then(function () { search(input.value); }, function () {}); });
  input.addEventListener("keydown", function (e) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!hits.length) return;
      selected = (selected + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length;
      highlight();
    } else if (e.key === "Enter" && hits[selected]) {
      e.preventDefault();
      close();
      location.href = hits[selected].url;
    }
  });
  document.addEventListener("keydown", function (e) {
    var typing = /input|textarea|select/i.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
    if (e.key === "Escape") {
      if (!dialog.hidden) close();
      else if (sidebar.classList.contains("open")) setMenu(false);
    } else if (dialog.hidden && ((e.key === "/" && !typing) || (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)))) {
      e.preventDefault();
      open();
    }
  });
})();
