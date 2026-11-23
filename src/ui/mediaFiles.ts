export const MEDIA_TYPES = "image/png,image/jpeg,image/webp,image/avif,image/gif,video/mp4,video/webm";

export const MEDIA_REFUSALS = {
  too_large: "settings.customization.file_too_large",
  empty: "settings.customization.invalid_file_type",
  format: "settings.customization.invalid_file_type",
  read: "settings.customization.read_error",
  write: "settings.customization.save_error",
  undecodable: "settings.customization.media_error",
} as const;
