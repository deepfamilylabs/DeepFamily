const getNumberValue = (id) => {
  const value = document.getElementById(id)?.value ?? "0";
  return Number.parseInt(String(value), 10);
};

const render = () => {
  const size = getNumberValue("sizeSelect");
  const bgShape = document.getElementById("bgShape")?.value ?? "none";
  const bgColor = document.getElementById("bgColor")?.value ?? "#ffffff";
  const logoScale = getNumberValue("logoScale");
  const panX = getNumberValue("panX");
  const panY = getNumberValue("panY");
  const swapColors = Boolean(document.getElementById("swapColors")?.checked);

  const scaleValue = document.getElementById("scaleValue");
  if (scaleValue) {
    scaleValue.innerText = `${logoScale}%`;
  }

  const hasBackground = bgShape !== "none";
  const setDisplay = (id, display) => {
    const element = document.getElementById(id);
    if (element) {
      element.style.display = display;
    }
  };

  setDisplay("bgColorGroup", hasBackground ? "flex" : "none");
  setDisplay("swapGroup", hasBackground ? "flex" : "none");
  setDisplay("scaleGroup", hasBackground ? "flex" : "none");
  setDisplay("panGroupX", hasBackground ? "flex" : "none");
  setDisplay("panGroupY", hasBackground ? "flex" : "none");

  const colorLabel = document.getElementById("colorLabel");
  if (colorLabel) {
    colorLabel.innerText = swapColors ? "Logo Color:" : "BG Color:";
  }

  const canvas = document.getElementById("canvas");
  const svgElement = document.getElementById("source-svg");
  if (!canvas || !svgElement || !canvas.getContext) {
    return;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  canvas.width = size;
  canvas.height = size;
  ctx.clearRect(0, 0, size, size);

  if (hasBackground) {
    if (swapColors) {
      const grad = ctx.createLinearGradient(0, 0, size, size);
      grad.addColorStop(0, "#fb923c");
      grad.addColorStop(1, "#ef4444");
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = bgColor;
    }

    ctx.beginPath();
    if (bgShape === "circle") {
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    } else if (bgShape === "square") {
      const radius = size * 0.2;
      if (ctx.roundRect) {
        ctx.roundRect(0, 0, size, size, radius);
      } else {
        const max = size - radius;
        ctx.moveTo(radius, 0);
        ctx.lineTo(max, 0);
        ctx.quadraticCurveTo(size, 0, size, radius);
        ctx.lineTo(size, max);
        ctx.quadraticCurveTo(size, size, max, size);
        ctx.lineTo(radius, size);
        ctx.quadraticCurveTo(0, size, 0, max);
        ctx.lineTo(0, radius);
        ctx.quadraticCurveTo(0, 0, radius, 0);
        ctx.closePath();
      }
    }
    ctx.fill();
  }

  let svgData = new XMLSerializer().serializeToString(svgElement);
  if (hasBackground && swapColors) {
    svgData = svgData.replace(
      /fill="none" stroke="url\(#brand-gradient\)"/g,
      `fill="none" stroke="${bgColor}"`
    );
    svgData = svgData.replace(/stroke="url\(#brand-gradient\)"/g, `stroke="${bgColor}"`);
  }

  const blob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const img = new Image();
  img.onload = () => {
    let drawSize = size;
    if (hasBackground) {
      drawSize = size * (logoScale / 100);
    }

    const baseOffset = (size - drawSize) / 2;
    const offsetX = baseOffset + size * (panX / 100);
    const offsetY = baseOffset + size * (panY / 100);

    ctx.drawImage(img, offsetX, offsetY, drawSize, drawSize);
    URL.revokeObjectURL(url);
  };
  img.src = url;
};

const downloadPNG = () => {
  const canvas = document.getElementById("canvas");
  if (!canvas || !canvas.toDataURL) {
    return;
  }

  const link = document.createElement("a");
  link.download = `deepfamily-logo-${canvas.width}x${canvas.height}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
};

window.addEventListener("DOMContentLoaded", () => {
  const renderIds = [
    "sizeSelect",
    "bgShape",
    "bgColor",
    "logoScale",
    "panX",
    "panY",
    "swapColors",
  ];

  renderIds.forEach((id) => {
    const element = document.getElementById(id);
    if (!element) return;

    element.addEventListener("change", render);
    element.addEventListener("input", render);
  });

  const downloadButton = document.getElementById("downloadButton");
  if (downloadButton) {
    downloadButton.addEventListener("click", downloadPNG);
  }

  render();
});
