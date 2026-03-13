import type { GameUIPlugin } from "../types";
import { SevenDaysConfigEditor } from "./ConfigEditor";

const plugin: GameUIPlugin = {
  id: "7dtd",
  metadata: {
    name: "7 Days to Die",
    logo: "game-logos/7daystodie.png",
  },
  ConfigEditor: SevenDaysConfigEditor,
};

export default plugin;
