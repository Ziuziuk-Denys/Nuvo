/** The storage every Nuvo settings store persists through: writes are batched and flushed each second and on unload. */
export { debouncedStorage as settingsStorage } from "@/data/platform/debouncedStorage";
