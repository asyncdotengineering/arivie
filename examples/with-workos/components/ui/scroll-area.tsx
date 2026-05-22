/* SPDX-License-Identifier: Apache-2.0 */
import type { HTMLAttributes, ReactNode } from "react";

export function ScrollArea({
  children,
  className,
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return <div className={["scroll-area", className].filter(Boolean).join(" ")}>{children}</div>;
}

