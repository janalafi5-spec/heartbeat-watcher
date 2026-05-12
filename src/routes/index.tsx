import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Heartbeat Watcher — ICU Patient Monitor" },
      {
        name: "description",
        content:
          "Heartbeat Watcher: hospital-style ICU patient monitor demonstrating DSP filtering of noisy ECG signals in real time.",
      },
    ],
  }),
});

// PQRST gaussian approximation, t in [0,1)
function ecgSample(t: number): number {
  const g = (c: number, w: number, a: number) =>
    a * Math.exp(-Math.pow((t - c) / w, 2));
  return (
    g(0.18, 0.025, 0.12) +
    g(0.34, 0.008, -0.18) +
    g(0.36, 0.01, 1.0) +
    g(0.385, 0.01, -0.25) +
    g(0.58, 0.05, 0.28)
  );
}

interface MonitorProps {
  runningRef: React.MutableRefObject<boolean>;
  noiseRef: React.MutableRefObject<boolean>;
  filterRef: React.MutableRefObject<boolean>;
  bpmRef: React.MutableRefObject<number>;
  resetSignal: number;
}

function EcgMonitor({ runningRef, noiseRef, filterRef, bpmRef, resetSignal }: MonitorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    const css = getComputedStyle(document.documentElement);
    const c = (name: string) => `hsl(${css.getPropertyValue(name).trim()})`;
    const COLORS = {
      bg: c("--monitor-bg"),
      grid: c("--monitor-grid"),
      gridStrong: c("--monitor-grid-strong"),
      clean: c("--ecg-line"),
      noisy: c("--ecg-noisy"),
      divider: c("--vital-spo2"),
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    };
    resize();
    window.addEventListener("resize", resize);

    const SR = 250;
    const SECS = 6;
    const LEN = SR * SECS;
    const raw = new Float32Array(LEN);
    const filt = new Float32Array(LEN);
    let writeIdx = 0;
    let phase = 0;
    let lastTime = performance.now();
    const FW = 9;

    const drawGrid = (w: number, h: number) => {
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = COLORS.grid;
      ctx.lineWidth = 0.5;
      const sm = 16;
      for (let x = 0; x < w; x += sm) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = 0; y < h; y += sm) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      ctx.strokeStyle = COLORS.gridStrong;
      ctx.lineWidth = 0.9;
      for (let x = 0; x < w; x += sm * 5) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = 0; y < h; y += sm * 5) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    };

    let raf = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;

      if (runningRef.current) {
        const bps = bpmRef.current / 60;
        const n = Math.floor(dt * SR);
        for (let i = 0; i < n; i++) {
          phase += bps / SR;
          if (phase >= 1) phase -= 1;
          const clean = ecgSample(phase);
          let v = clean;
          if (noiseRef.current) {
            v = clean
              + (Math.random() - 0.5) * 0.55
              + Math.sin((now + i * 4) * 0.05) * 0.12
              + Math.sin((now + i * 4) * 0.001 * 50) * 0.08;
          }
          raw[writeIdx] = v;
          // 9-tap moving average
          let s = 0;
          for (let k = 0; k < FW; k++) {
            const idx = (writeIdx - k + LEN) % LEN;
            s += raw[idx];
          }
          filt[writeIdx] = s / FW;
          writeIdx = (writeIdx + 1) % LEN;
        }
      }

      const rect = canvas.getBoundingClientRect();
      const w = rect.width, h = rect.height;
      drawGrid(w, h);

      const midX = w / 2;
      const midY = h / 2;
      const amp = h * 0.3;

      // Left half: noisy raw
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, midX, h);
      ctx.clip();
      ctx.shadowColor = COLORS.noisy;
      ctx.shadowBlur = 8;
      ctx.strokeStyle = COLORS.noisy;
      ctx.lineWidth = 1.6;
      ctx.lineJoin = "round";
      ctx.beginPath();
      for (let x = 0; x < w; x++) {
        const t = x / w;
        const idx = (writeIdx - 1 - Math.floor(t * LEN) + LEN) % LEN;
        const y = midY - raw[idx] * amp;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();

      // Right half: filtered or raw based on filterRef
      ctx.save();
      ctx.beginPath();
      ctx.rect(midX, 0, w - midX, h);
      ctx.clip();
      const useFilt = filterRef.current;
      ctx.shadowColor = COLORS.clean;
      ctx.shadowBlur = useFilt ? 12 : 6;
      ctx.strokeStyle = useFilt ? COLORS.clean : COLORS.noisy;
      ctx.lineWidth = 1.8;
      ctx.lineJoin = "round";
      ctx.beginPath();
      for (let x = 0; x < w; x++) {
        const t = x / w;
        const idx = (writeIdx - 1 - Math.floor(t * LEN) + LEN) % LEN;
        const v = useFilt ? filt[idx] : raw[idx];
        const y = midY - v * amp;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();

      // Center divider — dashed
      ctx.shadowBlur = 0;
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = COLORS.divider;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(midX, 0);
      ctx.lineTo(midX, h);
      ctx.stroke();
      ctx.setLineDash([]);

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [runningRef, noiseRef, filterRef, bpmRef, resetSignal]);

  return <canvas ref={canvasRef} className="block w-full h-[340px] md:h-[420px]" />;
}

