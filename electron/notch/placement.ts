export interface DisplayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function kwinScript(title: string, geometry: DisplayBounds, above: boolean): string {
  return `const geometry = ${JSON.stringify(geometry)};
function pin(window) {
  if (window.caption !== ${JSON.stringify(title)}) return;
  window.frameGeometry = { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height };
  window.keepAbove = ${above};
  window.onAllDesktops = true;
  window.skipTaskbar = true;
  window.skipPager = true;
  window.skipSwitcher = true;
  window.noBorder = true;
}
workspace.windowList().forEach(pin);
workspace.windowAdded.connect(pin);
`;
}
