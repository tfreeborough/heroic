/**
 * Shared modal/sheet behaviours (Tom's device pass, 2026-08-15):
 *
 *  - useBackClose: Android hardware-back closes the topmost overlay instead
 *    of navigating. Works because BackHandler runs listeners newest-first
 *    and stops at the first `true` — an overlay subscribes on mount, so it
 *    always outranks App.tsx's navigation handler (subscribed at boot), and
 *    a forge stacked over a sheet outranks the sheet. The handler rides a
 *    ref so re-renders never re-subscribe (re-subscribing would shuffle the
 *    listener order and let back reach UNDER a newer overlay).
 *
 *  - useSheetDrag: makes the bottom-sheet handle honest — grab the handle
 *    zone, drag down, release past the threshold (or flick) and the sheet
 *    leaves; short drags spring back. `onGone` must remove the sheet
 *    INSTANTLY (state null + anim value reset) — the drag has already
 *    animated the exit, a second close animation would replay it.
 */
import { useEffect, useRef } from "react";
import { Animated, BackHandler, Easing, PanResponder } from "react-native";

export const useBackClose = (onBack: () => void): void => {
  const ref = useRef(onBack);
  ref.current = onBack;
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      ref.current();
      return true;
    });
    return () => sub.remove();
  }, []);
};

/** Drag past this (or flick faster than DISMISS_VY) and the sheet is gone. */
const DISMISS_DY = 110;
const DISMISS_VY = 0.8;
/** Far enough to clear any sheet height before the instant removal. */
const EXIT_Y = 520;

export const useSheetDrag = (
  onGone: () => void,
): { dragY: Animated.Value; panHandlers: object } => {
  const goneRef = useRef(onGone);
  goneRef.current = onGone;
  const dragY = useRef(new Animated.Value(0)).current;
  const responder = useRef(
    PanResponder.create({
      // Claim only a clearly-vertical downward pull, so taps (and any
      // horizontal fidgeting) inside the grab zone still land as taps.
      onMoveShouldSetPanResponder: (_e, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => dragY.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_e, g) => {
        if (g.dy > DISMISS_DY || g.vy > DISMISS_VY) {
          Animated.timing(dragY, {
            toValue: EXIT_Y,
            duration: 140,
            easing: Easing.in(Easing.cubic),
            useNativeDriver: true,
          }).start(({ finished }) => {
            if (!finished) return;
            goneRef.current();
            dragY.setValue(0);
          });
        } else {
          Animated.spring(dragY, { toValue: 0, bounciness: 4, useNativeDriver: true }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(dragY, { toValue: 0, bounciness: 4, useNativeDriver: true }).start();
      },
    }),
  ).current;
  return { dragY, panHandlers: responder.panHandlers };
};
