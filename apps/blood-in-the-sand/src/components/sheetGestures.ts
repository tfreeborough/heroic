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
 *    leaves; short drags spring back. `onGone` must UNMOUNT the sheet
 *    instantly (state null + any enter-anim reset) — the drag has already
 *    animated the exit, a second close animation would replay it, and the
 *    hook leaves dragY parked offscreen so the sheet can't reappear in
 *    the gap before React commits the removal.
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
            // Hand off and STOP — never reset dragY here. onGone is a React
            // state update that commits a frame or two later, while a
            // native-driver setValue(0) lands on the UI thread at once: the
            // sheet snapped back to rest under its still-opaque scrim for
            // those frames before unmounting (the pack shelf's "flashes back
            // on dismiss", Tom 2026-08-22). The sheet unmounts on gone and a
            // fresh mount gets a fresh value, so nothing needs resetting.
            goneRef.current();
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
