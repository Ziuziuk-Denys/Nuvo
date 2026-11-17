// The page streams encoded video in; the save path comes from the dialog and the temp file is main's own
import { randomUUID } from "node:crypto";
import { default as fs } from "node:fs";
import path from "node:path";
import { CHANNELS } from "./ipc";
import { type CoreAnswer, coreError } from "./coreCall";
import { documentName } from "./files";

export interface ClipExportDeps {
  call(method: string, route: string, body?: unknown): Promise<CoreAnswer>;
  pickSavePath(title: string, defaultPath: string): Promise<string | null>;
  videosDir(): string;
  tempDir(): string;
  refuse(channel: string, why: string): void;
}

interface Pending {
  video: string;
  audio: string | null;
  out: string;
}

export function createClipExport(deps: ClipExportDeps) {
  const pending = new Map<string, Pending>();
  const forget = async (id: string) => {
    const clip = pending.get(id);
    pending.delete(id);
    if (!clip) return;
    await fs.promises.rm(clip.video, { force: true });
    if (clip.audio) await fs.promises.rm(clip.audio, { force: true });
  };

  return {
    async begin(payload: unknown): Promise<{ id: string } | null> {
      const name = (payload as { name?: unknown } | null)?.name;
      if (typeof name !== "string") {
        deps.refuse(CHANNELS.visualClipBegin, "shape");
        return null;
      }
      const picked = await deps.pickSavePath("Save clip", path.join(deps.videosDir(), documentName(name, "mp4")));
      if (!picked) return null;
      const id = randomUUID();
      const video = path.join(deps.tempDir(), `nuvo-clip-${id}.h264`);
      await fs.promises.writeFile(video, new Uint8Array(), { mode: 0o600, flag: "wx" });
      pending.set(id, { video, audio: null, out: picked.endsWith(".mp4") ? picked : `${picked}.mp4` });
      return { id };
    },

    async write(payload: unknown): Promise<boolean> {
      const { id, bytes } = (payload ?? {}) as { id?: unknown; bytes?: unknown };
      const clip = typeof id === "string" ? pending.get(id) : undefined;
      if (!clip || !(bytes instanceof Uint8Array)) {
        deps.refuse(CHANNELS.visualClipWrite, "shape");
        return false;
      }
      await fs.promises.appendFile(clip.video, bytes);
      return true;
    },

    async audio(payload: unknown): Promise<boolean> {
      const { id, bytes } = (payload ?? {}) as { id?: unknown; bytes?: unknown };
      const clip = typeof id === "string" ? pending.get(id) : undefined;
      if (!clip || !(bytes instanceof Uint8Array)) {
        deps.refuse(CHANNELS.visualClipAudio, "shape");
        return false;
      }
      const audio = clip.video.replace(/\.h264$/, ".wav");
      await fs.promises.writeFile(audio, bytes, { mode: 0o600 });
      clip.audio = audio;
      return true;
    },

    async finish(payload: unknown): Promise<{ path: string } | { error: string } | null> {
      const { id, trackId, startMs, lenMs, fps, fadeMs = 0 } = (payload ?? {}) as Record<string, unknown>;
      const clip = typeof id === "string" ? pending.get(id) : undefined;
      if (!clip) return { error: "the clip was not started" };
      if (typeof trackId !== "string" || ![startMs, lenMs, fps, fadeMs].every((n) => Number.isInteger(n) && (n as number) >= 0)) {
        deps.refuse(CHANNELS.visualClipFinish, "shape");
        await forget(id as string);
        return null;
      }
      let answer: CoreAnswer | null = null;
      try {
        answer = await deps.call("POST", "/v1/fs/clips", {
          trackId,
          video: clip.video,
          audio: clip.audio ?? undefined,
          out: clip.out,
          startMs,
          lenMs,
          fps,
          fadeMs,
        });
      } catch {
        answer = null;
      } finally {
        await forget(id as string);
      }
      if (!answer) return { error: "nuvo-core is not running" };
      if (answer.status !== 200) return { error: coreError(answer) };
      return { path: clip.out };
    },

    async cancel(payload: unknown): Promise<void> {
      const id = (payload as { id?: unknown } | null)?.id;
      if (typeof id === "string") await forget(id);
    },
  };
}
