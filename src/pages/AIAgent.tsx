import React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bot, Activity, Settings as SettingsIcon, Sparkles } from "lucide-react";
import { AgentQueueTab } from "@/components/aiAgent/AgentQueueTab";
import { AgentActivityTab } from "@/components/aiAgent/AgentActivityTab";
import { AgentSettingsTab } from "@/components/aiAgent/AgentSettingsTab";
import { CrmAssistantChat } from "@/components/aiAgent/CrmAssistantChat";

export const AIAgent: React.FC = () => {
  return (
    <div className="container mx-auto py-6 space-y-4">
      <div className="flex items-center gap-2">
        <Bot className="w-6 h-6 text-indigo-500" />
        <h1 className="text-2xl font-bold">AI Sales Agent</h1>
      </div>
      <Tabs defaultValue="chat" className="space-y-4">
        <TabsList>
          <TabsTrigger value="chat" className="gap-2">
            <Sparkles className="w-4 h-4" /> Ask AI
          </TabsTrigger>
          <TabsTrigger value="queue" className="gap-2">
            <Bot className="w-4 h-4" /> Queue
          </TabsTrigger>
          <TabsTrigger value="activity" className="gap-2">
            <Activity className="w-4 h-4" /> Activity
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-2">
            <SettingsIcon className="w-4 h-4" /> Settings
          </TabsTrigger>
        </TabsList>
        <TabsContent value="chat"><CrmAssistantChat /></TabsContent>
        <TabsContent value="queue"><AgentQueueTab /></TabsContent>
        <TabsContent value="activity"><AgentActivityTab /></TabsContent>
        <TabsContent value="settings"><AgentSettingsTab /></TabsContent>
      </Tabs>
    </div>
  );
};
