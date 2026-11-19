import { useEffect, useRef, useState, type DragEvent } from "react";
import { IconPlayerPlay as Play, IconPlayerStop as Stop, IconTrash as Trash, IconUpload as Upload, IconRefresh as Refresh } from "@tabler/icons-react";
import { Alert } from "@/components/ui/knowns/alert";
import { Button } from "@/components/ui/knowns/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/knowns/card";
import { Empty } from "@/components/ui/knowns/empty";
import { Input } from "@/components/ui/knowns/input";
import { Spinner } from "@/components/ui/knowns/spinner";
import { ApiError, api, soundUrl } from "@/api";
import { refreshSounds, setSounds, soundFormatProblem, useSounds } from "@/lib/sounds";
import { t } from "@/lib/i18n";
import { usePlatform } from "@/lib/platform";
import { cn } from "@/lib/utils";
import type { Sound } from "@/types";

const MAX_BYTES = 5 * 1024 * 1024;
const fmtSize = (n?: number) => (n === undefined ? "" : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const fmtTime = (s?: number) => (s === undefined ? "" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);

/** Sound library: upload (drag and drop), rename, delete, preview in the browser. */
export function SoundsPanel() {
  const { sounds, error, reload } = useSounds();
  // the agent accepts mp3, m4a, wav, aac and ogg; on Windows its player has no Ogg decoder, so ogg is refused there
  const win = usePlatform() === "win32";
  const formats = win ? "mp3, m4a, wav, aac" : "mp3, m4a, wav, aac, ogg";
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => () => audio.current?.pause(), []);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(null), 3000);
    return () => clearTimeout(timer);
  }, [armed]);

  const upload = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    setBusy(true);
    setErr(null);
    for (const f of list) {
      if (!f.type.startsWith("audio/") && !/\.(mp3|wav|m4a|aac|ogg|flac|aiff?)$/i.test(f.name)) {
        setErr(t("“{name}” is not an audio file.", { name: f.name }));
        continue;
      }
      const bad = soundFormatProblem(f.name, win);
      if (bad) {
        setErr(t(bad, { name: f.name, formats }));
        continue;
      }
      if (f.size > MAX_BYTES) {
        setErr(t("“{name}” is larger than 5 MB. Trim the clip.", { name: f.name }));
        continue;
      }
      try {
        const s = await api.uploadSound(f);
        setSounds((cur) => [s, ...cur.filter((x) => x.id !== s.id)]);
      } catch (e) {
        setErr(e instanceof ApiError && e.status === 404 ? t("The agent does not support sounds yet (/api/sounds returned 404).") : t("Upload failed: {error}", { error: e instanceof Error ? e.message : String(e) }));
      }
    }
    setBusy(false);
    if (input.current) input.current.value = "";
  };

  const preview = (s: Sound) => {
    audio.current?.pause();
    if (playing === s.id) return setPlaying(null);
    const a = new Audio(soundUrl(s.id));
    audio.current = a;
    a.onended = () => setPlaying((p) => (p === s.id ? null : p));
    a.onerror = () => {
      setPlaying(null);
      setErr(t("Could not preview this clip."));
    };
    setPlaying(s.id);
    void a.play().catch(() => setPlaying(null));
  };

  const rename = async (s: Sound, name: string) => {
    const next = name.trim();
    if (!next || next === s.name) return;
    setSounds((cur) => cur.map((x) => (x.id === s.id ? { ...x, name: next } : x)));
    try {
      await api.renameSound(s.id, next);
    } catch (e) {
      setErr(t("Rename failed: {error}", { error: e instanceof Error ? e.message : String(e) }));
      void refreshSounds();
    }
  };

  const remove = async (s: Sound) => {
    if (armed !== s.id) return setArmed(s.id);
    setArmed(null);
    if (playing === s.id) {
      audio.current?.pause();
      setPlaying(null);
    }
    try {
      await api.deleteSound(s.id);
      setSounds((cur) => cur.filter((x) => x.id !== s.id));
    } catch (e) {
      setErr(t("Delete failed: {error}", { error: e instanceof Error ? e.message : String(e) }));
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void upload(e.dataTransfer.files);
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between p-4 pb-0">
          <CardTitle className="text-sm">{t("Sound library")}</CardTitle>
          <Button size="xs" variant="secondary" icon={<Refresh />} onClick={reload}>{t("Refresh")}</Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 p-4">
          <div
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
            className={cn("flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-6 text-center transition-colors", over && "border-primary bg-primary/10")}
          >
            <Upload className="size-5 text-muted-foreground" />
            <p className="text-[13px]">{t("Drag and drop audio files here ({formats}; up to 5 MB per clip)", { formats })}</p>
            {win && <p className="text-xs text-muted-foreground">{t("Windows cannot play ogg clips: convert them to mp3 first.")}</p>}
            <Button size="sm" variant="secondary" loading={busy} onClick={() => input.current?.click()}>{t("Choose files…")}</Button>
            <input ref={input} type="file" accept={win ? "audio/mpeg,audio/mp4,audio/wav,audio/aac,.mp3,.wav,.m4a,.aac" : "audio/*,.mp3,.wav,.m4a,.aac,.ogg"} multiple className="hidden" onChange={(e) => e.target.files && void upload(e.target.files)} />
          </div>
          {err && <Alert tone="danger" onDismiss={() => setErr(null)}>{err}</Alert>}
          {!sounds && !error && <Spinner label={t("Loading")} />}
          {!sounds && error && <Alert tone="danger">{error.includes("404") ? t("The agent does not support sounds yet (/api/sounds returned 404). Update the agent and reload.") : error}</Alert>}
          {sounds && sounds.length === 0 && <Empty size="sm" title={t("No sounds yet")} description={t("Upload an mp3 clip, then drag it from the Function board to the phone.")} />}
          {sounds && sounds.length > 0 && (
            <ul className="flex flex-col divide-y">
              {sounds.map((s) => (
                <li key={s.id} className="flex items-center gap-3 py-2">
                  <Button size="sm" variant="secondary" aria-label={playing === s.id ? t("Stop {name}", { name: s.name }) : t("Preview {name}", { name: s.name })} icon={playing === s.id ? <Stop /> : <Play />} onClick={() => preview(s)} />
                  <div className="min-w-0 flex-1">
                    <Input size="sm" aria-label={t("Clip name")} defaultValue={s.name} key={s.name} maxLength={60} onBlur={(e) => void rename(s, e.target.value)} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
                  </div>
                  <span className="w-24 flex-none text-right text-xs text-muted-foreground tabular-nums">{[fmtTime(s.duration), fmtSize(s.size)].filter(Boolean).join(" · ")}</span>
                  <Button size="sm" variant="destructive" icon={<Trash />} onClick={() => void remove(s)}>{armed === s.id ? t("Confirm?") : t("Delete")}</Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
