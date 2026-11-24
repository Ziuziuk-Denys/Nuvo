import { useEffect, type RefObject } from "react";
import type { Box } from "./scene";

export type Room = "page" | "karaoke" | "studio";

export interface LightObject extends Box {
  radius: number;
  lift: number;
  hero?: boolean;
}

export type ObjectSource = () => readonly LightObject[];

interface RoomState {
  sources: Set<ObjectSource>;
  watchers: Set<() => void>;
}

const rooms: Record<Room, RoomState> = {
  page: { sources: new Set(), watchers: new Set() },
  karaoke: { sources: new Set(), watchers: new Set() },
  studio: { sources: new Set(), watchers: new Set() },
};

export function lightMoved(room: Room = "page"): void {
  for (const watcher of rooms[room].watchers) watcher();
}

export function addLightObjects(source: ObjectSource, room: Room = "page"): () => void {
  rooms[room].sources.add(source);
  lightMoved(room);
  return () => {
    rooms[room].sources.delete(source);
    lightMoved(room);
  };
}

export function lightObjects(room: Room): LightObject[] {
  return [...rooms[room].sources].flatMap((source) => source());
}

export function watchLightObjects(room: Room, watcher: () => void): () => void {
  rooms[room].watchers.add(watcher);
  return () => rooms[room].watchers.delete(watcher);
}

export interface LightObjectOptions {
  radius?: number;
  lift?: number;
  hero?: boolean;
  room?: Room;
}

export function useLightObject(ref: RefObject<HTMLElement | null>, options: LightObjectOptions = {}): void {
  const { radius = 12, lift = 18, hero = false, room = "page" } = options;
  useEffect(() => {
    return addLightObjects(() => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return [];
      return [{ x: rect.x, y: rect.y, width: rect.width, height: rect.height, radius, lift, hero }];
    }, room);
  }, [ref, radius, lift, hero, room]);
}
