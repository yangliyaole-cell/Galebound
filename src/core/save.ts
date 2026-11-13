const KEY = 'galebound.save.v1';

export interface SaveData {
  orbs: string[];
  pos: [number, number, number] | null;
  yaw: number;
  muted: boolean;
}

const blank: SaveData = { orbs: [], pos: null, yaw: Math.PI, muted: false };

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...blank, ...(JSON.parse(raw) as Partial<SaveData>) };
  } catch {
    // Missing or unreadable storage just means a fresh start.
  }
  return { ...blank };
}

export function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Progress simply won't persist, e.g. in a private window.
  }
}
