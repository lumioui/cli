#!/usr/bin/env node
import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { addCommand } from "./commands/add.js";
import { listCommand } from "./commands/list.js";
import { doctorCommand } from "./commands/doctor.js";
import { loginCommand, logoutCommand, whoamiCommand } from "./commands/login.js";
import { skillsCommand } from "./commands/skills.js";

const program = new Command()
  .name("lumioui")
  .description("LumioUI — the complete UI system for React Native")
  .version("0.4.1");

program.addCommand(initCommand);
program.addCommand(addCommand);
program.addCommand(listCommand);
program.addCommand(doctorCommand);
program.addCommand(loginCommand);
program.addCommand(logoutCommand);
program.addCommand(whoamiCommand);
program.addCommand(skillsCommand);

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
