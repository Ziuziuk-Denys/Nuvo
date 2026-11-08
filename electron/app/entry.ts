/** Vite's main entry. The YouTube worker service comes from its own module. */
import { startYoutubeService } from "../youtube/service";
import { runMain } from "./main";

runMain(startYoutubeService);
