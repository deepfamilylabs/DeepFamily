// Refined DeepFamily mark — three converging strokes forming a forward arrow.
// Geometry mirrors public/logo.svg and the Logo React component (viewBox 0 0 128 128).
const GRAD_FROM = "#F8843E";
const GRAD_TO = "#F04E33";
const INK = "#1C1916";
const HAIR = "#ECE4DB"; // paper tile hairline border
const PREVIEW_SIZE = 256; // fixed crisp preview resolution, independent of export size
const RADIUS_RATIO = 0.225; // rounded-square corner radius / size
const MARK_RATIO = 0.62; // mark size / tile size on a filled icon
const MARK_RATIO_BARE = 0.86; // mark size / canvas on the transparent variant

const STYLE_LABEL = {
  grad: "white-on-gradient",
  paper: "gradient-on-paper",
  ink: "gradient-on-ink",
  transparent: "mark",
};

const markSvg = (stroke) => {
  const strokeAttr = stroke === "gradient" ? "url(#g)" : stroke;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="g" x1="14" y1="14" x2="114" y2="114" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${GRAD_FROM}"/>
      <stop offset="1" stop-color="${GRAD_TO}"/>
    </linearGradient>
  </defs>
  <g fill="none" stroke="${strokeAttr}" stroke-width="14" stroke-linecap="round" stroke-linejoin="round">
    <path d="M16 64 H116"/>
    <path d="M16 24 H66 Q88 24 102 58"/>
    <path d="M16 104 H66 Q88 104 102 70"/>
  </g>
</svg>`;
};

const loadImage = (svg) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });

const roundRectPath = (ctx, size, radius, inset = 0) => {
  const min = inset;
  const span = size - inset * 2;
  const r = Math.max(0, radius - inset);
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(min, min, span, span, r);
    return;
  }
  const max = min + span;
  ctx.moveTo(min + r, min);
  ctx.lineTo(max - r, min);
  ctx.quadraticCurveTo(max, min, max, min + r);
  ctx.lineTo(max, max - r);
  ctx.quadraticCurveTo(max, max, max - r, max);
  ctx.lineTo(min + r, max);
  ctx.quadraticCurveTo(min, max, min, max - r);
  ctx.lineTo(min, min + r);
  ctx.quadraticCurveTo(min, min, min + r, min);
  ctx.closePath();
};

const getSize = () => Number.parseInt(document.getElementById("sizeSelect")?.value ?? "180", 10);

const renderStyle = async (canvas, style, size) => {
  const ctx = canvas?.getContext?.("2d");
  if (!ctx) return;

  canvas.width = size;
  canvas.height = size;
  ctx.clearRect(0, 0, size, size);

  if (style !== "transparent") {
    roundRectPath(ctx, size, size * RADIUS_RATIO);
    if (style === "grad") {
      const grad = ctx.createLinearGradient(0, 0, size, size);
      grad.addColorStop(0, GRAD_FROM);
      grad.addColorStop(1, GRAD_TO);
      ctx.fillStyle = grad;
    } else if (style === "paper") {
      ctx.fillStyle = "#FFFFFF";
    } else {
      ctx.fillStyle = INK;
    }
    ctx.fill();

    if (style === "paper") {
      // Hairline border so the white tile reads against a white page.
      // Inset by half the line width so the stroke stays inside the canvas.
      const lineWidth = Math.max(1, size / 120);
      const inset = lineWidth / 2;
      roundRectPath(ctx, size, size * RADIUS_RATIO, inset);
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = HAIR;
      ctx.stroke();
    }
  }

  const stroke = style === "grad" ? "#FFFFFF" : "gradient";
  const img = await loadImage(markSvg(stroke));
  const ratio = style === "transparent" ? MARK_RATIO_BARE : MARK_RATIO;
  const drawSize = size * ratio;
  const offset = (size - drawSize) / 2;
  ctx.drawImage(img, offset, offset, drawSize, drawSize);
};

// Previews always render at PREVIEW_SIZE so they stay crisp; the size selector
// only controls the resolution of the downloaded PNG.
const renderPreviews = () => {
  document.querySelectorAll("canvas[data-style]").forEach((canvas) => {
    renderStyle(canvas, canvas.dataset.style, PREVIEW_SIZE);
  });
};

const download = async (style) => {
  const size = getSize();
  const canvas = document.createElement("canvas");
  await renderStyle(canvas, style, size);
  if (!canvas.toDataURL) return;
  const link = document.createElement("a");
  link.download = `deepfamily-${STYLE_LABEL[style]}-${size}x${size}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
};

window.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("button[data-download]").forEach((button) => {
    button.addEventListener("click", () => download(button.dataset.download));
  });

  renderPreviews();
});
