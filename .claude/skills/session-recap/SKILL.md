---
name: session-recap
description: Turn a speech-to-text transcript of a played Guardian's Rest session into a session recap note in the Obsidian vault, with a player summary and a timeline of the major moments, linked to the vault's character, location and quest notes so the ledger's Sync from Obsidian can import it. Use when the GM gives a session transcript, or asks for a recap or timeline of a session.
argument-hint: <transcript file> [session number]
---

# Session recap from a transcript

The GM gives you a transcript of a session that has been played. You write one recap note into the vault. The GM reviews it in Obsidian, then imports it with **Sync from Obsidian** in the ledger, where it shows up on the Timeline tab and in each linked person's Interactions.

**Vault:** `C:/Users/Matth/Desktop/The Spire/Mountport` (use a different path if the GM gives one).

## 1. Gather what you need

1. **The transcript**, from the path the GM gave. If they didn't give one, ask. Read the whole thing, even if it's long: read it in chunks rather than skimming.
2. **The session number.** Take it from the GM, the transcript's file name, or the session plan. If none of these gives it, ask. Don't guess.
3. **The names in the vault.** List the note file names in `Characters/`, `Locations/` and `Quests/`, including subfolders. These are the only names you may link. For each character, read the frontmatter `tagline` and the `## Player summary`: that's usually enough to tell who's who. Open a full note only when you need it to settle who someone is.
4. **The session plan**, if there is one (`Sessions/Session <N> - <name>.md`, tagged `session`). Use it to learn the names, places and quest that were *planned*. The recap must describe what *actually happened* in the transcript, which often differs from the plan.
5. **Earlier recaps** (`Sessions/Session <N> - Recap.md`) for continuity, if there are any.

## 2. Read the transcript the way the GM would

Speech-to-text transcripts are messy. Allow for all of this:

- **Speakers are players, not characters.** A label like `Sam:` is a person at the table. Work out which character each player is playing from context, such as the names others call them in play. If you can't tell, refer to "the party" rather than guessing.
- **Names get misheard.** "Marina See legs", "Agatha Wyndham" and "the drown gull" are Marina Sealegs Saltmarsh, Agatha Windham and The Drowned Gull. Match them to the vault names using sound and context. If you can't match a name confidently, don't link it. List it under "For the GM" instead.
- **Most of it isn't the story.** Leave out rules talk, dice rolls, snack breaks, scheduling and jokes out of character. The GM narrating, or doing an NPC's voice, is where the story is.
- **Only what happened counts.** Something a player suggested but the party didn't do, or a plan they dropped, is not a moment.

## 3. Pick the major moments

A moment is something the party will want to remember later. Examples:

- meeting someone for the first time, or a real change in a relationship (a deal, a fight, a favour, a betrayal, earning trust)
- learning something important: a clue, a secret revealed in play, a rumour that matters
- taking on, advancing, failing or finishing a quest
- going somewhere new or significant
- a fight and how it ended
- a decision the party made, such as choosing the guild's home or sparing an enemy

Aim for about 8 to 20 moments for a three-hour session. Merge small beats into one moment, and leave out anything trivial.

## 4. Keep it player-safe

The recap is shown to players. Write only what the party saw, heard or learned at the table.

- **Never** use anything from the vault notes that the party hasn't discovered: GM secrets, backstories, true motives, what's behind a twist. Vault notes are for resolving names, not a source of facts.
- If an NPC lied to the party, record what they *said* ("Silas swore he'd never been near the wreck"), not the truth.
- Write in the past tense, from the party's point of view, in plain and vivid language. Use one or two sentences per moment.

## 5. Write the note

Write `Sessions/Session <N> - Recap.md` in the vault, in exactly this shape:

```markdown
---
tags: [recap]
session: <N>
title: "<a short evocative name for the session>"
date: <YYYY-MM-DD, if the GM or the transcript gives it; otherwise leave this line out>
---

## Player summary

<Two to four sentences: what this session was about, as the party would tell it.>

## Timeline

- The party arrived in the cove aboard a chartered boat with [[Alak'Kith Swiftfoot|Alak'Kith]], the guild's director.
- [[Marina Sealegs Saltmarsh|Marina]] welcomed them at [[The Pier]] and revealed the census was one signature short, so [[Census Assistance Required|the census job]] began.
- ...

## For the GM

<Not imported into the ledger. List names you couldn't match, new NPCs or places who have no vault note yet (as plain text, with a line about each), and anything you were unsure of, quoting the transcript line.>
```

Rules for the Timeline list, because the ledger reads it:

- One moment per top-level `- ` bullet, in the order things happened. Don't use sub-bullets or headings inside the section.
- **Link every person, place and quest from the vault that the moment involves**, using the exact note file name: `[[Note Name]]`, or `[[Note Name|short name]]` to read naturally. The ledger uses these links to show each moment on that person's, place's or quest's page and in the timeline filter, so a missed link means a missing moment.
- Don't link player characters, or names that have no vault note. Write those as plain text.
- Don't embed images, and don't link lore, session or handout notes.

If the recap file already exists, show the GM what would change and ask before you overwrite it. Don't edit any other vault note. If a new NPC needs a note, suggest it under "For the GM".

## 6. Hand back

Tell the GM:

- where you wrote the note, and how many moments it has
- anything under "For the GM" that needs their attention
- the next step: review the note in Obsidian, then in the ledger open GM view, then **Sync from Obsidian**, pick the vault folder and apply. The session arrives hidden: they can reveal it on the Timeline tab, or tick "Show new entries to players" before applying.
