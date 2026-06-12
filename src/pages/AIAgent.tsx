import React from "react";
import { Bot } from "lucide-react";
import { CrmAssistantChat } from "@/components/aiAgent/CrmAssistantChat";

export const AIAgent: React.FC = () => {
  return (
    <div className="container mx-auto py-6 space-y-4">
      <div className="flex items-center gap-2">
        <Bot className="w-6 h-6 text-indigo-500" />
        <h1 className="text-2xl font-bold">AI Sales Agent</h1>
      </div>
      <CrmAssistantChat />
    </div>
  );
};
