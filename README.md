# guardians-rest

The Guardian's Rest player ledger: a static site on GitHub Pages backed by Supabase. No build step; push and it's live.

| File | What's in it |
|---|---|
| `index.html` | Markup only |
| `style.css` | All styles |
| `config.js` | Supabase URL and public key |
| `kinds.js` | Entry types (quests, people, places) and their fields |
| `vault.js` | Reads Obsidian notes into ledger fields (no DOM, runs in Node) |
| `app.js` | Everything else: rendering, GM tools, Supabase data layer |

When you change a CSS or JS file, bump its `?v=` number in `index.html` so browsers don't keep the old copy.

## Maps

The Places tab has a Town map (`map.jpg`) and a World map (`world.jpg`). Either image can be any shape. Until `world.jpg` exists, the World tab just lists its places. To replace a map, swap the file and bump its `?v=` in the `MAPS` list at the top of the chart code in `app.js`; existing pins may then need moving.

To choose a vault location's map, give the note a `map:` property (`local` or `town` for the Town map, `island` or `world` for the World map), or tag it `local` or `island`. A note with neither goes by folder: `Guardian's Rest` means the Town map, anything else the World map.

## Session timeline

1. After a session, run Claude Code in this folder and give it the transcript: `/session-recap path/to/transcript.txt 3`. It writes `Sessions/Session 3 - Recap.md` into the vault: a player summary, plus a `## Timeline` list of the major moments with `[[links]]` to the people, places and quests involved.
2. Review the note in Obsidian. Anything under "For the GM" isn't imported.
3. In the ledger, turn on GM view, open **Sync from Obsidian**, pick the vault folder and apply. The session arrives hidden; reveal it on the Timeline tab.

Each moment also appears in the Interactions of every linked person, and as "On the timeline" on linked places and quests. The skill's instructions are in `.claude/skills/session-recap/SKILL.md`.

## Tests

```
node --test
```

To also check every tagged note in your vault:

```
VAULT_DIR="C:/Users/Matth/Desktop/The Spire" node --test
```
