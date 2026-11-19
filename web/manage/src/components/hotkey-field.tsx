import { useEffect, useState } from "react";
import { Button } from "@/components/ui/knowns/button";
import { Field, Input } from "@/components/ui/knowns/input";
import { Kbd } from "@/components/ui/knowns/kbd";
import { hotkeyFromEvent } from "@/lib/layout";
import { t, useLanguage } from "@/lib/i18n";
import { hotkeyLabels, usePlatform } from "@/lib/platform";

/** Key combination input with a recorder. */
export function HotkeyField({ value, onChange, id = "f-keys", label }: { value: string; onChange: (v: string) => void; id?: string; label?: string }) {
  useLanguage();
  const platform = usePlatform();
  const [recording, setRecording] = useState(false);
  // Windows keeps most Win+key shortcuts for itself (the browser never sees them): a toggle adds the key instead
  const hasWin = /(^|\+)(win|windows|super|start)(\+|$)/i.test(value);
  const toggleWin = () => {
    const parts = value.split("+").map((p) => p.trim()).filter(Boolean);
    const rest = parts.filter((p) => !/^(win|windows|super|start)$/i.test(p));
    onChange(hasWin ? rest.join("+") : ["win", ...rest].join("+"));
  };

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        setRecording(false);
        return;
      }
      const combo = hotkeyFromEvent(e, platform);
      if (combo) {
        onChange(combo);
        setRecording(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, onChange, platform]);

  return (
    <Field label={label ?? t("Key combination")} id={id} hint={recording ? t("Listening... press a key combination (Esc to cancel).") : (platform === "win32" ? t("E.g. win+shift+s, ctrl+alt+t, f13, num1, printscreen. Ctrl is written as cmd in the layout; use the Win button for Windows-key shortcuts.") : t("E.g. cmd+shift+4, ctrl+alt+t, f5, return, space, up."))}>
      <div className="flex items-center gap-2">
        <Input id={id} value={value} placeholder={platform === "win32" ? "cmd+shift+s" : "cmd+shift+4"} onChange={(e) => onChange(e.target.value)} onFocus={() => setRecording(false)} />
        {platform === "win32" && (
          <Button size="md" variant={hasWin ? "primary" : "secondary"} onClick={toggleWin} className="shrink-0" aria-pressed={hasWin} title={t("Add or remove the Windows key")}>
            Win
          </Button>
        )}
        <Button size="md" variant={recording ? "primary" : "secondary"} onClick={() => setRecording((r) => !r)} className="shrink-0">
          {recording ? t("Recording...") : t("Record keys")}
        </Button>
      </div>
      {value && (
        <div className="flex flex-wrap gap-1">
          {hotkeyLabels(value, platform).map((k, i) => <Kbd key={i} size="sm">{k}</Kbd>)}
        </div>
      )}
    </Field>
  );
}
