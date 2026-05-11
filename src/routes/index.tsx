import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "ECG Monitor — Vital Signs" },
      { name: "description", content: "Hospital-style real-time ECG monitor with BPM, noise injection and DSP filtering." },
    ],
  }),
});

// Generate one ECG (PQRST) sample at phase t in [0,1)
function ecgSample(t: number): number {
  // Sum of gaussians approximating PQRST
  const g = (c: number, w: number, a: number) =>
    a * Math.exp(-Math.pow((t - c) / w, 2));
  return (
    g(0.18, 0.025, 0.12) + // P
    g(0.34, 0.008, -0.18) + // Q
    g(0.36, 0.010, 1.0) + // R
    g(0.385, 0.010, -0.25) + // S
    g(0.58, 0.05, 0.28) // T
  );
}

function Index() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [bpm, setBpm] = useState(72);
  const [noise, setNoise] = useState(false);
  const [filter, setFilter] = useState(false);
  const noiseRef = useRef(false);
  const filterRef = useRef(false);
  const bpmRef = useRef(72);

  useEffect(() => { noiseRef.current = noise; }, [noise]);
  useEffect(() => { filterRef.current = filter; }, [filter]);
  useEffect(() => { bpmRef.current = bpm; }, [bpm]);

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
      line: c("--ecg-line"),
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

    const SAMPLE_RATE = 250; // Hz
    const SECONDS_VISIBLE = 6;
    const BUFFER_LEN = SAMPLE_RATE * SECONDS_VISIBLE;
    const raw = new Float32Array(BUFFER_LEN);
    const filtered = new Float32Array(BUFFER_LEN);
    let writeIdx = 0;
    let phase = 0;
    let lastTime = performance.now();
    let lastBeatTime = performance.now();

    // Simple moving-average low-pass for DSP
    const FILTER_WIN = 7;

    const drawGrid = (w: number, h: number) => {
      ctx.fillStyle = "hsl(var(--monitor-bg))";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "hsl(var(--monitor-grid))";
      ctx.lineWidth = 0.5;
      const small = 16;
      for (let x = 0; x < w; x += small) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
      for (let y = 0; y < h; y += small) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }
      ctx.strokeStyle = "hsl(var(--monitor-grid-strong))";
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
        if (phase >= 1) {
          phase -= 1;
          lastBeatTime = now;
        }
        let v = ecgSample(phase);
        if (noiseRef.current) {
          v += (Math.random() - 0.5) * 0.35;
          v += Math.sin(now * 0.06 + i * 0.3) * 0.05;
        }
        raw[writeIdx] = v;

        // Moving average filter
        let sum = 0;
        for (let k = 0; k < FILTER_WIN; k++) {
          const idx = (writeIdx - k + BUFFER_LEN) % BUFFER_LEN;
          sum += raw[idx];
        }
        filtered[writeIdx] = sum / FILTER_WIN;

        writeIdx = (writeIdx + 1) % BUFFER_LEN;
      }

      const rect = canvas.getBoundingClientRect();
      const w = rect.width, h = rect.height;
      drawGrid(w, h);

      const data = filterRef.current ? filtered : raw;
      const midY = h / 2;
      const amp = h * 0.32;

      // Glow trail
      ctx.shadowColor = "hsl(var(--ecg-line))";
      ctx.shadowBlur = 10;
      ctx.strokeStyle = "hsl(var(--ecg-line))";
      ctx.lineWidth = 1.8;
      ctx.lineJoin = "round";
      ctx.beginPath();
      for (let x = 0; x < w; x++) {
        const t = x / w;
        const idx = (writeIdx + Math.floor(t * BUFFER_LEN)) % BUFFER_LEN;
        const y = midY - data[idx] * amp;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Leading dot
      const leadIdx = (writeIdx - 1 + BUFFER_LEN) % BUFFER_LEN;
      const leadY = midY - data[leadIdx] * amp;
      ctx.fillStyle = "hsl(var(--ecg-line))";
      ctx.beginPath();
      ctx.arc(w - 2, leadY, 3, 0, Math.PI * 2);
      ctx.fill();

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Pulsing heart based on BPM
  const beatDuration = 60 / bpm;

  return (
    <main className="min-h-screen bg-background text-foreground p-4 md:p-8">
      <div className="mx-auto max-w-7xl">
        <header className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="h-2.5 w-2.5 rounded-full bg-status-live animate-pulse" />
            <h1 className="text-lg md:text-xl font-mono tracking-widest text-muted-foreground">
              VITAL SIGNS · ECG LEAD II
            </h1>
          </div>
          <div className="font-mono text-xs md:text-sm text-muted-foreground">
            BED 04 · ROOM 217 · {new Date().toLocaleDateString()}
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
          <section className="rounded-lg border border-monitor-border bg-monitor-panel overflow-hidden shadow-monitor">
            <div className="flex items-center justify-between px-4 py-2 border-b border-monitor-border bg-monitor-header">
              <span className="font-mono text-xs text-ecg-line tracking-widest">II</span>
              <span className="font-mono text-[10px] text-muted-foreground">25 mm/s · 10 mm/mV</span>
            </div>
            <canvas ref={canvasRef} className="block w-full h-[340px] md:h-[440px]" />
          </section>

          <aside className="space-y-4">
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
                className="font-mono text-7xl font-bold text-vital-bpm mt-2 tabular-nums"
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
              <div className="flex justify-between font-mono text-[10px] text-muted-foreground mt-1">
                <span>40</span><span>180</span>
              </div>
            </div>

            <div className="rounded-lg border border-monitor-border bg-monitor-panel p-5 shadow-monitor space-y-3">
              <div>
                <div className="font-mono text-xs tracking-widest text-vital-spo2">SpO₂</div>
                <div className="font-mono text-3xl font-bold text-vital-spo2 tabular-nums">98<span className="text-base text-muted-foreground ml-1">%</span></div>
              </div>
              <div className="border-t border-monitor-border pt-3">
                <div className="font-mono text-xs tracking-widest text-vital-resp">RESP</div>
                <div className="font-mono text-3xl font-bold text-vital-resp tabular-nums">16<span className="text-base text-muted-foreground ml-1">/min</span></div>
              </div>
              <div className="border-t border-monitor-border pt-3">
                <div className="font-mono text-xs tracking-widest text-vital-temp">TEMP</div>
                <div className="font-mono text-3xl font-bold text-vital-temp tabular-nums">36.8<span className="text-base text-muted-foreground ml-1">°C</span></div>
              </div>
            </div>

            <div className="rounded-lg border border-monitor-border bg-monitor-panel p-4 shadow-monitor space-y-2">
              <button
                onClick={() => setNoise((v) => !v)}
                className={`w-full font-mono text-xs tracking-widest py-3 rounded border transition-all ${
                  noise
                    ? "bg-status-warn/20 border-status-warn text-status-warn shadow-[0_0_16px_hsl(var(--status-warn)/0.4)]"
                    : "bg-transparent border-monitor-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
                }`}
              >
                {noise ? "■ NOISE: ACTIVE" : "+ INJECT NOISE"}
              </button>
              <button
                onClick={() => setFilter((v) => !v)}
                className={`w-full font-mono text-xs tracking-widest py-3 rounded border transition-all ${
                  filter
                    ? "bg-ecg-line/15 border-ecg-line text-ecg-line shadow-[0_0_16px_hsl(var(--ecg-line)/0.4)]"
                    : "bg-transparent border-monitor-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
                }`}
              >
                {filter ? "✓ DSP FILTER: ON" : "≈ APPLY DSP FILTER"}
              </button>
              <p className="font-mono text-[10px] text-muted-foreground pt-1 leading-relaxed">
                Filter: 7-tap moving average low-pass.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
