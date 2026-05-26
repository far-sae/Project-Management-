import { supabase } from "./config";
import { logger } from "@/lib/logger";

export interface SmsMessage {
  messageId: string;
  organizationId: string;
  clientId: string | null;
  dealId: string | null;
  direction: "outbound" | "inbound";
  toNumber: string;
  fromNumber: string | null;
  body: string;
  status: string;
  providerSid: string | null;
  errorMessage: string | null;
  sentBy: string | null;
  sentByName: string | null;
  createdAt: Date;
}

const mapSms = (r: Record<string, unknown>): SmsMessage => ({
  messageId: r.message_id as string,
  organizationId: r.organization_id as string,
  clientId: (r.client_id as string) ?? null,
  dealId: (r.deal_id as string) ?? null,
  direction: ((r.direction as string) || "outbound") as "outbound" | "inbound",
  toNumber: r.to_number as string,
  fromNumber: (r.from_number as string) ?? null,
  body: (r.body as string) ?? "",
  status: (r.status as string) ?? "queued",
  providerSid: (r.provider_sid as string) ?? null,
  errorMessage: (r.error_message as string) ?? null,
  sentBy: (r.sent_by as string) ?? null,
  sentByName: (r.sent_by_name as string) ?? null,
  createdAt: new Date(r.created_at as string),
});

export interface SendSmsInput {
  organizationId: string;
  to: string;
  body: string;
  clientId?: string | null;
  dealId?: string | null;
}

export const sendSms = async (
  input: SendSmsInput,
): Promise<{ messageId: string; status: string }> => {
  const { data, error } = await supabase.functions.invoke("sms-send", {
    body: input,
  });
  if (error) {
    logger.error("sms-send failed:", error);
    throw new Error(
      error instanceof Error ? error.message : "Failed to send SMS",
    );
  }
  const payload = data as {
    ok: boolean;
    messageId?: string;
    status?: string;
    error?: string;
  };
  if (!payload?.ok) {
    throw new Error(payload?.error ?? "Failed to send SMS");
  }
  return {
    messageId: payload.messageId ?? "",
    status: payload.status ?? "queued",
  };
};

export const listClientSms = async (
  organizationId: string,
  clientId: string,
): Promise<SmsMessage[]> => {
  const { data, error } = await supabase
    .from("sms_messages")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  if (error) {
    logger.error("failed to load client SMS:", error);
    return [];
  }
  return (data ?? []).map(mapSms);
};
