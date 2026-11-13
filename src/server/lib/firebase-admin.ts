import fs from 'node:fs';
import path from 'node:path';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

function resolveProjectId(): string | undefined {
  if (process.env.FIREBASE_PROJECT_ID?.trim()) {
    return process.env.FIREBASE_PROJECT_ID.trim();
  }
  if (process.env.GOOGLE_CLOUD_PROJECT?.trim()) {
    return process.env.GOOGLE_CLOUD_PROJECT.trim();
  }
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { projectId?: string };
      return parsed.projectId?.trim() || undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

if (!getApps().length) {
  const projectId = resolveProjectId();
  initializeApp(projectId ? { projectId } : undefined);
}

export const adminAuth = getAuth();
