import type { JSX } from "react";
import { useNavigate } from "react-router-dom";
import type { Track } from "../ports/player";
import styles from "./ArtistLinks.module.css";
import { navigateWithTransition } from "./navigate";

export function AlbumLink({ album }: { album: NonNullable<Track["album"]> }): JSX.Element {
  const navigate = useNavigate();
  const open = () => navigateWithTransition(navigate, `/collection?type=album&id=${encodeURIComponent(album.id)}`);
  if (!album.id) return <>{album.title}</>;
  return (
    <span
      role="link"
      tabIndex={-1}
      className={styles.link}
      data-no-window-drag
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        open();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.stopPropagation();
        open();
      }}
    >
      {album.title}
    </span>
  );
}
