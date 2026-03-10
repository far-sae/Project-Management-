import Navbar from "@/components/landing/Navbar";
import Footer from "@/components/landing/Footer";

const ContractsInfoPage = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-24 pb-16 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto">
        <h1 className="text-3xl sm:text-4xl font-extrabold text-foreground mb-4">
          Contracts &amp; Agreements
        </h1>
        <p className="text-muted-foreground mb-6">
          TaskCalendar includes a contracts workspace where you can store, track, and manage
          agreements related to your projects in one place. This page explains how contracts are
          handled in the product.
        </p>
        <ul className="list-disc pl-5 space-y-2 text-muted-foreground mb-4">
          <li>Contracts are stored securely in your organization workspace and linked to projects.</li>
          <li>
            Only members of your organization with the appropriate role can view or update
            contracts.
          </li>
          <li>
            You are responsible for the legal content of uploaded contracts; TaskCalendar does not
            provide legal advice or create binding legal text for you.
          </li>
        </ul>
        <p className="text-muted-foreground mb-4">
          If you need to update or remove a contract, an organization owner or admin can do this
          from within the app. For any questions about how contracts are stored or if you need help
          with your account, please email{" "}
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

export default ContractsInfoPage;

