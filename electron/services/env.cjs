const path = require("node:path");
const fs = require("node:fs/promises");

function loadLocalEnv(appPath) {
  const envPath = path.join(appPath, ".env");
  return fs
    .readFile(envPath, "utf8")
    .then((content) => {
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const equalsIndex = trimmed.indexOf("=");
        if (equalsIndex === -1) continue;
        const key = trimmed.slice(0, equalsIndex).trim();
        const value = trimmed.slice(equalsIndex + 1).trim();
        if (key && process.env[key] === undefined) {
          process.env[key] = value.replace(/^["']|["']$/g, "");
        }
      }
    })
    .catch(() => {});
}

module.exports = {
  loadLocalEnv,
};
