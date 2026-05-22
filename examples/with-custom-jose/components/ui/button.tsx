/* SPDX-License-Identifier: Apache-2.0 */
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Button({
  children,
  className,
  size,
  variant,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  size?: "icon" | "sm";
  variant?: "outline";
}) {
  const classes = ["btn", size === "icon" ? "btn-icon" : "", className]
    .filter(Boolean)
    .join(" ");
  return (
    <button type="button" className={classes} {...props}>
      {children}
    </button>
  );
}
