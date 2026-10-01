// The device keyboard must never hide what's being typed into, or the button after it. When a
// field that opens the keyboard gets focus — and again whenever the keyboard changes the visible
// area (iPad Safari doesn't resize the page, it only shrinks the visual viewport) — the field is
// scrolled into the middle of what's still visible. Serial numbers use the app's own keypad
// (SerialInput), which never opens the device keyboard at all.

function opensKeyboard(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return false;
  if (el.readOnly || el.disabled || el.inputMode === "none") return false;
  if (el instanceof HTMLInputElement && ["checkbox", "radio", "button", "submit", "file", "range", "color"].includes(el.type)) return false;
  return true;
}

function reveal() {
  const el = document.activeElement;
  if (!opensKeyboard(el)) return;
  const vv = window.visualViewport;
  const rect = el.getBoundingClientRect();
  const top = vv ? vv.offsetTop : 0;
  const height = vv ? vv.height : window.innerHeight;
  // Already comfortably visible (with room for the button under it)? Leave it.
  if (rect.top >= top + 8 && rect.bottom + 80 <= top + height) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
}

/** Chromium's VirtualKeyboard API (Edge / Chrome on Windows touch screens). */
type VirtualKeyboard = { show(): void };
const virtualKeyboard = (): VirtualKeyboard | undefined => (navigator as Navigator & { virtualKeyboard?: VirtualKeyboard }).virtualKeyboard;

export function initKeyboardSafe(): void {
  document.addEventListener("focusin", (e) => {
    if (opensKeyboard(e.target as Element)) setTimeout(reveal, 350);
  });

  // Windows + Edge on a touch screen: Windows only pops its touch keyboard up by itself in tablet
  // mode (or with the "show the touch keyboard" setting). A finger tapping a text field (a note,
  // a name…) asks for it straight away instead. Mouse and pen taps are left alone, and iPad /
  // Android open their keyboard on their own anyway.
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType !== "touch" || !virtualKeyboard()) return;
      const el = (e.target as Element | null)?.closest("input, textarea") ?? null;
      if (opensKeyboard(el)) el.setAttribute("virtualkeyboardpolicy", "manual");
    },
    true,
  );
  document.addEventListener(
    "pointerup",
    (e) => {
      const vk = virtualKeyboard();
      if (e.pointerType !== "touch" || !vk) return;
      const el = (e.target as Element | null)?.closest("input, textarea") ?? null;
      if (!opensKeyboard(el)) return;
      // After the tap's own focus has happened.
      setTimeout(() => {
        if (document.activeElement !== el) el.focus();
        try {
          vk.show();
        } catch {
          // not available here — the system decides
        }
      }, 0);
    },
    true,
  );
  window.visualViewport?.addEventListener("resize", () => setTimeout(reveal, 50));
}
