#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
import { runCli } from "../src/cli.js";

const code = await runCli(process.argv.slice(2));
process.exit(code);
