// Raises IPHONEOS_DEPLOYMENT_TARGET on every CocoaPods target (including
// resource-bundle targets such as ReachabilitySwift-ReachabilitySwift and
// RNCAsyncStorage-RNCAsyncStorage_resources) up to the app's deployment
// target. React Native's post_install only patches each pod's main target,
// and Xcode 27+ refuses to archive when any target sits below iOS 15.0.
const { withPodfile } = require('expo/config-plugins');

const MARKER = '# [withPodsDeploymentTarget]';
const SNIPPET = `
    ${MARKER} raise every pod target (incl. resource bundles) to the app's deployment target
    min_target = (podfile_properties['ios.deploymentTarget'] || '15.0').to_f
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        current = config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'].to_f
        config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = min_target.to_s if current < min_target
      end
    end
`;

module.exports = function withPodsDeploymentTarget(config) {
  return withPodfile(config, (cfg) => {
    const contents = cfg.modResults.contents;
    if (contents.includes(MARKER)) return cfg;
    const anchor = 'post_install do |installer|';
    if (!contents.includes(anchor)) {
      throw new Error('[withPodsDeploymentTarget] could not find post_install block in Podfile');
    }
    cfg.modResults.contents = contents.replace(anchor, anchor + SNIPPET);
    return cfg;
  });
};
