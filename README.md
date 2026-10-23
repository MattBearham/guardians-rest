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

## Tests

```
node --test
```

To also check every tagged note in your vault:

```
VAULT_DIR="C:/Users/Matth/Desktop/The Spire" node --test
```
