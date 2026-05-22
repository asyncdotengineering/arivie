/* SPDX-License-Identifier: Apache-2.0 */
import type { HTMLAttributes, ReactNode } from "react";

export function Card({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div className={["card", className].filter(Boolean).join(" ")} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({
  children,
  className,
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return <div className={["card-header", className].filter(Boolean).join(" ")}>{children}</div>;
}

export function CardTitle({
  children,
  className,
}: HTMLAttributes<HTMLHeadingElement> & { children: ReactNode }) {
  return <h2 className={["card-title", className].filter(Boolean).join(" ")}>{children}</h2>;
}

export function CardContent({
  children,
  className,
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return <div className={["card-content", className].filter(Boolean).join(" ")}>{children}</div>;
}
