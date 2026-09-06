import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = resolve(repositoryRoot, "plugins/varoriya-generate");
const manifestPath = resolve(pluginRoot, ".codex-plugin/plugin.json");
const marketplacePath = resolve(repositoryRoot, ".agents/plugins/marketplace.json");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
assert(manifest.name === "varoriya-generate", "manifest name must match its folder");
assert(/^\d+\.\d+\.\d+$/.test(manifest.version), "manifest version must be semver");
assert(typeof manifest.description === "string" && manifest.description.length > 20, "manifest description is required");
const skillPaths =
  typeof manifest.skills === "string"
    ? [manifest.skills]
    : Array.isArray(manifest.skills)
      ? manifest.skills
      : [];
assert(skillPaths.length > 0, "at least one skill path is required");
assert(!containsPlaceholder(manifest), "manifest contains a placeholder");

for (const skill of skillPaths) {
  assert(typeof skill === "string" && !skill.startsWith("/"), "skill paths must be relative");
  await access(resolve(pluginRoot, skill));
}

if (manifest.interface?.defaultPrompt) {
  assert(
    Array.isArray(manifest.interface.defaultPrompt) ||
      typeof manifest.interface.defaultPrompt === "string",
    "defaultPrompt must be a string or array",
  );
}

const marketplace = JSON.parse(await readFile(marketplacePath, "utf8"));
const entry = marketplace.plugins?.find((item) => item.name === manifest.name);
assert(entry, "marketplace entry is missing");
assert(entry.source?.path === "./plugins/varoriya-generate", "marketplace source path is invalid");
assert(entry.policy?.installation, "marketplace installation policy is required");
assert(entry.policy?.authentication, "marketplace authentication policy is required");
assert(entry.category, "marketplace category is required");
assert(!containsPlaceholder(marketplace), "marketplace contains a placeholder");

process.stdout.write("Plugin package validation passed.\n");

function containsPlaceholder(value) {
  return /\[TODO:|replace[_ -]?me|example\.com/i.test(JSON.stringify(value));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
