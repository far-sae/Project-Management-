import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "taskcalendar_cookie_consent";

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
    setVisible(false);
  };

  const handleReject = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "rejected");
    } catch {
      // ignore
    }
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
            <Link to="/privacy" className="underline text-primary">
              Privacy Policy
            </Link>{" "}
            and{" "}
            <Link to="/terms" className="underline text-primary">
              Terms &amp; Conditions
            </Link>
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

