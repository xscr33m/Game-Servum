import type { GameUIPlugin } from "../types";
import { ArkConfigEditor } from "./ConfigEditor";

const plugin: GameUIPlugin = {
  id: "ark",
  metadata: {
    name: "ARK: Survival Evolved",
    logo: "game-logos/ark.png",
  },
  ConfigEditor: ArkConfigEditor,
};

export default plugin;
