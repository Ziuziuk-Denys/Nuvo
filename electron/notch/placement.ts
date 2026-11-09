export interface DisplayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function notchOrigin(display: DisplayBounds, windowWidth: number): { x: number; y: number } {
  return { x: Math.round(display.x + (display.width - windowWidth) / 2), y: display.y };
}

export function kwinScript(title: string, geometry: DisplayBounds): string {
  return `const geometry = ${JSON.stringify(geometry)};
function pin(window) {
  if (window.caption !== ${JSON.stringify(title)}) return;
  window.frameGeometry = { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height };
  window.keepAbove = true;
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
