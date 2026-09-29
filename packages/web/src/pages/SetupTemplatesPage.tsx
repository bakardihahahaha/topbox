import { useNavigate } from "react-router-dom";
import type { Template } from "@biosite-signoff/shared";
import { deleteTemplate, duplicateTemplate, listTemplates } from "../lib/api.js";
import { useData } from "../lib/useData.js";
import { SetupSubNav } from "../components/SetupSubNav.js";
import { confirmDialog } from "../lib/confirmDialog.js";
import { mutateOrQueue } from "../lib/offlineQueue.js";
import { withSaving } from "../lib/savingStatus.js";
import { card, chip, danger, errorBox, errorMessage, formatDate, ghost, h1, hint, page, primary } from "../lib/ui.js";

export function SetupTemplatesPage() {
  const navigate = useNavigate();
  const { data, error, setError, reload } = useData<Template[]>(listTemplates);

  async function remove(t: Template) {
    if (!(await confirmDialog(`Delete template "${t.name}"? Existing sign-offs keep their own copy and still print fine; it just can't be used for new ones.`, { confirmLabel: "Delete", danger: true }))) return;
    try {
      await withSaving(() => mutateOrQueue({ kind: "deleteTemplate", templateId: t.id }, () => deleteTemplate(t.id)));
      await reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function duplicate(t: Template) {
    try {
      const copy = await withSaving(() => duplicateTemplate(t.id));
      navigate(`/setup/templates/${copy.id}`);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div style={page}>
      <h1 style={h1}>Setup</h1>
      <SetupSubNav />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <p style={hint}>One template per product / mechanism type. Add as many items and check columns (1st, 2nd, 3rd…) as the paper form has, choose whether it has a "Sign and date here" row, and which parts can be replaced on a service.</p>
        <button style={{ ...primary, flex: "none" }} onClick={() => navigate("/setup/templates/new")}>
          + New template
        </button>
      </div>
      {error && <div style={errorBox}>{error}</div>}
      {data?.length === 0 && <div style={{ color: "var(--text-4)", fontSize: 13 }}>No templates yet.</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {data?.map((t) => (
          <div key={t.id} style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700 }}>{t.name}</div>
              <div className="mono" style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 3 }}>
                {t.documentId || "no document id"} · {t.rows.filter((r) => r.kind === "item").length} items · {t.checks.map((c) => c.label).join(" / ")} · updated {formatDate(t.updatedAt)}
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                <span style={chip(t.signRowEnabled ? "accent" : "muted")}>{t.signRowEnabled ? "Sign & date row" : "No sign row"}</span>
                <span style={chip("muted")}>{t.partIds.length ? `${t.partIds.length} selected parts` : "All parts"}</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button style={ghost} onClick={() => navigate(`/setup/templates/${t.id}`)}>
                Edit
              </button>
              <button style={ghost} onClick={() => void duplicate(t)}>
                Duplicate
              </button>
              <button style={danger} onClick={() => void remove(t)}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
