/* SPDX-License-Identifier: Apache-2.0 */
"use client";

import { useSchema } from "@arivie/react";
import { Badge } from "@/components/ui/badge";

export interface OwnerContextBadgeProps {
  endpoint?: string;
  className?: string;
}

export function OwnerContextBadge({
  endpoint = "/api/arivie/schema",
  className,
}: OwnerContextBadgeProps) {
  const { owner, status } = useSchema({ endpoint });

  if (status === "loading") {
    return (
      <Badge variant="outline" className={className}>
        Loading owner…
      </Badge>
    );
  }

  if (status === "error" || !owner) {
    return (
      <Badge variant="destructive" className={className}>
        Owner unknown
      </Badge>
    );
  }

  return (
    <Badge variant="secondary" className={className} title={owner.id}>
      {owner.name}
    </Badge>
  );
}
