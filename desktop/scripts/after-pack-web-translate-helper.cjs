const { cpSync, existsSync, mkdirSync, rmSync } = require("node:fs");
const { join } = require("node:path");

module.exports = async function afterPackWebTranslateHelper(context) {
  const source = join(context.packager.projectDir, "resources", "web-translate-helper", "node_modules");
  if (!existsSync(source)) {
    throw new Error(`Prepared web translation helper dependencies are missing: ${source}`);
  }

  const resourcesRoot =
    context.electronPlatformName === "darwin"
      ? join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          "Contents",
          "Resources"
        )
      : join(context.appOutDir, "resources");
  const helperRoot = join(resourcesRoot, "web-translate-helper");
  const target = join(helperRoot, "node_modules");

  mkdirSync(helperRoot, { recursive: true });
  rmSync(target, { recursive: true, force: true });
  cpSync(source, target, { recursive: true });
};
