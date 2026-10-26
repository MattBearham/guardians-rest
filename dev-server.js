// Serves the ledger locally, plus read-only access to the Obsidian vault named by VAULT_DIR in .env.local,
// so Sync from Obsidian can read the vault without picking a folder. Run with: node dev-server.js [port]
// Listens on this computer only. Dotfiles (.env.local, .git) are never served, and only notes and images
// inside VAULT_DIR are readable through /__vault/.
const http = require("http"), fs = require("fs"), path = require("path");
const root = __dirname, port = Number(process.argv[2]) || 8000;

function env() {
  try {
    return Object.fromEntries(fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)
      .map(l => /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(l)).filter(Boolean).map(m => [m[1], m[2].replace(/^["']|["']$/g, "")]));
  } catch (e) { return {}; }
}
const vault = env().VAULT_DIR ? path.resolve(env().VAULT_DIR) : null;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".md": "text/markdown; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml" };
const VAULT_FILE = /\.(md|png|jpe?g|webp|gif)$/i;

// Every note and image in the vault, as paths relative to it. Skips dot folders (.obsidian, .trash) and templates.
function vaultFiles() {
  const out = [];
  (function walk(dir, rel) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith(".")) continue;
      const r = rel ? rel + "/" + ent.name : ent.name;
      if (ent.isDirectory()) { if (!/^templates?$/i.test(ent.name)) walk(path.join(dir, ent.name), r); }
      else if (VAULT_FILE.test(ent.name)) out.push(r);
    }
  })(vault, "");
  return out;
}
// A path inside `base`, or null if it would escape it or passes through a dot folder or file.
function inside(base, rel) {
  if (rel.split(/[\\/]/).some(p => p.startsWith("."))) return null;
  const p = path.resolve(base, rel);
  return p === base || p.startsWith(base + path.sep) ? p : null;
}
function send(res, code, type, body) { res.writeHead(code, { "content-type": type, "cache-control": "no-store" }); res.end(body); }
function sendFile(res, file) {
  fs.readFile(file, (err, buf) => err ? send(res, 404, "text/plain", "Not found") : send(res, 200, TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", buf));
}

http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/__vault/index") {
    if (!vault) return send(res, 404, "text/plain", "Set VAULT_DIR in .env.local");
    try { return send(res, 200, "application/json", JSON.stringify({ name: path.basename(vault), files: vaultFiles() })); }
    catch (e) { return send(res, 500, "text/plain", "Couldn't read VAULT_DIR"); }
  }
  if (url.pathname === "/__vault/file") {
    const rel = url.searchParams.get("path") || "", file = vault && VAULT_FILE.test(rel) ? inside(vault, rel) : null;
    return file ? sendFile(res, file) : send(res, 404, "text/plain", "Not found");
  }
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
  const file = inside(root, rel);
  return file ? sendFile(res, file) : send(res, 404, "text/plain", "Not found");
}).listen(port, "127.0.0.1", () => {
  console.log("Ledger: http://localhost:" + port);
  console.log(vault ? "Vault: " + vault : "No VAULT_DIR in .env.local, so Sync from Obsidian will ask for a folder.");
});
