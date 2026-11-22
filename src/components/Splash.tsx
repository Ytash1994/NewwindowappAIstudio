import { useEffect, useRef, useState } from "react";

interface SplashProps {
  onDone: () => void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  l: number;
  dl: number;
  r: number;
  c: string;
  g: number;
  amb?: number;
  ph: number;
}

export default function Splash({ onDone }: SplashProps) {
  const [closing, setClosing] = useState(false);
  const [n1, setN1] = useState(0);
  const [n2, setN2] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const closedRef = useRef(false);

  const triggerClose = () => {
    if (closedRef.current) return;
    closedRef.current = true;
    setClosing(true);
    window.setTimeout(onDone, 780);
  };

  useEffect(() => {
    const s = rootRef.current;
    const cv = canvasRef.current;
    const svg = svgRef.current;
    if (!s || !cv || !svg) return;

    const cx = cv.getContext("2d");
    if (!cx) return;

    const R = Math.min(2, window.devicePixelRatio || 1);
    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion:reduce)").matches;

    let W = 0;
    let H = 0;
    const size = () => {
      W = s.clientWidth;
      H = s.clientHeight;
      cv.width = W * R;
      cv.height = H * R;
      cx.setTransform(R, 0, 0, R, 0, 0);
    };
    size();
    window.addEventListener("resize", size);

    const P: Particle[] = [];
    const burst = (x: number, y: number, n: number, gold: number) => {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.283;
        const v = (gold === 2 ? 0.5 : 1.5) + Math.random() * (gold === 2 ? 1.4 : 4.5);
        P.push({
          x,
          y,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v - 1,
          l: 1,
          dl: (gold === 2 ? 0.008 : 0.012) + Math.random() * 0.01,
          r: (gold === 2 ? 0.8 : 1) + Math.random() * (gold === 2 ? 1.2 : 2.2),
          c: gold ? (Math.random() < 0.5 ? "255,210,122" : "255,243,201") : "159,208,255",
          g: 0.05,
          ph: 0,
        });
      }
    };

    for (let i = 0; i < (reduce ? 0 : 34); i++) {
      P.push({
        x: Math.random() * 400,
        y: Math.random() * 900,
        vx: (Math.random() - 0.5) * 0.15,
        vy: -0.15 - Math.random() * 0.3,
        l: Math.random(),
        dl: 0,
        r: 0.8 + Math.random() * 1.6,
        c: "159,208,255",
        g: 0,
        amb: 1,
        ph: Math.random() * 6,
      });
    }

    let rafId = 0;
    const loop = () => {
      if (closedRef.current) return;
      cx.clearRect(0, 0, W, H);
      for (let i = P.length - 1; i >= 0; i--) {
        const p = P[i];
        if (p.amb) {
          p.x += p.vx + Math.sin((p.ph += 0.02)) * 0.2;
          p.y += p.vy;
          if (p.y < -10) {
            p.y = H + 10;
            p.x = Math.random() * W;
          }
          p.x = (p.x + W) % W;
          cx.globalAlpha = 0.25 + 0.45 * Math.abs(Math.sin(p.ph));
        } else {
          p.vy += p.g;
          p.x += p.vx;
          p.y += p.vy;
          p.vx *= 0.985;
          p.l -= p.dl;
          if (p.l <= 0) {
            P.splice(i, 1);
            continue;
          }
          cx.globalAlpha = p.l;
        }
        cx.beginPath();
        cx.fillStyle = `rgb(${p.c})`;
        cx.shadowColor = `rgba(${p.c},.9)`;
        cx.shadowBlur = 8;
        cx.arc(p.x, p.y, p.r, 0, 6.283);
        cx.fill();
      }
      cx.globalAlpha = 1;
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);

    const winPt = (x: number, y: number): [number, number] => {
      const r = svg.getBoundingClientRect();
      const k = r.width / 280;
      const o = s.getBoundingClientRect();
      return [r.left - o.left + x * k, r.top - o.top + y * k];
    };

    const timers: number[] = [];
    if (!reduce) {
      timers.push(
        window.setTimeout(() => {
          [
            [62, 30],
            [198, 30],
            [62, 200],
            [198, 200],
          ].forEach((q) => {
            const p = winPt(q[0], q[1]);
            burst(p[0], p[1], 9, 2);
          });
        }, 1250)
      );
    }

    const animateNum = (setter: (v: number) => void, to: number, delay: number, dur: number) => {
      timers.push(
        window.setTimeout(() => {
          let t0: number | null = null;
          const f = (t: number) => {
            if (t0 === null) t0 = t;
            const raw = Math.min(1, (t - t0) / dur);
            const k = 1 - Math.pow(1 - raw, 3);
            setter(Math.round(to * k));
            if (raw < 1 && !closedRef.current) requestAnimationFrame(f);
          };
          requestAnimationFrame(f);
        }, delay)
      );
    };

    animateNum(setN1, 120, 2100, 1100);
    animateNum(setN2, 150, 2300, 1100);

    timers.push(window.setTimeout(triggerClose, 6800));

    return () => {
      window.removeEventListener("resize", size);
      cancelAnimationFrame(rafId);
      timers.forEach((id) => clearTimeout(id));
    };
  }, []);

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = rootRef.current;
    const svg = svgRef.current;
    if (!s || !svg) return;
    const o = s.getBoundingClientRect();
    const dx = (e.clientX - o.left) / o.width - 0.5;
    const dy = (e.clientY - o.top) / o.height - 0.5;
    svg.style.transform = `perspective(700px) rotateY(${dx * 12}deg) rotateX(${-dy * 10}deg)`;
  };

  const handlePointerLeave = () => {
    if (svgRef.current) svgRef.current.style.transform = "";
  };

  return (
    <div
      id="splash"
      ref={rootRef}
      className={closing ? "out" : undefined}
      role="presentation"
      aria-label="شاشة البداية"
      onClick={triggerClose}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      <canvas id="spc" ref={canvasRef} />
      <div className="scan" />
      <svg className="win" id="spw" ref={svgRef} viewBox="0 0 280 262" aria-hidden="true">
        <defs>
          <linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#7dbaff" stopOpacity=".6" />
            <stop offset="1" stopColor="#1b5fc4" stopOpacity=".28" />
          </linearGradient>
          <linearGradient id="gf" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff" />
            <stop offset="1" stopColor="#cfe3ff" />
          </linearGradient>
          <radialGradient id="rg">
            <stop offset="0" stopColor="#9fd0ff" stopOpacity=".9" />
            <stop offset="1" stopColor="#9fd0ff" stopOpacity="0" />
          </radialGradient>
          <clipPath id="cpw">
            <rect x="62" y="30" width="136" height="170" rx="3" />
          </clipPath>
        </defs>
        <path
          className="cl"
          style={{ ["--d" as string]: ".9s" }}
          d="M30 30H236M30 200H236M62 14V224M198 14V224"
        />
        <circle className="glow" cx="130" cy="115" r="105" fill="url(#rg)" />
        <g className="gl">
          <rect x="62" y="30" width="136" height="170" fill="url(#g1)" />
          <g clipPath="url(#cpw)">
            <rect className="sheen" x="80" y="10" width="22" height="220" fill="#fff" opacity=".4" />
            <rect className="sheen" x="112" y="10" width="7" height="220" fill="#fff" opacity=".3" />
          </g>
        </g>
        <rect
          className="bar4"
          style={{ ["--d" as string]: ".5s", ["--fx" as string]: "0px", ["--fy" as string]: "-170px", ["--fr" as string]: "-18deg" }}
          x="62"
          y="30"
          width="136"
          height="8"
          rx="2"
        />
        <rect
          className="bar4"
          style={{ ["--d" as string]: ".65s", ["--fx" as string]: "0px", ["--fy" as string]: "170px", ["--fr" as string]: "20deg" }}
          x="62"
          y="192"
          width="136"
          height="8"
          rx="2"
        />
        <rect
          className="bar4"
          style={{ ["--d" as string]: ".8s", ["--fx" as string]: "-170px", ["--fy" as string]: "0px", ["--fr" as string]: "15deg" }}
          x="62"
          y="30"
          width="8"
          height="170"
          rx="2"
        />
        <rect
          className="bar4"
          style={{ ["--d" as string]: ".95s", ["--fx" as string]: "170px", ["--fy" as string]: "0px", ["--fr" as string]: "-16deg" }}
          x="190"
          y="30"
          width="8"
          height="170"
          rx="2"
        />
        <circle className="pulse" cx="130" cy="115" r="30" />
        <circle className="pulse pulse2" cx="130" cy="115" r="30" />
        <rect
          className="dr fr2"
          style={{ ["--l" as string]: 560, ["--t" as string]: "1.1s", ["--d" as string]: "1.45s" }}
          x="70"
          y="38"
          width="120"
          height="154"
          rx="2"
        />
        <path
          className="dr mu"
          style={{ ["--l" as string]: 154, ["--d" as string]: "1.6s", ["--t" as string]: ".7s" }}
          d="M130 38V192"
        />
        <path
          className="dr mu"
          style={{ ["--l" as string]: 120, ["--d" as string]: "1.75s", ["--t" as string]: ".7s" }}
          d="M70 115H190"
        />
        <rect className="hd" x="124.5" y="97" width="3" height="14" rx="1.5" />
        <rect className="hd" x="132.5" y="97" width="3" height="14" rx="1.5" />
        <path
          className="dr dm"
          style={{ ["--l" as string]: 150, ["--d" as string]: "1.9s", ["--t" as string]: ".8s" }}
          d="M62 224H198M62 216v16M198 216v16"
        />
        <path
          className="dr dm"
          style={{ ["--l" as string]: 190, ["--d" as string]: "2.0s", ["--t" as string]: ".8s" }}
          d="M232 30V200M224 30h16M224 200h16"
        />
        <path
          style={{ opacity: 0, animation: "spFade .4s 2.4s forwards" }}
          d="M62 224l7-4v8zM198 224l-7-4v8zM232 30l-4 7h8zM232 200l-4-7h8z"
          fill="#ffd27a"
        />
        <text className="dt" x="130" y="248" textAnchor="middle">
          <tspan id="n1">{n1}</tspan>
        </text>
        <text className="dtu" x="130" y="261" textAnchor="middle">
          العرض
        </text>
        <text className="dt" textAnchor="middle" transform="translate(250 115) rotate(90)">
          <tspan id="n2">{n2}</tspan>
        </text>
        <text className="dtu" textAnchor="middle" transform="translate(277 115) rotate(90)">
          الطول
        </text>
      </svg>
      <div className="tb">
        <div className="ln hz" style={{ ["--d" as string]: "2.7s", top: 0 }} />
        <div className="ln hz" style={{ ["--d" as string]: "2.9s", bottom: 0 }} />
        <div className="ln vt" style={{ ["--d" as string]: "3.0s", right: 0 }} />
        <div className="ln vt" style={{ ["--d" as string]: "3.2s", left: 0 }} />
        <i className="cr" style={{ top: -3, right: -3 }} />
        <i className="cr" style={{ top: -3, left: -3 }} />
        <i className="cr" style={{ bottom: -3, right: -3 }} />
        <i className="cr" style={{ bottom: -3, left: -3 }} />
        <div className="r1">حاسبة القياسات</div>
        <div className="r2">
          <div className="ln hz" style={{ ["--d" as string]: "3.4s", top: 0 }} />
          <div className="lb">برمجة وتصميم</div>
          <div className="ln hz" style={{ ["--d" as string]: "3.6s", top: 36 }} />
          <div className="nmc">
            <span className="nmw">
              <span className="nm" id="spn">
                المهندس يزن طشطوش
              </span>
              <i className="pen" />
            </span>
            <div className="dim">
              <i />
              <i />
              <b />
              <b />
            </div>
          </div>
        </div>
      </div>
      <div className="bar">
        <i />
      </div>
      <div className="stap">اضغط في أي مكان للدخول</div>
    </div>
  );
}
