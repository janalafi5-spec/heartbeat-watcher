import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "ECG Monitor — DSP Signal Processing" },
      {
        name: "description",
        content:
          "Hospital-style ECG monitor visualizing original, noisy, and DSP-filtered signals for a Digital Signal Processing project.",
      },
    ],
  }),
});

// PQRST approximation via gaussians, t in [0,1)
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

type TraceKind = "clean" | "noisy" | "filtered";

interface TraceProps {
  kind: TraceKind;
  label: string;
  sub: string;
  colorVar: string;
  bpmRef: React.MutableRefObject<number>;
  noiseRef: React.MutableRefObject<boolean>;
  filterRef: React.MutableRefObject<boolean>;
}

function EcgTrace({ kind, label, sub, colorVar, bpmRef, noiseRef, filterRef }: TraceProps) {
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
      line: c(colorVar),
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

    const SAMPLE_RATE = 250;
    const SECONDS_VISIBLE = 5;
    const BUFFER_LEN = SAMPLE_RATE * SECONDS_VISIBLE;
    const raw = new Float32Array(BUFFER_LEN);
    const display = new Float32Array(BUFFER_LEN);
    let writeIdx = 0;
    let phase = Math.random();
    let lastTime = performance.now();
    const FILTER_WIN = 7;

    const drawGrid = (w: number, h: number) => {
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = COLORS.grid;
      ctx.lineWidth = 0.5;
      const small = 14;
      for (let x = 0; x < w; x += small) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
      for (let y = 0; y < h; y += small) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }
      ctx.strokeStyle = COLORS.gridStrong;
      ctx.lineWidth = 0.8;
      for (let x = 0; x < w; x += small * 5) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
      for (let y = 0; y < h; y += small * 5) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }
    };

    let raf = 0;
    const loop = (now: number) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      const beatsPerSec = bpmRef.current / 60;
      const samplesToAdd = Math.min(BUFFER_LEN, Math.floor(dt * SAMPLE_RATE));

      for (let i = 0; i < samplesToAdd; i++) {
        phase += beatsPerSec / SAMPLE_RATE;
        if (phase >= 1) phase -= 1;
        const clean = ecgSample(phase);
        let v = clean;
        const addNoise = kind === "noisy" || (kind === "filtered" && noiseRef.current);
        if (kind === "clean") {
          v = clean;
        } else if (addNoise) {
          v =
            clean +
            (Math.random() - 0.5) * 0.4 +
            Math.sin(now * 0.06 + i * 0.3) * 0.06 +
            Math.sin(now * 0.001 * 50) * 0.04;
        }
        raw[writeIdx] = v;

        if (kind === "filtered" && filterRef.current) {
          let sum = 0;
          for (let k = 0; k < FILTER_WIN; k++) {
            const idx = (writeIdx - k + BUFFER_LEN) % BUFFER_LEN;
            sum += raw[idx];
          }
          display[writeIdx] = sum / FILTER_WIN;
        } else {
          display[writeIdx] = raw[writeIdx];
        }
        writeIdx = (writeIdx + 1) % BUFFER_LEN;
      }

      const rect = canvas.getBoundingClientRect();
      const w = rect.width, h = rect.height;
      drawGrid(w, h);

      const midY = h / 2;
      const amp = h * 0.32;

      ctx.shadowColor = COLORS.line;
      ctx.shadowBlur = 8;
      ctx.strokeStyle = COLORS.line;
      ctx.lineWidth = 1.6;
      ctx.lineJoin = "round";
      ctx.beginPath();
      for (let x = 0; x < w; x++) {
        const t = x / w;
        const idx = (writeIdx + Math.floor(t * BUFFER_LEN)) % BUFFER_LEN;
        const y = midY - display[idx] * amp;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      const leadIdx = (writeIdx - 1 + BUFFER_LEN) % BUFFER_LEN;
      const leadY = midY - display[leadIdx] * amp;
      ctx.fillStyle = COLORS.line;
      ctx.beginPath();
      ctx.arc(w - 2, leadY, 3, 0, Math.PI * 2);
      ctx.fill();

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [kind, colorVar, bpmRef, noiseRef, filterRef]);

  return (
    <div className="rounded-lg border border-monitor-border bg-monitor-panel overflow-hidden shadow-monitor transition-all hover:border-foreground/30">
      <div className="flex items-center justify-between px-4 py-2 border-b border-monitor-border bg-monitor-header">
        <span
          className="font-mono text-xs tracking-widest"
          style={{ color: `hsl(var(${colorVar}))` }}
        >
          {label}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">{sub}</span>
      </div>
      <canvas ref={canvasRef} className="block w-full h-[180px] md:h-[200px]" />
    </div>
  );
}

