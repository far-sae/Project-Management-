import Navbar from '@/components/landing/Navbar';
import Footer from '@/components/landing/Footer';
import { Link } from 'react-router-dom';
import {
  LEGAL_COMPANY_NAME,
  LEGAL_CONTACT_EMAIL,
  LEGAL_LAST_UPDATED,
  LEGAL_PRODUCT_NAME,
} from '@/lib/legalBrand';

const PrivacyPolicyPage = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-24 pb-16 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto">
        <p className="text-sm text-muted-foreground mb-2">Last updated: {LEGAL_LAST_UPDATED}</p>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-foreground mb-4">Privacy Policy</h1>
        <p className="text-muted-foreground mb-6 leading-relaxed">
          This Privacy Policy explains how {LEGAL_COMPANY_NAME} (&quot;we&quot;, &quot;us&quot;, or
          &quot;our&quot;) collects, uses, discloses, and safeguards personal information when you access or
          use {LEGAL_PRODUCT_NAME}, our web-based project management and collaboration platform (the
          &quot;Service&quot;). We respect your privacy and aim to comply with applicable data protection
          laws, including the EU and UK General Data Protection Regulation (GDPR) where they apply.
        </p>
        <p className="text-muted-foreground mb-8 leading-relaxed text-sm border-l-2 border-border pl-4">
          This policy is provided for transparency. It does not constitute legal advice. If you need
          legal guidance specific to your organisation, consult qualified counsel.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-10 mb-3">1. Who is responsible?</h2>
        <p className="text-muted-foreground mb-4 leading-relaxed">
          The data controller for personal information processed through the Service is{' '}
          {LEGAL_COMPANY_NAME}. For privacy-related requests, contact us at{' '}
          <a
            href={`mailto:${LEGAL_CONTACT_EMAIL}`}
            className="text-primary underline underline-offset-2"
          >
            {LEGAL_CONTACT_EMAIL}
          </a>
          .
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-10 mb-3">2. Scope and children</h2>
        <p className="text-muted-foreground mb-4 leading-relaxed">
          The Service is intended for use by businesses and individuals who are at least the age of
          digital consent in their jurisdiction (typically 16 in the UK/EU, or 13 where local law
          allows with parental involvement). We do not knowingly collect personal information from
          children for marketing purposes. If you believe we have collected data from a child in error,
          contact us and we will take appropriate steps.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-10 mb-3">
          3. Information we collect
        </h2>
        <p className="text-muted-foreground mb-3 leading-relaxed">
          Depending on how you use the Service, we may process the following categories of information:
        </p>
        <ul className="list-disc pl-5 space-y-2 text-muted-foreground mb-4 leading-relaxed">
          <li>
            <strong className="text-foreground">Account and profile data.</strong> Name, email address,
            profile photo, organisation or workspace identifiers, role, and authentication credentials
            (handled securely by our identity provider; we do not store your password in plain text).
          </li>
          <li>
            <strong className="text-foreground">Organisation and collaboration content.</strong> Projects,
            tasks, comments, chat messages, file metadata, workflow states, presence indicators,
            notifications, and other content you or your colleagues submit to the Service.
          </li>
          <li>
            <strong className="text-foreground">Billing and subscription data.</strong> Where you
            purchase a paid plan, our payment processor may collect billing contact details and
            payment method metadata; we typically receive limited information needed for invoicing
            and account status.
          </li>
          <li>
            <strong className="text-foreground">Technical and usage data.</strong> IP address, device
            and browser type, approximate location derived from IP, log and security records, and
            diagnostic data needed to operate, secure, and improve the Service. Where you consent to
            optional analytics, aggregated usage statistics may be collected via third-party analytics
            tools as described in our{' '}
            <Link to="/cookies" className="text-primary underline underline-offset-2">
              Cookie Policy
            </Link>
            .
          </li>
          <li>
            <strong className="text-foreground">Communications.</strong> Messages you send to support,
            feedback you volunteer, and records of transactional emails (e.g. invitations, security,
            billing) sent through our infrastructure or email delivery partners.
          </li>
        </ul>

        <h2 className="text-xl font-semibold text-foreground mt-10 mb-3">
          4. How we use personal information
        </h2>
        <p className="text-muted-foreground mb-3 leading-relaxed">We use personal information to:</p>
        <ul className="list-disc pl-5 space-y-2 text-muted-foreground mb-4 leading-relaxed">
          <li>Provide, host, and operate the Service, including real-time collaboration features;</li>
          <li>Authenticate users, prevent fraud and abuse, and maintain the security of the platform;</li>
          <li>
            Communicate with you about the Service, including service announcements, support responses,
            and (where permitted) product updates;
          </li>
          <li>Process payments and manage subscriptions;</li>
          <li>
            Improve and develop features, conduct troubleshooting and analytics in line with your
            choices (including optional analytics where you have consented);
          </li>
          <li>Comply with legal obligations and enforce our terms.</li>
        </ul>

        <h2 className="text-xl font-semibold text-foreground mt-10 mb-3">
          5. Legal bases (EEA/UK GDPR)
        </h2>
        <p className="text-muted-foreground mb-4 leading-relaxed">
          Where GDPR applies, we rely on one or more of the following legal bases:{' '}
          <strong className="text-foreground">performance of a contract</strong> (to deliver the
          Service you signed up for);{' '}
          <strong className="text-foreground">legitimate interests</strong> (to secure our systems,
          improve the product in a proportionate way, and communicate operational notices), balanced
          against your rights; <strong className="text-foreground">consent</strong> (where required,
          for example optional analytics cookies); and{' '}
          <strong className="text-foreground">legal obligation</strong> where the law requires us to
          retain or disclose data.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-10 mb-3">
          6. Sharing and subprocessors
        </h2>
        <p className="text-muted-foreground mb-4 leading-relaxed">
          We use trusted third-party service providers (&quot;subprocessors&quot;) to host and operate the
          Service. They process personal information on our instructions and under contractual
          safeguards appropriate to the risk. Categories of recipients include:
        </p>
        <ul className="list-disc pl-5 space-y-2 text-muted-foreground mb-4 leading-relaxed">
          <li>
            <strong className="text-foreground">Cloud infrastructure and database.</strong> Primary
            hosting, authentication, database, storage, and realtime messaging for the application.
          </li>
          <li>
            <strong className="text-foreground">Payments.</strong> Payment processing for subscriptions
            and billing (e.g. Stripe or comparable providers).
          </li>
          <li>
            <strong className="text-foreground">Email delivery.</strong> Transactional and notification
            email (e.g. EmailJS or comparable providers when configured for your deployment).
          </li>
          <li>
            <strong className="text-foreground">Analytics.</strong> If you consent, tools such as
            Google Analytics 4 to understand aggregate usage.
          </li>
        </ul>
        <p className="text-muted-foreground mb-4 leading-relaxed">
          We may also disclose information if required by law, court order, or competent authority, or
          to protect the rights, property, or safety of {LEGAL_COMPANY_NAME}, our users, or the public.
          If we undergo a business transfer (e.g. merger or acquisition), personal information may be
          transferred as part of that transaction subject to continued protection consistent with this
          policy.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-10 mb-3">
          7. International transfers
        </h2>
        <p className="text-muted-foreground mb-4 leading-relaxed">
          Our subprocessors may process data in the United Kingdom, the European Economic Area, the
          United States, and other countries where they operate. Where we transfer personal data from
          the UK/EEA to countries not recognised as providing adequate protection, we use appropriate
          safeguards such as standard contractual clauses or other mechanisms approved under applicable
          law.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-10 mb-3">8. Retention</h2>
        <p className="text-muted-foreground mb-4 leading-relaxed">
          We retain personal information only as long as necessary for the purposes described in this
          policy, including to provide the Service, resolve disputes, enforce agreements, and meet
          legal, tax, and accounting requirements. Workspace content may be retained until an
          organisation deletes it or closes an account, subject to backup and disaster-recovery
          cycles. Aggregated or de-identified data may be retained longer where it no longer identifies
          you.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-10 mb-3">9. Security</h2>
        <p className="text-muted-foreground mb-4 leading-relaxed">
          We implement appropriate technical and organisational measures designed to protect personal
          information against unauthorised access, alteration, disclosure, or destruction. No method of
          transmission over the internet is completely secure; we encourage you to use strong passwords
          and protect your credentials.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-10 mb-3">10. Your rights</h2>
        <p className="text-muted-foreground mb-4 leading-relaxed">
          Depending on your location, you may have the right to access, rectify, erase, restrict, or
          object to certain processing of your personal information, to data portability, and to
          withdraw consent where processing is based on consent. You may also lodge a complaint with a
          supervisory authority. To exercise your rights, contact{' '}
          <a
            href={`mailto:${LEGAL_CONTACT_EMAIL}`}
            className="text-primary underline underline-offset-2"
          >
            {LEGAL_CONTACT_EMAIL}
          </a>
          . We may need to verify your identity before fulfilling certain requests.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-10 mb-3">
          11. Cookies and similar technologies
        </h2>
        <p className="text-muted-foreground mb-4 leading-relaxed">
          We use cookies and similar technologies as described in our{' '}
          <Link to="/cookies" className="text-primary underline underline-offset-2">
            Cookie Policy
          </Link>
          , including strictly necessary cookies for sign-in and optional analytics where you have
          consented.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-10 mb-3">12. Changes</h2>
        <p className="text-muted-foreground mb-4 leading-relaxed">
          We may update this Privacy Policy from time to time. We will post the revised version on this
          page and update the &quot;Last updated&quot; date. Where changes are material, we will provide
          additional notice as appropriate (for example by email or in-product notice).
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-10 mb-3">13. Contact</h2>
        <p className="text-muted-foreground mb-4 leading-relaxed">
          Questions about this Privacy Policy:{' '}
          <a
            href={`mailto:${LEGAL_CONTACT_EMAIL}`}
            className="text-primary underline underline-offset-2"
          >
            {LEGAL_CONTACT_EMAIL}
          </a>
          .
        </p>
      </main>
      <Footer />
    </div>
  );
};

export default PrivacyPolicyPage;
