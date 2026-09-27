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
 * The profile the tests fill forms from. A fresh install starts with an empty
 * profile (it would otherwise be typed into real applications), so the tests
 * bring their own. Test data only: example.net is reserved for examples.
 */
const TEST_PROFILE = {
  name: "Viren Chauhan",
  email: "viren.test@example.net",
  phone: "404-555-0142",
  location: "Atlanta, Georgia",
  country: "United States",
  university: "SCAD",
  degree: "BFA Game Design",
  minor: "Applied AI",
  graduationDate: "2027",
  currentCompany: "",
  currentTitle: "",
  portfolio: "https://virenchauhan.com",
  linkedin: "https://www.linkedin.com/in/viren-test",
  github: "",
  skills: ["React", "TypeScript", "Python", "Unreal Engine", "Unity", "AI integrations"],
};

/**
 * Seeds the extension's backend settings and a test profile, from one of the
 * extension's own pages.
 *
 * Tests run on a throwaway Chrome profile, so storage starts empty. A fresh
 * install also opens the welcome page; it is closed here so tests start from
 * a clean set of tabs.
 */
async function configureExtension(browser, extId, { backendUrl, apiKey, profile } = {}) {
  for (const p of await browser.pages()) {
    if (p.url().includes(`${extId}/options/`)) await p.close();
  }
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${extId}/popup/popup.html`, {
    waitUntil: "domcontentloaded",
  });
  await page.evaluate(
    async (cfg) => {
      await chrome.storage.local.set({
        backendUrl: cfg.backendUrl,
        apiKey: cfg.apiKey,
        profile: cfg.profile,
      });
    },
    {
      backendUrl: backendUrl || "http://localhost:3000",
      apiKey: apiKey ?? envValue("SCREENMATE_API_KEY"),
      profile: profile || TEST_PROFILE,
    },
  );
  await page.close();
}

module.exports = { envValue, configureExtension, TEST_PROFILE };
