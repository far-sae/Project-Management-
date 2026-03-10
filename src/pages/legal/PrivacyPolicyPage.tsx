import Navbar from "@/components/landing/Navbar";
import Footer from "@/components/landing/Footer";

const PrivacyPolicyPage = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-24 pb-16 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto">
        <h1 className="text-3xl sm:text-4xl font-extrabold text-foreground mb-4">
          Privacy Policy
        </h1>
        <p className="text-muted-foreground mb-4">
          This Privacy Policy explains how Securovix (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;)
          processes personal data when you use TaskCalendar. We aim to comply with applicable data
          protection laws, including the EU/UK GDPR.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-8 mb-2">Data we collect</h2>
        <ul className="list-disc pl-5 space-y-2 text-muted-foreground mb-4">
          <li>Account details (name, email, profile image).</li>
          <li>Workspace and project content you create (tasks, comments, files, contracts).</li>
          <li>Usage and technical data (log data, device/browser type) to keep the service secure.</li>
        </ul>

        <h2 className="text-xl font-semibold text-foreground mt-8 mb-2">How we use data</h2>
        <ul className="list-disc pl-5 space-y-2 text-muted-foreground mb-4">
          <li>To provide and maintain the TaskCalendar service.</li>
          <li>To secure your account and detect abuse or misuse.</li>
          <li>To send essential service emails (login, billing, important updates).</li>
        </ul>

        <h2 className="text-xl font-semibold text-foreground mt-8 mb-2">
          Legal bases under GDPR
        </h2>
        <p className="text-muted-foreground mb-4">
          We process your data based on: (a) performance of a contract (to provide the service you
          signed up for), (b) our legitimate interests in running and improving a secure product,
          and (c) your consent for optional features such as certain cookies.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-8 mb-2">Your rights</h2>
        <p className="text-muted-foreground mb-4">
          Depending on your location, you may have the right to access, correct, download, or delete
          your personal data, and to object to or restrict certain processing. To exercise these
          rights, contact us at{" "}
          <a href="mailto:info@securovix.com" className="underline text-primary">
            info@securovix.com
          </a>
          .
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-8 mb-2">Cookies</h2>
        <p className="text-muted-foreground mb-4">
          TaskCalendar uses essential cookies to keep you logged in and to remember your
          preferences, as well as limited analytics to understand product usage. You can manage
          basic consent via the cookie banner on the site or by adjusting your browser settings.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-8 mb-2">Contact</h2>
        <p className="text-muted-foreground mb-4">
          If you have questions about this Privacy Policy or data protection, please email{" "}
          <a href="mailto:info@securovix.com" className="underline text-primary">
            info@securovix.com
          </a>
          .
        </p>
      </main>
      <Footer />
    </div>
  );
};

export default PrivacyPolicyPage;

