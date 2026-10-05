# T9 direct lobby + mobile layout fix

- Entering T9 now suppresses the entire notice modal/overlay, including the broken Unmatched Route content iframe.
- Notice suppression scans normal DOM, shadow roots and same-origin child iframes, then hides the actual large overlay container rather than only clicking text.
- T9 hidden persistent iframe now uses the real phone viewport instead of 1280x720, so T9 initializes its mobile layout on phones.
- Revealing T9 dispatches resize/orientationchange to let the game recalculate layout.
- Existing T9 single-session, live data and background mute behavior are preserved.
