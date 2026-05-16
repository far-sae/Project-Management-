// src/components/clients/ForecastTab.tsx
import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useForecast, ForecastPeriod } from "@/hooks/useForecast";
import { usePipelines } from "@/hooks/usePipelines";
import { formatDealMoney } from "@/services/supabase/deals";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid,
} from "recharts";

interface Props {
  displayCurrency: string;
}

export const ForecastTab: React.FC<Props> = ({ displayCurrency }) => {
  const { pipelines } = usePipelines();
  const [pipelineId, setPipelineId] = useState<string>("all");
  const [ownerId, setOwnerId] = useState<string>("all");
  const [period, setPeriod] = useState<ForecastPeriod>("quarter");

  const { loading, months, buckets, totals, byOwner } = useForecast({
    pipelineId: pipelineId === "all" ? null : pipelineId,
    ownerId: ownerId === "all" ? null : ownerId,
    period,
    displayCurrency,
  });

  const chartData = months.map((m) => ({
    month: m,
    Committed: Math.round(buckets[m]?.committed ?? 0),
    "Best case": Math.round(buckets[m]?.bestCase ?? 0),
    Pipeline: Math.round(buckets[m]?.pipeline ?? 0),
  }));

  const owners = Array.from(new Map(byOwner.map((o) => [o.ownerId, o.name])).entries());

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4 flex flex-wrap gap-3 items-end">
          <div>
            <Label>Pipeline</Label>
            <Select value={pipelineId} onValueChange={setPipelineId}>
              <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All pipelines</SelectItem>
                {pipelines.map((p) => (
                  <SelectItem key={p.pipelineId} value={p.pipelineId}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Owner</Label>
            <Select value={ownerId} onValueChange={setOwnerId}>
              <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All owners</SelectItem>
                {owners.map(([id, name]) => (
                  <SelectItem key={id} value={id}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Period</Label>
            <Select value={period} onValueChange={(v) => setPeriod(v as ForecastPeriod)}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="month">This month</SelectItem>
                <SelectItem value="quarter">This quarter</SelectItem>
                <SelectItem value="next_quarter">Next quarter</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-3 gap-3">
        {(["committed", "bestCase", "pipeline"] as const).map((k) => (
          <Card key={k}>
            <CardContent className="pt-4">
              <p className="text-xs uppercase text-muted-foreground tracking-wide">
                {k === "committed" ? "Committed" : k === "bestCase" ? "Best case" : "Pipeline"}
              </p>
              <p className="text-2xl font-bold">{formatDealMoney(totals[k], displayCurrency)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="pt-4 h-72">
          {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="Committed" stackId="a" fill="#10B981" />
                <Bar dataKey="Best case" stackId="a" fill="#3B82F6" />
                <Bar dataKey="Pipeline"  stackId="a" fill="#9CA3AF" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left p-1">Owner</th>
                <th className="text-right p-1">Committed</th>
                <th className="text-right p-1">Best case</th>
                <th className="text-right p-1">Pipeline</th>
              </tr>
            </thead>
            <tbody>
              {byOwner.map((o) => (
                <tr key={o.ownerId}>
                  <td className="p-1">{o.name}</td>
                  <td className="p-1 text-right">{formatDealMoney(o.committed, displayCurrency)}</td>
                  <td className="p-1 text-right">{formatDealMoney(o.bestCase, displayCurrency)}</td>
                  <td className="p-1 text-right">{formatDealMoney(o.pipeline, displayCurrency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
};
