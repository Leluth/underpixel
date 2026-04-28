import pixelmatch from 'pixelmatch';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'pixel-diff') return false;

  handlePixelDiff(message.previous as string, message.current as string)
    .then((result) => sendResponse(result))
    .catch((err) => sendResponse({ error: String(err), diffRatio: 1.0, width: 0, height: 0 }));

  return true; // async response
});

async function handlePixelDiff(
  previousDataUrl: string,
  currentDataUrl: string,
): Promise<{ diffRatio: number; width: number; height: number }> {
  const [imgA, imgB] = await Promise.all([loadImage(previousDataUrl), loadImage(currentDataUrl)]);

  const width = Math.min(imgA.width, imgB.width);
  const height = Math.min(imgA.height, imgB.height);

  if (width === 0 || height === 0) {
    return { diffRatio: 1.0, width: 0, height: 0 };
  }

  const canvasA = document.getElementById('canvas-a') as HTMLCanvasElement;
  const canvasB = document.getElementById('canvas-b') as HTMLCanvasElement;
  canvasA.width = width;
  canvasA.height = height;
  canvasB.width = width;
  canvasB.height = height;

  const ctxA = canvasA.getContext('2d')!;
  const ctxB = canvasB.getContext('2d')!;
  ctxA.drawImage(imgA, 0, 0, width, height);
  ctxB.drawImage(imgB, 0, 0, width, height);

  const dataA = ctxA.getImageData(0, 0, width, height);
  const dataB = ctxB.getImageData(0, 0, width, height);

  const diffPixels = pixelmatch(dataA.data, dataB.data, null, width, height, {
    threshold: 0.1,
  });

  return { diffRatio: diffPixels / (width * height), width, height };
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataUrl;
  });
}
