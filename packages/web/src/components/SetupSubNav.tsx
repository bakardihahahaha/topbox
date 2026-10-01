import { NavLink } from "react-router-dom";
import { useMe } from "../lib/meContext.js";

export function SetupSubNav() {
  const me = useMe();
  const tabs = [
    ...(me.role === "admin"
      ? [
          { to: "/setup/templates", label: "Templates" },
          { to: "/setup/types", label: "Types" },
          { to: "/setup/parts", label: "Parts" },
          { to: "/setup/document", label: "Document" },
          { to: "/setup/users", label: "Users" },
          { to: "/setup/security", label: "Security" },
          { to: "/setup/card-reader", label: "Card reader" },
          { to: "/setup/backup", label: "Database" },
          { to: "/setup/audit", label: "Audit log" },
        ]
      : []),
    { to: "/setup/account", label: "My account" },
  ];
  return (
    <div style={{ display: "flex", flexWrap: "wrap", rowGap: 10, columnGap: 14, marginBottom: 16, borderBottom: "1px solid var(--border-soft)", paddingBottom: 10 }}>
      {tabs.map((t) => (
        <NavLink key={t.to} to={t.to} style={({ isActive }) => ({ fontSize: 13.5, fontWeight: 700, padding: "8px 4px", color: isActive ? "var(--accent)" : "var(--text-2)", textDecoration: "none" })}>
          {t.label}
        </NavLink>
      ))}
    </div>
  );
}
