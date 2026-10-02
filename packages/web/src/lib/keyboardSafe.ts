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

export function initKeyboardSafe(): void {
  document.addEventListener("focusin", (e) => {
    if (opensKeyboard(e.target as Element)) setTimeout(reveal, 350);
  });
  window.visualViewport?.addEventListener("resize", () => setTimeout(reveal, 50));
}
