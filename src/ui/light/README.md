# Cover light

One WebGL2 context lights every screen from the cover in front of it. A still screen draws nothing.

## Lighting a page

```ts
usePageBackdrop(cover, { scene?: "room" | "page" | "wall"; pinned?: boolean; banner?: string; portrait?: string }): void
useCalmLight(): void
```

`room` is a hero under its own lamp, `page` a header cover, `wall` a quiet lamp without an object. The default is `page`. `pinned` keeps the light in place while the page scrolls.

## Objects that cast a shadow

```ts
useLightObject(ref, { radius?: number; lift?: number; hero?: boolean; room?: Room }): void
addLightObjects(source: () => LightObject[], room?): () => void
lightMoved(room?): void
```

`hero` is where the lamp points. Call `lightMoved` in the frame that moves an object. Up to 24 objects per room.

## A cover as an object

```ts
<CoverObject src={string} size={number} radius?={number} alt?={string} className?={string} />
```

For the one cover that matters on a screen.

## Colour

```ts
useCoverLight(cover: string | undefined): CoverLight | null
readLight(pixels: Uint8ClampedArray): CoverLight
lightVars(light: CoverLight): Record<string, string>
cssColour(colour: Vec3): string
interface CoverLight { key: Vec3; rim: Vec3; from: readonly [x: number, y: number]; cells: readonly number[] }
```

Custom properties on `:root`: `--n-lamp`, `--n-lamp-rim`, `--n-light-x` (1 is light from the left), `--n-light-y` (1 is light from the top).
