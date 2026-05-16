// src/pages/ClientsActivity.tsx
import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ActivityTimeline } from "@/components/clients/ActivityTimeline";
import { ActivityEventType } from "@/services/supabase/activityFeed";

const EVENT_OPTIONS: { value: ActivityEventType | "all"; label: string }[] = [
  { value: "all", label: "All events" },
  { value: "note", label: "Notes" },
  { value: "deal_stage", label: "Deal stage changes" },
  { value: "task", label: "Tasks" },
  { value: "form_submission", label: "Form submissions" },
];

export const ClientsActivity: React.FC = () => {
  const [eventFilter, setEventFilter] = useState<ActivityEventType | "all">("all");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  return (
    <main className="flex-1 min-w-0 overflow-y-auto p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-4">
        <h1 className="text-2xl md:text-3xl font-bold">Recent activity</h1>

        <Card>
          <CardContent className="pt-4 flex flex-wrap gap-3 items-end">
            <div>
              <Label>Event type</Label>
              <Select value={eventFilter} onValueChange={(v) => setEventFilter(v as ActivityEventType | "all")}>
                <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EVENT_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>From</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <Label>To</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <ActivityTimeline
              eventTypes={eventFilter === "all" ? undefined : [eventFilter]}
              fromDate={from ? new Date(from + "T00:00:00") : undefined}
              toDate={to ? new Date(to + "T23:59:59") : undefined}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
};

export default ClientsActivity;
