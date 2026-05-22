/* SPDX-License-Identifier: Apache-2.0 */
import { EventEmitter } from "node:events";
import { vi } from "vitest";
import type Dockerode from "dockerode";

export function createMockDockerode(stdoutByCmd?: (cmd: string[]) => string): {
  docker: Dockerode;
  exec: ReturnType<typeof vi.fn>;
} {
  const exec = vi.fn().mockImplementation(({ Cmd }: { Cmd: string[] }) => {
    const payload =
      stdoutByCmd?.(Cmd) ??
      (Cmd[0] === "cat"
        ? "file-content"
        : Cmd[0] === "find"
          ? "orders.yml f\ncustomers.yml f\n"
          : Cmd[0] === "stat"
            ? "12 1700000000 1700000000 regular file"
            : "");
    const stream = new EventEmitter();
    const start = vi.fn().mockImplementation(() => {
      setImmediate(() => {
        if (payload.length > 0) {
          stream.emit("data", Buffer.from(payload));
        }
        stream.emit("end");
      });
      return stream;
    });
    stream.write = vi.fn((_chunk: Buffer, cb?: (err?: Error) => void) => {
      setImmediate(() => {
        cb?.();
        stream.emit("end");
      });
    });
    stream.end = vi.fn(() => {
      setImmediate(() => stream.emit("end"));
    });
    return Promise.resolve({
      start,
      inspect: vi.fn().mockResolvedValue({ ExitCode: 0 }),
    });
  });

  const container = { exec };
  const docker = {
    getContainer: vi.fn().mockReturnValue(container),
  } as unknown as Dockerode;

  return { docker, exec };
}
