// Run with: node --test
// Set VAULT_DIR to an Obsidian vault folder to also check every tagged note in it, e.g.
//   VAULT_DIR="C:/Users/Matth/Desktop/The Spire" node --test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const KINDS = require("../kinds.js");
const Vault = require("../vault.js");

const entry = (file, text) => Vault.entry(file, text, KINDS);

test("character: tagline, location and player summary, nothing from GM sections", () => {
  const e = entry("Mountport/Characters/Agatha Windham.md", [
    "---", "tags: [character]", 'location: "[[The Pier]]"', 'tagline: "Wild old woman under the pier"', "---",
    "*Pronounced: ag-uh-thuh win-dum*", "", "## Player summary", "",
    "A wild-haired old woman at war with the **sea**. Wary of [[Seagulls|gulls]].", "", "![[agatha-portrait.png]]", "",
    "## Overview", "", "SECRET", "", "## GM secret", "SECRET"
  ].join("\n"));
  assert.deepEqual(e.fields, {
    name: "Agatha Windham", where: "The Pier", role: "Wild old woman under the pier",
    summary: "A wild-haired old woman at war with the sea. Wary of gulls."
  });
});

test("character: the first embedded image is the portrait; other kinds have none", () => {
  const image = (file, body) => entry(file, "---\ntags: [character]\n---\n" + body).image;
  assert.equal(image("Characters/Agatha Windham.md", "*Pronounced*\n\n## Player summary\nWild.\n\n![[agatha-portrait.png]]\n\n![[second.png]]"), "agatha-portrait.png");
  assert.equal(image("Characters/X.md", "![[portraits/My Face.JPG|338]]"), "My Face.JPG");
  assert.equal(image("Characters/X.md", "![face](portraits/face%20one.webp)"), "face one.webp");
  assert.equal(image("Characters/X.md", "No picture yet. [[agatha-portrait.png]] is a link, not an embed."), "");
  assert.equal(entry("Locations/Pier.md", "---\ntags: [location]\n---\n![[pier.png]]").image, "");
});

test("quest: frontmatter, giver, and the board notice split into summary and reward", () => {
  const e = entry("Quests/Assistant Wanted.md", [
    "---", "tags: [quest]", "quest-giver:", '  - "[[Margaret Grandma Yew]]"', "completed: false", "order: 5", "xp: 300", "---",
    "**Posted by:** [[Margaret Grandma Yew|Grandma Yew]]", "",
    "*One Day Only: I need a pair of hands. Reward: 8 gold and a remedy of your choice.*", "",
    "**Reward:** GM-only reward notes"
  ].join("\n"));
  assert.equal(e.kind, "quests");
  assert.deepEqual(e.fields, { title: "Assistant Wanted", giver: "Margaret Grandma Yew", xp: 300, order: 5,
    reward: "8 gold and a remedy of your choice", summary: "One Day Only: I need a pair of hands." });
});

test("quest: a Player summary beats the notice for the summary; the notice still gives the reward", () => {
  const e = entry("Quests/Census.md", ["---", "tags: [quest]", "---", "*OFFICIAL NOTICE: One signature needed. Reward: 10 gold.*", "",
    "## Player summary", "", "The census is one signature short.", "", "## Role-play", "GM notes"].join("\n"));
  assert.equal(e.fields.summary, "The census is one signature short.");
  assert.equal(e.fields.reward, "10 gold");
});

test("quest: a signature after the reward isn't part of it", () => {
  const e = entry("Quests/Botany.md", "---\ntags: [quest]\n---\n*OFFICIAL NOTICE. Escort the school trip. Reward: 12 gold and lunch provided by the students. — Constable H. Brightwater*\n");
  assert.equal(e.fields.reward, "12 gold and lunch provided by the students");
  assert.equal(e.fields.summary, "OFFICIAL NOTICE. Escort the school trip.");
});

test("quest: completed marks it done; ledger overrides win and bad values are ignored", () => {
  const e = entry("x/Q.md", "---\ntags: [quest]\ncompleted: true\nledger-status: bogus\nledger-reward: 5 gold\nledger-xp: lots\n---\n*Notice. Reward: 9 gold.*\n");
  assert.deepEqual(e.fields, { title: "Q", status: "completed", reward: "5 gold", summary: "Notice." });
});

