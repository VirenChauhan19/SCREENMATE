const fs = require("fs");
const path = require("path");

/** Reads a value out of .env.local without pulling in a dotenv dependency. */
function envValue(name) {
  const file = path.resolve(__dirname, "..", ".env.local");
  if (!fs.existsSync(file)) return "";
  const line = fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith(`${name}=`));
  return line ? line.slice(line.indexOf("=") + 1).trim() : "";
}

/**
 * Seeds the extension's backend settings the way the popup does.
 *
 * Tests run on a throwaway Chrome profile, so storage starts empty. We drive the
 * extension's own popup page rather than poking storage from outside, which also
 * keeps the popup itself on the tested path.
 */
async function configureExtension(browser, extId, { backendUrl, apiKey } = {}) {
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${extId}/popup/popup.html`, {
    waitUntil: "domcontentloaded",
  });
  await page.evaluate(
    async (cfg) => {
      await chrome.storage.local.set({
        backendUrl: cfg.backendUrl,
        apiKey: cfg.apiKey,
      });
    },
    {
      backendUrl: backendUrl || "http://localhost:3000",
      apiKey: apiKey ?? envValue("SCREENMATE_API_KEY"),
    },
  );
  await page.close();
}

module.exports = { envValue, configureExtension };
