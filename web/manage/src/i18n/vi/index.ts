import { VI_APP } from "./app";
import { VI_EDITOR } from "./editor";
import { VI_PALETTE } from "./palette";
import { VI_SCREENS } from "./screens";
import { VI_AUTOMATION } from "./automation";
import { VI_GAMING } from "./gaming";

/** English text -> Vietnamese. One file per area so they can be edited independently. */
export const VI: Record<string, string> = { ...VI_APP, ...VI_EDITOR, ...VI_PALETTE, ...VI_SCREENS, ...VI_AUTOMATION, ...VI_GAMING };
