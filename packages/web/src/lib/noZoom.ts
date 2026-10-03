// Windows (the kiosk PCs): no pinch-zoom on the touch screen and no Ctrl + wheel / Ctrl + + / − /
// 0 browser zoom — the interface size is set with the app's own "Size" button instead. Phones and
// tablets keep pinch-zoom (it's how small text gets read there).
export function initNoZoomOnWindows(): void {
  if (!/Windows/i.test(navigator.userAgent)) return;
  // Pinch-zoom on a touch screen: only panning is allowed.
  document.documentElement.style.touchAction = "pan-x pan-y";
  // Touchpad pinch / Ctrl + mouse wheel.
  window.addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey) e.preventDefault();
    },
    { passive: false },
  );
  // Ctrl + "+", "−", "=", "0" (and the numeric keypad's + / −).
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && ["+", "-", "=", "0", "_"].includes(e.key)) e.preventDefault();
  });
}