function Index() {
  const [bpm, setBpm] = useState(72);
  const [noise, setNoise] = useState(false);
  const [filter, setFilter] = useState(false);
  const noiseRef = useRef(false);
  const filterRef = useRef(false);
  const bpmRef = useRef(72);

  useEffect(() => { noiseRef.current = noise; }, [noise]);
  useEffect(() => { filterRef.current = filter; }, [filter]);
  useEffect(() => { bpmRef.current = bpm; }, [bpm]);

  const beatDuration = 60 / bpm;

  const status = !noise
    ? { text: "PATIENT STABLE · SINUS RHYTHM", tone: "text-ecg-line", dot: "bg-ecg-line" }
    : filter
    ? { text: "FILTERING ACTIVE · SIGNAL RECOVERED", tone: "text-vital-spo2", dot: "bg-vital-spo2" }
    : { text: "SIGNAL DEGRADED · NOISE DETECTED", tone: "text-status-warn", dot: "bg-status-warn" };

  return (
    <main className="min-h-screen bg-background text-foreground p-4 md:p-8">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <div className="h-2.5 w-2.5 rounded-full bg-status-live animate-pulse" />
            <h1 className="text-lg md:text-xl font-mono tracking-widest text-muted-foreground">
              VITAL SIGNS · ECG LEAD II · DSP LAB
            </h1>
          </div>
          <div className="font-mono text-xs md:text-sm text-muted-foreground">
            BED 04 · ROOM 217 · {new Date().toLocaleDateString()}
          </div>
        </header>

        {/* Top bar: BPM + status + controls */}
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr_auto] gap-4 mb-4">
          <div className="rounded-lg border border-monitor-border bg-monitor-panel p-5 shadow-monitor">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs tracking-widest text-vital-bpm">HR · bpm</span>
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5 text-vital-bpm"
                style={{ animation: `heartbeat ${beatDuration}s ease-in-out infinite` }}
                fill="currentColor"
              >
                <path d="M12 21s-7-4.35-7-10a4 4 0 0 1 7-2.65A4 4 0 0 1 19 11c0 5.65-7 10-7 10z" />
              </svg>
            </div>
            <div
              className="font-mono text-6xl font-bold text-vital-bpm mt-1 tabular-nums"
              style={{ textShadow: "0 0 24px hsl(var(--vital-bpm) / 0.5)" }}
            >
              {bpm}
            </div>
            <input
              type="range"
              min={40}
              max={180}
              value={bpm}
              onChange={(e) => setBpm(parseInt(e.target.value))}
              className="w-full mt-3 accent-vital-bpm"
            />
          </div>

          <div className="rounded-lg border border-monitor-border bg-monitor-panel p-5 shadow-monitor flex flex-col justify-center">
            <div className="flex items-center gap-2 mb-2">
              <span className={`h-2 w-2 rounded-full ${status.dot} animate-pulse`} />
              <span className="font-mono text-[10px] tracking-widest text-muted-foreground">PATIENT STATUS</span>
            </div>
            <div className={`font-mono text-lg md:text-2xl tracking-wider ${status.tone} transition-colors duration-500`}>
              {status.text}
            </div>
            <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-monitor-border">
              <div>
                <div className="font-mono text-[10px] tracking-widest text-vital-spo2">SpO₂</div>
                <div className="font-mono text-2xl font-bold text-vital-spo2 tabular-nums">98<span className="text-xs text-muted-foreground ml-1">%</span></div>
              </div>
              <div>
                <div className="font-mono text-[10px] tracking-widest text-vital-resp">RESP</div>
                <div className="font-mono text-2xl font-bold text-vital-resp tabular-nums">16<span className="text-xs text-muted-foreground ml-1">/min</span></div>
              </div>
              <div>
                <div className="font-mono text-[10px] tracking-widest text-vital-temp">TEMP</div>
                <div className="font-mono text-2xl font-bold text-vital-temp tabular-nums">36.8<span className="text-xs text-muted-foreground ml-1">°C</span></div>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-monitor-border bg-monitor-panel p-4 shadow-monitor flex flex-col gap-2 justify-center min-w-[220px]">
            <button
              onClick={() => setNoise((v) => !v)}
              className={`w-full font-mono text-xs tracking-widest py-3 rounded border transition-all duration-300 ${
                noise
                  ? "bg-status-warn/20 border-status-warn text-status-warn shadow-[0_0_16px_hsl(var(--status-warn)/0.4)]"
                  : "bg-transparent border-monitor-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
              }`}
            >
              {noise ? "■ NOISE: ACTIVE" : "+ ADD NOISE"}
            </button>
            <button
              onClick={() => setFilter((v) => !v)}
              className={`w-full font-mono text-xs tracking-widest py-3 rounded border transition-all duration-300 ${
                filter
                  ? "bg-ecg-line/15 border-ecg-line text-ecg-line shadow-[0_0_16px_hsl(var(--ecg-line)/0.4)]"
                  : "bg-transparent border-monitor-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
              }`}
            >
              {filter ? "✓ DSP FILTER: ON" : "≈ APPLY DSP FILTER"}
            </button>
          </div>
        </div>

        {/* Three traces */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <EcgTrace
            kind="clean"
            label="① ORIGINAL ECG"
            sub="reference signal"
            colorVar="--ecg-line"
            bpmRef={bpmRef}
            noiseRef={noiseRef}
            filterRef={filterRef}
          />
          <EcgTrace
            kind="noisy"
            label="② NOISY ECG"
            sub="signal + interference"
            colorVar="--status-warn"
            bpmRef={bpmRef}
            noiseRef={noiseRef}
            filterRef={filterRef}
          />
          <EcgTrace
            kind="filtered"
            label="③ DSP FILTERED ECG"
            sub={filter ? "7-tap moving average" : "filter bypassed"}
            colorVar="--vital-spo2"
            bpmRef={bpmRef}
            noiseRef={noiseRef}
            filterRef={filterRef}
          />
        </div>

        {/* DSP Explanation cards */}
        <section>
          <h2 className="font-mono text-xs tracking-widest text-muted-foreground mb-3">
            ▍ HOW DSP REMOVES ECG NOISE
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              {
                t: "1 · Acquire & Sample",
                c: "ecg-line",
                d: "The analog ECG from electrodes is sampled at a fixed rate (here 250 Hz). Each sample becomes a discrete value the processor can analyze in the digital domain.",
              },
              {
                t: "2 · Identify Noise",
                c: "status-warn",
                d: "Real ECGs are corrupted by 50/60 Hz powerline hum, muscle (EMG) activity and baseline wander. These artifacts overlap the signal and obscure the QRS complex.",
              },
              {
                t: "3 · Filter Digitally",
                c: "vital-spo2",
                d: "A digital low-pass filter — here a 7-tap moving average (FIR) — averages neighboring samples to suppress high-frequency noise while preserving the heartbeat morphology.",
              },
            ].map((card) => (
              <article
                key={card.t}
                className="rounded-lg border border-monitor-border bg-monitor-panel p-5 shadow-monitor transition-all hover:border-foreground/30 hover:-translate-y-0.5 duration-300"
              >
                <div
                  className="font-mono text-sm tracking-widest mb-2"
                  style={{ color: `hsl(var(--${card.c}))` }}
                >
                  {card.t}
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">{card.d}</p>
              </article>
            ))}
          </div>
          <p className="font-mono text-[10px] text-muted-foreground mt-4 text-center">
            Educational simulation · not for clinical use
          </p>
        </section>
      </div>
    </main>
  );
}
