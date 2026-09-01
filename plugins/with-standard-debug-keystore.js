const { withAppBuildGradle } = require("expo/config-plugins");

const generatedDebugKeystore = "storeFile file('debug.keystore')";
const standardDebugKeystore = `def standardDebugKeystore = new File(System.getProperty('user.home'), '.android/debug.keystore')
            storeFile standardDebugKeystore.exists() ? standardDebugKeystore : file('debug.keystore')`;

module.exports = function withStandardDebugKeystore(config) {
  return withAppBuildGradle(config, (modConfig) => {
    if (!modConfig.modResults.contents.includes(generatedDebugKeystore)) {
      return modConfig;
    }

    modConfig.modResults.contents = modConfig.modResults.contents.replace(
      generatedDebugKeystore,
      standardDebugKeystore,
    );
    return modConfig;
  });
};
