(function () {
  "use strict";
  var KINDS = window.LEDGER_KINDS, Vault = window.Vault;
  var state = { quests: [], people: [], places: [], timeline: [], notes: [], improvements: [], guild: [], picks: [], ballot: null, votes: [] };
  var members = [];
  var loaded = { quests: false, people: false, places: false, timeline: false, notes: false, improvements: false, guild: false, picks: false, members: false, ballot: false };
  var ballotError = false;
  var COLLECTIONS = ["quests", "people", "places", "timeline", "notes", "improvements", "guild", "picks"];
  var confirming = null, confirmingReset = false, voteControlsMissing = false, pickProfiles = {};
  var db = null, sb = null, myId = null, isOwner = false, gm = false;
  var epoch = 0; // bumped on log-out so replies from the old session are ignored
  var editing = { quests: null, people: null, places: null };
  var pinFor = null, activePlace = null;

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "cls") n.className = attrs[k];
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function $(id) { return document.getElementById(id); }
  function setStatus(msg) { $("status").textContent = msg || ""; }
  function byOrder(a, b) { return (a.d.order || 999) - (b.d.order || 999) || String(a.d.title || a.d.name || "").localeCompare(String(b.d.title || b.d.name || "")); }
  function visible(list) { return list.filter(function (x) { return gm || x.d.revealed === true; }); }

  /* ---------- tabs ---------- */
  var TABS = ["guild", "timeline", "quests", "people", "places", "notes"];
  function showTab(name) {
    if (TABS.indexOf(name) < 0) name = "guild";
    TABS.forEach(function (t) {
      $(t).hidden = t !== name;
      $("tab-" + t).setAttribute("aria-selected", t === name ? "true" : "false");
    });
    try { history.replaceState(null, "", "#" + name); } catch (e) {}
    if (typeof fitLists === "function") fitLists();
  }
  document.querySelectorAll("nav button").forEach(function (b) {
    b.addEventListener("click", function () { showTab(b.dataset.tab); });
  });
  showTab((location.hash || "").slice(1));
  document.querySelectorAll(".subtabs button").forEach(function (b) {
    b.addEventListener("click", function () { showMap(b.dataset.map); });
  });

  /* ---------- render ---------- */
  function render() {
    document.body.classList.toggle("gm", gm);
    indexMoments();
    renderProfiles(); renderGuild(); renderTimeline(); renderQuests(); renderPeople(); renderPlaces(); renderNotes();
    if (isOwner) renderSync();
    fitLists();
    $("c-timeline").textContent = loaded.timeline ? " " + visible(state.timeline).length : "";
    $("c-quests").textContent = loaded.quests ? " " + visible(state.quests).length : "";
    $("c-people").textContent = loaded.people ? " " + visible(state.people).length : "";
    $("c-places").textContent = loaded.places ? " " + visible(state.places).length : "";
    $("c-notes").textContent = loaded.notes ? " " + state.notes.length : "";
  }

  function gmBar(kind, item) {
    if (!gm) return null;
    var d = item.d;
    var bar = el("div", { cls: "gm-bar" }, [
      d.revealed ? null : el("span", { cls: "chip", text: "HIDDEN FROM PLAYERS" }),
      el("button", { cls: "btn small ghost", type: "button", text: d.revealed ? "Hide" : "Reveal to players",
        onclick: function () { write(db.collection(kind).doc(item.id).update({ revealed: !d.revealed }), d.revealed ? "Hidden." : "Revealed to players."); } }),
      KINDS[kind] ? el("button", { cls: "btn small ghost", type: "button", text: "Edit", onclick: function () { startEdit(kind, item); } }) : null
    ]);
    if (kind === "quests") {
      var sel = el("select", { "aria-label": "Quest status", id: "status-" + item.id });
      ["available", "active", "completed"].forEach(function (s) {
        var o = el("option", { value: s, text: s.charAt(0).toUpperCase() + s.slice(1) });
        if (s === (d.status || "available")) o.selected = true; sel.appendChild(o);
      });
      sel.style.width = "auto";
      sel.addEventListener("change", function () { write(db.collection("quests").doc(item.id).update({ status: sel.value }), "Status updated."); });
      bar.appendChild(sel);
    }
    if (kind === "places") {
      bar.appendChild(el("button", { cls: "btn small ghost", type: "button", text: pinFor === item.id ? "Click the chart…" : typeof d.x === "number" ? "Move pin" : "Pin on chart",
        onclick: function () { pinFor = pinFor === item.id ? null : item.id; render(); } }));
      if (typeof d.x === "number") bar.appendChild(el("button", { cls: "btn small ghost", type: "button", text: "Remove pin",
        onclick: function () { if (pinFor === item.id) pinFor = null; write(db.collection("places").doc(item.id).update({ x: null, y: null }), "Pin removed."); } }));
    }
    if (kind === "timeline") {
      // Sessions are edited in the vault; removing one here is undone by syncing its recap again.
      bar.appendChild(el("button", { cls: "btn small danger", type: "button", text: "Remove session",
        onclick: function () { write(db.collection("timeline").doc(item.id).delete(), "Session removed. Sync its recap again to bring it back."); } }));
    }
    return bar;
  }

  function renderQuests() {
    var box = $("quest-groups"); box.textContent = "";
    if (!loaded.quests) { box.appendChild(el("div", { cls: "empty", text: "Opening the ledger…" })); return; }
    var list = visible(state.quests).sort(byOrder);
    if (!list.length) { box.appendChild(el("div", { cls: "empty", text: "No jobs on the board yet. The guild's first commission arrives at the welcome ceremony." })); return; }
    [["active", "In progress"], ["available", "On the job board"], ["completed", "Completed"]].forEach(function (g) {
      var items = list.filter(function (q) { return (q.d.status || "available") === g[0]; });
      if (!items.length) return;
      var grp = el("div", { cls: "group" }, [el("h2", null, [document.createTextNode(g[1] + " "), el("span", { cls: "label", text: items.length + (items.length === 1 ? " JOB" : " JOBS") })])]);
      items.forEach(function (q) {
        var d = q.d, st = d.status || "available";
        var meta = el("div", { cls: "meta" });
        if (d.giver) meta.appendChild(el("span", null, [el("b", { text: "POSTED BY" }), document.createTextNode(d.giver)]));
        if (d.reward) meta.appendChild(el("span", null, [el("b", { text: "REWARD" }), document.createTextNode(d.reward)]));
        if (d.xp) meta.appendChild(el("span", null, [el("b", { text: "GUILD XP" }), document.createTextNode(Number(d.xp).toLocaleString())]));
        grp.appendChild(el("article", { cls: "quest " + st + (d.revealed ? "" : " is-hidden"), id: "quest-" + q.id }, [
          el("span", { cls: "stamp", text: st === "active" ? "IN PROGRESS" : st === "completed" ? "DONE" : "POSTED" }),
          el("h3", { text: d.title || "Untitled job" }), meta,
          d.summary ? el("p", { text: d.summary }) : null,
          timelineButton(q.id),
          gmBar("quests", q)
        ]));
      });
      box.appendChild(grp);
    });
  }

  var selPerson = null, explicitSel = false, peopleQuery = "";
  function personInitial(n) { return String(n || "?").replace(/^(The|Captain|Old Mother|Grandma|Father)\s+/i, "").charAt(0).toUpperCase(); }
  function lastSeen(p) { var m = 0; (p.d.log || []).concat(moments[p.id] || []).forEach(function (e) { if (Number(e.session) > m) m = Number(e.session); }); return m; }
  function renderPeople() {
    var box = $("people-list"); box.textContent = "";
    if (!loaded.people) { box.appendChild(el("div", { cls: "empty", text: "Opening the ledger…" })); return; }
    var all = visible(state.people).slice().sort(function (a, b) { return String(a.d.name || "").localeCompare(String(b.d.name || "")); });
    if (!all.length) { box.appendChild(el("div", { cls: "empty", text: "You haven't met anyone yet. New faces will appear here as you meet them." })); return; }
    var q = peopleQuery.trim().toLowerCase();
    var list = !q ? all : all.filter(function (p) { return [p.d.name, p.d.role, p.d.where, p.d.summary].join(" ").toLowerCase().indexOf(q) >= 0; });
    if (selPerson && !all.some(function (p) { return p.id === selPerson; })) { selPerson = null; explicitSel = false; }
    var current = all.filter(function (p) { return p.id === selPerson; })[0] || list[0] || all[0];

    var dir = el("div", { cls: "dir" + (explicitSel ? " has-sel" : "") });
    var lst = el("div", { cls: "dir-list", role: "navigation", "aria-label": "People" });
    if (!list.length) lst.appendChild(el("div", { cls: "empty", text: "Nobody matches that search." }));
    var letter = "";
    list.forEach(function (p) {
      var d = p.d, n = String(d.name || "?"), L = personInitial(n), seen = lastSeen(p);
      if (L !== letter) { letter = L; lst.appendChild(el("div", { cls: "dir-letter", text: L })); }
      lst.appendChild(el("button", { type: "button", cls: "dir-row" + (d.revealed ? "" : " is-hidden"), "aria-current": current && current.id === p.id ? "true" : "false",
        onclick: function () { selPerson = p.id; explicitSel = true; renderPeople(); var dd = document.querySelector("#people .dir-detail"); if (dd && window.innerWidth <= 720) dd.scrollIntoView({ block: "start" }); } }, [
        el("span", { cls: "mono", "aria-hidden": "true", text: L }),
        el("span", { cls: "nm", text: n }),
        el("span", { cls: "sub", text: [d.role, seen ? "last seen session " + seen : ""].filter(Boolean).join(" · ") })
      ]));
    });
    dir.appendChild(lst);

    var det = el("article", { cls: "dir-detail" });
    if (current) {
      var d = current.d, n = String(d.name || "?");
      det.appendChild(el("button", { cls: "btn small ghost back-btn", type: "button", text: "← Everyone", onclick: function () { explicitSel = false; renderPeople(); } }));
      det.appendChild(el("div", { cls: "dir-head" }, [
        el("div", { cls: "mono", "aria-hidden": "true", text: personInitial(n) }),
        el("h2", { text: n }),
        d.role ? el("div", { cls: "role", text: d.role }) : null,
        d.where ? el("div", { cls: "where", text: "Found: " + d.where }) : null
      ]));
      var tb = timelineButton(current.id); if (tb) det.appendChild(tb);
      det.appendChild(el("h3", { text: "WHAT WE KNOW" }));
      det.appendChild(el("p", { cls: "known", text: d.summary || "Not much yet." }));
      // The GM's hand-written log plus every timeline moment that links this person (those are managed in the vault).
      var log = (d.log || []).map(function (e, ix) { return { e: e, ix: ix }; })
        .concat((moments[current.id] || []).map(function (e, i) { return { e: e, ix: -1, at: i }; }))
        .sort(function (a, b) { return (Number(b.e.session) || 0) - (Number(a.e.session) || 0) || (a.ix < 0) - (b.ix < 0) || b.ix - a.ix || (a.at || 0) - (b.at || 0); });
      det.appendChild(el("h3", { text: "INTERACTIONS" + (log.length ? " · " + log.length : "") }));
      if (!log.length) det.appendChild(el("p", { cls: "known", text: "No recorded interactions yet." }));
      else {
        var ul = el("ul", { cls: "log" });
        log.forEach(function (x) {
          var li = el("li", null, [
            el("span", { cls: "ses", text: x.e.session ? "SESSION " + x.e.session : "EARLIER" }),
            el("div", null, [el("p", { text: x.e.text || "" }),
              gm && x.ix >= 0 ? el("button", { cls: "btn small danger del", type: "button", text: "Delete entry", onclick: function () {
                var arr = (current.d.log || []).slice(); arr.splice(x.ix, 1);
                write(db.collection("people").doc(current.id).update({ log: arr }), "Entry deleted.");
              } }) : null])
          ]);
          ul.appendChild(li);
        });
        det.appendChild(ul);
      }
      if (gm) {
        var sesIn = el("input", { type: "number", id: "logSession", min: "1", placeholder: "Session" }); sesIn.style.width = "110px";
        var txt = el("textarea", { id: "logText", placeholder: "What happened between the party and " + n + "?" }); txt.style.minHeight = "70px";
        det.appendChild(el("div", { cls: "gm-panel" }, [
          el("div", { cls: "label", text: "GM: ADD AN INTERACTION" }),
          el("div", { cls: "gm-form" }, [sesIn, txt, el("button", { cls: "btn small", type: "button", text: "Add to log", onclick: function () {
            var s2 = Number($("logSession").value) || 0, tx = $("logText").value.trim();
            if (!tx) { setStatus("Write the entry first."); return; }
            var arr = (current.d.log || []).slice(); arr.push({ session: s2, text: tx.slice(0, 2000) });
            write(db.collection("people").doc(current.id).update({ log: arr }), "Added to " + n + "'s log.");
          } })])
        ]));
        var bar = gmBar("people", current); if (bar) det.appendChild(bar);
      }
    }
    dir.appendChild(det);
    box.appendChild(dir);
    fitLists();
  }


  /* ---------- timeline ---------- */
  // Each session (synced from a vault recap) holds events that [[link]] vault notes. Links resolve to ledger entries by
  // vault note name, or failing that by name. Players only see revealed sessions, and links to revealed entries.
  var KIND_LABEL = { quests: "Quest", people: "Person", places: "Place" };
  var moments = {}, linkIndex = {}, tlFilter = null;
  function sessions() { return visible(state.timeline).slice().sort(function (a, b) { return (Number(a.d.session) || 0) - (Number(b.d.session) || 0); }); }
  function indexMoments() {
    linkIndex = {}; moments = {};
    ["quests", "people", "places"].forEach(function (k) {
      visible(state[k]).forEach(function (it) { var n = nameOf(it).toLowerCase(); if (n && !linkIndex[n]) linkIndex[n] = { kind: k, item: it }; });
    });
    ["quests", "people", "places"].forEach(function (k) {
      visible(state[k]).forEach(function (it) { if (it.d.vaultNote) linkIndex[String(it.d.vaultNote).toLowerCase()] = { kind: k, item: it }; });
    });
    sessions().forEach(function (s) {
      (s.d.events || []).forEach(function (e) {
        eventLinks(e).forEach(function (h) { (moments[h.item.id] = moments[h.item.id] || []).push({ session: s.d.session, text: e.text }); });
      });
    });
  }
  function eventLinks(e) {
    var out = [], seen = {};
    (e.links || []).forEach(function (l) { var h = linkIndex[String(l).toLowerCase()]; if (h && !seen[h.item.id]) { seen[h.item.id] = true; out.push(h); } });
    return out;
  }
  function timelineButton(id) {
    var n = (moments[id] || []).length;
    if (!n) return null;
    return el("button", { cls: "btn small ghost tl-btn", type: "button", text: "On the timeline · " + n,
      onclick: function () { tlFilter = id; showTab("timeline"); render(); window.scrollTo(0, 0); } });
  }
  function openEntry(h) {
    if (h.kind === "people") { selPerson = h.item.id; explicitSel = true; peopleQuery = ""; $("peopleSearch").value = ""; }
    if (h.kind === "places") { activePlace = h.item.id; explicitPlace = true; placeQuery = ""; $("placeSearch").value = ""; placesMap = mapOf(h.item.d); }
    showTab(h.kind); render();
    var target = h.kind === "quests" ? $("quest-" + h.item.id) : h.kind === "places" ? $("place-detail") : document.querySelector("#people .dir-detail");
    if (target) target.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  function renderTimeline() {
    var box = $("timeline-list"); box.textContent = "";
    if (!loaded.timeline) { box.appendChild(el("div", { cls: "empty", text: "Opening the ledger…" })); return; }
    var list = sessions().reverse();
    if (!list.length) { box.appendChild(el("div", { cls: "empty", text: "Nothing on the timeline yet. After each session, the story so far appears here." })); return; }

    var refs = {}, order = [];
    list.forEach(function (s) { (s.d.events || []).forEach(function (e) { eventLinks(e).forEach(function (h) { if (!refs[h.item.id]) { refs[h.item.id] = h; order.push(h); } }); }); });
    if (tlFilter && !refs[tlFilter]) tlFilter = null;
    var sel = el("select", { id: "tlFilter" });
    sel.appendChild(el("option", { value: "", text: "Everyone and everything" }));
    [["people", "People"], ["places", "Places"], ["quests", "Quests"]].forEach(function (g) {
      var hs = order.filter(function (h) { return h.kind === g[0]; }).sort(function (a, b) { return nameOf(a.item).localeCompare(nameOf(b.item)); });
      if (!hs.length) return;
      var og = el("optgroup", { label: g[1] });
      hs.forEach(function (h) { var o = el("option", { value: h.item.id, text: nameOf(h.item) }); if (h.item.id === tlFilter) o.selected = true; og.appendChild(o); });
      sel.appendChild(og);
    });
    sel.addEventListener("change", function () { tlFilter = sel.value || null; renderTimeline(); });
    var bar = el("div", { cls: "tl-bar" }, [el("label", { cls: "label", "for": "tlFilter", text: "SHOW MOMENTS WITH" }), sel]);
    if (tlFilter) bar.appendChild(el("button", { cls: "btn small ghost", type: "button", text: "Open " + nameOf(refs[tlFilter].item), onclick: function () { openEntry(refs[tlFilter]); } }));
    box.appendChild(bar);

    list.forEach(function (s) {
      var d = s.d;
      var evs = (d.events || []).filter(function (e) { return !tlFilter || eventLinks(e).some(function (h) { return h.item.id === tlFilter; }); });
      if (tlFilter && !evs.length) return;
      var ol = el("ol", { cls: "moments" });
      evs.forEach(function (e) {
        var links = eventLinks(e);
        ol.appendChild(el("li", null, [el("p", { text: e.text }),
          links.length ? el("div", { cls: "links" }, links.map(function (h) {
            var on = h.item.id === tlFilter;
            return el("button", { type: "button", cls: "link-chip k-" + h.kind, "aria-pressed": on ? "true" : "false", "aria-label": KIND_LABEL[h.kind] + ": " + nameOf(h.item),
              title: on ? "Show everything" : "Show only moments with " + nameOf(h.item), text: nameOf(h.item),
              onclick: function () { tlFilter = on ? null : h.item.id; renderTimeline(); } });
          })) : null]));
      });
      var heading = d.session ? "Session " + d.session : "Session";
      box.appendChild(el("article", { cls: "session" + (d.revealed ? "" : " is-hidden") }, [
        el("h2", null, [document.createTextNode(heading + " "), d.title && d.title !== heading ? el("span", { cls: "label", text: String(d.title).toUpperCase() }) : null]),
        !tlFilter && d.summary ? el("p", { cls: "tl-summary", text: d.summary }) : null,
        ol, gmBar("timeline", s)
      ]));
    });
  }

  /* ---------- chart ---------- */
  var SVGNS = "http://www.w3.org/2000/svg";
  function s(tag, attrs) { var n = document.createElementNS(SVGNS, tag); for (var k in attrs) n.setAttribute(k, attrs[k]); return n; }
  // One map per Places tab. Pins are stored in chart units: 1000 across, with the height following the image's shape.
  // A map whose image is missing (no world.jpg yet) is simply not shown.
  var MAPS = {
    town: { src: "map.jpg?v=1", label: "Map of Guardian's Rest" },
    world: { src: "world.jpg?v=1", label: "Map of the island" }
  };
  var MAP_W = 1000, PIN_R = 10, LABEL_SIZE = 18, chartBase = null, placesMap = "town";
  try { if (localStorage.getItem("ledger-places-map") === "world") placesMap = "world"; } catch (e) {}
  function mapOf(d) { return d.map === "world" ? "world" : "town"; }
  function mapInfo(name) {
    var m = MAPS[name];
    if (!m.probe) {
      m.probe = new Image();
      m.probe.onload = function () { m.h = Math.round(MAP_W * m.probe.naturalHeight / m.probe.naturalWidth); render(); };
      m.probe.onerror = function () { m.missing = true; render(); };
      m.probe.src = m.src;
    }
    return m;
  }
  function showMap(name) {
    placesMap = name; pinFor = null; activePlace = null; explicitPlace = false;
    try { localStorage.setItem("ledger-places-map", name); } catch (e) {}
    render();
  }
  function drawBase(svg) {
    var g = s("g", {});
    g.appendChild(s("rect", { "class": "map-bg", x: 0, y: 0, width: MAP_W, height: 750, fill: "var(--land)" }));
    g.appendChild(s("image", { "class": "map-img", x: 0, y: 0, width: MAP_W, height: 750, preserveAspectRatio: "xMidYMid slice" }));
    svg.appendChild(g);
    chartBase = g;
  }

  function svgPoint(svg, evt) {
    var pt = svg.createSVGPoint(); pt.x = evt.clientX; pt.y = evt.clientY;
    var m = svg.getScreenCTM(); if (!m) return null;
    return pt.matrixTransform(m.inverse());
  }

  function renderPlaces() {
    var svg = $("chart");
    if (!chartBase) {
      drawBase(svg);
      svg.addEventListener("click", function (evt) {
        if (!gm || !pinFor || !db) return;
        var p = svgPoint(svg, evt); if (!p) return;
        var id = pinFor; pinFor = null;
        write(db.collection("places").doc(id).update({ x: Math.round(p.x), y: Math.round(p.y) }), "Pinned on the chart.");
      });
    }
    var all = visible(state.places), m = mapInfo(placesMap), h = m.h || 750;
    ["town", "world"].forEach(function (k) {
      $("map-" + k).setAttribute("aria-selected", k === placesMap ? "true" : "false");
      $("c-map-" + k).textContent = loaded.places ? " " + all.filter(function (pl) { return mapOf(pl.d) === k; }).length : "";
    });
    $("chart-box").hidden = !!m.missing;
    $("map-missing").hidden = !(m.missing && gm);
    $("chart-label").textContent = m.label;
    svg.setAttribute("viewBox", "0 0 " + MAP_W + " " + h);
    svg.setAttribute("aria-label", m.label);
    chartBase.querySelector(".map-bg").setAttribute("height", h);
    var img = chartBase.querySelector(".map-img"); img.setAttribute("height", h);
    if (img.getAttribute("href") !== m.src) img.setAttribute("href", m.src);
    svg.style.cursor = gm && pinFor ? "crosshair" : "default";
    var old = svg.querySelector("#pins"); if (old) old.remove();
    var pins = s("g", { id: "pins" });
    var list = all.filter(function (pl) { return mapOf(pl.d) === placesMap; }).sort(byOrder);
    // A pin's name shows on hover or focus, and stays up for the selected place (which is how phones see it).
    // Names live in their own layer above every dot, so a label is never hidden under a neighbouring pin.
    var labels = s("g", { "class": "pin-labels", "aria-hidden": "true" });
    function label(d) {
      var name = String(d.name || ""), gap = PIN_R + 5, left = d.x > MAP_W - name.length * LABEL_SIZE * 0.62 - gap;
      var t = s("text", { "class": "pin-label", x: d.x + (left ? -gap : gap), y: d.y + LABEL_SIZE * 0.35, "text-anchor": left ? "end" : "start" });
      t.textContent = name; return t;
    }
    var hoverLabel = null;
    list.forEach(function (pl) {
      var d = pl.d; if (typeof d.x !== "number" || typeof d.y !== "number") return;
      var pg = s("g", { "class": "pin" + (d.revealed ? "" : " hidden-pin") + (activePlace === pl.id ? " active" : ""),
        transform: "translate(" + d.x + " " + d.y + ")", tabindex: "0", role: "button", "aria-label": String(d.name || "Place") });
      pg.appendChild(s("circle", { "class": "dot", r: PIN_R }));
      function pick(e) { e.stopPropagation(); selectPlace(pl.id); }
      function show() { hide(); if (activePlace !== pl.id) { hoverLabel = label(d); labels.appendChild(hoverLabel); } }
      function hide() { if (hoverLabel) { hoverLabel.remove(); hoverLabel = null; } }
      pg.addEventListener("click", pick);
      pg.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") pick(e); });
      pg.addEventListener("mouseenter", show); pg.addEventListener("focus", show);
      pg.addEventListener("mouseleave", hide); pg.addEventListener("blur", hide);
      pins.appendChild(pg);
      if (activePlace === pl.id) labels.appendChild(label(d));
    });
    pins.appendChild(labels);
    svg.appendChild(pins);

    var dir = $("place-dir"), box = $("place-list"), det = $("place-detail");
    box.textContent = ""; det.textContent = "";
    if (!loaded.places) { dir.classList.remove("has-sel"); box.appendChild(el("div", { cls: "empty", text: "Opening the ledger…" })); return; }
    var q = placeQuery.trim().toLowerCase();
    var shown = !q ? list : list.filter(function (pl) { return [pl.d.name, pl.d.kind, pl.d.summary].join(" ").toLowerCase().indexOf(q) >= 0; });
    if (activePlace && !list.some(function (pl) { return pl.id === activePlace; })) { activePlace = null; explicitPlace = false; }
    var current = list.filter(function (pl) { return pl.id === activePlace; })[0] || shown[0] || list[0];
    dir.classList.toggle("has-sel", explicitPlace && !!current);
    if (!list.length) box.appendChild(el("div", { cls: "empty", text: placesMap === "town" ? "No places in town charted yet." : "No places beyond the town charted yet." }));
    else if (!shown.length) box.appendChild(el("div", { cls: "empty", text: "No place matches that search." }));
    shown.forEach(function (pl) {
      var d = pl.d, pinned = typeof d.x === "number";
      box.appendChild(el("button", { type: "button", cls: "dir-row" + (d.revealed ? "" : " is-hidden"), "aria-current": current && current.id === pl.id ? "true" : "false",
        onclick: function () { selectPlace(pl.id); } }, [
        el("span", { cls: "mono pin-mono", "aria-hidden": "true", text: personInitial(d.name || "?") }),
        el("span", { cls: "nm", text: d.name || "Unnamed place" }),
        el("span", { cls: "sub", text: [d.kind, gm && !pinned ? "not on the map" : ""].filter(Boolean).join(" · ") })
      ]));
    });
    if (current) placeDetail(det, current);
  }

  // The reading panel beside the map: what the party knows, who's found there, and its moments on the timeline.
  var placeQuery = "", explicitPlace = false;
  function selectPlace(id) {
    activePlace = id; explicitPlace = true; render();
    if (window.innerWidth <= 860) { var dd = $("place-detail"); if (dd) dd.scrollIntoView({ block: "start", behavior: "smooth" }); }
  }
  function placeDetail(det, current) {
    var d = current.d, name = String(d.name || "Unnamed place");
    det.appendChild(el("button", { cls: "btn small ghost back-btn", type: "button", text: "← All places", onclick: function () { explicitPlace = false; render(); } }));
    det.appendChild(el("div", { cls: "place-head" }, [
      el("h2", { text: name }),
      d.kind ? el("div", { cls: "role", text: d.kind }) : null,
      gm && typeof d.x !== "number" ? el("div", { cls: "label", text: "NOT ON THE MAP YET" }) : null
    ]));
    det.appendChild(el("h3", { text: "WHAT WE KNOW" }));
    det.appendChild(el("p", { cls: "known", text: d.summary || "Not much yet." }));
    var here = visible(state.people).filter(function (p) { return String(p.d.where || "").trim().toLowerCase() === name.toLowerCase(); })
      .sort(function (a, b) { return String(a.d.name || "").localeCompare(String(b.d.name || "")); });
    if (here.length) {
      det.appendChild(el("h3", { text: "PEOPLE HERE · " + here.length }));
      det.appendChild(el("div", { cls: "links" }, here.map(function (p) {
        return el("button", { type: "button", cls: "link-chip k-people", text: p.d.name || "Someone", title: "Open " + (p.d.name || "this person"),
          onclick: function () { openEntry({ kind: "people", item: p }); } });
      })));
    }
    var ms = (moments[current.id] || []).slice().sort(function (a, b) { return (Number(b.session) || 0) - (Number(a.session) || 0); });
    det.appendChild(el("h3", { text: "ON THE TIMELINE" + (ms.length ? " · " + ms.length : "") }));
    if (!ms.length) det.appendChild(el("p", { cls: "known", text: "Nothing has happened here yet." }));
    else det.appendChild(el("ul", { cls: "log" }, ms.map(function (m) {
      return el("li", null, [el("span", { cls: "ses", text: m.session ? "SESSION " + m.session : "EARLIER" }), el("div", null, [el("p", { text: m.text || "" })])]);
    })));
    var bar = gmBar("places", current); if (bar) det.appendChild(bar);
  }

  /* ---------- guild ---------- */
  var LEVELS = [0, 100, 500, 1400, 2600, 4100, 5900, 8000, 10400, 13100, 16100, 19400, 23000, 26900, 31100, 35600, 40400, 45500, 50900, 56600];
  var RANKS = ["Adventuring Intern", "Junior Associate", "Associate", "Senior Associate", "Team Lead", "Supervisor", "Assistant Manager", "Manager", "Senior Manager", "Associate Director", "Director", "Senior Director", "Vice President", "Senior Vice President", "Executive Vice President", "Chief Adventuring Officer", "Managing Partner", "Board Member", "Chair of the Board", "Guildmaster General"];
  function guildState() { var g = state.guild.filter(function (x) { return x.id === "state"; })[0]; return g ? g.d : {}; }
  function guildXp() {
    var xp = 0;
    state.quests.forEach(function (q) { if ((q.d.status || "") === "completed") xp += Number(q.d.xp) || 0; });
    return xp + (Number(guildState().bonusXp) || 0);
  }
  function levelFor(xp) { var l = 1; for (var i = 0; i < LEVELS.length; i++) if (xp >= LEVELS[i]) l = i + 1; return l; }
  function badge(level) {
    var svg = document.createElementNS(SVGNS, "svg"); svg.setAttribute("viewBox", "0 0 100 110"); svg.setAttribute("aria-hidden", "true");
    svg.appendChild(s("path", { d: "M50 4 L92 18 V54 C92 80 72 98 50 106 C28 98 8 80 8 54 V18 Z", fill: "var(--sea)", stroke: "var(--ink)", "stroke-width": 3 }));
    var tx = s("text", { x: 50, y: 66, "text-anchor": "middle", "font-family": "IM Fell English, Georgia, serif", "font-size": 40, fill: "var(--sand)" }); tx.textContent = String(level); svg.appendChild(tx);
    var lt = s("text", { x: 50, y: 30, "text-anchor": "middle", "font-family": "Alegreya Sans SC, sans-serif", "font-size": 12, fill: "var(--sand)", "letter-spacing": 1.5 }); lt.textContent = "LEVEL"; svg.appendChild(lt);
    return svg;
  }
  function renderGuild() {
    var box = $("guild-body"); box.textContent = "";
    if (!loaded.quests || !loaded.improvements || !loaded.guild || !loaded.picks || !loaded.ballot) { box.appendChild(el("div", { cls: "empty", text: "Opening the ledger…" })); return; }
    var xp = guildXp(), level = levelFor(xp), max = level >= LEVELS.length;
    var floor = LEVELS[level - 1], next = max ? floor : LEVELS[level];
    var pct = max ? 100 : Math.max(0, Math.min(100, Math.round((xp - floor) / (next - floor) * 100)));
    var bar = el("div", { cls: "xp-bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(pct), "aria-label": "Progress to the next rank" }, [el("div", { cls: "xp-fill" })]);
    bar.firstChild.style.width = pct + "%";
    box.appendChild(el("div", { cls: "rank-card" }, [
      el("div", { cls: "rank-badge" }, [badge(level)]),
      el("div", { cls: "label", text: "GUILD RANK · AMARAN GUILD OF ADVENTURERS" }),
      el("h2", { cls: "rank-title", text: RANKS[level - 1] }),
      el("div", { cls: "xp-row" }, [bar, el("div", { cls: "xp-text" }, [
        el("span", { text: xp.toLocaleString() + " XP" }),
        el("span", { text: max ? "Top of the ladder" : (next - xp).toLocaleString() + " XP to " + RANKS[level] + " (level " + (level + 1) + ")" })
      ])])
    ]));

    var imps = state.improvements.slice().sort(function (a, b) { return (a.d.minLevel || 0) - (b.d.minLevel || 0) || String(a.d.name).localeCompare(String(b.d.name)); });
    var picks = state.picks.filter(function (pk) { return pk.d.improvement; });
    var pickOf = {}; picks.forEach(function (pk) { pickOf[pk.d.improvement] = pk; });
    var homePick = imps.filter(function (it) { return it.d.home && pickOf[it.id]; })[0];
    var homeBuilt = !!homePick;
    var homeSite = homePick ? homePick.d.site : null;
    var SITE_NAMES = { beach: "beach", town: "town", grass: "grassland" };
    function siteOk(it) { var ss = it.d.sites; return !ss || !ss.length || !homeSite || ss.indexOf(homeSite) >= 0; }
    function sitesText(it) { return (it.d.sites || []).map(function (x) { return SITE_NAMES[x] || x; }).join(" or "); }

    // The ballot comes from the database (ledger_ballot), so players and the GM see the same options.
    var ballot = state.ballot, onBallot = {};
    if (ballot) ballot.options.forEach(function (id) { onBallot[id] = true; });
    var players = members.filter(function (m) { return m.role !== "gm"; });
    var me = myProfile(), isPlayer = !!(me && me.role !== "gm");
    var ballotVotes = ballot ? state.votes.filter(function (v) { return v.level === ballot.level; }) : [];
    var myVote = ballotVotes.filter(function (v) { return v.user_id === myId; })[0] || null;
    function impName(id) { var it = imps.filter(function (x) { return x.id === id; })[0]; return it ? it.d.name || "Improvement" : "an improvement"; }

    if (ballotError && isOwner) {
      box.appendChild(el("div", { cls: "levelup" }, [el("b", { text: "GM" }), document.createTextNode("Improvement voting isn't set up in the database yet. Run supabase/3-improvement-votes.sql in Supabase's SQL Editor.")]));
    }
    if (ballot) {
      var need = Math.floor(players.length / 2) + 1, msg;
      if (!ballot.options.length) msg = "The guild has levelled up, but there's nothing new it can build yet. Ask the GM.";
      else {
        msg = (!homeBuilt ? "The guild has levelled up. Time to choose the guild's home: beach, town or grassland. They're equally good, but where you live decides which improvements you can build later. "
          : "The guild has levelled up and can build something new. ")
          + "Everyone has one token to place on the option they want. An option is built as soon as it holds " + need + " of the " + players.length + " tokens, or once every token is down and it's in the lead.";
      }
      var lu = el("div", { cls: "levelup" }, [el("b", { text: "LEVEL " + ballot.level }), document.createTextNode(msg)]);
      if (ballot.options.length) {
        lu.appendChild(el("p", { cls: "token-status" }, [
          el("span", { text: ballotVotes.length + " of " + players.length + " tokens placed." }),
          isPlayer ? el("span", { text: myVote ? " Your token is on " + impName(myVote.improvement) + "." : " Your token is still in your pocket." }) : null
        ]));
      }
      box.appendChild(lu);
    }

    // The GM can close voting (players lose the ballot; tokens are kept) and reset the open vote's tokens.
    var closed = guildState().votingClosed === true, waiting = false;
    for (var lv = 2; lv <= level; lv++) if (!state.picks.some(function (pk) { return pk.id === "level-" + lv; })) waiting = true;
    if (closed && waiting && !gm) {
      box.appendChild(el("div", { cls: "levelup" }, [el("b", { text: "VOTING PAUSED" }), document.createTextNode("The guild has levelled up, but the GM has paused the vote on what to build next. It'll reopen soon.")]));
    }
    if (gm && (ballot || closed || waiting)) {
      var vc = el("div", { cls: "gm-panel" }, [el("div", { cls: "label", text: "GM: VOTING" })]);
      var say = function (t) { vc.appendChild(el("p", { cls: "section-intro", text: t })); };
      if (voteControlsMissing) say("The voting controls aren't set up in the database yet. Run 4-vote-controls.sql in Supabase's SQL Editor.");
      else if (closed) {
        say("Voting is closed. Players can't see the ballot or move tokens. Tokens already placed are kept for when it reopens.");
        vc.appendChild(el("div", { cls: "row" }, [el("button", { cls: "btn small", type: "button", text: "Reopen voting",
          onclick: function () { write(db.collection("guild").doc("state").update({ votingClosed: false }), "Voting reopened."); } })]));
      } else if (ballot && ballot.options.length) {
        say("The level " + ballot.level + " vote is open: " + ballotVotes.length + " of " + players.length + " tokens placed.");
        vc.appendChild(el("div", { cls: "row" }, confirmingReset ? [
          el("span", { text: "Clear all " + ballotVotes.length + (ballotVotes.length === 1 ? " token" : " tokens") + " and start the vote again?" }),
          el("span", { cls: "row" }, [
            el("button", { cls: "btn small ghost", type: "button", text: "Cancel", onclick: function () { confirmingReset = false; renderGuild(); } }),
            el("button", { cls: "btn small danger", type: "button", text: "Clear tokens", onclick: function () { confirmingReset = false; resetVotes(); } })
          ])
        ] : [
          el("button", { cls: "btn small ghost", type: "button", text: "Close voting",
            onclick: function () { confirmingReset = false; write(db.collection("guild").doc("state").update({ votingClosed: true }), "Voting closed."); } }),
          ballotVotes.length ? el("button", { cls: "btn small danger", type: "button", text: "Reset tokens", onclick: function () { confirmingReset = true; renderGuild(); } }) : null
        ]));
      } else say("There's nothing on the ballot right now.");
      box.appendChild(vc);
    }

    if (gm) {
      var g = guildState();
      var bonus = el("input", { type: "number", id: "bonusXp", step: "50" }); bonus.value = Number(g.bonusXp) || 0; bonus.style.width = "140px";
      box.appendChild(el("div", { cls: "gm-panel" }, [
        el("div", { cls: "label", text: "GM: XP ADJUSTMENT" }),
        el("p", { cls: "section-intro", text: "Guild XP is the total of every completed quest's XP, plus this adjustment (use it for side jobs, bonuses or penalties)." }),
        el("div", { cls: "row" }, [bonus, el("button", { cls: "btn small", type: "button", text: "Save adjustment", onclick: function () {
          var v = Number($("bonusXp").value) || 0;
          write(db.collection("guild").doc("state").update({ bonusXp: v }), "XP adjustment saved.");
        } })])
      ]));
    }

    function chosenBy(pk) {
      if (pk.d.votes) {
        var all = Object.keys(pk.d.votes), forIt = all.filter(function (k) { return pk.d.votes[k] === pk.d.improvement; });
        return "CHOSEN BY VOTE · " + forIt.length + " OF " + all.length + " TOKENS";
      }
      if (pk.d.by) return "CHOSEN BY " + String(profileName(pk.d.by) || pickProfiles[pk.d.by] || (pk.d.by === myId ? "you" : "a party member")).toUpperCase();
      return "";
    }

    function tokens(it) {
      var on = ballotVotes.filter(function (v) { return v.improvement === it.id; });
      var names = on.map(function (v) { return v.user_id === myId ? "you" : profileName(v.user_id) || "a party member"; });
      var row = el("div", { cls: "tokens", "aria-label": on.length + (on.length === 1 ? " token" : " tokens") });
      on.forEach(function (v, i) { row.appendChild(el("span", { cls: "token" + (v.user_id === myId ? " mine" : ""), title: names[i], "aria-hidden": "true", text: personInitial(profileName(v.user_id) || "?") })); });
      row.appendChild(el("span", { text: on.length ? on.length + (on.length === 1 ? " token: " : " tokens: ") + names.join(", ") : "No tokens yet" }));
      return row;
    }

    function card(it) {
      var d = it.d, pk = pickOf[it.id], open = !!onBallot[it.id], unlocked = d.home || level >= (d.minLevel || 1);
      var mine = !!(myVote && myVote.improvement === it.id);
      var pill = pk ? el("span", { cls: "pill built", text: "BUILT AT LEVEL " + String(pk.id).replace("level-", "") })
        : open ? el("span", { cls: "pill vote", text: "ON THE BALLOT" })
        : d.home ? el("span", { cls: "pill locked", text: homeBuilt ? "NOT CHOSEN" : "FIRST LEVEL-UP" })
        : (homeSite && !siteOk(it)) ? el("span", { cls: "pill locked", text: "NEEDS A " + sitesText(it).toUpperCase() + " HOME" })
        : unlocked ? el("span", { cls: "pill avail", text: "UNLOCKED" }) : el("span", { cls: "pill locked", text: "UNLOCKS AT LEVEL " + d.minLevel });
      var blocked = !d.home && homeSite && !siteOk(it);
      var c = el("article", { cls: "imp" + (pk ? " built" : open ? (mine ? " ballot mine" : " ballot") : (blocked || !unlocked) ? " locked" : "") }, [
        pill, el("h3", { text: d.name || "Improvement" }),
        d.home && d.site ? el("div", { cls: "label", text: (SITE_NAMES[d.site] || d.site).toUpperCase() }) : null,
        !d.home && d.sites && d.sites.length ? el("div", { cls: "label", text: sitesText(it).toUpperCase() + " HOMES ONLY" }) : null,
        d.flavour ? el("p", { text: d.flavour }) : null,
        d.benefit ? el("p", { cls: "benefit" }, [el("b", { text: "BENEFIT" }), document.createTextNode(d.benefit)]) : null,
        pk && chosenBy(pk) ? el("p", { cls: "label", text: chosenBy(pk) }) : null,
        open ? tokens(it) : null
      ]);
      if (open && isPlayer && sb) {
        c.appendChild(el("div", { cls: "gm-bar" }, [mine
          ? el("button", { cls: "btn small ghost", type: "button", text: "Take your token back", onclick: function () { vote(null, "Token taken back."); } })
          : el("button", { cls: "btn small", type: "button", text: myVote ? "Move your token here" : "Place your token here", onclick: function () { vote(it.id, "Token placed on " + (d.name || "that") + "."); } })
        ]));
      }
      if (open && gm && db) {
        if (confirming === it.id) {
          c.appendChild(el("div", { cls: "gm-bar" }, [
            el("span", { text: "Skip the vote and build " + (d.name || "this") + " for level " + ballot.level + "?" }),
            el("button", { cls: "btn small", type: "button", text: "Confirm", onclick: function () {
              confirming = null;
              write(db.collection("picks").doc("level-" + ballot.level).set({ improvement: it.id, by: myId || null, at: Date.now() }), "Chosen. The guild builds " + (d.name || "it") + ".");
            } }),
            el("button", { cls: "btn small ghost", type: "button", text: "Cancel", onclick: function () { confirming = null; renderGuild(); } })
          ]));
        } else {
          c.appendChild(el("div", { cls: "gm-bar" }, [el("button", { cls: "btn small ghost", type: "button", text: "GM: choose for the party", onclick: function () { confirming = it.id; renderGuild(); } })]));
        }
      }
      if (gm && pk) c.appendChild(el("div", { cls: "gm-bar" }, [el("button", { cls: "btn small danger", type: "button", text: "Undo this choice", onclick: function () { write(db.collection("picks").doc(pk.id).delete(), "Choice undone."); } })]));
      return c;
    }

    var homes = imps.filter(function (it) { return it.d.home; });
    var rest = imps.filter(function (it) { return !it.d.home; });
    var builtCount = picks.length;
    function grid(list) { var g = el("div", { cls: "improvements" }); list.forEach(function (it) { g.appendChild(card(it)); }); return g; }
    if (gm) {
      // GM view: every improvement, with what's on the ballot marked.
      box.appendChild(el("h2", { cls: "guild-h" }, [document.createTextNode(homeBuilt ? "The guild's home " : "Choose the guild's home "), el("span", { cls: "label", text: "LEVEL 2" })]));
      var hg = grid(homeBuilt ? [homePick] : homes);
      if (!homes.length) hg.appendChild(el("div", { cls: "empty", text: "No home options listed yet." }));
      box.appendChild(hg);

      box.appendChild(el("h2", { cls: "guild-h" }, [document.createTextNode("Improvements "), el("span", { cls: "label", text: builtCount + " BUILT · " + Math.max(0, level - 1) + " EARNED" })]));
      var tiers = {}; rest.forEach(function (it) { var k = it.d.minLevel || 1; (tiers[k] = tiers[k] || []).push(it); });
      Object.keys(tiers).map(Number).sort(function (a, b) { return a - b; }).forEach(function (k) {
        box.appendChild(el("div", { cls: "label", text: "LEVEL " + k + " AND UP" }));
        var tg = grid(tiers[k]); tg.style.margin = "8px 0 18px";
        box.appendChild(tg);
      });
    } else {
      // Player view: only what's on the ballot and what's been built.
      var options = imps.filter(function (it) { return onBallot[it.id]; });
      if (options.length) {
        box.appendChild(el("h2", { cls: "guild-h" }, [document.createTextNode(homeBuilt ? "On the ballot " : "Choose the guild's home "), el("span", { cls: "label", text: "LEVEL " + ballot.level })]));
        box.appendChild(grid(options));
      }
      if (homeBuilt) {
        box.appendChild(el("h2", { cls: "guild-h", text: "The guild's home" }));
        box.appendChild(grid([homePick]));
      }
      var built = rest.filter(function (it) { return pickOf[it.id]; });
      if (built.length) {
        box.appendChild(el("h2", { cls: "guild-h" }, [document.createTextNode("Improvements "), el("span", { cls: "label", text: built.length + " BUILT" })]));
        box.appendChild(grid(built));
      }
      if (!options.length && !homeBuilt && !built.length) {
        box.appendChild(el("div", { cls: "empty", text: "The guild hasn't built anything yet. When it levels up, the options appear here and everyone gets a token to vote with." }));
      }
    }

    var done = state.quests.filter(function (q) { return (q.d.status || "") === "completed" && Number(q.d.xp); }).sort(byOrder);
    if (done.length) {
      box.appendChild(el("h2", { cls: "guild-h", text: "XP earned" }));
      var ul = el("ul", { cls: "xp-log" });
      done.forEach(function (q) { ul.appendChild(el("li", { text: (q.d.title || "Quest") + ": " + Number(q.d.xp).toLocaleString() + " XP" })); });
      if (Number(guildState().bonusXp)) ul.appendChild(el("li", { text: "Other: " + Number(guildState().bonusXp).toLocaleString() + " XP" }));
      box.appendChild(ul);
    }

    var lad = el("details", { cls: "ladder" }, [el("summary", { text: "THE CORPORATE LADDER" })]);
    var ol = el("ol");
    RANKS.forEach(function (r, i) { ol.appendChild(el("li", { cls: i + 1 === level ? "now" : "" }, [el("b", { text: String(i + 1) }), document.createTextNode(r)])); });
    lad.appendChild(ol); box.appendChild(lad);
  }

  /* ---------- who's logged in ---------- */
  function memberOf(uid) { return members.filter(function (m) { return m.user_id === uid; })[0] || null; }
  function myProfile() { return myId ? memberOf(myId) : null; }
  function profileName(uid) { var m = uid ? memberOf(uid) : null; return m ? m.name : ""; }
  var renaming = false;
  function renameMember(uid, v) {
    v = String(v || "").trim().slice(0, 60); if (!v) return;
    write(sb.from("members").update({ name: v }).eq("user_id", uid).select().then(function (r) {
      if (r.error) throw codeErr(r.error); if (!r.data || !r.data.length) throw { code: "invalid_argument" };
      return loadMembers();
    }), "Name saved.");
  }
  function renderProfiles() {
    var who = $("who"), admin = $("profile-admin");
    who.textContent = ""; admin.textContent = ""; $("claim").hidden = true;
    var me = myProfile();
    if (!me) return;
    if (renaming) {
      var inp = el("input", { type: "text", id: "renameInput", maxlength: "60", "aria-label": "Your character's name" }); inp.value = me.name || ""; inp.style.width = "180px";
      who.appendChild(inp);
      who.appendChild(el("button", { cls: "btn small", type: "button", text: "Save", onclick: function () { renaming = false; renameMember(me.user_id, $("renameInput").value); } }));
      who.appendChild(el("button", { cls: "btn small ghost", type: "button", text: "Cancel", onclick: function () { renaming = false; renderProfiles(); } }));
    } else {
      who.appendChild(el("span", { text: "Logged in as" }));
      who.appendChild(el("span", { cls: "mono", "aria-hidden": "true", text: personInitial(me.name || "?") }));
      who.appendChild(el("b", { text: me.name }));
      who.appendChild(el("button", { cls: "btn small ghost", type: "button", text: "Rename", onclick: function () { renaming = true; renderProfiles(); } }));
      who.appendChild(el("button", { cls: "btn small ghost", type: "button", text: "Log out", onclick: logOut }));
    }
    if (gm) {
      var rows = el("div", { cls: "slots" });
      members.slice().sort(function (a, b) { return (a.role === "gm" ? 0 : 1) - (b.role === "gm" ? 0 : 1) || a.username.localeCompare(b.username); }).forEach(function (m) {
        var id = "mname-" + m.user_id;
        var inp = el("input", { type: "text", id: id, maxlength: "60", "aria-label": "Character name for " + m.username }); inp.value = m.name;
        rows.appendChild(el("div", { cls: "slot" }, [
          el("span", { cls: "label", text: (m.role === "gm" ? "GM · " : "LOGIN · ") + m.username.toUpperCase() }),
          inp,
          el("button", { cls: "btn small ghost", type: "button", text: "Save name", onclick: function () { renameMember(m.user_id, $(id).value); } })
        ]));
      });
      admin.appendChild(el("div", { cls: "gm-panel" }, [el("div", { cls: "label", text: "GM: LOGINS" }),
        el("p", { cls: "section-intro", text: "Each login posts under its character's name. Add or remove logins, or reset passwords, in Supabase under Authentication > Users." }), rows]));
    }
  }

  /* ---------- notes ---------- */
  var canWriteNotes = null;
  function renderNotes() {
    var box = $("note-list");
    if (!loaded.notes) { box.textContent = ""; box.appendChild(el("div", { cls: "empty", text: "Opening the ledger…" })); return; }
    var list = state.notes.slice().sort(function (a, b) { return (b.d.at || 0) - (a.d.at || 0); });
    if (!list.length) { box.textContent = ""; box.appendChild(el("div", { cls: "empty", text: "No notes yet. The first theory is always the wildest." })); return; }
    var ids = []; list.forEach(function (n) { if (n.d.author && ids.indexOf(n.d.author) < 0) ids.push(n.d.author); });
    var draw = function (profiles) {
      box.textContent = "";
      list.forEach(function (n) {
        var d = n.d, p = profiles && d.author ? profiles[d.author] : null;
        var when = d.at ? new Date(d.at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";
        var mine = myId && d.author === myId;
        var by = el("div", { cls: "by" }, [
          el("span", { cls: "mono", "aria-hidden": "true", text: personInitial(profileName(d.author) || (p && p.name) || "?") }),
          el("b", { text: profileName(d.author) || (p && p.name) || (mine ? "You" : "A party member") }),
          el("span", { text: when }),
          (mine || isOwner) ? el("button", { cls: "btn small danger del", type: "button", text: "Delete",
            onclick: function () { write(db.collection("notes").doc(n.id).delete(), "Note deleted."); } }) : null
        ]);
        box.appendChild(el("article", { cls: "note" }, [by, el("p", { text: d.text || "" })]));
      });
    };
    draw(null);
  }

  $("peopleSearch").addEventListener("input", function () { peopleQuery = $("peopleSearch").value; renderPeople(); });
  $("placeSearch").addEventListener("input", function () { placeQuery = $("placeSearch").value; renderPlaces(); });
  // Directories scroll within the box beside them: the place list fills the map's height (the search box included),
  // and the people list matches the open entry. Neither is capped when it isn't beside its partner (phones, no map).
  function fitLists() {
    var map = $("chart-box"), find = $("place-find"), plist = $("place-list"), mapH = map.offsetHeight;
    var beside = mapH && find.offsetHeight && Math.abs(find.getBoundingClientRect().top - map.getBoundingClientRect().top) < 4;
    plist.style.maxHeight = beside ? Math.max(160, mapH - (plist.getBoundingClientRect().top - find.getBoundingClientRect().top)) + "px" : mapH ? mapH + "px" : "";
    var det = document.querySelector("#people .dir-detail"), lst = document.querySelector("#people .dir-list");
    if (lst) lst.style.maxHeight = det && det.offsetHeight && window.innerWidth > 720 ? Math.max(240, det.offsetHeight) + "px" : "";
  }
  if (window.ResizeObserver) new ResizeObserver(fitLists).observe($("chart-box"));
  window.addEventListener("resize", fitLists);

  $("compose").addEventListener("submit", function (e) {
    e.preventDefault();
    var t = $("noteText").value.trim();
    if (!t) { $("noteStatus").textContent = "Write something first."; return; }
    if (!db || !myProfile()) { $("noteStatus").textContent = "Log in to post to the board."; return; }
    $("notePost").disabled = true;
    db.collection("notes").add({ text: t.slice(0, 4000), author: myId || null, at: Date.now() }).then(function () {
      $("noteText").value = ""; $("noteStatus").textContent = "Posted.";
    }, function (err) {
      if (err && err.code === "invalid_argument") { $("noteStatus").textContent = "That post didn't go through. Try logging out and back in."; $("noteText").disabled = true; }
      else $("noteStatus").textContent = "That note didn't save. Try again in a moment.";
    }).then(function () { $("notePost").disabled = !!$("noteText").disabled; });
  });

  /* ---------- GM forms ---------- */
  function buildForm(kind) {
    var cfg = KINDS[kind], box = $("form-" + kind);
    box.textContent = "";
    var ed = editing[kind];
    box.appendChild(el("summary", { text: ed ? "Editing: " + (ed.d.title || ed.d.name || "") : "Add a " + cfg.label }));
    var form = el("form", { cls: "gm-form" });
    var pair = null;
    cfg.fields.forEach(function (f) {
      var id = kind + "-f-" + f[0], input;
      if (f[2] === "area") input = el("textarea", { id: id });
      else if (f[2] === "select") { input = el("select", { id: id }); f[3].forEach(function (o) { input.appendChild(el("option", { value: o, text: o })); }); }
      else input = el("input", { id: id, type: f[2] });
      var v = ed ? ed.d[f[0]] : (f[0] === "order" ? "" : (f[0] === "status" ? "available" : ""));
      if (v !== undefined && v !== null) input.value = v;
      var wrap = el("div", null, [el("label", { cls: "label", "for": id, text: f[1] }), input]);
      wrap.style.display = "grid"; wrap.style.gap = "4px";
      if (f[2] === "area") { if (pair) { form.appendChild(pair); pair = null; } form.appendChild(wrap); }
      else { if (!pair) pair = el("div", { cls: "two" }); pair.appendChild(wrap); if (pair.children.length === 2) { form.appendChild(pair); pair = null; } }
    });
    if (pair) form.appendChild(pair);
    var rev = el("input", { type: "checkbox", id: kind + "-f-revealed" });
    rev.checked = ed ? !!ed.d.revealed : false;
    form.appendChild(el("label", { cls: "toggle", "for": kind + "-f-revealed" }, [rev, document.createTextNode("Visible to players")]));
    var buttons = el("div", { cls: "row" }, [
      el("span", null, [ed ? el("button", { cls: "btn danger", type: "button", text: "Delete", onclick: function () { write(db.collection(kind).doc(ed.id).delete(), "Deleted."); editing[kind] = null; buildForm(kind); } }) : null]),
      el("span", { cls: "row" }, [
        ed ? el("button", { cls: "btn ghost", type: "button", text: "Cancel", onclick: function () { editing[kind] = null; buildForm(kind); } }) : null,
        el("button", { cls: "btn", type: "submit", text: ed ? "Save changes" : "Add " + cfg.label })
      ])
    ]);
    form.appendChild(buttons);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var body = {};
      cfg.fields.forEach(function (f) {
        var v = $(kind + "-f-" + f[0]).value;
        if (f[2] === "number") { body[f[0]] = v === "" ? 999 : Number(v); }
        else body[f[0]] = v.trim();
      });
      body.revealed = rev.checked;
      var key = kind === "quests" ? "title" : "name";
      if (!body[key]) { setStatus("Give it a " + (key === "title" ? "title" : "name") + " first."); return; }
      if (ed) {
        write(db.collection(kind).doc(ed.id).update(body), "Saved.");
      } else {
        write(db.collection(kind).add(body), "Added.");
      }
      editing[kind] = null; buildForm(kind);
    });
    box.appendChild(form);
    if (ed) box.open = true;
  }
  function startEdit(kind, item) { editing[kind] = item; buildForm(kind); $("form-" + kind).scrollIntoView({ block: "start", behavior: "smooth" }); }

  function write(promise, okMsg) {
    setStatus("Saving…");
    return promise.then(function () { setStatus(okMsg); setTimeout(function () { if ($("status").textContent === okMsg) setStatus(""); }, 2500); },
      function (err) {
        if (err && err.code === "invalid_argument") setStatus("Only the GM can change the ledger.");
        else setStatus("That change didn't save. Try again in a moment.");
      });
  }

  var sync = { rows: [], skipped: [], ignored: 0, busy: false, reveal: false, keep: {} };
  function nameOf(it) { return String(it.d.title || it.d.name || ""); }
  function matchRows() {
    var claimed = {};
    sync.rows.forEach(function (r) {
      var hit = state[r.kind].filter(function (it) { return String(it.d.vaultNote || "").toLowerCase() === r.note.toLowerCase(); })[0];
      r.match = hit ? hit.id : null; r.linked = !!hit; r.guess = false;
      if (hit) claimed[hit.id] = true;
    });
    sync.rows.forEach(function (r) {
      if (r.match) return;
      var nm = (r.fields.title || r.fields.name).toLowerCase();
      var free = state[r.kind].filter(function (it) { return !it.d.vaultNote && !claimed[it.id] && nameOf(it); });
      var hits = free.filter(function (it) { return nameOf(it).toLowerCase() === nm; });
      if (hits.length !== 1) hits = free.filter(function (it) { var a = nameOf(it).toLowerCase(); return nm.indexOf(a) >= 0 || a.indexOf(nm) >= 0; });
      if (hits.length === 1) { r.match = hits[0].id; r.guess = true; claimed[hits[0].id] = true; }
    });
  }
  function rowData(r) {
    var cur = r.match ? current(r.kind, r.match) : null, out = {};
    Object.keys(r.soft).forEach(function (k) { if (!cur || !String(cur[k] == null ? "" : cur[k]).trim()) out[k] = r.soft[k]; });
    return { cur: cur, fields: Object.assign(out, r.fields) };
  }
  function flat(v) { return v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v); }
  function rowChanges(r) {
    var x = rowData(r);
    if (!x.cur) return null;
    var ch = Object.keys(x.fields).filter(function (k) { return flat(x.cur[k]) !== flat(x.fields[k]); });
    if (x.cur.vaultNote !== r.note) ch.push("link to vault note");
    return ch;
  }
  function readVault(files) {
    var all = [].slice.call(files || []);
    var mds = all.filter(function (f) { var p = f.webkitRelativePath || f.name; return /\.md$/i.test(p) && !/(^|\/)(\.[^\/]*|templates?)\//i.test(p); });
    if (!mds.length) { setStatus("No notes found in that folder."); return; }
    setStatus("Reading " + mds.length + " notes…");
    var ep = epoch;
    Promise.all(mds.map(function (f) { return f.text().then(function (t) { return Vault.entry(f.webkitRelativePath || f.name, t, KINDS); }); })).then(function (entries) {
      if (ep !== epoch) return;
      Vault.resolveMaps(entries);
      var seen = {}; sync.rows = []; sync.skipped = []; sync.ignored = 0; sync.keep = {};
      entries.forEach(function (e, i) {
        var path = mds[i].webkitRelativePath || mds[i].name;
        if (!e) { sync.ignored++; return; }
        if (e.skip) { sync.skipped.push({ path: path, why: e.skip }); return; }
        var key = e.kind + "|" + e.note.toLowerCase();
        if (seen[key]) { sync.skipped.push({ path: path, why: "same note name as " + seen[key] }); return; }
        seen[key] = path; e.on = true; sync.rows.push(e);
      });
      matchRows(); setStatus(""); renderSync();
      $("vault-sync").scrollIntoView({ block: "start", behavior: "smooth" });
    }, function () { setStatus("Couldn't read those notes. Try picking the folder again."); });
  }
  // The vault is the source of truth: an entry no vault note matches is deleted, but only for types the picked
  // folder has notes for, so picking just the Quests folder can't wipe people, places or the timeline.
  var SYNCED = ["quests", "people", "places", "timeline"];
  function syncedKinds() { var k = {}; sync.rows.forEach(function (r) { k[r.kind] = true; }); return k; }
  function staleEntries() {
    var kinds = syncedKinds(), matched = {}, out = [];
    sync.rows.forEach(function (r) { if (r.match) matched[r.match] = true; });
    SYNCED.forEach(function (k) { if (kinds[k]) state[k].forEach(function (it) { if (!matched[it.id]) out.push({ kind: k, item: it }); }); });
    return out;
  }
  function applySync() {
    var todo = sync.rows.filter(function (r) { var ch = rowChanges(r); return r.on && (!ch || ch.length); });
    var gone = staleEntries().filter(function (x) { return !sync.keep[x.item.id]; });
    if ((!todo.length && !gone.length) || sync.busy) return;
    sync.busy = true; renderSync(); setStatus("Syncing from Obsidian…");
    var ep = epoch, inserts = [], jobs = [];
    function job(type, n, p) { jobs.push({ type: type, n: n, p: p }); }
    todo.forEach(function (r) {
      var x = rowData(r);
      var base = x.cur || Object.assign(r.kind === "quests" ? { status: "available" } : {}, { order: 999, revealed: sync.reveal });
      var data = Object.assign({}, base, x.fields, { vaultNote: r.note });
      if (x.cur) job("updated", 1, sb.from("docs").update({ data: data }).eq("collection", r.kind).eq("id", r.match).select("id").then(function (res) {
        if (res.error) throw codeErr(res.error); if (!res.data || !res.data.length) throw { code: "invalid_argument" };
      }));
      else inserts.push({ collection: r.kind, id: newId(), data: data });
    });
    if (inserts.length) job("added", inserts.length, sb.from("docs").insert(inserts).select("id").then(function (res) { if (res.error) throw codeErr(res.error); }));
    SYNCED.forEach(function (k) {
      var ids = gone.filter(function (x) { return x.kind === k; }).map(function (x) { return x.item.id; });
      if (ids.length) job("removed", ids.length, sb.from("docs").delete().eq("collection", k).in("id", ids).select("id").then(function (res) {
        if (res.error) throw codeErr(res.error); if ((res.data || []).length !== ids.length) throw { code: "invalid_argument" };
      }));
    });
    Promise.allSettled(jobs.map(function (j) { return j.p; })).then(function (rs) {
      if (ep !== epoch) return;
      var done = { added: 0, updated: 0, removed: 0 }, failed = 0;
      rs.forEach(function (r, i) { if (r.status === "fulfilled") done[jobs[i].type] += jobs[i].n; else failed++; });
      return Promise.all(SYNCED.map(refetch)).then(function () {
        sync.busy = false; sync.keep = {}; matchRows(); render();
        setStatus("Synced from Obsidian: " + done.added + " added, " + done.updated + " updated, " + done.removed + " removed." + (failed ? " Some changes didn't save; try again." : ""));
      });
    }).catch(function () { sync.busy = false; renderSync(); setStatus("The sync didn't finish. Try again in a moment."); });
  }
  function renderSync() {
    var box = $("vault-sync");
    box.textContent = "";
    box.appendChild(el("summary", { text: "Sync from Obsidian" }));
    var wrap = el("div", { cls: "gm-form" });
    box.appendChild(wrap);
    wrap.appendChild(el("p", { cls: "section-intro", text: "Pick your vault folder to add or update quests, characters and locations from notes tagged quest, character or location, and the timeline from session recaps tagged recap. The ledger then matches the vault: anything with no note there is removed (reveals, pins and logs are kept for everything else). Nothing changes until you apply. Only player-safe parts are read: frontmatter (including a character's tagline), a quest's board notice, a \"Player summary\" section, and ledger-name / ledger-role / ledger-summary style overrides." }));
    var pick = el("input", { type: "file", id: "vaultPick", "aria-label": "Obsidian vault folder", onchange: function () { readVault(pick.files); } });
    pick.setAttribute("webkitdirectory", ""); pick.multiple = true;
    if (!loaded.quests || !loaded.people || !loaded.places || !loaded.timeline) pick.disabled = true;
    wrap.appendChild(pick);
    if (!sync.rows.length && !sync.skipped.length) return;
    box.open = true;

    var groups = { "new": [], update: [], same: [] };
    sync.rows.forEach(function (r) { var ch = rowChanges(r); r.changes = ch; groups[!ch ? "new" : ch.length ? "update" : "same"].push(r); });
    var LABEL = { quests: "QUEST", people: "PERSON", places: "PLACE", timeline: "SESSION" };
    function row(r) {
      var cb = el("input", { type: "checkbox", "aria-label": "Include " + r.note });
      cb.checked = r.on; cb.disabled = sync.busy;
      cb.addEventListener("change", function () { r.on = cb.checked; renderSync(); });
      var x = rowData(r), info = el("div", null, [
        el("div", null, [el("span", { cls: "label", text: LABEL[r.kind] + " · " }), el("b", { text: x.fields.title || x.fields.name })]),
        el("div", { cls: "sub", text: r.changes ? (r.changes.length ? "Changes: " + r.changes.join(", ") : "Up to date") + (r.guess ? " · matched by name to \"" + nameOf({ d: x.cur }) + "\"" : "") : "New, added " + (sync.reveal ? "visible to players" : "hidden from players") }),
        el("div", { cls: "sub", text: r.path })
      ]);
      if (!r.linked) {
        var sel = el("select", { "aria-label": "Link " + r.note + " to an existing entry" });
        sel.appendChild(el("option", { value: "", text: "Add as a new entry" }));
        var taken = {}; sync.rows.forEach(function (o) { if (o !== r && o.match) taken[o.match] = true; });
        state[r.kind].filter(function (it) { return !it.d.vaultNote && !taken[it.id]; }).sort(function (a, b) { return nameOf(a).localeCompare(nameOf(b)); }).forEach(function (it) {
          var o = el("option", { value: it.id, text: "Update \"" + (nameOf(it) || "Untitled") + "\"" }); if (it.id === r.match) o.selected = true; sel.appendChild(o);
        });
        sel.disabled = sync.busy;
        sel.addEventListener("change", function () { r.match = sel.value || null; r.guess = false; renderSync(); });
        if (sel.options.length > 1) info.appendChild(sel);
      }
      return el("label", { cls: "sync-row" }, [cb, info]);
    }
    [["new", "NEW"], ["update", "UPDATES"]].forEach(function (g) {
      if (!groups[g[0]].length) return;
      wrap.appendChild(el("h3", { cls: "sync-h", text: g[1] + " · " + groups[g[0]].length }));
      var lst = el("div", { cls: "sync-list" }); groups[g[0]].forEach(function (r) { lst.appendChild(row(r)); }); wrap.appendChild(lst);
    });
    if (groups.same.length) {
      var sd = el("details", null, [el("summary", { cls: "sync-h", text: "UP TO DATE · " + groups.same.length })]);
      var sl = el("div", { cls: "sync-list" }); groups.same.forEach(function (r) { sl.appendChild(row(r)); }); sd.appendChild(sl); wrap.appendChild(sd);
    }
    if (sync.skipped.length) {
      var kd = el("details", null, [el("summary", { cls: "sync-h", text: "SKIPPED · " + sync.skipped.length })]);
      sync.skipped.forEach(function (s) { kd.appendChild(el("div", { cls: "sync-row" }, [el("span"), el("div", { cls: "sub", text: s.path + ": " + s.why })])); });
      wrap.appendChild(kd);
    }
    var stale = staleEntries();
    if (stale.length) {
      wrap.appendChild(el("h3", { cls: "sync-h", text: "REMOVED · NOT IN THE VAULT · " + stale.length }));
      var rl = el("div", { cls: "sync-list" });
      stale.forEach(function (x) {
        var d = x.item.d, cb = el("input", { type: "checkbox", "aria-label": "Remove " + (nameOf(x.item) || "this entry") });
        cb.checked = !sync.keep[x.item.id]; cb.disabled = sync.busy;
        cb.addEventListener("change", function () { if (cb.checked) delete sync.keep[x.item.id]; else sync.keep[x.item.id] = true; renderSync(); });
        var notes = [d.vaultNote ? "Its vault note is gone or renamed" : "Added in the ledger, not from the vault"];
        if (d.revealed) notes.push("players can see it");
        if (d.log && d.log.length) notes.push(d.log.length + (d.log.length === 1 ? " logged interaction goes too" : " logged interactions go too"));
        if (x.kind === "quests" && d.status === "completed" && Number(d.xp)) notes.push("guild XP drops by " + Number(d.xp).toLocaleString());
        rl.appendChild(el("label", { cls: "sync-row" }, [cb, el("div", null, [
          el("div", null, [el("span", { cls: "label", text: LABEL[x.kind] + " · " }), el("b", { text: nameOf(x.item) || "Untitled" })]),
          el("div", { cls: "sub", text: notes.join(" · ") })
        ])]));
      });
      wrap.appendChild(rl);
    }
    var kinds = syncedKinds(), NAMES = { quests: "quests", people: "people", places: "places", timeline: "timeline sessions" };
    var untouched = SYNCED.filter(function (k) { return !kinds[k]; }).map(function (k) { return NAMES[k]; });
    if (untouched.length) wrap.appendChild(el("p", { cls: "status-line", text: "No notes for " + untouched.join(", ") + " in this folder, so those are left as they are." }));
    if (sync.ignored) wrap.appendChild(el("p", { cls: "status-line", text: sync.ignored + " other notes (lore, sessions, handouts and so on) were ignored." }));

    var rev = el("input", { type: "checkbox", id: "syncReveal" }); rev.checked = sync.reveal; rev.disabled = sync.busy;
    rev.addEventListener("change", function () { sync.reveal = rev.checked; renderSync(); });
    var n = sync.rows.filter(function (r) { return r.on && (!r.changes || r.changes.length); }).length + stale.filter(function (x) { return !sync.keep[x.item.id]; }).length;
    var clear = el("button", { cls: "btn ghost", type: "button", text: "Clear", onclick: function () { sync.rows = []; sync.skipped = []; sync.ignored = 0; sync.keep = {}; renderSync(); } });
    var go = el("button", { cls: "btn", type: "button", text: sync.busy ? "Syncing…" : n ? "Apply " + n + (n === 1 ? " change" : " changes") : "Nothing to apply", onclick: applySync });
    clear.disabled = sync.busy; go.disabled = sync.busy || !n;
    wrap.appendChild(el("div", { cls: "row" }, [
      el("label", { cls: "toggle", "for": "syncReveal" }, [rev, document.createTextNode("Show new entries to players")]),
      el("span", { cls: "row" }, [clear, go])
    ]));
  }

  /* ---------- Supabase data layer ---------- */
  function codeErr(e) {
    var msg = (e && e.message) || "";
    var denied = (e && (e.code === "42501" || e.code === "PGRST301")) || /row-level security|permission denied/i.test(msg);
    return { code: denied ? "invalid_argument" : "other", message: msg };
  }
  function current(c, id) { var x = (state[c] || []).filter(function (r) { return r.id === id; })[0]; return x ? x.d : null; }
  function newId() { try { return crypto.randomUUID(); } catch (e) { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); } }
  function checked(c) {
    return function (r) {
      if (r.error) throw codeErr(r.error);
      if (Array.isArray(r.data) && !r.data.length) throw { code: "invalid_argument" };
      return refetch(c);
    };
  }
  function makeDb() {
    return {
      collection: function (c) {
        var api = {
          doc: function (id) {
            var q = function (b) { return b.eq("collection", c).eq("id", id); };
            return {
              set: function (data) {
                if (current(c, id)) return q(sb.from("docs").update({ data: data })).select("id").then(checked(c));
                return sb.from("docs").insert({ collection: c, id: id, data: data }).select("id").then(checked(c));
              },
              update: function (patch) {
                var merged = Object.assign({}, current(c, id) || {}, patch);
                return q(sb.from("docs").update({ data: merged })).select("id").then(checked(c));
              },
              delete: function () { return q(sb.from("docs").delete()).select("id").then(checked(c)); }
            };
          },
          add: function (data) { return api.doc(newId()).set(data); }
        };
        return api;
      }
    };
  }
  var pending = {};
  function refetch(c) {
    var ep = epoch;
    return sb.from("docs").select("id,data").eq("collection", c).then(function (r) {
      if (ep !== epoch) return;
      if (r.error) throw codeErr(r.error);
      state[c] = (r.data || []).map(function (x) { return { id: x.id, d: x.data || {} }; });
      loaded[c] = true;
      if (activePlace && c === "places" && !state.places.some(function (p) { return p.id === activePlace; })) activePlace = null;
      // Levels and picks decide what's on the ballot, and so which improvements players can see.
      if (c === "quests" || c === "guild" || c === "picks") { refetchSoon("improvements"); refetchSoon("ballot"); }
      render();
    });
  }
  function refetchSoon(c) {
    if (pending[c]) return;
    pending[c] = setTimeout(function () { pending[c] = null; if (!started) return; (c === "members" ? loadMembers() : c === "ballot" ? loadBallot() : refetch(c)).catch(function () {}); }, 150);
  }
  function loadBallot() {
    var ep = epoch;
    return Promise.all([sb.rpc("ledger_ballot"), sb.from("votes").select("level,user_id,improvement"), isOwner ? sb.rpc("ledger_voting_closed") : Promise.resolve({})]).then(function (rs) {
      if (ep !== epoch) return;
      var b = rs[0], v = rs[1];
      voteControlsMissing = !!rs[2].error;
      ballotError = !!(b.error || v.error);
      var rows = ballotError ? [] : b.data || [];
      state.ballot = rows.length ? { level: rows[0].ballot_level, options: rows.map(function (r) { return r.option_id; }).filter(Boolean) } : null;
      state.votes = ballotError ? [] : v.data || [];
      loaded.ballot = true; render();
    });
  }
  function resetVotes() {
    setStatus("Saving…");
    return sb.rpc("ledger_reset_votes").then(function (r) {
      if (r.error) throw r.error;
      return loadBallot().then(function () {
        var msg = "Tokens cleared. The vote starts fresh.";
        setStatus(msg); setTimeout(function () { if ($("status").textContent === msg) setStatus(""); }, 4000);
      });
    }).catch(function () { setStatus("The tokens weren't cleared. Try again in a moment."); });
  }
  function vote(choice, okMsg) {
    setStatus("Saving…");
    return sb.rpc("ledger_vote", { choice: choice }).then(function (r) {
      if (r.error) throw r.error;
      var decided = r.data;
      return Promise.all([loadBallot(), refetch("picks"), refetch("improvements")]).then(function () {
        var it = decided && state.improvements.filter(function (x) { return x.id === decided; })[0];
        var msg = decided ? "The vote is in. The guild builds " + (it ? it.d.name : "it") + "." : okMsg;
        setStatus(msg); setTimeout(function () { if ($("status").textContent === msg) setStatus(""); }, 4000);
      });
    }).catch(function (e) {
      setStatus(/no vote is open|not on the ballot/i.test((e && e.message) || "") ? "That vote has already closed." : "Your token didn't move. Try again in a moment.");
      loadBallot().catch(function () {});
    });
  }
  function loadMembers() {
    var ep = epoch;
    return sb.from("members").select("user_id,username,name,role").then(function (r) {
      if (ep !== epoch) return;
      if (r.error) throw codeErr(r.error);
      members = r.data || []; loaded.members = true; render();
    });
  }
  function refreshAll() { return Promise.all([loadMembers(), loadBallot()].concat(COLLECTIONS.map(refetch))); }

  /* ---------- boot ---------- */
  render();
  var CFG = window.LEDGER_CONFIG || {};
  function showLogin(msg) { $("app").hidden = true; $("login").hidden = false; $("loginStatus").textContent = msg || ""; }
  if (!window.supabase || !CFG.supabaseUrl || /PASTE/.test(CFG.supabaseUrl + CFG.supabaseAnonKey)) {
    showLogin(window.supabase ? "This ledger isn't connected to its database yet. Add the Supabase details at the top of index.html." : "Couldn't load the login library. Check your connection and reload.");
    $("loginBtn").disabled = true;
    return;
  }
  sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } });

  $("loginForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var u = $("loginUser").value.trim(), p = $("loginPass").value;
    if (!u || !p) { $("loginStatus").textContent = "Enter your username and password."; return; }
    var email = u.indexOf("@") >= 0 ? u : u.toLowerCase().replace(/\s+/g, "") + "@" + (CFG.loginDomain || "ledger.example.com");
    $("loginBtn").disabled = true; $("loginStatus").textContent = "Checking the guild register…";
    sb.auth.signInWithPassword({ email: email, password: p }).then(function (r) {
      $("loginBtn").disabled = false;
      if (r.error) { $("loginStatus").textContent = /invalid/i.test(r.error.message) ? "That username and password don't match." : "Couldn't log in: " + r.error.message; return; }
      $("loginPass").value = "";
      start(r.data.session);
    });
  });

  var started = false, channel = null, poll = null;
  function start(session) {
    if (started || !session) return; started = true;
    myId = session.user.id;
    db = makeDb();
    $("login").hidden = true; $("app").hidden = false;
    setStatus("Opening the ledger…");
    loadMembers().then(function () {
      var me = myProfile();
      if (!me) { setStatus("This login isn't on the guild register. Ask the GM."); return; }
      isOwner = me.role === "gm";
      if (isOwner) {
        $("gmToggleWrap").hidden = false;
        var saved = false; try { saved = localStorage.getItem("ledger-gm") === "1"; } catch (e) {}
        $("gmToggle").checked = saved; gm = saved;
        ["quests", "people", "places"].forEach(buildForm);
      }
      return Promise.all(COLLECTIONS.map(refetch).concat([loadBallot()])).then(function () { setStatus(""); });
    }).catch(function () { setStatus("Couldn't open the ledger. Reload the page to try again."); COLLECTIONS.forEach(function (k) { loaded[k] = true; }); loaded.ballot = true; render(); });

    channel = sb.channel("ledger")
      .on("postgres_changes", { event: "*", schema: "public", table: "docs" }, function (p) {
        var c = (p.new && p.new.collection) || (p.old && p.old.collection);
        if (c && COLLECTIONS.indexOf(c) >= 0) refetchSoon(c); else COLLECTIONS.forEach(refetchSoon);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "members" }, function () { refetchSoon("members"); })
      .on("postgres_changes", { event: "*", schema: "public", table: "votes" }, function () { refetchSoon("ballot"); })
      .subscribe();
    // Catch anything live updates miss (like the GM hiding something again).
    poll = setInterval(function () { if (started && !document.hidden) refreshAll().catch(function () {}); }, 60000);
  }

  // Close the session in place and go back to the login form (no page reload).
  function stop(msg) {
    if (!started) { showLogin(msg); return; }
    started = false; epoch++;
    clearInterval(poll); poll = null;
    Object.keys(pending).forEach(function (k) { clearTimeout(pending[k]); pending[k] = null; });
    if (channel) { var ch = channel; channel = null; setTimeout(function () { sb.removeChannel(ch); }, 0); }
    myId = null; db = null; isOwner = false; gm = false; members = [];
    renaming = false; confirming = null; confirmingReset = false; voteControlsMissing = false; pinFor = null; activePlace = null; selPerson = null; explicitSel = false;
    editing = { quests: null, people: null, places: null };
    state = { quests: [], people: [], places: [], timeline: [], notes: [], improvements: [], guild: [], picks: [], ballot: null, votes: [] };
    moments = {}; linkIndex = {}; tlFilter = null; placeQuery = ""; explicitPlace = false; $("placeSearch").value = "";
    Object.keys(loaded).forEach(function (k) { loaded[k] = false; });
    ballotError = false;
    $("gmToggleWrap").hidden = true; $("gmToggle").checked = false;
    ["quests", "people", "places"].forEach(function (k) { $("form-" + k).textContent = ""; });
    sync = { rows: [], skipped: [], ignored: 0, busy: false, reveal: false, keep: {} }; $("vault-sync").textContent = "";
    setStatus(""); render();
    showLogin(msg);
  }
  function logOut() {
    // "local" clears this browser's session without waiting on the server, so a network hiccup can't block it.
    sb.auth.signOut({ scope: "local" }).then(function () { stop(""); }, function () { stop(""); });
  }

  $("gmToggle").addEventListener("change", function () { gm = $("gmToggle").checked; try { localStorage.setItem("ledger-gm", gm ? "1" : "0"); } catch (e) {} pinFor = null; render(); });
  document.addEventListener("visibilitychange", function () { if (started && !document.hidden) refreshAll().catch(function () {}); });

  sb.auth.getSession().then(function (r) {
    var s = r && r.data && r.data.session;
    if (s) start(s); else showLogin("");
  }, function () { showLogin(""); });
  // Signed out elsewhere (another tab, or an expired session). Deferred: supabase-js holds its auth lock during this callback.
  sb.auth.onAuthStateChange(function (ev) { if (ev === "SIGNED_OUT") setTimeout(function () { stop(""); }, 0); });
})();