test("location: type becomes kind; Windows line endings and list-style tags", () => {
  const e = entry("Locations/The Capital.md", ["---", "tags:", "- location", "type: city", "---", "## Overview", "The distant capital.", ""].join(String.fromCharCode(13, 10)));
  assert.deepEqual(e.fields, { name: "The Capital", kind: "city" });
});

test("location: tagline is the subheading, ahead of type", () => {
  const place = fm => entry("Locations/Gull Point Lighthouse.md", ["---", "tags: [location]"].concat(fm, ["---", ""]).join(String.fromCharCode(10))).fields.kind;
  assert.equal(place(["type: lighthouse", 'tagline: "The light that guides boats home"']), "The light that guides boats home");
  assert.equal(place(["type: lighthouse"]), "lighthouse");
  assert.equal(place([]), undefined);
});

test("location: part-of chain decides the map: Guardian's Rest is local, Toruun is the island", () => {
  const place = (name, partOf, extra) => entry("Locations/" + name + ".md",
    ["---", "tags: [location]"].concat(partOf ? ['part-of: "' + partOf + '"'] : [], extra || [], ["---", ""]).join(String.fromCharCode(10)));
  const notes = [
    place("Toruun"), place("Guardian's Rest", "[[Toruun]]"),
    place("The Merry Gull", "[[Guardian's Rest]]"), place("Gull Point Reef", "[[Guardian's Rest|the town]]"),
    place("Toruun's Spine", "[[Toruun]]"), place("Mount Kellen", "[[Toruun's Spine]]"), place("Kellen's Hearth", "[[Mount Kellen]]"),
    place("Cellar", "[[The Merry Gull]]"), place("The Capital"), place("Nowhere", "[[Missing Note]]"),
    place("Loop A", "[[Loop B]]"), place("Loop B", "[[Loop A]]"),
    place("Overridden", "[[Guardian's Rest]]", ["ledger-map: world"])
  ];
  Vault.resolveMaps(notes.concat([null, { skip: "x" }]));
  const map = {}; notes.forEach(e => { map[e.note] = e.fields.map; });
  assert.deepEqual(map, {
    "Toruun": "world", "Guardian's Rest": "world", "The Merry Gull": "town", "Gull Point Reef": "town",
    "Toruun's Spine": "world", "Mount Kellen": "world", "Kellen's Hearth": "world", "Cellar": "town",
    "The Capital": "world", "Nowhere": "world", "Loop A": "world", "Loop B": "world", "Overridden": "world"
  });
});

test("ledger: false skips; untagged notes are ignored", () => {
  assert.deepEqual(entry("x/N.md", "---\ntags: [quest]\nledger: false\n---\n"), { skip: "marked ledger: false" });
  assert.equal(entry("Lore/History.md", "---\ntags: [lore]\n---\nText"), null);
  assert.equal(entry("Sessions/1.md", "No frontmatter at all"), null);
});

test("ledger: <kind> picks the type when tags don't", () => {
  assert.equal(entry("x/Finn.md", "---\nledger: character\n---\n").kind, "people");
});

test("recap: one timeline entry per session, with each moment's links", () => {
  const e = entry("Sessions/Session 1 - Recap.md", [
    "---", "tags: [recap]", "session: 1", 'title: "The Hundredth Signature"', "---",
    "## Player summary", "", "The guild arrived and won the town's hundredth signature.", "",
    "## Timeline", "",
    "- The party sailed into the cove with [[Alak'Kith Swiftfoot|Alak'Kith]].",
    "- [[Marina Sealegs Saltmarsh|Marina]] met them at [[The Pier]] and started",
    "  [[Census Assistance Required|the census job]]. ![[census.png]]",
    "- They took a crab hostage for [[Agatha Windham#Mittens|Agatha]], and [[Agatha Windham]] signed.",
    "", "## For the GM", "", "- [[Someone Unmatched]] needs a note"
  ].join("\n"));
  assert.equal(e.kind, "timeline");
  assert.deepEqual(e.fields, {
    session: 1, title: "The Hundredth Signature",
    summary: "The guild arrived and won the town's hundredth signature.",
    events: [
      { text: "The party sailed into the cove with Alak'Kith.", links: ["Alak'Kith Swiftfoot"] },
      { text: "Marina met them at The Pier and started the census job.", links: ["Marina Sealegs Saltmarsh", "The Pier", "Census Assistance Required"] },
      { text: "They took a crab hostage for Agatha, and Agatha Windham signed.", links: ["Agatha Windham"] }
    ]
  });
});

