import type { ElectronApplication } from "playwright-core";

export async function diffRatio(app: ElectronApplication, a: string, b: string, channelTolerance = 16): Promise<number> {
  return app.evaluate(
    ({ nativeImage }, [pathA, pathB, tolerance]) => {
      const first = nativeImage.createFromPath(pathA as string);
      const second = nativeImage.createFromPath(pathB as string);
      const sizeA = first.getSize();
      const sizeB = second.getSize();
      if (sizeA.width !== sizeB.width || sizeA.height !== sizeB.height) return 1;
      const bitmapA = first.toBitmap();
      const bitmapB = second.toBitmap();
      const pixels = sizeA.width * sizeA.height;
      if (pixels === 0 || bitmapA.length !== bitmapB.length) return 1;
      let different = 0;
      for (let i = 0; i < bitmapA.length; i += 4) {
        const delta = Math.max(Math.abs(bitmapA[i] - bitmapB[i]), Math.abs(bitmapA[i + 1] - bitmapB[i + 1]), Math.abs(bitmapA[i + 2] - bitmapB[i + 2]));
        if (delta > (tolerance as number)) different += 1;
      }
      return different / pixels;
    },
    [a, b, channelTolerance] as [string, string, number],
  );
}
