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

test("quest: frontmatter, giver, and the board notice split into summary and reward", () => {
  const e = entry("Quests/Assistant Wanted.md", [
    "---", "tags: [quest]", "quest-giver:", '  - "[[Margaret Grandma Yew]]"', "completed: false", "order: 5", "xp: 300", "---",
    "**Posted by:** [[Margaret Grandma Yew|Grandma Yew]]", "",
    "*One Day Only: I need a pair of hands. Reward: 8 gold and a remedy of your choice.*", "",
    "**Reward:** GM-only reward notes"
  ].join("\n"));
  assert.equal(e.kind, "quests");
  assert.deepEqual(e.fields, { title: "Assistant Wanted", giver: "Margaret Grandma Yew", xp: 300, order: 5 });
  assert.deepEqual(e.soft, { reward: "8 gold and a remedy of your choice", summary: "One Day Only: I need a pair of hands." });
});

test("quest: completed marks it done; ledger overrides win and bad values are ignored", () => {
  const e = entry("x/Q.md", "---\ntags: [quest]\ncompleted: true\nledger-status: bogus\nledger-reward: 5 gold\nledger-xp: lots\n---\n*Notice. Reward: 9 gold.*\n");
  assert.deepEqual(e.fields, { title: "Q", status: "completed", reward: "5 gold" });
  assert.deepEqual(e.soft, { summary: "Notice." });
});

test("location: type becomes kind; Windows line endings and list-style tags", () => {
  const e = entry("Locations/The Capital.md", "---\r\ntags:\r\n- location\r\ntype: city\r\n---\r\n## Overview\r\nThe distant capital.\r\n");
  assert.deepEqual(e.fields, { name: "The Capital", kind: "city" });
});

test("ledger: false skips; untagged notes are ignored", () => {
  assert.deepEqual(entry("x/N.md", "---\ntags: [quest]\nledger: false\n---\n"), { skip: "marked ledger: false" });
  assert.equal(entry("Lore/History.md", "---\ntags: [lore]\n---\nText"), null);
  assert.equal(entry("Sessions/1.md", "No frontmatter at all"), null);
});

test("ledger: <kind> picks the type when tags don't", () => {
  assert.equal(entry("x/Finn.md", "---\nledger: character\n---\n").kind, "people");
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
  const counts = { quests: 0, people: 0, places: 0 };
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
  assert.ok(counts.quests + counts.people + counts.places > 0, "no tagged notes found");
});
