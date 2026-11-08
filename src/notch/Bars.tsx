export function Bars({ playing, color }: { playing: boolean; color: string }) {
  return (
    <span className="bars" data-playing={playing} style={{ color }} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}
