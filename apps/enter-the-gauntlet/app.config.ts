import { ConfigContext, ExpoConfig } from 'expo/config';

const IS_DEV = process.env.APP_VARIANT === 'development';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: IS_DEV ? 'Gauntlet (Dev)' : config.name!,
  slug: config.slug!,
  android: {
    ...config.android,
    package: IS_DEV
      ? 'com.heroic.enter_the_gauntlet.dev'
      : config.android!.package,
  },
  ios: {
    ...config.ios,
    bundleIdentifier: IS_DEV
      ? 'com.tfreeb.heroic-enter-the-gauntlet.dev'
      : config.ios!.bundleIdentifier,
  },
});
