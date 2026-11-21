import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useToastStore } from "../../feedback/toastStore";
import { useTranslation } from "../../ports/i18n";
import { addMusicFiles } from "../../ports/localFiles";
import { navigateWithTransition } from "../../shell/navigate";

export const LOCAL_TAB = "/library?tab=local";

export const isMusicFile = (name: string): boolean => /\.(mp3|flac|m4a|aac|ogg|oga|opus|wav)$/i.test(name);

export function useAddMusic(): (files?: File[]) => Promise<void> {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return useCallback(
    async (files?: File[]) => {
      const result = await addMusicFiles(files);
      if (!result) return;
      const toast = useToastStore.getState();
      if ("error" in result) {
        toast.show({ message: t("ui.local.add_failed"), description: result.error, variant: "error" });
        return;
      }
      toast.show({
        message: t("ui.local.added"),
        variant: "success",
        action: { label: t("ui.local.open"), onClick: () => navigateWithTransition(navigate, LOCAL_TAB) },
      });
    },
    [t, navigate],
  );
}
