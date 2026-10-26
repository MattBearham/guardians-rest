// Turn Scriptly's Discord export (scriptly-page-1.json, scriptly-page-2.json, ...) into one chronological transcript.
// The pages are read as data only. Usage: node scriptly.js <folder, or any page in it> <out.txt>
// Each line reads "[elapsed | HH:MMZ] speaker: text", with a speaker's messages less than 20 seconds apart merged into one turn.
const fs = require("fs"), path = require("path");
const [input, out] = process.argv.slice(2);
if (!input || !out) { console.error("Usage: node scriptly.js <folder or scriptly-page-N.json> <out.txt>"); process.exit(1); }
const dir = fs.statSync(input).isDirectory() ? input : path.dirname(input);
const pages = fs.readdirSync(dir).filter(f => /^scriptly-page-\d+\.json$/i.test(f));
if (!pages.length) { console.error("No scriptly-page-N.json files in " + dir); process.exit(1); }
const msgs = [];
for (const f of pages) {
  for (const m of JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))) {
    const who = /^\[Scriptly\]\s*(.+)$/.exec((m.author && m.author.username) || "");
    const embed = (m.embeds || []).map(e => [e.author && e.author.name, e.description].filter(Boolean).join(": ")).join(" ");
    msgs.push({ t: new Date(m.timestamp), id: BigInt(m.id), who: who ? who[1] : "(bot)", text: (m.content || "").trim() || (who ? "" : embed) });
  }
}
// Discord message ids are time-ordered, and break ties between messages sent in the same millisecond.
msgs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const t0 = msgs[0].t, clock = t => { const s = Math.round((t - t0) / 1000); return Math.floor(s / 3600) + ":" + String(Math.floor(s / 60) % 60).padStart(2, "0"); };
const lines = []; let last = null;
for (const m of msgs) {
  if (!m.text) continue;
  if (last && last.who === m.who && m.t - last.t < 20000) { last.text += " " + m.text; last.t = m.t; continue; }
  last = { who: m.who, t: m.t, start: m.t, text: m.text }; lines.push(last);
}
fs.writeFileSync(out, lines.map(l => "[" + clock(l.start) + " | " + l.start.toISOString().slice(11, 16) + "Z] " + l.who + ": " + l.text).join("\n") + "\n");
const speakers = {}; msgs.forEach(m => { if (m.text) speakers[m.who] = (speakers[m.who] || 0) + 1; });
console.log(pages.length + " pages | " + msgs.length + " messages | " + lines.length + " turns | " + msgs[0].t.toISOString() + " to " + msgs[msgs.length - 1].t.toISOString());
console.log("speakers (messages each): " + JSON.stringify(speakers));
