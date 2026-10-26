// Turns an Obsidian note into ledger fields. No DOM or Supabase here, so it runs in Node for tests (see test/vault.test.js).
(function (root) {
  "use strict";
  /* ---------- Obsidian sync ---------- */
  // Notes are picked up by their tags (or `ledger: quest|character|location`). Vault notes are GM notes,
  // so only player-safe parts are read: frontmatter (a character's tagline is their role), the quest board notice,
  // a "Player summary" section, and `ledger-<field>` overrides. New entries arrive hidden; GM-only state (revealed, log, pins) is kept.
  // Session recaps (tag `recap`) become one timeline entry each: the bullets under "## Timeline", with the notes each one links.
  var VAULT_KINDS = { quest: "quests", quests: "quests", character: "people", npc: "people", person: "people", location: "places", place: "places", recap: "timeline", "session-recap": "timeline" };
  function fmValue(v) {
    v = String(v).trim();
    var q = /^(["'])(.*)\1$/.exec(v);
    if (q) return q[2];
    if (v.slice(0, 2) === "[[") return v;
    if (/^\[.*\]$/.test(v)) return v.slice(1, -1).split(",").map(fmValue).filter(function (x) { return x !== ""; });
    if (/^(true|false)$/i.test(v)) return v.toLowerCase() === "true";
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    return v;
  }
  function parseNote(text) {
    text = String(text).replace(/^﻿/, "").replace(/\r\n?/g, "\n");
    var fm = {}, body = text, m = /^---\n([\s\S]*?)\n---[ \t]*(\n|$)/.exec(text);
    if (m) {
      body = text.slice(m[0].length);
      var key = null;
      m[1].split("\n").forEach(function (line) {
        var item = /^\s*-\s+(.*)$/.exec(line), kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
        if (item && key) { if (!Array.isArray(fm[key])) fm[key] = []; fm[key].push(fmValue(item[1])); }
        else if (kv) { key = kv[1].toLowerCase(); fm[key] = kv[2].trim() === "" ? "" : fmValue(kv[2]); }
      });
    }
    return { fm: fm, body: body.replace(/%%[\s\S]*?%%|<!--[\s\S]*?-->/g, "") };
  }
  function plain(s) {
    return String(s == null ? "" : s)
      .replace(/!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
      .replace(/\[\[([^\]]*)\]\]/g, function (m, t) { return t.replace(/#.*$/, ""); })
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/^(\s*)[*+]\s+/gm, "$1- ")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/\*\*|__|~~/g, "")
      .replace(/(^|[^\w*])\*([^*\n]+)\*(?!\w)/g, "$1$2")
      .replace(/(^|[^\w_])_([^_\n]+)_(?!\w)/g, "$1$2")
      .replace(/[ \t]+$/gm, "")
      .trim();
  }
  function sectionRaw(body, re) {
    var lines = body.split("\n"), out = null, level = 0;
    for (var i = 0; i < lines.length; i++) {
      var h = /^(#{1,6})\s+(.*?)\s*$/.exec(lines[i]);
      if (out) { if (h && h[1].length <= level) break; out.push(lines[i]); }
      else if (h && re.test(plain(h[2]))) { out = []; level = h[1].length; }
    }
    return out ? out.join("\n") : "";
  }
  function sectionText(body, re) { return plain(sectionRaw(body, re)).replace(/\n{3,}/g, "\n\n"); }
  // One event per top-level bullet (indented lines fold into it); `links` are the note names it [[links]], minus embeds.
  function timelineEvents(raw) {
    var items = [];
    raw.split("\n").forEach(function (line) {
      var top = /^[-*+]\s+(.*)$/.exec(line), more = /^\s+(?:[-*+]\s+)?(.*\S)/.exec(line);
      if (top) items.push(top[1]); else if (more && items.length) items[items.length - 1] += " " + more[1];
    });
    return items.map(function (s) {
      var links = [];
      s.replace(/(!?)\[\[([^\]|#]*)[^\]]*\]\]/g, function (m, embed, t) { t = t.trim(); if (!embed && t && links.indexOf(t) < 0) links.push(t); return m; });
      return { text: plain(s), links: links };
    }).filter(function (e) { return e.text; });
  }
  function vaultEntry(path, text, kinds) {
    var n = parseNote(text), fm = n.fm, body = n.body;
    var note = path.split("/").pop().replace(/\.md$/i, "");
    if (fm.ledger === false) return { skip: "marked ledger: false" };
    var kind = typeof fm.ledger === "string" ? VAULT_KINDS[fm.ledger.toLowerCase()] : null;
    if (!kind) [].concat(fm.tags || fm.tag || []).some(function (t) { return (kind = VAULT_KINDS[String(t).replace(/^#/, "").toLowerCase()] || null); });
    if (!kind) return null;
    var f = {}, soft = {};
    function first(v) { return plain([].concat(v || [])[0]); }
    if (kind === "quests") {
      f.title = note;
      var giver = [].concat(fm["quest-giver"] || []).map(plain).filter(Boolean).join(", ");
      if (giver) f.giver = giver;
      ["xp", "order"].forEach(function (k) { if (typeof fm[k] === "number") f[k] = fm[k]; });
      if (fm.completed === true) f.status = "completed";
      // The italic board notice is player-facing; it only fills blanks so it never replaces text the GM wrote in the ledger.
      var nm = /^\*(?!\*)(.+)\*[ \t]*$/m.exec(body);
      if (nm) {
        var notice = plain(nm[1]), rm = /(^|\s)Reward:\s*(.*)$/i.exec(notice);
        if (rm) { soft.reward = rm[2].replace(/\.$/, "").trim(); notice = notice.slice(0, rm.index).trim(); }
        if (notice) soft.summary = notice;
      }
    } else if (kind === "timeline") {
      if (typeof fm.session === "number") f.session = fm.session;
      f.title = plain(fm.title) || (f.session ? "Session " + f.session : note);
      f.events = timelineEvents(sectionRaw(body, /^timeline$/i));
      if (!f.events.length) return { skip: "recap has no bullets under ## Timeline" };
    } else {
      f.name = note;
      if (kind === "people" && first(fm.location)) f.where = first(fm.location);
      if (kind === "people" && first(fm.tagline)) f.role = first(fm.tagline);
      if (kind === "places" && (first(fm.tagline) || first(fm.type))) f.kind = first(fm.tagline) || first(fm.type);
    }
    var known = sectionText(body, /^(player summary|what the party knows)$/i);
    if (known) f.summary = known;
    Object.keys(fm).forEach(function (k) {
      var m = /^ledger-(.+)$/.exec(k); if (!m) return;
      var name = m[1] === "name" && kind === "quests" ? "title" : m[1];
      var spec = kinds[kind] && kinds[kind].fields.filter(function (x) { return x[0] === name; })[0];
      if (!spec || fm[k] === "") return;
      var v = spec[2] === "number" ? Number(fm[k]) : [].concat(fm[k]).map(plain).join(", ");
      if (spec[2] === "number" ? isNaN(v) : !v) return;
      if (spec[2] === "select" && spec[3].indexOf(v) < 0) return;
      f[name] = v; delete soft[name];
    });
    // part-of names the parent note: follow the link target, not its display alias.
    var parent = String([].concat(fm["part-of"] || [])[0] || ""), link = /\[\[([^\]|#]*)/.exec(parent);
    return { kind: kind, note: note, path: path, fields: f, soft: soft, partOf: kind === "places" ? (link ? link[1] : plain(parent)).trim().toLowerCase() : "" };
  }
  // Which map each place goes on: follow its part-of chain up to the town (local) or the island (world).
  // Places that reach neither, or that set ledger-map, are left as they are (world unless ledger-map says town).
  var TOWN = "guardian's rest", ISLAND = "toruun";
  function resolveMaps(entries) {
    var byNote = {};
    entries.forEach(function (e) { if (e && e.kind === "places") byNote[e.note.toLowerCase()] = e; });
    entries.forEach(function (e) {
      if (!e || e.kind !== "places" || e.fields.map) return;
      var seen = {}, at = e.partOf;
      while (at && !seen[at]) {
        if (at === TOWN) { e.fields.map = "town"; return; }
        if (at === ISLAND) break;
        seen[at] = true; at = byNote[at] && byNote[at].partOf;
      }
      e.fields.map = "world";
    });
    return entries;
  }
  var Vault = { parseNote: parseNote, plain: plain, sectionText: sectionText, timelineEvents: timelineEvents, entry: vaultEntry, resolveMaps: resolveMaps };
  if (typeof module !== "undefined" && module.exports) module.exports = Vault; else root.Vault = Vault;
})(this);
