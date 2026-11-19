import type { Layout } from "../config";
import { gamingPcLayout as sharedGamingPc } from "../../web/shared/layout-presets";

/** The Gaming PC template. Defined once in web/shared/layout-presets.ts (the manage page uses the same module). */
export function gamingPcLayout(): Layout {
  return sharedGamingPc() as unknown as Layout;
}