function Vital({
  label, value, unit, color, sub,
}: { label: string; value: string; unit?: string; color: string; sub?: string }) {
  return (
    <div className="rounded-md border border-monitor-border bg-monitor-panel p-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] tracking-widest" style={{ color: `hsl(var(${color}))` }}>{label}</span>
        {sub && <span className="font-mono text-[9px] text-muted-foreground">{sub}</span>}
      </div>
      <div
        className="font-mono font-bold tabular-nums leading-none mt-1"
        style={{ color: `hsl(var(${color}))`, fontSize: "2.6rem", textShadow: `0 0 18px hsl(var(${color}) / 0.5)` }}
      >
        {value}
      </div>
      {unit && <div className="font-mono text-[10px] text-muted-foreground mt-0.5">{unit}</div>}
    </div>
  );
}

function useClock() {
  const [t, setT] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return t;
}

function Index() {
  const [running, setRunning] = useState(true);
  const [noise, setNoise] = useState(false);
  const [filter, setFilter] = useState(false);
  const [bpm, setBpm] = useState(80);
  const [resetSignal, setResetSignal] = useState(0);

  const runningRef = useRef(true);
  const noiseRef = useRef(false);
  const filterRef = useRef(false);
  const bpmRef = useRef(80);
  useEffect(() => { runningRef.current = running; }, [running]);
  useEffect(() => { noiseRef.current = noise; }, [noise]);
  useEffect(() => { filterRef.current = filter; }, [filter]);
  useEffect(() => { bpmRef.current = bpm; }, [bpm]);

  const clock = useClock();
  const beatDuration = 60 / bpm;

  const leftLabel = noise ? "SIGNAL CORRUPTED" : "NOISY ECG · RAW SIGNAL";
  const rightLabel = filter ? "DSP FILTER ON · CLEAN" : "DSP FILTERED ECG · CLEAN SIGNAL";
  const dspStatus = filter ? "DSP FILTER ON" : noise ? "SIGNAL CORRUPTED" : "STABLE";

  const reset = () => {
    setNoise(false);
    setFilter(false);
    setRunning(true);
    setResetSignal((n) => n + 1);
  };

  const Btn = ({
    label, onClick, active, tone = "default",
  }: { label: string; onClick: () => void; active?: boolean; tone?: "default" | "go" | "stop" | "warn" | "ok" }) => {
    const tones: Record<string, string> = {
      default: "border-monitor-border text-foreground/90 hover:border-foreground/40",
      go: "border-ecg-line/60 text-ecg-line hover:bg-ecg-line/10",
      stop: "border-vital-bp/60 text-vital-bp hover:bg-vital-bp/10",
      warn: "border-status-warn/60 text-status-warn hover:bg-status-warn/10",
      ok: "border-vital-spo2/60 text-vital-spo2 hover:bg-vital-spo2/10",
    };
    const activeStyle =
      active
        ? tone === "warn"
          ? "bg-status-warn/20 shadow-[0_0_18px_hsl(var(--status-warn)/0.45)]"
          : tone === "ok"
          ? "bg-vital-spo2/20 shadow-[0_0_18px_hsl(var(--vital-spo2)/0.45)]"
          : "bg-foreground/10"
        : "";
    return (
      <button
        onClick={onClick}
        className={`font-mono text-xs tracking-widest px-4 py-2.5 rounded border bg-monitor-panel transition-all duration-200 ${tones[tone]} ${activeStyle}`}
      >
        {label}
      </button>
    );
  };

  return (
    <main className="min-h-screen bg-background text-foreground p-3 md:p-5">
      <div className="mx-auto max-w-[1500px]">
        {/* Top bar */}
        <header className="rounded-lg border border-monitor-border bg-monitor-header px-4 py-2.5 mb-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="h-2.5 w-2.5 rounded-full bg-status-live animate-pulse" />
            <div>
              <h1 className="font-mono text-base md:text-lg font-bold tracking-[0.25em] text-ecg-line">
                HEARTBEAT WATCHER
              </h1>
              <div className="font-mono text-[10px] tracking-widest text-muted-foreground">
                PATIENT MONITORING SYSTEM
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4 font-mono text-xs text-muted-foreground">
            <span className="hidden sm:inline">{clock.toLocaleDateString()}</span>
            <span className="text-foreground tabular-nums text-sm">{clock.toLocaleTimeString()}</span>
            {/* Sound icon */}
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-vital-spo2" fill="currentColor">
              <path d="M3 10v4h4l5 4V6L7 10H3zm13.5 2a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z" />
            </svg>
            {/* Battery */}
            <div className="flex items-center gap-1">
              <div className="relative h-3 w-7 border border-foreground/60 rounded-sm">
                <div className="absolute left-0 top-0 bottom-0 w-[80%] bg-ecg-line" />
              </div>
              <div className="h-1.5 w-0.5 bg-foreground/60" />
              <span className="text-[10px]">80%</span>
            </div>
          </div>
        </header>

        {/* Patient info strip */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
          {[
            { k: "PATIENT ID", v: "P-1001" },
            { k: "NAME", v: "John Doe" },
            { k: "AGE / GENDER", v: "45 / Male" },
            { k: "BED", v: "ICU-07" },
            { k: "STATUS", v: dspStatus },
          ].map((p) => (
            <div key={p.k} className="rounded-md border border-monitor-border bg-monitor-panel px-3 py-2">
              <div className="font-mono text-[9px] tracking-widest text-muted-foreground">{p.k}</div>
              <div
                className={`font-mono text-sm font-semibold ${
                  p.k === "STATUS"
                    ? filter
                      ? "text-ecg-line"
                      : noise
                      ? "text-vital-bp"
                      : "text-vital-spo2"
                    : "text-foreground"
                }`}
              >
                {p.v}
              </div>
            </div>
          ))}
        </div>

        {/* Main grid: ECG + vitals */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-3 mb-3">
          {/* ECG card */}
          <div className="rounded-lg border border-monitor-border bg-monitor-panel shadow-monitor overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-monitor-border bg-monitor-header">
              <div className="flex items-center gap-2">
                <svg viewBox="0 0 24 24" className="h-5 w-5 text-vital-bpm" fill="currentColor"
                  style={{ animation: `heartbeat ${beatDuration}s ease-in-out infinite` }}>
                  <path d="M12 21s-7-4.35-7-10a4 4 0 0 1 7-2.65A4 4 0 0 1 19 11c0 5.65-7 10-7 10z" />
                </svg>
                <span className="font-mono text-xs tracking-widest text-muted-foreground">ECG · LEAD II · 25 mm/s</span>
              </div>
              <span className="font-mono text-[10px] tracking-widest text-muted-foreground">
                {running ? "● LIVE" : "■ PAUSED"}
              </span>
            </div>
            <div className="relative">
              <EcgMonitor
                runningRef={runningRef}
                noiseRef={noiseRef}
                filterRef={filterRef}
                bpmRef={bpmRef}
                resetSignal={resetSignal}
              />
              {/* Half labels overlay */}
              <div className="pointer-events-none absolute inset-0 flex">
                <div className="w-1/2 p-3">
                  <span className="inline-block font-mono text-[10px] tracking-widest px-2 py-1 rounded bg-vital-bp/20 text-vital-bp border border-vital-bp/40">
                    {leftLabel}
                  </span>
                </div>
                <div className="w-1/2 p-3 flex justify-end">
                  <span className="inline-block font-mono text-[10px] tracking-widest px-2 py-1 rounded bg-ecg-line/20 text-ecg-line border border-ecg-line/40">
                    {rightLabel}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Vitals column */}
          <div className="grid grid-cols-2 lg:grid-cols-1 gap-2">
            <Vital label="ECG" value="80" unit="bpm" color="--vital-bpm" sub="HR" />
            <Vital label="RESP" value="14" unit="rpm" color="--vital-resp" />
            <Vital label="SpO₂" value="99" unit="%" color="--vital-spo2" />
            <Vital label="CO₂" value="38" unit="mmHg" color="--vital-co2" sub="EtCO₂" />
            <Vital label="ABP" value="120/80" unit="mmHg" color="--vital-bp" sub="ART" />
            <Vital label="NIBP" value="120/80" unit="mmHg" color="--vital-nibp" />
          </div>
        </div>

        {/* Controls */}
        <div className="rounded-lg border border-monitor-border bg-monitor-panel p-3 mb-3 flex flex-wrap gap-2 justify-center">
          <Btn label="▶ START" onClick={() => setRunning(true)} active={running} tone="go" />
          <Btn label="■ STOP" onClick={() => setRunning(false)} active={!running} tone="stop" />
          <Btn label={noise ? "✕ NOISE: ON" : "+ ADD NOISE"} onClick={() => setNoise((v) => !v)} active={noise} tone="warn" />
          <Btn label={filter ? "✓ DSP FILTER: ON" : "≈ APPLY DSP FILTER"} onClick={() => setFilter((v) => !v)} active={filter} tone="ok" />
          <Btn label="↺ RESET" onClick={reset} />
          <Btn label="⚙ SETTINGS" onClick={() => {}} />
        </div>

        {/* Explanation */}
        <section className="rounded-lg border border-monitor-border bg-monitor-panel p-4">
          <div className="font-mono text-[11px] tracking-widest text-vital-spo2 mb-2">
            ▍ DIGITAL SIGNAL PROCESSING — ECG NOISE REMOVAL
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Digital Signal Processing removes unwanted ECG noise such as motion artifacts,
            muscle (EMG) noise, and 50/60 Hz power-line interference. The{" "}
            <span className="text-vital-bp font-semibold">left side</span> shows the raw noisy
            ECG signal acquired directly from the electrodes, while the{" "}
            <span className="text-ecg-line font-semibold">right side</span> shows the filtered
            clean signal after DSP processing using a 9-tap moving-average FIR filter that
            preserves the QRS morphology while attenuating high-frequency noise.
          </p>
          <div className="mt-3 font-mono text-[10px] text-muted-foreground text-center">
            Educational simulation · Heartbeat Watcher · Not for clinical use
          </div>
        </section>
      </div>
    </main>
  );
}
