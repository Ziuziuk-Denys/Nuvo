import { useEffect, useState } from "react";
import { CORE_BASE_URL } from "@/engine/boot";
import { kickDownloads } from "@/engine/index";
import { createLocalClient, downloadProgress } from "@/local/client";
import type { SaveDocumentRequest, SaveFilesRequest } from "@/shell/nuvoShell";

export type { SaveDocumentRequest, SaveFilesRequest };

const client = createLocalClient(CORE_BASE_URL);
const POLL_MS = 1000;
const ERROR_MS = 6000;
const started = new Set<() => void>();
let lastError: { text: string; at: number } | null = null;

function poke(): void {
  started.forEach((listener) => listener());
}

function remember(error: string | null): string | null {
  if (error) {
    lastError = { text: error, at: Date.now() };
    poke();
  }
  return error;
}

export type SaveFormat = SaveFilesRequest["format"];
const FORMAT_KEY = "nuvo.saveFormat";

export function saveFormat(): SaveFormat {
  try {
    return localStorage.getItem(FORMAT_KEY) === "mp3" ? "mp3" : "original";
  } catch {
    return "original";
  }
}

export function setSaveFormat(format: SaveFormat): void {
  try {
    localStorage.setItem(FORMAT_KEY, format);
  } catch {
    // private storage off: saves stay in the original format
  }
}

export async function saveAsFiles(request: Omit<SaveFilesRequest, "format">): Promise<string | null> {
  const result = await window.nuvoShell?.saveAsFiles({ ...request, format: saveFormat() });
  if (result && "error" in result) return remember(result.error);
  if (result) {
    kickDownloads();
    poke();
  }
  return null;
}

export async function exportDocument(request: SaveDocumentRequest): Promise<string | null> {
  const result = await window.nuvoShell?.saveDocument(request);
  return remember(result && "error" in result ? result.error : null);
}

export async function cancelSaves(): Promise<void> {
  const jobs = await client.downloads();
  await Promise.all(jobs.filter((job) => job.status === "running").map((job) => client.cancelDownload(job.id)));
  poke();
}

export interface DownloadState {
  done: number;
  total: number;
  error: string | null;
}

export function useDownloadProgress(): DownloadState | null {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const restart = () => setTick((n) => n + 1);
    started.add(restart);
    return () => void started.delete(restart);
  }, []);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = () =>
      client.downloads().then(
        (jobs) => {
          if (!live) return;
          const next = downloadProgress(jobs);
          setProgress(next);
          if (next) timer = setTimeout(read, POLL_MS);
        },
        () => undefined,
      );
    void read();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [tick]);
  const errorAt = lastError?.at ?? 0;
  const error = lastError && Date.now() - errorAt < ERROR_MS ? lastError.text : null;
  useEffect(() => {
    if (!errorAt) return;
    const timer = setTimeout(() => setTick((n) => n + 1), Math.max(0, errorAt + ERROR_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [errorAt]);
  if (!progress && !error) return null;
  return { done: progress?.done ?? 0, total: progress?.total ?? 0, error };
}
