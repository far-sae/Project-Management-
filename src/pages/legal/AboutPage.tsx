import Navbar from "@/components/landing/Navbar";
import Footer from "@/components/landing/Footer";

const AboutPage = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-24 pb-16 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto">
        <h1 className="text-3xl sm:text-4xl font-extrabold text-foreground mb-4">
          About Securovix TaskCalendar
        </h1>
        <p className="text-muted-foreground mb-6">
          Securovix TaskCalendar is a modern project and task management workspace built to help
          teams plan, track, and deliver work with clarity. Boards, timelines, reports, contracts,
          and collaboration tools are all in one place so that you spend less time chasing updates
          and more time shipping results.
        </p>
        <p className="text-muted-foreground mb-4">
          Our focus is privacy-conscious productivity: we only collect the information needed to run
          the service (like your account details and workspace content) and never sell your data.
          You stay in control of your tasks, projects, and files at all times.
        </p>
        <p className="text-muted-foreground mb-4">
          If you have questions about the product, pricing, or roadmap, you can always reach us at{" "}
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

export default AboutPage;

