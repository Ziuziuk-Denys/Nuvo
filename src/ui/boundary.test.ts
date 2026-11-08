import { default as fs } from "node:fs";
import { default as path } from "node:path";
import { expect, it, describe } from "vitest";

const UI_DIR = path.resolve(__dirname);
const SRC_DIR = path.resolve(UI_DIR, "..");
const importPattern = /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

/** Packages the UI layer may use directly. Everything app-specific comes through ports. */
const PACKAGES = new Set([
  "react",
  "react-dom",
  "react/jsx-runtime",
  "framer-motion",
  "react-router-dom",
  "zustand",
  "@tanstack/react-virtual",
  "@braccato/core",
]);
/** The interim icon set lives behind src/ui/icons only, so the icon sub-project swaps one folder. */
const ICON_PACKAGES = new Set(["@mingcute/react"]);
/** Packages a port may wrap so screens never import them: useLook reads next-themes. */
const PORT_PACKAGES = new Set(["next-themes"]);
const LEGACY_UI = [/^@\/features\/[^/]+\/ui(\/|$)/, /^@\/shared\/ui(\/|$)/, /^@\/widgets(\/|$)/];

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function imports(file: string): string[] {
  return [...fs.readFileSync(file, "utf8").matchAll(importPattern)].map((m) => m[1] ?? m[2]);
}

function inside(dir: string, file: string): boolean {
  const rel = path.relative(dir, file);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** Returns why `spec` imported from `file` breaks the boundary, or null when it is allowed. */
function boundaryViolation(file: string, spec: string): string | null {
  const area = path.relative(UI_DIR, file).split(path.sep)[0];
  if (spec.startsWith(".")) {
    const target = path.resolve(path.dirname(file), spec);
    return inside(UI_DIR, target) ? null : "relative import leaves src/ui";
  }
  if (spec.startsWith("@/ui/")) return null;
  if (spec.startsWith("@/")) {
    if (area !== "ports") return "only src/ui/ports may import app code";
    if (LEGACY_UI.some((re) => re.test(spec))) return "legacy UI";
    return null;
  }
  const pkg = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
  if (ICON_PACKAGES.has(pkg)) return area === "icons" ? null : "icon packages only inside src/ui/icons";
  if (PORT_PACKAGES.has(pkg)) return area === "ports" ? null : "only src/ui/ports may wrap this package";
  if (PACKAGES.has(spec) || PACKAGES.has(pkg)) return null;
  return `package ${pkg} is not on the src/ui allow-list`;
}

describe("src/ui boundary", () => {
  it("imports only src/ui, ports and allowed packages", () => {
    const offenders = sourceFiles(UI_DIR).flatMap((file) =>
      imports(file)
        .map((spec) => [spec, boundaryViolation(file, spec)] as const)
        .filter(([, why]) => why !== null)
        .map(([spec, why]) => `${path.relative(SRC_DIR, file)} -> ${spec}: ${why}`),
    );
    expect(offenders).toEqual([]);
  });

  it("rejects the imports it is meant to catch", () => {
    const screen = path.join(UI_DIR, "screens", "home", "Home.tsx");
    const port = path.join(UI_DIR, "ports", "player.ts");
    const icons = path.join(UI_DIR, "icons", "index.tsx");
    expect(boundaryViolation(screen, "@/features/player")).not.toBeNull();
    expect(boundaryViolation(screen, "../../../features/player")).not.toBeNull();
    expect(boundaryViolation(screen, "../../ports/player")).toBeNull();
    expect(boundaryViolation(screen, "@/ui/components/Button")).toBeNull();
    expect(boundaryViolation(screen, "@mingcute/react")).not.toBeNull();
    expect(boundaryViolation(icons, "@mingcute/react")).toBeNull();
    expect(boundaryViolation(screen, "@solar-icons/react")).not.toBeNull();
    expect(boundaryViolation(screen, "tailwind-merge")).not.toBeNull();
    expect(boundaryViolation(screen, "react")).toBeNull();
    expect(boundaryViolation(port, "@/features/player")).toBeNull();
    expect(boundaryViolation(port, "@/features/home/ui/HomePage")).not.toBeNull();
    expect(boundaryViolation(port, "@/shared/ui")).not.toBeNull();
    expect(boundaryViolation(port, "@/features/player/ui/FullscreenPlayer")).not.toBeNull();
    expect(boundaryViolation(port, "@/features/player/ui/MiniPlayer")).not.toBeNull();
    expect(boundaryViolation(port, "next-themes")).toBeNull();
    expect(boundaryViolation(screen, "next-themes")).not.toBeNull();
  });

  it("finds the ui sources", () => {
    expect(sourceFiles(UI_DIR).some((file) => file.endsWith(path.join("ports", "color.ts")))).toBe(true);
  });
});
