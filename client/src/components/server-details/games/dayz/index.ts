import type { GameUIPlugin } from "../types";
import { DayZConfigEditor } from "./ConfigEditor";

const plugin: GameUIPlugin = {
  id: "dayz",
  metadata: {
    name: "DayZ",
    logo: "game-logos/dayz.png",
  },
  ConfigEditor: DayZConfigEditor,
};

export default plugin;
