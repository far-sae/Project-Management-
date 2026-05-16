import React from "react";
import { Badge } from "@/components/ui/badge";

interface Props { score: number; band: "hot" | "warm" | "cold"; }

export const ScoreBadge: React.FC<Props> = ({ score, band }) => (
  <Badge className={
    band === "hot"
      ? "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30"
      : band === "warm"
      ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30"
      : "bg-muted text-muted-foreground"
  }>
    Score {score} · {band}
  </Badge>
);
