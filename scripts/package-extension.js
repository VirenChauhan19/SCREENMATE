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

fs.mkdirSync(OUT, { recursive: true });
const name = `screenmate-${manifest.version}.zip`;
fs.writeFileSync(path.join(OUT, name), Buffer.from(zipSync(files, { level: 9 })));

const kb = (fs.statSync(path.join(OUT, name)).size / 1024).toFixed(1);
console.log(`packaged dist/${name} (${kb} KB, ${Object.keys(files).length} files)`);
console.log(`version ${manifest.version} | host_permissions: ${manifest.host_permissions.join(", ")}`);
console.log(
  "\nUsers set the backend URL and access key in the popup, so a localhost " +
    "default is fine — but tell them the hosted URL.",
);
