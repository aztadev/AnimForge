"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { formatBytes, parseInput } from "@/lib/animForge";
import type { ForgeEvent, ForgeReadyEvent } from "@/lib/animForge";

type Level = "info" | "success" | "warn" | "error";

interface LogEntry {
  id: number;
  time: string;
  level: Level;
  message: string;
  detail?: string;
  step?: string;
}

type DownloadState = "idle" | "downloading" | "done" | "error";

const EXAMPLES = [
  { label: "Idle", value: "rbxassetid://507768375" },
  { label: "Walk", value: "rbxassetid://507777826" },
  { label: "Run", value: "rbxassetid://913402848" },
  { label: "Jump", value: "rbxassetid://507765000" },
];

const STAGES = ["PARSE", "UNIVERSE", "BYPASS", "DOWNLOAD"] as const;

const STEP_TO_STAGE: Record<string, number> = {
  parse: 0,
  query: 1,
  "cdn-block": 1,
  universe: 1,
  bypass: 2,
  fallback: 2,
  resolve: 3,
  download: 3,
};

const LEVELS: Record<Level, { color: string; text: string; badge: string }> = {
  info: {
    color: "#22d3ee",
    text: "text-cyan-300",
    badge: "border border-cyan-400/20 bg-cyan-400/10 text-cyan-300/80",
  },
  success: {
    color: "#34d399",
    text: "text-emerald-300",
    badge: "border border-emerald-400/20 bg-emerald-400/10 text-emerald-300/80",
  },
  warn: {
    color: "#fbbf24",
    text: "text-amber-300",
    badge: "border border-amber-400/20 bg-amber-400/10 text-amber-300/80",
  },
  error: {
    color: "#fb7185",
    text: "text-rose-300",
    badge: "border border-rose-500/20 bg-rose-500/10 text-rose-300/80",
  },
};

function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** Client fetch with an abort timeout so a hanging relay can never stall. */
function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
}

/* ------------------------------- icons ------------------------------- */
function Logo() {
  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 48 48"
      fill="none"
      className="af-float"
      aria-hidden
    >
      <defs>
        <linearGradient id="aflogo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a855f7" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      <path
        d="M24 3 L42 13.5 V34.5 L24 45 L6 34.5 V13.5 Z"
        stroke="url(#aflogo)"
        strokeWidth="2"
        fill="rgba(124,58,237,0.08)"
      />
      <path d="M24 13 L33 30 H15 Z" stroke="#a855f7" strokeWidth="1.6" fill="none" />
      <circle cx="24" cy="24" r="2.6" fill="#22d3ee" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M13 2 4.5 13.5H11l-1 8.5 8.5-12H12z" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="rgba(255,255,255,0.25)" strokeWidth="3" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="white"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TerminalIcon() {
  return (
    <svg className="h-8 w-8 text-neon/50" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M6 9l3 3-3 3M12 15h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/* ------------------------------- atoms ------------------------------- */
function BackgroundFX() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="absolute inset-0 af-grid opacity-70" />
      <div
        className="af-orb af-float"
        style={{
          width: 520,
          height: 520,
          left: "-8%",
          top: "-12%",
          background: "radial-gradient(circle, rgba(124,58,237,0.5), transparent 60%)",
        }}
      />
      <div
        className="af-orb af-float"
        style={{
          width: 460,
          height: 460,
          right: "-10%",
          top: "6%",
          background: "radial-gradient(circle, rgba(34,211,238,0.22), transparent 60%)",
          animationDelay: "1.5s",
        }}
      />
      <div
        className="af-orb"
        style={{
          width: 600,
          height: 600,
          left: "30%",
          bottom: "-32%",
          background: "radial-gradient(circle, rgba(124,58,237,0.28), transparent 60%)",
        }}
      />
      <div className="absolute inset-0 af-scanlines opacity-60" />
      <div className="af-scanline-move" />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 100% 70% at 50% 0%, transparent 38%, rgba(5,5,5,0.85) 100%)",
        }}
      />
    </div>
  );
}

function CornerSet() {
  const base = "absolute h-3 w-3 border-neon/50";
  return (
    <>
      <span className={cn(base, "left-2 top-2 border-l border-t")} />
      <span className={cn(base, "right-2 top-2 border-r border-t")} />
      <span className={cn(base, "bottom-2 left-2 border-b border-l")} />
      <span className={cn(base, "bottom-2 right-2 border-b border-r")} />
    </>
  );
}

