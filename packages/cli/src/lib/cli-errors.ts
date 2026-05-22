/* SPDX-License-Identifier: Apache-2.0 */
import { ArivieConfigError } from "@arivie/core";
import { LoadError, ParseError } from "@arivie/semantic";

export function formatCliCommandError(command: string, err: unknown): string {
  if (err instanceof ArivieConfigError) {
    return `Arivie ${command} failed: ${err.message}`;
  }
  if (err instanceof ParseError || err instanceof LoadError) {
    return `Arivie ${command} failed: ${err.message}`;
  }
  if (err instanceof Error) {
    return `Arivie ${command} failed: ${err.message}`;
  }
  return `Arivie ${command} failed`;
}

export function printCliCommandError(command: string, err: unknown): void {
  console.error(formatCliCommandError(command, err));
}
