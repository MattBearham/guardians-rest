// The ledger's entry types and their fields: drives the GM forms and decides which ledger-<field> overrides a vault note may set.
(function (root) {
  "use strict";
  var KINDS = {
    quests: { label: "quest", fields: [
      ["title", "Title", "text"], ["giver", "Posted by", "text"], ["reward", "Reward", "text"],
      ["status", "Status", "select", ["available", "active", "completed"]], ["order", "Order", "number"], ["xp", "Guild XP", "number"],
      ["summary", "What the party knows", "area"]] },
    people: { label: "person", fields: [
      ["name", "Name", "text"], ["role", "Who they are", "text"], ["where", "Where to find them", "text"],
      ["order", "Order", "number"], ["summary", "What the party knows", "area"]] },
    places: { label: "place", fields: [
      ["name", "Name", "text"], ["kind", "Kind of place", "text"], ["order", "Order", "number"],
      ["summary", "What the party knows", "area"]] }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = KINDS; else root.LEDGER_KINDS = KINDS;
})(this);
