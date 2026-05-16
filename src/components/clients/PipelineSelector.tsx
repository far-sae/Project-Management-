import React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Pipeline } from "@/services/supabase/pipelines";

interface Props {
  pipelines: Pipeline[];
  value: string;
  onChange: (id: string) => void;
}

export const PipelineSelector: React.FC<Props> = ({ pipelines, value, onChange }) => (
  <Select value={value} onValueChange={onChange}>
    <SelectTrigger className="w-[220px]">
      <SelectValue placeholder="Select pipeline" />
    </SelectTrigger>
    <SelectContent>
      {pipelines.map((p) => (
        <SelectItem key={p.pipelineId} value={p.pipelineId}>
          {p.name}
          {p.isDefault && " · default"}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);

export default PipelineSelector;
