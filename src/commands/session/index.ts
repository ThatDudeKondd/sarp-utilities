import { defineCommand } from "../../utils/defineCommand.js";
import start from "./start.js";

export default defineCommand({
  name: "session",
  description: "Commands for session control",

  subcommands: [start],
});
