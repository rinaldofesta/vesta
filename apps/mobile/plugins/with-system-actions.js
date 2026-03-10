// Expo config plugin for native modules: SystemActionsPackage + Vesta Widget.
// After `npx expo prebuild`, this plugin copies Kotlin files and Android resources
// into the android/ dir, registers packages, and adds the widget receiver to the manifest.

const { withMainApplication, withDangerousMod, withAndroidManifest } = require("expo/config-plugins");
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

      // Copy Android resource files (widget layout, drawables, values, xml)
      const resSrcDir = path.join(
        config.modRequest.projectRoot,
        "native/android/src/main/res"
      );
      const resDestDir = path.join(
        config.modRequest.platformProjectRoot,
        "app/src/main/res"
      );

      if (fs.existsSync(resSrcDir)) {
        for (const subDir of fs.readdirSync(resSrcDir)) {
          const srcSubDir = path.join(resSrcDir, subDir);
          const destSubDir = path.join(resDestDir, subDir);
          if (fs.statSync(srcSubDir).isDirectory()) {
            fs.mkdirSync(destSubDir, { recursive: true });
            for (const file of fs.readdirSync(srcSubDir)) {
              fs.copyFileSync(
                path.join(srcSubDir, file),
                path.join(destSubDir, file)
              );
            }
          }
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

  // Register the Vesta Widget receiver in AndroidManifest.xml
  config = withAndroidManifest(config, (config) => {
    const mainApplication = config.modResults.manifest.application[0];

    if (!mainApplication.receiver) {
      mainApplication.receiver = [];
    }

    // Register widget activities (transparent overlays)
    if (!mainApplication.activity) {
      mainApplication.activity = [];
    }

    // Quick chat dialog (floating input over home screen)
    const hasQuickChat = mainApplication.activity.some(
      (a) => a.$?.["android:name"] === ".VestaQuickChatActivity"
    );
    if (!hasQuickChat) {
      mainApplication.activity.push({
        $: {
          "android:name": ".VestaQuickChatActivity",
          "android:theme": "@android:style/Theme.Translucent.NoTitleBar",
          "android:exported": "false",
          "android:excludeFromRecents": "true",
          "android:taskAffinity": "",
          "android:windowSoftInputMode": "adjustResize",
        },
      });
    }

    // Voice input activity
    const hasVoiceActivity = mainApplication.activity.some(
      (a) => a.$?.["android:name"] === ".VestaVoiceActivity"
    );
    if (!hasVoiceActivity) {
      mainApplication.activity.push({
        $: {
          "android:name": ".VestaVoiceActivity",
          "android:theme": "@android:style/Theme.Translucent.NoTitleBar",
          "android:exported": "false",
          "android:excludeFromRecents": "true",
          "android:taskAffinity": "",
        },
      });
    }

    const hasWidget = mainApplication.receiver.some(
      (r) => r.$?.["android:name"] === ".VestaWidgetProvider"
    );

    if (!hasWidget) {
      mainApplication.receiver.push({
        $: {
          "android:name": ".VestaWidgetProvider",
          "android:exported": "true",
          "android:label": "@string/widget_label",
        },
        "intent-filter": [
          {
            action: [
              {
                $: {
                  "android:name": "android.appwidget.action.APPWIDGET_UPDATE",
                },
              },
            ],
          },
        ],
        "meta-data": [
          {
            $: {
              "android:name": "android.appwidget.provider",
              "android:resource": "@xml/vesta_widget_info",
            },
          },
        ],
      });
    }

    return config;
  });

  return config;
}

module.exports = withSystemActions;
