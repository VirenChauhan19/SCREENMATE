import { FlatCompat } from "@eslint/eslintrc";
import globals from "globals";
import { fileURLToPath } from "node:url";

const compat = new FlatCompat({ baseDirectory: fileURLToPath(new URL(".", import.meta.url)) });
export default [
  { ignores: [".next/**", "node_modules/**", "dist/**", ".tsbuild/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript").map(config => ({ ...config, files: ["src/**/*.{ts,tsx}"] })),
  { files: ["extension/**/*.js"], languageOptions: { sourceType: "script", globals: {
    ...globals.browser, chrome: "readonly", SM_PROFILE_FIELDS: "readonly", SM_ESSENTIAL: "readonly",
    smEsc: "readonly", smIsPlaceholder: "readonly", smHealth: "readonly", smEnsureHostPermission: "readonly",
  } }, rules: { "no-undef": "error", "no-unreachable": "error", "no-dupe-keys": "error" } },
  { files: ["scripts/*regressions.test.js"], languageOptions: { sourceType: "commonjs", globals: globals.node } },
];