function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("af-glass relative rounded-2xl p-5 sm:p-6", className)}>
      <CornerSet />
      {children}
    </div>
  );
}

function StatTile({
  label,
  value,
  active,
}: {
  label: string;
  value: string;
  active?: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-3">
      <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-600">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 truncate font-mono text-sm",
          active ? "text-neon-light" : "text-zinc-300",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function StageNode({
  label,
  index,
  active,
  current,
}: {
  label: string;
  index: number;
  active: boolean;
  current: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className={cn(
          "relative grid h-9 w-9 place-items-center rounded-lg border font-mono text-xs transition-all duration-500",
          active
            ? "border-neon/60 bg-neon/15 text-neon-light"
            : "border-white/10 bg-white/[0.02] text-zinc-600",
        )}
      >
        {active && (
          <span className="absolute inset-0 rounded-lg ring-1 ring-neon/40" />
        )}
        {current && (
          <span className="absolute -inset-1 rounded-xl ring-2 ring-neon/50 af-pulse-dot" />
        )}
        {String(index + 1).padStart(2, "0")}
      </div>
      <span
        className={cn(
          "font-mono text-[9px] uppercase tracking-widest transition-colors",
          active ? "text-zinc-300" : "text-zinc-600",
        )}
      >
        {label}
      </span>
    </div>
  );
}

function LogRow({ entry }: { entry: LogEntry }) {
  const s = LEVELS[entry.level];
  return (
    <div className="af-fade-in flex items-start gap-2.5">
      <span
        className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: s.color, boxShadow: `0 0 8px ${s.color}` }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="font-mono text-[10px] text-zinc-600">{entry.time}</span>
          <span
            className={cn(
              "rounded px-1.5 py-px font-mono text-[9px] uppercase tracking-widest",
              s.badge,
            )}
          >
            {entry.level}
          </span>
          <span className={cn("text-[12px] font-medium", s.text)}>
            {entry.message}
          </span>
        </div>
        {entry.detail && (
          <div className="mt-0.5 truncate font-mono text-[10px] text-zinc-600">
            ↳ {entry.detail}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ main app ------------------------------ */
export default function Page() {
  const [input, setInput] = useState("");
  const [scanKey, setScanKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [ready, setReady] = useState<ForgeReadyEvent | null>(null);
  const [downloadState, setDownloadState] = useState<DownloadState>("idle");
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState(0);

  const idRef = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);

  const parsed = useMemo(() => parseInput(input), [input]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  const triggerScan = () => setScanKey((k) => k + 1);

  const pushLog = (entry: Omit<LogEntry, "id" | "time">) => {
    const time = new Date().toLocaleTimeString("en-US", { hour12: false });
    setLog((prev) => [...prev, { ...entry, id: idRef.current++, time }]);
  };

  const advance = (step?: string) => {
    if (step && step in STEP_TO_STAGE) {
      setStage((s) => Math.max(s, STEP_TO_STAGE[step]));
    }
  };

  const proxyUrl = (r: Pick<ForgeReadyEvent, "location" | "filename">) =>
    `/api/proxy?url=${encodeURIComponent(r.location)}&filename=${encodeURIComponent(r.filename)}`;

  const triggerFileDownload = (url: string, filename: string) => {
    // The server responds with `Content-Disposition: attachment`, so navigating
    // to the relay URL hands the blob to the browser as a download WITHOUT
    // leaving the page. This works even inside sandboxed preview iframes,
    // where programmatic blob/click downloads are often blocked.
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.rel = "noopener";
      a.target = "_self";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      window.location.assign(url);
    }
  };

  const runDownload = async (r: ForgeReadyEvent) => {
    setDownloadState("downloading");
    setProgress(0);
    advance("download");
    pushLog({
      level: "info",
      step: "download",
      message: "Downloading Blob…",
      detail: "server relay → client",
    });

    const finalProxy = proxyUrl(r);

    // The server proxy is the primary, reliable relay. Try the in-memory
    // streaming path first so we can show live progress, then hand the blob to
    // the browser. If that path is unavailable/blocked we fall back to a direct
    // navigation, which the server turns into a download.
    try {
      const resp = await fetchWithTimeout(finalProxy, 15000);
      if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);

      pushLog({
        level: "success",
        step: "download",
        message: "Relay connected (server relay).",
        detail: "streaming blob…",
      });

      const total = r.size || 0;
      const chunks: Uint8Array[] = [];
      let received = 0;
      const reader = resp.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          received += value.length;
          setProgress((p) => {
            if (total > 0 && received <= total) {
              return Math.max(p, Math.min(99, Math.round((received / total) * 100)));
            }
            return Math.min(99, p + 2);
          });
        }
      }

      if (chunks.length === 0) throw new Error("empty stream");

      const blob = new Blob(chunks as unknown as BlobPart[], {
        type: r.contentType || "application/octet-stream",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = r.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 8000);

      setDownloadState("done");
      setProgress(100);
      pushLog({
        level: "success",
        step: "download",
        message: `Blob written → ${r.filename}`,
        detail: `${formatBytes(blob.size)} delivered`,
      });
      return;
    } catch {
      // Streaming/blob path blocked (common in sandboxed iframes) — hand off
      // to a direct navigation, which the server converts into a download.
      pushLog({
        level: "warn",
        step: "download",
        message: "Stream capture blocked — routing direct download…",
      });
    }

    triggerFileDownload(finalProxy, r.filename);
    setDownloadState("done");
    setProgress(100);
    pushLog({
      level: "success",
      step: "download",
      message: `Download handed to browser → ${r.filename}`,
      detail: "Content-Disposition: attachment",
    });
  };

  const handleForgeEvent = (ev: ForgeEvent) => {
    if (ev.type === "status") {
      pushLog({
        level: ev.level,
        message: ev.message,
        detail: ev.detail,
        step: ev.step,
      });
      advance(ev.step);
    } else if (ev.type === "error") {
      pushLog({ level: "error", message: ev.message, step: "error" });
    } else if (ev.type === "ready") {
      setReady(ev);
      advance("resolve");
      pushLog({
        level: "success",
        step: "resolve",
        message: "CDN lock cleared — asset stream open.",
        detail: ev.universeId ? `universe ${ev.universeId}` : "direct resolve",
      });
      void runDownload(ev);
    }
  };

  const handleForge = async () => {
    if (busy) return;
    const trimmed = input.trim();
    if (!trimmed) {
      pushLog({ level: "warn", message: "No asset target provided.", step: "parse" });
      triggerScan();
      return;
    }

    setBusy(true);
    setReady(null);
    setDownloadState("idle");
    setProgress(0);
    setStage(0);
    pushLog({
      level: "info",
      step: "parse",
      message: "Booting AnimForge pipeline…",
      detail: "v2.4 // node-relay",
    });

    try {
      const res = await fetch("/api/forge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: trimmed }),
      });
      if (!res.ok || !res.body) throw new Error("Forge relay unreachable.");
      const body = res.body;

      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const line = raw.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          try {
            handleForgeEvent(JSON.parse(line.slice(5).trim()));
          } catch {
            /* ignore malformed chunk */
          }
        }
      }
    } catch (err) {
      pushLog({
        level: "error",
        message: err instanceof Error ? err.message : "Connection lost.",
        step: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const showProgress = downloadState === "downloading" || downloadState === "done";

  return (
    <div className="relative min-h-screen overflow-hidden bg-ink">
      <BackgroundFX />

      {/* ----------------------------- header ----------------------------- */}
      <header className="relative z-20 border-b border-neon/10 bg-ink/60 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <Logo />
            <div className="leading-none">
              <div className="font-display text-lg font-extrabold tracking-[0.18em] text-white af-text-glow">
                ANIM<span className="text-neon-light">FORGE</span>
              </div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500">
                animation asset pipeline
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-2 font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-400 sm:flex">
              <span className="af-pulse-dot h-1.5 w-1.5 rounded-full bg-emerald-400" />
              systems online
            </span>
            <span className="rounded-md border border-neon/30 bg-neon/10 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-neon-light">
              v2.4
            </span>
          </div>
        </div>
      </header>

      {/* ------------------------------ hero ------------------------------ */}
      <main className="relative z-10 mx-auto w-full max-w-5xl px-4 pb-20 sm:px-6">
        <section className="af-rise-in pt-12 text-center sm:pt-16">
          <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-neon/25 bg-neon/5 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.3em] text-neon-light">
            <span className="af-pulse-dot h-1 w-1 rounded-full bg-neon-light" />
            roblox asset delivery
          </div>
          <h1 className="font-display text-4xl font-black uppercase leading-[0.95] tracking-tight text-white sm:text-6xl">
            Forge Any
            <br />
            <span
              className="bg-clip-text text-transparent af-text-glow"
              style={{
                backgroundImage:
                  "linear-gradient(90deg,#a855f7,#7c3aed,#22d3ee)",
              }}
            >
              Animation
            </span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-sm leading-relaxed text-zinc-400 sm:text-base">
            Drop a Roblox asset ID or URL. AnimForge resolves restricted CDN
            locations through universe-bypass logic and ships the raw{" "}
            <span className="font-mono text-neon-light">.rbxm</span> blob straight
            to your machine.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            {["Universe Bypass", "No Login", ".RBXM Export", "Client Relay"].map(
              (t) => (
                <span
                  key={t}
                  className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-zinc-400"
                >
                  {t}
                </span>
              ),
            )}
          </div>
        </section>

        {/* --------------------------- pipeline --------------------------- */}
        <section className="af-rise-in mt-10" style={{ animationDelay: "0.08s" }}>
          <div className="af-panel rounded-2xl p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500">
                resolution pipeline
              </span>
              <span
                className={cn(
                  "font-mono text-[10px] uppercase tracking-widest",
                  busy ? "text-rose-400" : "text-neon-light",
                )}
              >
                {busy ? "running" : "standby"}
              </span>
            </div>
            <div className="flex items-center">
              {STAGES.map((s, i) => (
                <Fragment key={s}>
                  <StageNode
                    label={s}
                    index={i}
                    active={i <= stage}
                    current={i === stage && busy}
                  />
                  {i < STAGES.length - 1 && (
                    <div className="relative mx-1.5 h-px flex-1 bg-white/10">
                      <div
                        className="absolute inset-y-0 left-0 bg-neon transition-all duration-500"
                        style={{ width: i < stage ? "100%" : "0%" }}
                      />
                    </div>
                  )}
                </Fragment>
              ))}
            </div>
          </div>
        </section>

        {/* --------------------------- controls --------------------------- */}
        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          {/* input card */}
          <Card className="af-rise-in" >
            <div className="mb-4 flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500">
                ▸ asset target
              </span>
              {parsed && (
                <span className="rounded-md border border-neon/30 bg-neon/10 px-2 py-0.5 font-mono text-[10px] text-neon-light">
                  id {parsed}
                </span>
              )}
            </div>

            {/* input */}
            <div className="relative">
              <div
                className={cn(
                  "relative flex items-center gap-3 overflow-hidden rounded-xl border bg-black/40 px-4 transition-all duration-300",
                  parsed
                    ? "border-neon/50 shadow-[0_0_24px_-6px_rgba(124,58,237,0.5)]"
                    : "border-white/10 focus-within:border-neon/40",
                )}
              >
                <span className="font-mono text-lg text-neon-light/70">#</span>
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onPaste={triggerScan}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleForge();
                  }}
                  placeholder="paste asset id or roblox url…"
                  spellCheck={false}
                  autoComplete="off"
                  className="w-full bg-transparent py-4 font-mono text-base text-white placeholder:text-zinc-600 focus:outline-none"
                />
                {input && (
                  <button
                    type="button"
                    onClick={() => {
                      setInput("");
                    }}
                    className="text-zinc-600 transition hover:text-white"
                    aria-label="clear"
                  >
                    ✕
                  </button>
                )}
                {scanKey > 0 && <span key={scanKey} className="af-scan-sweep" />}
              </div>
              <div
                className="mx-4 h-px transition-opacity duration-500"
                style={{
                  backgroundImage:
                    "linear-gradient(90deg,transparent,#7c3aed,transparent)",
                  opacity: parsed ? 1 : 0,
                }}
              />
            </div>

            {/* examples */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-600">
                try
              </span>
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.value}
                  type="button"
                  onClick={() => {
                    setInput(ex.value);
                    triggerScan();
                  }}
                  className="rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1 font-mono text-[11px] text-zinc-300 transition hover:border-neon/40 hover:text-neon-light"
                >
                  {ex.label}
                </button>
              ))}
            </div>

            {/* button */}
            <button
              type="button"
              onClick={() => void handleForge()}
              disabled={busy}
              className={cn(
                "af-btn af-sheen mt-5 flex w-full items-center justify-center gap-3 rounded-xl py-4 font-display text-sm font-bold uppercase tracking-[0.2em] text-white",
                !busy && "af-btn-pulse",
              )}
            >
              {busy ? (
                <>
                  <Spinner /> Forging…
                </>
              ) : (
                <>
                  <BoltIcon /> Forge Animation
                </>
              )}
            </button>

            {/* stats */}
            <div className="mt-5 grid grid-cols-3 gap-3">
              <StatTile
                label="Universe"
                value={ready?.universeId ? String(ready.universeId) : "—"}
                active={!!ready?.universeId}
              />
              <StatTile label="Format" value={ready ? ".RBXM" : "—"} />
              <StatTile
                label="Size"
                value={ready?.size ? formatBytes(ready.size) : "—"}
              />
            </div>

            {/* progress */}
            {showProgress && (
              <div className="mt-4">
                <div className="mb-1.5 flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                  <span>
                    {downloadState === "done" ? "transfer complete" : "downloading blob"}
                  </span>
                  <span className="text-neon-light">{progress}%</span>
                </div>
                <div className="relative h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className={cn(
                      "af-progress relative h-full rounded-full transition-all duration-300",
                    )}
                    style={{
                      width: `${progress}%`,
                      backgroundImage:
                        downloadState === "done"
                          ? "linear-gradient(90deg,#10b981,#34d399)"
                          : "linear-gradient(90deg,#7c3aed,#22d3ee)",
                    }}
                  />
                </div>
              </div>
            )}

            {/* manual download — always available once resolved */}
            {ready && (
              <button
                type="button"
                onClick={() => triggerFileDownload(proxyUrl(ready), ready.filename)}
                className="mt-4 flex w-full items-center justify-center gap-2.5 rounded-xl border border-neon/40 bg-neon/10 py-3 font-display text-xs font-bold uppercase tracking-[0.2em] text-neon-light transition hover:border-neon/70 hover:bg-neon/20 hover:text-white"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {downloadState === "done" ? "Re-download .rbxm" : "Download .rbxm"}
              </button>
            )}
          </Card>

          {/* log card */}
          <Card className="af-rise-in flex flex-col" >
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500">
                  process log
                </span>
                {busy && (
                  <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-rose-400">
                    <span className="af-pulse-dot h-1.5 w-1.5 rounded-full bg-rose-500" />
                    rec
                  </span>
                )}
              </div>
              {log.length > 0 && (
                <button
                  type="button"
                  onClick={() => setLog([])}
                  className="font-mono text-[10px] uppercase tracking-widest text-zinc-500 transition hover:text-neon-light"
                >
                  clear
                </button>
              )}
            </div>

            <div
              ref={logRef}
              className="relative flex-1 overflow-y-auto rounded-xl border border-white/10 bg-black/50 p-4 font-mono"
              style={{ minHeight: 300, maxHeight: 460 }}
            >
              {log.length === 0 ? (
                <div className="flex h-full min-h-[260px] flex-col items-center justify-center text-center text-zinc-600">
                  <TerminalIcon />
                  <p className="mt-3 max-w-[220px] text-[11px] leading-relaxed">
                    Awaiting asset target. Resolution events will stream here in
                    real time.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {log.map((entry) => (
                    <LogRow key={entry.id} entry={entry} />
                  ))}
                  {busy && (
                    <div className="flex items-center gap-2 text-neon-light">
                      <span className="af-blink">▌</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* ---------------------------- footer ---------------------------- */}
        <footer className="af-rise-in mt-12" style={{ animationDelay: "0.16s" }}>
          <div className="af-panel rounded-2xl p-5 text-center">
            <p className="mx-auto max-w-2xl font-mono text-[10px] leading-relaxed tracking-wide text-zinc-600">
              ⚠ AnimForge is an independent tool, not affiliated with or endorsed
              by Roblox Corporation. Built for interoperability &amp; research.
              Always respect creators&apos; terms of use.
            </p>
          </div>
        </footer>
      </main>
    </div>
  );
}
