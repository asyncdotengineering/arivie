/* SPDX-License-Identifier: Apache-2.0 */
import { defineCommand } from "citty";
import { addEntityCommand } from "./add-entity.js";
import { addSkillCommand } from "./add-skill.js";
import { addUiCommand } from "./add-ui.js";

export const addCommand = defineCommand({
  meta: {
    name: "add",
    description: "Add entity YAML, registry UI component, or skill playbook",
  },
  subCommands: {
    entity: addEntityCommand,
    skill: addSkillCommand,
    ui: addUiCommand,
  },
});
