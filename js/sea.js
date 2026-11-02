export function startSea(canvas) {
  const ctx = canvas.getContext("2d", { alpha: false });
  const stars = Array.from({ length: 70 }, () => ({
    x: Math.random(),
    y: Math.random() * 0.55,
    r: Math.random() * 1.3 + 0.3,
    a: Math.random() * 0.5 + 0.2,
  }));
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const tiny = window.matchMedia("(max-width: 700px)").matches;
  const bubbles = Array.from({ length: tiny ? 14 : 28 }, () => spawnBubble(true));
  const bursts = [];
  let running = true;
  let raf = 0;

  function spawnBubble(anyY) {
    return {
      x: Math.random(),
      y: anyY ? 0.45 + Math.random() * 0.6 : 1.05,
      r: Math.random() * 2.2 + 0.6,
      s: 0.015 + Math.random() * 0.03,
      a: Math.random() * 0.25 + 0.08,
    };
  }

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function wave(width, height, base, amp, length, speed, time, color, widthPx) {
    ctx.beginPath();
    for (let x = 0; x <= width; x += 10) {
      const y =
        base +
        Math.sin(x / length + time * speed) * amp +
        Math.sin(x / (length * 0.37) - time * speed * 0.7) * amp * 0.35;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = widthPx;
    ctx.stroke();
  }

  function frame(time) {
    if (!running) return;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const t = time * 0.001;
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, "#02060c");
    sky.addColorStop(0.35, "#071a28");
    sky.addColorStop(0.62, "#0a3a46");
    sky.addColorStop(1, "#041018");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    for (const star of stars) {
      ctx.globalAlpha = star.a * (0.75 + Math.sin(t * 1.5 + star.x * 20) * 0.25);
      ctx.fillStyle = "#f4fbff";
      ctx.beginPath();
      ctx.arc(star.x * width, star.y * height, star.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const moonX = width * 0.78;
    const moonY = height * 0.16;
    const glow = ctx.createRadialGradient(moonX, moonY, 10, moonX, moonY, Math.max(width, height) * 0.35);
    glow.addColorStop(0, "rgba(255, 236, 196, 0.45)");
    glow.addColorStop(0.25, "rgba(120, 190, 200, 0.08)");
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#f6e7c3";
    ctx.beginPath();
    ctx.arc(moonX, moonY, Math.max(18, width * 0.028), 0, Math.PI * 2);
    ctx.fill();

    const reflection = ctx.createLinearGradient(0, height * 0.42, 0, height);
    reflection.addColorStop(0, "rgba(246, 231, 195, 0.18)");
    reflection.addColorStop(1, "rgba(246, 231, 195, 0)");
    ctx.fillStyle = reflection;
    ctx.fillRect(moonX - 18, height * 0.42, 36, height * 0.4);

    wave(width, height, height * 0.46, 10, 90, 0.7, t, "rgba(170, 236, 226, 0.18)", 1.4);
    wave(width, height, height * 0.58, 16, 140, 0.45, t, "rgba(120, 200, 210, 0.16)", 1.6);
    wave(width, height, height * 0.72, 12, 70, 0.9, t, "rgba(232, 201, 138, 0.13)", 1.2);
    wave(width, height, height * 0.86, 18, 160, 0.35, t, "rgba(180, 240, 230, 0.1)", 2);

    for (const bubble of bubbles) {
      bubble.y -= bubble.s * (reduced ? 0 : 0.016);
      if (bubble.y < 0.4) Object.assign(bubble, spawnBubble(false));
      ctx.globalAlpha = bubble.a;
      ctx.strokeStyle = "rgba(210, 255, 246, 0.8)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(bubble.x * width, bubble.y * height, bubble.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    for (let i = bursts.length - 1; i >= 0; i -= 1) {
      const bit = bursts[i];
      bit.x += bit.vx;
      bit.y += bit.vy;
      bit.vy += 0.02;
      bit.life -= 0.012;
      if (bit.life <= 0) {
        bursts.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = Math.max(0, bit.life);
      ctx.fillStyle = bit.color;
      ctx.beginPath();
      ctx.arc(bit.x, bit.y, bit.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (!reduced) raf = requestAnimationFrame(frame);
  }

  function burst(x, y) {
    const originX = x ?? window.innerWidth * 0.5;
    const originY = y ?? window.innerHeight * 0.35;
    for (let i = 0; i < 48; i += 1) {
      const angle = (Math.PI * 2 * i) / 48 + Math.random() * 0.2;
      const speed = 1.2 + Math.random() * 3.4;
      bursts.push({
        x: originX,
        y: originY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.4,
        r: Math.random() * 2.4 + 1,
        life: 1,
        color: i % 3 === 0 ? "#f0d59a" : i % 3 === 1 ? "#fff7e8" : "#7dffe8",
      });
    }
    if (reduced) frame(performance.now());
  }

  resize();
  frame(performance.now());
  window.addEventListener("resize", () => {
    resize();
    if (reduced) frame(performance.now());
  });

  return {
    burst,
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
  };
}
