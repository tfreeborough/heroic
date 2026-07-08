import { ConfigContext, ExpoConfig } from 'expo/config';

const IS_DEV = process.env.APP_VARIANT === 'development';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: IS_DEV ? 'Blood (Dev)' : config.name!,
  slug: config.slug!,
  android: {
    ...config.android,
    package: IS_DEV ? 'com.heroic.blood_in_the_sand.dev' : config.android!.package,
  },
  ios: {
    ...config.ios,
    bundleIdentifier: IS_DEV ? 'com.tfreeb.blood-in-the-sand.dev' : config.ios!.bundleIdentifier,
  },
});
