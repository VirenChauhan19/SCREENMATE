/**
 * Zips extension/ for sharing or for the Chrome Web Store.
 * Fails loudly if the manifest still points at localhost, because an extension
 * shipped that way works only on the machine that built it.
 */
const fs = require("fs");
const path = require("path");
const { zipSync, strToU8 } = require("fflate");

const EXT = path.resolve(__dirname, "..", "extension");
const OUT = path.resolve(__dirname, "..", "dist");

function collect(dir, base = "") {
  const files = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(files, collect(full, rel));
    else files[rel] = new Uint8Array(fs.readFileSync(full));
  }
  return files;
}

const manifest = JSON.parse(
  fs.readFileSync(path.join(EXT, "manifest.json"), "utf8"),
);
const files = collect(EXT);
files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));

// --backend=URL --key=KEY bakes the backend into the zip, so whoever installs
// it is connected on first run instead of typing a URL and a secret.
const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : "";
};
const backendUrl = arg("backend");
const apiKey = arg("key");

if (backendUrl) {
  if (/localhost|127\.0\.0\.1/.test(backendUrl)) {
    console.error("");
    console.error(`Refusing to package --backend=${backendUrl}`);
    console.error(
      "localhost points at the recipient's own machine, where nothing runs.",
    );
    console.error("Pass the deployed URL instead.");
    process.exit(1);
  }
  files["config.json"] = strToU8(
    JSON.stringify({ backendUrl, ...(apiKey ? { apiKey } : {}) }, null, 2),
  );
}

fs.mkdirSync(OUT, { recursive: true });
const name = `screenmate-${manifest.version}.zip`;
fs.writeFileSync(path.join(OUT, name), Buffer.from(zipSync(files, { level: 9 })));

const kb = (fs.statSync(path.join(OUT, name)).size / 1024).toFixed(1);
console.log(`packaged dist/${name} (${kb} KB, ${Object.keys(files).length} files)`);
console.log(`version ${manifest.version}`);

if (backendUrl) {
  console.log(`bundled backend: ${backendUrl}`);
  console.log(
    apiKey
      ? `bundled access key: ${apiKey.slice(0, 6)}… (${apiKey.length} chars)`
      : "no access key bundled — the recipient must paste one",
  );
  if (apiKey) {
    console.log("");
    console.log("This zip contains your access key. Anyone who has the file can");
    console.log("spend your OpenRouter and Exa credits. Hand it to people");
    console.log("directly; do not post it anywhere public.");
  }
} else {
  console.log("");
  console.log("No backend bundled, so this defaults to the recipient's localhost.");
  console.log("To package for someone else's laptop:");
  console.log(
    "  npm run package:ext -- --backend=https://your-app.vercel.app --key=sm_...",
  );
}
