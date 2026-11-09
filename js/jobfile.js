// Saving a job (with its photos) to a file, to back it up or send it to the
// office, and opening such a file on any phone or computer.

import * as photos from './photos.js';

const FORMAT = 'site-measure-job';

const safeName = (name) => (name || 'Site measure').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Site measure';

// Offer a file through the phone's share sheet (Drive, email, Teams…) where
// it has one, else download it. Returns 'shared', 'downloaded' or 'cancelled'.
export async function shareOrDownload(blob, filename, title) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled';
      // fall through to a download if sharing isn't allowed here
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'downloaded';
}

export async function jobFileBlob(job) {
  const pictures = {};
  await Promise.all(photos.jobPhotos(job.rooms).map(async ({ photo }) => {
    const blob = await photos.getPhoto(photo.id).catch(() => null);
    if (blob) pictures[photo.id] = await photos.blobToDataUrl(blob);
  }));
  const data = { format: FORMAT, version: 1, savedAt: new Date().toISOString(), job, photos: pictures };
  return new Blob([JSON.stringify(data)], { type: 'application/json' });
}

export function jobFileName(job) {
  const date = new Date().toISOString().slice(0, 10);
  return `${safeName(job.name)} ${date}.sitemeasure.json`;
}

// Reads a job file; stores its photos and returns the job. Throws with a
// message for the user if it isn't one.
export async function readJobFile(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error("That file isn't a Site Measure job file.");
  }
  if (!data || data.format !== FORMAT || !data.job || !Array.isArray(data.job.rooms)) {
    throw new Error("That file isn't a Site Measure job file.");
  }
  await Promise.all(Object.entries(data.photos || {}).map(async ([id, url]) => {
    await photos.putPhoto(id, await photos.dataUrlToBlob(url));
  }));
  return data.job;
}
