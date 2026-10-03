import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "@fontsource/archivo/400.css";
import "@fontsource/archivo/500.css";
import "@fontsource/archivo/600.css";
import "@fontsource/archivo/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "./theme/tokens.css";
import { ThemeProvider } from "./theme/ThemeContext.js";
import { App } from "./App.js";
import { ConfirmHost } from "./components/ConfirmHost.js";
import { PdfViewerHost } from "./components/PdfViewerHost.js";
import { OnScreenKeyboardHost } from "./components/OnScreenKeyboard.js";
import { initPwaUpdateCheck } from "./lib/pwaUpdate.js";
import { initTouchSize } from "./lib/touchSize.js";
import { initKeyboardSafe } from "./lib/keyboardSafe.js";
import { initStaleBundleReload } from "./lib/staleBundle.js";
import { initNoZoomOnWindows } from "./lib/noZoom.js";

initPwaUpdateCheck();
initTouchSize();
initKeyboardSafe();
initStaleBundleReload();
initNoZoomOnWindows();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
      <ConfirmHost />
      <PdfViewerHost />
      <OnScreenKeyboardHost />
    </ThemeProvider>
  </StrictMode>,
);
