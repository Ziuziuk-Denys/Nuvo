import type { JSX } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Album } from "../screens/entity/Album";
import { Artist } from "../screens/entity/Artist";
import { Playlist } from "../screens/entity/Playlist";
import { Home } from "../screens/home/Home";
import { Library } from "../screens/library/Library";
import { Recognize } from "../screens/recognize/Recognize";
import { Search } from "../screens/search/Search";
import { Specimen } from "../screens/specimen/Specimen";
import { Stats } from "../screens/stats/Stats";
import { History } from "../screens/stats/History";
import { StatsArtist, StatsTrack } from "../screens/stats/StatsDetail";

export function AppRoutes(): JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/search" element={<Search />} />
      <Route path="/recognize" element={<Recognize />} />
      <Route path="/library" element={<Library />} />
      <Route path="/library/playlist" element={<Playlist />} />
      <Route path="/collection" element={<Album />} />
      <Route path="/artist" element={<Artist />} />
      <Route path="/stats" element={<Stats />} />
      <Route path="/stats/track" element={<StatsTrack />} />
      <Route path="/stats/artist" element={<StatsArtist />} />
      <Route path="/stats/history" element={<History />} />
      <Route path="/settings" element={<Navigate to="/" replace />} />
      <Route path="/player" element={null} />
      <Route path="/specimen" element={<Specimen />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
