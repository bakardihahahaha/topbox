import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { fetchMe, logout, onUnauthorized, type Me } from "./lib/client.js";
import { MeContext } from "./lib/meContext.js";
import { useIdleLogout } from "./lib/idleLogout.js";
import { connectLiveEvents, disconnectLiveEvents } from "./lib/liveEvents.js";
import { useTheme } from "./theme/ThemeContext.js";
import { cycleTouchSize, useTouchSizeLabel } from "./lib/touchSize.js";
import { SavingIndicator } from "./components/SavingIndicator.js";
import { SignInPage } from "./pages/SignInPage.js";
import { HomePage } from "./pages/HomePage.js";
import { PartsUsagePage } from "./pages/PartsUsagePage.js";
import { MechanismsPage } from "./pages/MechanismsPage.js";
import { MechanismHistoryPage } from "./pages/MechanismHistoryPage.js";
import { NewSignoffPage } from "./pages/NewSignoffPage.js";
import { SignoffPage } from "./pages/SignoffPage.js";
import { SetupTemplatesPage } from "./pages/SetupTemplatesPage.js";
import { TemplateEditorPage } from "./pages/TemplateEditorPage.js";
import { SetupPartsPage } from "./pages/SetupPartsPage.js";
import { SetupUsersPage } from "./pages/SetupUsersPage.js";
import { SetupSecurityPage } from "./pages/SetupSecurityPage.js";
import { SetupBackupPage } from "./pages/SetupBackupPage.js";
import { SetupAuditPage } from "./pages/SetupAuditPage.js";
import { AccountPage } from "./pages/AccountPage.js";
import { SetupDocumentPage } from "./pages/SetupDocumentPage.js";
import { SetupTypesPage } from "./pages/SetupTypesPage.js";
// Side effect: flushes the offline queue on load and whenever the device comes back online.
import "./lib/offlineQueue.js";

type Status = "checking" | "signedOut" | "signedIn";

export function App() {
  const [status, setStatus] = useState<Status>("checking");
  const [me, setMe] = useState<Me | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const navigate = useNavigate();
  const { themeLabel, cycleTheme } = useTheme();
  const sizeLabel = useTouchSizeLabel();

  async function checkSession() {
    const user = await fetchMe();
    setMe(user);
    setStatus(user ? "signedIn" : "signedOut");
  }

  useEffect(() => {
    void checkSession();
  }, []);

  useEffect(
    () =>
      onUnauthorized(() => {
        setMe(null);
        setStatus("signedOut");
        setMessage("Your session ended (timed out, ended by an admin, or your network changed) — sign in again. Unsaved changes are kept on this device and will sync.");
      }),
    [],
  );

  useEffect(() => {
    if (status === "signedIn") {
      connectLiveEvents();
      return disconnectLiveEvents;
    }
  }, [status]);

  useIdleLogout(status === "signedIn" ? (me?.idleTimeoutMinutes ?? 0) : 0, () => {
    void logout();
    setMe(null);
    setStatus("signedOut");
    setMessage("You were signed out after being inactive for a while — sign in again to continue.");
  });

  if (status === "checking") return null;
  if (status === "signedOut" || !me) {
    return (
      <SignInPage
        onSignedIn={() => {
          setMessage(null);
          void checkSession();
        }}
        message={message ?? undefined}
      />
    );
  }

  const isAdmin = me.role === "admin";
  // A "parts" account sees the Parts used page and nothing else (the server enforces the same).
  const partsOnly = me.role === "parts";
  return (
    <MeContext.Provider value={me}>
      <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
        <nav style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", borderBottom: "1px solid var(--border-soft)", flex: "none", overflowX: "auto" }}>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flex: "none" }}>
            {partsOnly ? (
              <NavTab to="/parts-used" label="Parts used" />
            ) : (
              <>
                <NavTab to="/signoffs" label="Sign-offs" />
                <NavTab to="/mechanisms" label="Mechanisms" />
                <NavTab to="/parts-used" label="Parts used" />
                <NavTab to={isAdmin ? "/setup/templates" : "/setup/account"} label="Setup" match="/setup" />
              </>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "none", marginLeft: 16 }}>
            <SavingIndicator />
            <button onClick={cycleTouchSize} className="mono" style={navButton}>
              {sizeLabel}
            </button>
            <button onClick={cycleTheme} className="mono" style={navButton}>
              {themeLabel}
            </button>
            <span className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>
              {me.name} ({me.role})
            </span>
            <button
              onClick={() => {
                void logout();
                setMe(null);
                setStatus("signedOut");
                navigate("/signoffs");
              }}
              className="mono"
              style={navButton}
            >
              Log out
            </button>
          </div>
        </nav>
        <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
          {partsOnly ? (
            <Routes>
              <Route path="/parts-used" element={<PartsUsagePage />} />
              <Route path="*" element={<Navigate to="/parts-used" replace />} />
            </Routes>
          ) : (
          <Routes>
            <Route path="/" element={<Navigate to="/signoffs" replace />} />
            <Route path="/signoffs" element={<HomePage />} />
            <Route path="/mechanisms" element={<MechanismsPage />} />
            <Route path="/parts-used" element={<PartsUsagePage />} />
            <Route path="/signoff/:serial" element={<MechanismHistoryPage />} />
            <Route path="/mechanisms/:serial" element={<ToTopbox />} />
            <Route path="/signoffs/new" element={me.role === "viewer" ? <Navigate to="/signoffs" replace /> : <NewSignoffPage />} />
            <Route path="/signoffs/:id" element={<SignoffPage />} />
            <Route path="/setup/account" element={<AccountPage />} />
            {isAdmin && (
              <>
                <Route path="/setup/templates" element={<SetupTemplatesPage />} />
                <Route path="/setup/templates/:id" element={<TemplateEditorPage />} />
                <Route path="/setup/types" element={<SetupTypesPage />} />
                <Route path="/setup/parts" element={<SetupPartsPage />} />
                <Route path="/setup/document" element={<SetupDocumentPage />} />
                <Route path="/setup/users" element={<SetupUsersPage />} />
                <Route path="/setup/security" element={<SetupSecurityPage />} />
                <Route path="/setup/backup" element={<SetupBackupPage />} />
                <Route path="/setup/audit" element={<SetupAuditPage />} />
              </>
            )}
            <Route path="*" element={<Navigate to="/signoffs" replace />} />
          </Routes>
          )}
        </div>
      </div>
    </MeContext.Provider>
  );
}

/** Old /mechanisms/<serial> links -> the TopBox page /signoff/<serial>. */
function ToTopbox() {
  const { serial = "" } = useParams();
  return <Navigate to={`/signoff/${encodeURIComponent(serial)}`} replace />;
}

const navButton = {
  background: "transparent",
  border: "1px solid var(--border)",
  color: "var(--text-2)",
  borderRadius: "var(--radius-control)",
  padding: "0 12px",
  height: 36,
  fontSize: 11.5,
  fontWeight: 700,
  cursor: "pointer",
} as const;

function NavTab({ to, label, match }: { to: string; label: string; match?: string }) {
  return (
    <NavLink
      to={to}
      style={({ isActive }) => ({
        fontSize: 14,
        fontWeight: 700,
        padding: "10px 6px",
        color: isActive || (match && window.location.pathname.startsWith(match)) ? "var(--accent)" : "var(--text-2)",
        textDecoration: "none",
      })}
    >
      {label}
    </NavLink>
  );
}
