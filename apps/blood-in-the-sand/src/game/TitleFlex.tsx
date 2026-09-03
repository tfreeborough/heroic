import { Text, type StyleProp, type TextStyle } from "react-native";

/**
 * The one title treatment (bits-title-moments.md § the treatment): small caps
 * in the established title gold, letter-spaced, flanked by the Chronicle's
 * WORN ✦ marks, and auto-shrunk to a single line — a title is a name, never a
 * sentence. Every moment renders titles through this so the tuning happens
 * once (the DeedCards rule). Bare/unresolved titles render nothing, so each
 * moment degrades to exactly what shipped before titles.
 */
export interface TitleFlexProps {
  /** RESOLVED display text (resolveTitleText) — null/"" renders nothing. */
  title: string | null | undefined;
  /** Font size — letter-spacing scales with it. */
  size: number;
  style?: StyleProp<TextStyle>;
}

export const TitleFlex = ({ title, size, style }: TitleFlexProps) => {
  if (!title) return null;
  return (
    <Text
      numberOfLines={1}
      adjustsFontSizeToFit
      style={[
        {
          // Bounded so numberOfLines+adjustsFontSizeToFit actually engage —
          // an unconstrained Text in a centred column just overflows the
          // screen instead of shrinking (Tom's long-title on-device catch).
          maxWidth: "100%",
          fontSize: size,
          fontWeight: "800",
          color: "#cfa964",
          letterSpacing: size * 0.14,
          textAlign: "center",
          textShadowColor: "rgba(0,0,0,0.6)",
          textShadowOffset: { width: 0, height: 1 },
          textShadowRadius: 3,
        },
        style,
      ]}
    >
      {`✦ ${title.toUpperCase()} ✦`}
    </Text>
  );
};
