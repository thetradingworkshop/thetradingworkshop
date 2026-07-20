// Firestore documents cap out at ~1MiB. A pasted/dropped image is downscaled
// and re-encoded as JPEG before being embedded as a data URI, and rejected
// outright if it's still too big — there's no Firebase Storage bucket wired
// up for this app, so inline data URIs are the only option without adding
// that infrastructure just for journal images and trade attachments.
export const MAX_IMAGE_DIMENSION = 1200;
export const JPEG_QUALITY = 0.82;
export const MAX_DATA_URL_BYTES = 700_000;

export function processImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('That file is not an image.'));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const img = new window.Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
          const scale = MAX_IMAGE_DIMENSION / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not process that image.'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
        if (dataUrl.length > MAX_DATA_URL_BYTES) {
          reject(new Error('Image is too large even after compression — try a smaller screenshot.'));
          return;
        }
        resolve(dataUrl);
      };
      img.onerror = () => reject(new Error('Could not read that image.'));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}
