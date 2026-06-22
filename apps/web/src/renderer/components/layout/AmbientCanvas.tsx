import { useEffect, useRef } from 'react';
import { FRAGMENT_SHADER, THEME_MS, VERTEX_SHADER, easeInOut, themeTarget } from './ambientScene';

/** Clamp device-pixel-ratio so 4K / hi-dpi screens don't render an oversized
 * full-screen surface for what is only a soft background. */
const DPR_CAP = 1.5;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function link(gl: WebGLRenderingContext, vertexSrc: string, fragSrc: string): WebGLProgram | null {
  const vert = compile(gl, gl.VERTEX_SHADER, vertexSrc);
  const frag = compile(gl, gl.FRAGMENT_SHADER, fragSrc);
  if (!vert || !frag) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

/** The mounted canvas's shader-recompile hook, wired up by the effect below and
 * invoked by the module-level HMR handler. Only one canvas is ever live, so a
 * single slot is enough. Null when no canvas is mounted (or in production). */
let activeRecompile: ((mod: typeof import('./ambientScene')) => void) | null = null;

// Hot-reload the shaders without tearing down the WebGL context or losing the
// in-flight crossfade: when ambientScene.ts changes, hand the new sources to the
// live canvas, which recompiles just the GL program and repaints. In production
// `import.meta.hot` is undefined, so this block is stripped entirely.
if (import.meta.hot) {
  import.meta.hot.accept('./ambientScene', (mod) => {
    if (mod) activeRecompile?.(mod as unknown as typeof import('./ambientScene'));
  });
}

/**
 * Full-viewport animated day/night ambient background.
 *
 * Renders the {@link FRAGMENT_SHADER} gradient and crossfades it whenever the
 * document theme flips (observed directly off the `.dark` class on `<html>`,
 * so it reacts no matter which control toggles the theme). The render loop
 * only runs during the ~{@link THEME_MS}ms morph and then stops, so an idle
 * window costs nothing.
 *
 * If WebGL is unavailable (or context is lost), the canvas simply stays
 * transparent and the static CSS `.app-ambient` gradient behind it shows
 * through, so there is never a blank background.
 */
export function AmbientCanvas({ active = false }: { active?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // The GL effect publishes its activity setter here so the lightweight
  // `active`-watching effect below can drive the breathing without tearing
  // down and rebuilding the WebGL context.
  const setActiveRef = useRef<(next: boolean) => void>(() => {});

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext('webgl', {
      antialias: false,
      premultipliedAlpha: false,
      depth: false,
      // We render only on theme toggle, not in a continuous loop, so the
      // last drawn frame must survive subsequent compositor repaints.
      // Without this the buffer is cleared after present and the canvas
      // goes transparent, leaving only the CSS .app-ambient fallback.
      preserveDrawingBuffer: true,
    });
    if (!context) return; // CSS .app-ambient fallback shows through

    // Bind non-nullable locals so the nested render closures keep the
    // narrowed (non-null) types after the guards above.
    const view: HTMLCanvasElement = canvas;
    const gl: WebGLRenderingContext = context;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    // Program + uniform locations are mutable so a hot-reload can swap in a
    // freshly compiled program against the same live context (see buildProgram).
    let program: WebGLProgram | null = null;
    let resLoc: WebGLUniformLocation | null = null;
    let themeLoc: WebGLUniformLocation | null = null;
    let timeLoc: WebGLUniformLocation | null = null;
    let activeLoc: WebGLUniformLocation | null = null;

    function buildProgram(vertexSrc: string, fragSrc: string): boolean {
      const next = link(gl, vertexSrc, fragSrc);
      // On a shader edit with a compile/link error, keep the current program so
      // the background stays painted instead of flashing transparent.
      if (!next) return false;
      if (program) gl.deleteProgram(program);
      program = next;
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      const posLoc = gl.getAttribLocation(program, 'p');
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
      resLoc = gl.getUniformLocation(program, 'u_res');
      themeLoc = gl.getUniformLocation(program, 'u_theme');
      timeLoc = gl.getUniformLocation(program, 'u_time');
      activeLoc = gl.getUniformLocation(program, 'u_active');
      return true;
    }

    if (!buildProgram(VERTEX_SHADER, FRAGMENT_SHADER)) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let theme = themeTarget(); // current animated value, 0 = night .. 1 = day
    let themeTo = theme;
    let themeFrom = theme;
    let themeStart = 0;
    let themeAnimating = false;

    // Activity breathing: while an agent is working, activeLevel eases toward 1
    // and breatheTime advances, driving the genesis aurora's slow pulse in the
    // shader. Both settle back to 0 once work stops.
    let activeLevel = 0;
    let activeTarget = 0;
    let breatheTime = 0;
    let lastNow = 0;
    let raf = 0;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
      const w = Math.max(1, Math.floor(view.clientWidth * dpr));
      const h = Math.max(1, Math.floor(view.clientHeight * dpr));
      if (view.width !== w || view.height !== h) {
        view.width = w;
        view.height = h;
      }
      gl.viewport(0, 0, w, h);
    }

    function render() {
      gl.uniform2f(resLoc, view.width, view.height);
      gl.uniform1f(themeLoc, theme);
      gl.uniform1f(timeLoc, breatheTime);
      gl.uniform1f(activeLoc, activeLevel);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // One rAF loop advances both the theme crossfade and the activity breathe,
    // and parks itself the moment neither has anything left to animate so an
    // idle window costs nothing.
    function frame(now: number) {
      const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0;
      lastNow = now;

      if (themeAnimating) {
        const k = Math.min(1, (now - themeStart) / THEME_MS);
        theme = themeFrom + (themeTo - themeFrom) * easeInOut(k);
        if (k >= 1) {
          theme = themeTo;
          themeAnimating = false;
        }
      }

      activeLevel += (activeTarget - activeLevel) * Math.min(1, dt * 3);
      if (Math.abs(activeLevel - activeTarget) < 0.001) activeLevel = activeTarget;
      if (activeLevel > 0.001) breatheTime += dt;

      render();

      if (themeAnimating || activeLevel > 0.001) {
        raf = requestAnimationFrame(frame);
      } else {
        raf = 0;
        lastNow = 0;
      }
    }

    function kick() {
      if (!raf) {
        lastNow = 0;
        raf = requestAnimationFrame(frame);
      }
    }

    function transitionTo(next: 0 | 1) {
      if (reduceMotion) {
        theme = next;
        themeTo = next;
        themeAnimating = false;
        render();
        return;
      }
      themeFrom = theme;
      themeTo = next;
      themeStart = performance.now();
      themeAnimating = true;
      kick();
    }

    // Reduced motion keeps the aurora perfectly still: no breathing.
    function setActive(next: boolean) {
      if (reduceMotion) return;
      const t = next ? 1 : 0;
      if (t === activeTarget) return;
      activeTarget = t;
      kick();
    }

    setActiveRef.current = setActive;

    resize();
    render();

    const observer = new MutationObserver(() => {
      const next = themeTarget();
      if (next !== themeTo) transitionTo(next);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    const onResize = () => {
      resize();
      render();
    };
    window.addEventListener('resize', onResize);

    // Expose this canvas to the module-level HMR handler. On a shader edit it
    // recompiles the program against the live context and repaints the current
    // frame, so the background updates instantly without losing the GL context,
    // the theme crossfade, or any app state.
    const recompile = (mod: typeof import('./ambientScene')) => {
      if (buildProgram(mod.VERTEX_SHADER, mod.FRAGMENT_SHADER)) render();
    };
    if (import.meta.hot) activeRecompile = recompile;

    return () => {
      if (import.meta.hot && activeRecompile === recompile) activeRecompile = null;
      setActiveRef.current = () => {};
      observer.disconnect();
      window.removeEventListener('resize', onResize);
      if (raf) cancelAnimationFrame(raf);
      // Do NOT loseContext() here: the canvas element is reused across the
      // React.StrictMode dev double-mount. Destroying the context on the
      // first cleanup leaves the second mount with a dead context, so the
      // canvas never paints. The context is freed when the page unloads.
    };
    // Mount once: shader hot-reloads are handled by the module-level
    // import.meta.hot.accept handler (which swaps the GL program in place)
    // rather than by re-running this effect, so the context and animation
    // state survive an edit.
  }, []);

  // Drive the breathing without rebuilding the GL context: the mount effect
  // above publishes its activity setter, and this effect just nudges it as the
  // `active` prop flips.
  useEffect(() => {
    setActiveRef.current(active);
  }, [active]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 h-full w-full"
    />
  );
}
