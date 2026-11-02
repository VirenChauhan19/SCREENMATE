import { readFile } from "node:fs/promises";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";
import { requestOrigin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Explicit allowlist: local config.json, profiles and credentials never enter this download. */
export async function GET(request: Request) {
  const root = path.join(process.cwd(), "extension");
  const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
  const files: Record<string, Uint8Array> = {};
  const names = ["background.js", "popup/popup.html", "popup/popup.js",
    "content/connect.js", "content/scan.js", "content/act.js", "content/nav.js",
    "content/prefs.js", "content/panel.js", "content/main.js",
    "icons/icon16.png", "icons/icon32.png", "icons/icon48.png", "icons/icon128.png"];
  await Promise.all(names.map(async (name) => { files[name] = new Uint8Array(await readFile(path.join(root, name))); }));
  const backendUrl = requestOrigin(request);
  manifest.host_permissions = [...new Set([...manifest.host_permissions, `${backendUrl}/*`])];
  files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
  files["config.json"] = strToU8(JSON.stringify({ backendUrl }));
  files["INSTALL.txt"] = strToU8("SCREENMATE\n\n1. Extract this ZIP.\n2. Open chrome://extensions and enable Developer mode.\n3. Click Load unpacked and select the extracted folder containing manifest.json.\n4. Open the SCREENMATE popup and save your access key.\n5. Return to the website and send your profile to the extension.\n6. Open an employer application and choose Open on this page.\n\nThis download contains no personal profile or access key.\n");
  return new Response(new Uint8Array(zipSync(files)), { headers: {
    "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="screenmate-extension.zip"',
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
  } });
}
