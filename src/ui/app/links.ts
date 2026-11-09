import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { watchLinks, type DeeplinkTarget } from "../ports/app";
import { deliverShareLink, playTrackById } from "../ports/links";

export function linkPath(target: DeeplinkTarget): string | null {
  const id = encodeURIComponent(target.id);
  if (target.type === "artist") return `/artist?id=${id}`;
  if (target.type === "album") return `/collection?type=album&id=${id}`;
  if (target.type === "playlist") return `/collection?type=playlist&id=${id}`;
  return null;
}

export function useDeeplinks(): void {
  const navigate = useNavigate();
  useEffect(() => {
    return watchLinks((target) => {
      if (!target) return;
      if (target.type === "share") return deliverShareLink(target.id);
      if (target.type === "track") return void playTrackById(target.id);
      const path = linkPath(target);
      if (path) void navigate(path);
    });
  }, [navigate]);
}