test("recap: falls back to 'Session N' for the title; no bullets means skip", () => {
  assert.equal(entry("x/R.md", "---\ntags: [recap]\nsession: 4\n---\n## Timeline\n- Something happened.\n").fields.title, "Session 4");
  assert.deepEqual(entry("x/R.md", "---\ntags: [recap]\nsession: 4\n---\n## Timeline\n\nTBD\n"), { skip: "recap has no bullets under ## Timeline" });
});

test("player character: player-character beats character; tagline, player and summary, nothing from GM sections", () => {
  const e = entry("Mountport/Characters/Party/Naia Thalassira.md", [
    "---", "tags: [character, player-character]", 'location: "[[Guardian\'s Rest]]"', 'tagline: "Mermaid druid with a secret"', "player: Sophie", "---",
    "## Player summary", "", "A cheerful young sea elf druid.", "", "## Overview", "", "**Really:** a mermaid"
  ].join("\n"));
  assert.equal(e.kind, "players");
  assert.deepEqual(e.fields, { name: "Naia Thalassira", role: "Mermaid druid with a secret", player: "Sophie", summary: "A cheerful young sea elf druid." });
});

test("recap: party moments, one heading per character, linked or plain", () => {
  const e = entry("Sessions/Session 1 - Recap.md", [
    "---", "tags: [recap]", "session: 1", "---",
    "## Timeline", "", "- The party arrived.", "",
    "## Party moments", "",
    "### [[Naia Thalassira|Naia]]", "", "- Talked a baby crab into coming along, and named him Mr. Snippy.",
    "- Asked [[Roselynn Brightwater|Roz]] about", "  the town. ![[naia.png]]", "",
    "### Torren", "- Front-flipped onto the pier.", "",
    "### Breadstick", "", "Nothing this time.", "",
    "## For the GM", "- not a moment"
  ].join("\n"));
  assert.deepEqual(e.fields.party, [
    { who: "Naia Thalassira", events: [
      { text: "Talked a baby crab into coming along, and named him Mr. Snippy.", links: [] },
      { text: "Asked Roz about the town.", links: ["Roselynn Brightwater"] }] },
    { who: "Torren", events: [{ text: "Front-flipped onto the pier.", links: [] }] }
  ]);
  assert.equal(e.fields.events.length, 1);
  assert.equal(entry("x/R.md", "---\ntags: [recap]\n---\n## Timeline\n- A.\n").fields.party, undefined);
});

test("session plans (tag session) are not recaps", () => {
  assert.equal(entry("Sessions/Session 1 - Plan.md", "---\ntags: [session]\nsession: 1\n---\n## Timeline\n- planned beat\n"), null);
});

const vaultDir = process.env.VAULT_DIR;
test("every tagged note in VAULT_DIR parses", { skip: !vaultDir && "set VAULT_DIR to check a real vault" }, () => {
  const files = [];
  (function walk(d) {
    for (const f of fs.readdirSync(d)) {
      if (/^\.|^templates?$/i.test(f)) continue;
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p); else if (/\.md$/i.test(f)) files.push(p);
    }
  })(vaultDir);
  const counts = { quests: 0, people: 0, places: 0, players: 0, timeline: 0 };
  for (const p of files) {
    const e = entry(p.split(path.sep).join("/"), fs.readFileSync(p, "utf8"));
    if (!e || e.skip) continue;
    counts[e.kind]++;
    assert.ok(e.fields.title || e.fields.name, p + ": no name");
    if (e.kind === "people") {
      assert.ok(e.fields.role, p + ": no tagline");
      assert.ok(e.fields.summary, p + ": no Player summary");
    }
  }
  console.log("Vault notes:", counts);
  assert.ok(Object.values(counts).some(Boolean), "no tagged notes found");
});
