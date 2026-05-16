// src/pages/PublicLeadForm.tsx
import React from "react";
import { useParams } from "react-router-dom";
import { LeadFormRenderer } from "@/components/public/LeadFormRenderer";

export const PublicLeadForm: React.FC<{ embed?: boolean }> = ({ embed }) => {
  const { slug } = useParams<{ slug: string }>();
  if (!slug) return null;
  return (
    <div className={embed
      ? "min-h-screen bg-transparent"
      : "min-h-screen bg-background text-foreground"}>
      <LeadFormRenderer slug={slug} embed={embed} />
    </div>
  );
};

export default PublicLeadForm;
