const path = require("node:path");
const { pathToFileURL } = require("node:url");

function toMediaUrl(filePath) {
  return pathToFileURL(filePath).toString();
}

function toPosixRelative(baseDir, filePath) {
  return path.relative(baseDir, filePath).split(path.sep).join("/");
}

function resolveProjectPath(projectPath, relativePath) {
  return path.join(projectPath, relativePath);
}

module.exports = {
  toMediaUrl,
  toPosixRelative,
  resolveProjectPath,
};
