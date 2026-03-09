// Expo config plugin to register the SystemActionsPackage in MainApplication.
// After `npx expo prebuild`, this plugin copies the Kotlin files into the android/ dir
// and adds the package registration to the auto-generated MainApplication.

const { withMainApplication, withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

function withSystemActions(config) {
  // Copy Kotlin source files into the generated android project
  config = withDangerousMod(config, [
    "android",
    (config) => {
      const srcDir = path.join(
        config.modRequest.projectRoot,
        "native/android/src/main/java/com/cosmico/vesta"
      );
      const destDir = path.join(
        config.modRequest.platformProjectRoot,
        "app/src/main/java/com/cosmico/vesta"
      );

      if (!fs.existsSync(srcDir)) {
        console.warn(
          "[with-system-actions] Source directory not found:",
          srcDir
        );
        return config;
      }

      fs.mkdirSync(destDir, { recursive: true });
      for (const file of fs.readdirSync(srcDir)) {
        if (file.endsWith(".kt") || file.endsWith(".java")) {
          fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
        }
      }
      return config;
    },
  ]);

  // Register the package in MainApplication
  config = withMainApplication(config, (config) => {
    let contents = config.modResults.contents;

    // Add import (if not already present)
    if (!contents.includes("import com.cosmico.vesta.SystemActionsPackage")) {
      // Try multiple import insertion patterns
      const importPatterns = [
        /(import com\.facebook\.react.*\n)/,
        /(import android\.app\.Application\n)/,
        /(^package .*\n)/m,
      ];

      let importInserted = false;
      for (const pattern of importPatterns) {
        if (pattern.test(contents)) {
          contents = contents.replace(
            pattern,
            `$1import com.cosmico.vesta.SystemActionsPackage\n`
          );
          importInserted = true;
          break;
        }
      }

      if (!importInserted) {
        console.warn(
          "[with-system-actions] Could not find import insertion point in MainApplication"
        );
      }
    }

    // Add to packages list (if not already present)
    if (!contents.includes("SystemActionsPackage()")) {
      const packagePatterns = [
        // Expo SDK 55 / RN 0.83: PackageList(this).packages.apply { ... }
        // Insert add() call inside the .apply block
        {
          pattern: /(PackageList\(this\)\.packages\.apply\s*\{)\s*\n/,
          replacement: `$1\n          add(SystemActionsPackage())\n`,
        },
        // Older pattern: packages.add(MainReactPackage())
        {
          pattern: /(packages\.add\(MainReactPackage\(\)\))/,
          replacement: `$1\n          packages.add(SystemActionsPackage())`,
        },
      ];

      let packageInserted = false;
      for (const { pattern, replacement } of packagePatterns) {
        if (pattern.test(contents)) {
          contents = contents.replace(pattern, replacement);
          packageInserted = true;
          break;
        }
      }

      if (!packageInserted) {
        console.warn(
          "[with-system-actions] Could not find package registration point in MainApplication. " +
            "You may need to manually add SystemActionsPackage() to your packages list."
        );
      }
    }

    config.modResults.contents = contents;
    return config;
  });

  return config;
}

module.exports = withSystemActions;
