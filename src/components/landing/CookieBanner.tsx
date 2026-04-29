import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  TASKCALENDAR_ANALYTICS_CONSENT_EVENT,
  TASKCALENDAR_ANALYTICS_REJECT_EVENT,
  TASKCALENDAR_COOKIE_CONSENT_STORAGE_KEY,
} from "@/lib/cookieConsent";

const STORAGE_KEY = TASKCALENDAR_COOKIE_CONSENT_STORAGE_KEY;

const CookieBanner: React.FC = () => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      // Show banner only if no explicit choice has been made yet
      if (stored !== "accepted" && stored !== "rejected") setVisible(true);
    } catch {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  const handleAccept = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "accepted");
    } catch {
      // ignore
    }
    window.dispatchEvent(new Event(TASKCALENDAR_ANALYTICS_CONSENT_EVENT));
    setVisible(false);
  };

  const handleReject = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "rejected");
    } catch {
      // ignore
    }
    window.dispatchEvent(new Event(TASKCALENDAR_ANALYTICS_REJECT_EVENT));
    setVisible(false);
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] px-4 pb-4 sm:px-6 sm:pb-6">
      <div className="max-w-4xl mx-auto rounded-2xl border border-border bg-background/95 backdrop-blur shadow-lg p-4 sm:p-5 flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="flex-1 text-sm text-muted-foreground">
          <p className="font-medium text-foreground mb-1">We use cookies</p>
          <p>
            TaskCalendar uses essential cookies to keep you signed in and to improve the product.
            For details, see our{" "}
            <a href="/privacy" className="underline text-primary">
              Privacy Policy
            </a>{" "}
            and{" "}
            <a href="/terms" className="underline text-primary">
              Terms &amp; Conditions
            </a>
            .
          </p>
        </div>
        <div className="flex gap-2 justify-end">
          <Button size="sm" variant="outline" onClick={handleReject}>
            Only essential
          </Button>
          <Button size="sm" onClick={handleAccept}>
            Accept all
          </Button>
        </div>
      </div>
    </div>
  );
};

export default CookieBanner;

