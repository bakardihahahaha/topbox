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
import { initPwaUpdateCheck } from "./lib/pwaUpdate.js";
import { initTouchSize } from "./lib/touchSize.js";
import { initKeyboardSafe } from "./lib/keyboardSafe.js";

initPwaUpdateCheck();
initTouchSize();
initKeyboardSafe();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
      <ConfirmHost />
    </ThemeProvider>
  </StrictMode>,
);
