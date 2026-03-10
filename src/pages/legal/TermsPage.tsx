import Navbar from "@/components/landing/Navbar";
import Footer from "@/components/landing/Footer";

const TermsPage = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-24 pb-16 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto">
        <h1 className="text-3xl sm:text-4xl font-extrabold text-foreground mb-4">
          Terms &amp; Conditions
        </h1>
        <p className="text-muted-foreground mb-4">
          These Terms and Conditions (&quot;Terms&quot;) govern your use of Securovix TaskCalendar
          (&quot;Service&quot;). By creating an account or using the Service you agree to these
          Terms.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-8 mb-2">Use of the Service</h2>
        <p className="text-muted-foreground mb-4">
          You are responsible for the content you create and store in TaskCalendar, including tasks,
          files, and contracts. You agree not to upload illegal content, spam, or anything that
          violates applicable laws or the rights of others.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-8 mb-2">
          Account and organization owners
        </h2>
        <p className="text-muted-foreground mb-4">
          An organization owner controls the workspace and is responsible for managing members,
          billing, and data exported from the workspace. If you invite other users, you confirm that
          you have the right to share the data they will access.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-8 mb-2">Data protection</h2>
        <p className="text-muted-foreground mb-4">
          We process personal data in line with our{" "}
          <a href="/privacy" className="underline text-primary">
            Privacy Policy
          </a>
          , which is designed to meet GDPR requirements such as lawful bases for processing and your
          rights over your data.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-8 mb-2">Availability</h2>
        <p className="text-muted-foreground mb-4">
          We aim to provide a reliable service but do not guarantee uninterrupted availability. We
          may make changes to the Service or these Terms from time to time; if changes are
          significant we will notify you where reasonably possible.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-8 mb-2">Contact</h2>
        <p className="text-muted-foreground mb-4">
          For any questions about these Terms, please contact{" "}
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

export default TermsPage;

