import Navbar from '@/components/landing/Navbar';
import Footer from '@/components/landing/Footer';
import { Link } from 'react-router-dom';
import {
  LEGAL_COMPANY_NAME,
  LEGAL_CONTACT_EMAIL,
  LEGAL_LAST_UPDATED,
  LEGAL_PRODUCT_NAME,
} from '@/lib/legalBrand';

const CookiePolicyPage = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-24 pb-16 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto">
        <p className="text-sm text-muted-foreground mb-2">Last updated: {LEGAL_LAST_UPDATED}</p>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-foreground mb-4">
          Cookie Policy
        </h1>
        <p className="text-muted-foreground mb-6 leading-relaxed">
          This Cookie Policy describes how {LEGAL_COMPANY_NAME} (&quot;we&quot;, &quot;us&quot;) uses cookies
          and similar technologies when you use {LEGAL_PRODUCT_NAME} (the &quot;Service&quot;). It should be
          read together with our{' '}
          <Link to="/privacy" className="text-primary underline underline-offset-2">
            Privacy Policy
          </Link>
          .
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-10 mb-3">1. What are cookies?</h2>
        <p className="text-muted-foreground mb-4 leading-relaxed">
          Cookies are small text files stored on your device when you visit a website. Similar
          technologies include local storage and session storage, which can also save preferences on
          your browser. Together, we refer to these as &quot;cookies and similar technologies&quot; where
          relevant.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-10 mb-3">
          2. How we use cookies on {LEGAL_PRODUCT_NAME}
        </h2>
        <p className="text-muted-foreground mb-4 leading-relaxed">
          We use cookies and similar technologies for the purposes below. We distinguish between
          those that are strictly necessary to run the Service and those that are optional.
        </p>

        <h3 className="text-lg font-semibold text-foreground mt-6 mb-2">
          2.1 Strictly necessary (always on)
        </h3>
        <ul className="list-disc pl-5 space-y-2 text-muted-foreground mb-4 leading-relaxed">
          <li>
            <strong className="text-foreground">Authentication and security.</strong> Our infrastructure
            and auth providers set cookies or tokens needed to keep you signed in securely, protect
            against fraud, and maintain session integrity.
          </li>
          <li>
            <strong className="text-foreground">Preferences.</strong> We store your cookie choice
            (e.g. whether you accepted optional analytics) locally on your device so we do not ask
            you again on every visit.
          </li>
        </ul>

        <h3 className="text-lg font-semibold text-foreground mt-6 mb-2">
          2.2 Optional — analytics (only with your consent)
        </h3>
        <p className="text-muted-foreground mb-4 leading-relaxed">
          If you choose <strong className="text-foreground">Accept all</strong> in our cookie banner,
          we may load <strong className="text-foreground">Google Analytics 4</strong> (provided by
          Google) to measure how the Service is used in aggregate (for example traffic and product
          improvement). If you choose <strong className="text-foreground">Only essential</strong>, we do
          not load this analytics tag.
        </p>
        <p className="text-muted-foreground mb-4 leading-relaxed">
          You can change your mind by clearing site data for our domain in your browser; you may see
          the banner again on your next visit.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-10 mb-3">
          3. Third-party cookies and providers
        </h2>
        <p className="text-muted-foreground mb-4 leading-relaxed">
          Some cookies are set by third parties that provide functionality on our behalf, for example
          cloud hosting and analytics. Their use is described in more detail in our{' '}
          <Link to="/privacy" className="text-primary underline underline-offset-2">
            Privacy Policy
          </Link>{' '}
          (including subprocessors such as our database and authentication provider, payment
          processors where applicable, and email delivery partners).
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-10 mb-3">
          4. How to control cookies
        </h2>
        <ul className="list-disc pl-5 space-y-2 text-muted-foreground mb-4 leading-relaxed">
          <li>Use our cookie banner when it appears to accept or reject optional analytics.</li>
          <li>
            Adjust your browser settings to block or delete cookies. Note that blocking strictly
            necessary cookies may prevent sign-in or core features from working.
          </li>
          <li>
            For Google Analytics, Google offers an optional browser add-on in some regions to
            decline analytics cookies (see Google&apos;s documentation).
          </li>
        </ul>

        <h2 className="text-xl font-semibold text-foreground mt-10 mb-3">5. Contact</h2>
        <p className="text-muted-foreground mb-4 leading-relaxed">
          Questions about this Cookie Policy:{' '}
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} className="text-primary underline underline-offset-2">
            {LEGAL_CONTACT_EMAIL}
          </a>
          .
        </p>
      </main>
      <Footer />
    </div>
  );
};

export default CookiePolicyPage;
