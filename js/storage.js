// localStorage persistence for jobs. Each job:
// { id, name, unit, walls: [...], updatedAt }

const INDEX_KEY = 'siteMeasure.jobIndex';
const JOB_KEY_PREFIX = 'siteMeasure.job.';

function jobKey(id) {
  return JOB_KEY_PREFIX + id;
}

export function listJobs() {
  const raw = localStorage.getItem(INDEX_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveIndex(index) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

export function saveJob(job) {
  job.updatedAt = new Date().toISOString();
  localStorage.setItem(jobKey(job.id), JSON.stringify(job));
  const index = listJobs();
  const entry = { id: job.id, name: job.name, updatedAt: job.updatedAt };
  const existing = index.findIndex((j) => j.id === job.id);
  if (existing >= 0) {
    index[existing] = entry;
  } else {
    index.push(entry);
  }
  saveIndex(index);
}

export function loadJob(id) {
  const raw = localStorage.getItem(jobKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function deleteJob(id) {
  localStorage.removeItem(jobKey(id));
  saveIndex(listJobs().filter((j) => j.id !== id));
}

export function newJobId() {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
