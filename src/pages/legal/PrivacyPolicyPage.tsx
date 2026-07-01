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
          use {LEGAL_PRODUCT_NAME}, our web-based project management and CRM collaboration
          platform (the &quot;Service&quot;). The Service includes project and task workflows,
          a CRM hub (Contacts, Companies, Deals, CRM Tasks, activity timeline, notes, tags,
          reports and calendar), a Deal-Won handoff that creates workspaces and projects for
          delivery, HR / time-tracking / payroll modules, and optional Google / Gmail /
          Calendar / Meet integrations. We respect your privacy and aim to comply with
          applicable data protection laws, including the EU and UK General Data Protection
          Regulation (GDPR) where they apply.
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
            <strong className="text-foreground">CRM Hub data</strong> (Advanced and Premium tiers).
            Contacts, Companies, Deals, CRM Tasks, notes, activity events (calls, emails,
            meetings, deal stage changes, task completions), tags, deal-pipeline configuration,
            and a chosen display currency. CRM records typically include third-party personal
            data (your leads&apos; / customers&apos; names, emails, phone numbers, job titles,
            company addresses, revenue figures) that <strong className="text-foreground">you
            control</strong> — your organisation is the controller of that data and you are
            responsible for the lawful basis under which it was collected. We process it as
            your processor under{' '}
            <Link to="/terms" className="text-primary underline underline-offset-2">our Terms</Link>.
            When you use the Deal-Won handoff, the linkage from a won deal to the workspace
            and project you created is also stored so we can render the &quot;Open project&quot;
            shortcut.
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
          4a. Signup consent
        </h2>
        <p className="text-muted-foreground mb-4 leading-relaxed">
          Creating an account on {LEGAL_PRODUCT_NAME} — whether by email + password or via
          Google single sign-on — requires you to check a consent box confirming that you have
          read and agree to these Terms and this Privacy Policy. We record the timestamp of
          that acceptance locally so we can prove consent was given at signup if you ever ask.
          If you do not agree, you must not proceed with account creation.
        </p>

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
          <li>
            <strong className="text-foreground">AI / large-language-model API.</strong> OpenAI for
            optional task-assistant features. Server-to-server requests; prompts not retained for
            model training (<code>store=false</code> where supported).
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
          7. Google API services and third-party integrations
        </h2>
        <p className="text-muted-foreground mb-3 leading-relaxed">
          {LEGAL_PRODUCT_NAME} lets you connect optional third-party services to your account so the
          Service can act on your behalf. Connections are always initiated by you, can be disconnected
          at any time from <strong className="text-foreground">Settings &rarr; Integrations</strong>,
          and are isolated per user or per organisation as appropriate.
        </p>

        <h3 className="text-base font-semibold text-foreground mt-6 mb-2">
          Google API Services (Google Calendar and Google Meet)
        </h3>
        <p className="text-muted-foreground mb-3 leading-relaxed">
          When you choose to connect a Google account, {LEGAL_PRODUCT_NAME} uses Google API Services and
          will request only the scopes listed below. {LEGAL_PRODUCT_NAME}&apos;s use and transfer of
          information received from Google APIs to any other app will adhere to the{' '}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            className="text-primary underline underline-offset-2"
            target="_blank"
            rel="noopener noreferrer"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. The scopes we request and how each is used:
        </p>
        <ul className="list-disc pl-5 space-y-2 text-muted-foreground mb-4 leading-relaxed">
          <li>
            <strong className="text-foreground">openid, email, profile.</strong> Identify the connected
            Google account so we can display &quot;Connected as your@email.com&quot; on the integrations
            screen. We store the email address and display name only.
          </li>
          <li>
            <strong className="text-foreground">
              https://www.googleapis.com/auth/calendar.events.
            </strong>{' '}
            Create a Google Calendar event with an attached Google Meet conference link when you
            explicitly attach a Meet to a task in {LEGAL_PRODUCT_NAME}. We do not read your existing
            calendar entries. We store only the event id and Meet URL for the event we created on your
            behalf, linked to the task you initiated.
          </li>
        </ul>
        <p className="text-muted-foreground mb-3 leading-relaxed">
          <strong className="text-foreground">How we handle Google user data.</strong> OAuth refresh and
          access tokens are encrypted at rest using AES-256-GCM with a key stored only in our server
          environment; they are never exposed to the browser. Event ids and Meet URLs created on your
          behalf are stored alongside the task they belong to so we can render the Join Meeting button.
          We do not sell Google user data, we do not use it for advertising, and we do not use it to
          train generalised machine-learning or AI models. Only automated processes that are required
          to operate the integration access this data; human access by our staff is limited to
          investigating specific support incidents or security events you have raised.
        </p>
        <p className="text-muted-foreground mb-3 leading-relaxed">
          <strong className="text-foreground">Retention and deletion.</strong> Tokens persist until you
          disconnect the integration, revoke access at{' '}
          <a
            href="https://myaccount.google.com/permissions"
            className="text-primary underline underline-offset-2"
            target="_blank"
            rel="noopener noreferrer"
          >
            https://myaccount.google.com/permissions
          </a>
          , or delete your {LEGAL_PRODUCT_NAME} account. On any of those events the stored tokens are
          revoked at Google and removed from our database within 30 days. You can request a copy or
          deletion of any stored Google user data by emailing{' '}
          <a
            href={`mailto:${LEGAL_CONTACT_EMAIL}`}
            className="text-primary underline underline-offset-2"
          >
            {LEGAL_CONTACT_EMAIL}
          </a>
          .
        </p>

        <h3 className="text-base font-semibold text-foreground mt-6 mb-2">
          AI features (OpenAI)
        </h3>
        <p className="text-muted-foreground mb-4 leading-relaxed">
          {LEGAL_PRODUCT_NAME} uses large-language-model APIs to power optional assistant features
          such as task descriptions and summaries. Requests are made server-side; we pass{' '}
          <code>store=false</code> / equivalent flags where supported so prompts are not retained
          for model training by default. AI-generated suggestions are informational; they may be
          wrong, biased, or stale, and you remain responsible for any action you take based on them.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-10 mb-3">
          8. International transfers
        </h2>
        <p className="text-muted-foreground mb-4 leading-relaxed">
          Our subprocessors may process data in the United Kingdom, the European Economic Area, the
          United States, and other countries where they operate. Where we transfer personal data from
          the UK/EEA to countries not recognised as providing adequate protection, we use appropriate
          safeguards such as standard contractual clauses or other mechanisms approved under applicable
          law.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-10 mb-3">9. Retention</h2>
        <p className="text-muted-foreground mb-4 leading-relaxed">
          We retain personal information only as long as necessary for the purposes described in this
          policy, including to provide the Service, resolve disputes, enforce agreements, and meet
          legal, tax, and accounting requirements. Workspace content may be retained until an
          organisation deletes it or closes an account, subject to backup and disaster-recovery
          cycles. Aggregated or de-identified data may be retained longer where it no longer identifies
          you.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-10 mb-3">10. Security</h2>
        <p className="text-muted-foreground mb-4 leading-relaxed">
          We implement appropriate technical and organisational measures designed to protect personal
          information against unauthorised access, alteration, disclosure, or destruction. No method of
          transmission over the internet is completely secure; we encourage you to use strong passwords
          and protect your credentials.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-10 mb-3">11. Your rights</h2>
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
          12. Cookies and similar technologies
        </h2>
        <p className="text-muted-foreground mb-4 leading-relaxed">
          We use cookies and similar technologies as described in our{' '}
          <Link to="/cookies" className="text-primary underline underline-offset-2">
            Cookie Policy
          </Link>
          , including strictly necessary cookies for sign-in and optional analytics where you have
          consented.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-10 mb-3">13. Changes</h2>
        <p className="text-muted-foreground mb-4 leading-relaxed">
          We may update this Privacy Policy from time to time. We will post the revised version on this
          page and update the &quot;Last updated&quot; date. Where changes are material, we will provide
          additional notice as appropriate (for example by email or in-product notice).
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-10 mb-3">14. Contact</h2>
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
