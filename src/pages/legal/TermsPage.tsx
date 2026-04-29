import Navbar from '@/components/landing/Navbar';
import Footer from '@/components/landing/Footer';
import { Link } from 'react-router-dom';
import {
  LEGAL_COMPANY_NAME,
  LEGAL_CONTACT_EMAIL,
  LEGAL_LAST_UPDATED,
  LEGAL_PRODUCT_NAME,
} from '@/lib/legalBrand';

const TermsPage = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-24 pb-16 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto">
        <p className="text-sm text-muted-foreground mb-2">Last updated: {LEGAL_LAST_UPDATED}</p>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-foreground mb-4">
          Terms of Service
        </h1>
        <p className="text-muted-foreground mb-6 leading-relaxed">
          These Terms of Service (&quot;Terms&quot;) constitute a legal agreement between you and{' '}
          {LEGAL_COMPANY_NAME} (&quot;we&quot;, &quot;us&quot;, or &quot;our&quot;) governing access to and use of{' '}
          {LEGAL_PRODUCT_NAME}, our software product for project management, team collaboration, and
          related features (the &quot;Service&quot;), including any websites, applications, and services we
          make available in connection with {LEGAL_PRODUCT_NAME}.
        </p>
        <p className="text-muted-foreground mb-8 leading-relaxed">
          By creating an account, accepting an invitation, or otherwise using the Service, you confirm
          that you have read, understood, and agree to be bound by these Terms and our{' '}
          <Link to="/privacy" className="text-primary underline underline-offset-2">
            Privacy Policy
          </Link>{' '}
          and{' '}
          <Link to="/cookies" className="text-primary underline underline-offset-2">
            Cookie Policy
          </Link>
          . If you do not agree, you must not use the Service.
        </p>
        <p className="text-muted-foreground mb-8 leading-relaxed text-sm border-l-2 border-border pl-4">
          If you are using the Service on behalf of an organisation, you represent that you have
          authority to bind that organisation to these Terms.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-10 mb-3">1. The Service</h2>
        <p className="text-muted-foreground mb-4 leading-relaxed">
          {LEGAL_COMPANY_NAME} provides {LEGAL_PRODUCT_NAME} on an as-available basis. We may modify,
          enhance, or discontinue features to improve security, reliability, or user experience. We do
          not guarantee uninterrupted or error-free operation. Planned maintenance, third-party
          outages, and events outside our reasonable control may affect availability.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-10 mb-3">2. Accounts and eligibility</h2>
        <p className="text-muted-foreground mb-4 leading-relaxed">
          You must provide accurate registration information and keep your credentials confidential.
          You are responsible for all activity under your account except where caused by our gross
          negligence or breach. Notify us promptly of any unauthorised use.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-10 mb-3">
          3. Organisations, workspaces, and invitations
        </h2>
        <p className="text-muted-foreground mb-4 leading-relaxed">
          The Service may support organisations, workspaces, or teams. An administrator or owner may
          control membership, billing, configuration, and data export. By inviting others, you confirm
          that you are entitled to share the data they will access and that their use complies with
          these Terms. We may process personal data of invited users as described in our Privacy Policy.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-10 mb-3">4. Acceptable use</h2>
        <p className="text-muted-foreground mb-3 leading-relaxed">You agree not to:</p>
        <ul className="list-disc pl-5 space-y-2 text-muted-foreground mb-4 leading-relaxed">
          <li>
            Use the Service in violation of applicable law, regulation, or third-party rights;
          </li>
          <li>
            Upload, store, or transmit unlawful, harassing, defamatory, fraudulent, discriminatory,
            or malicious content, or malware;
          </li>
          <li>
            Attempt to probe, scan, or test the vulnerability of our systems, or circumvent security or
            access controls;
          </li>
          <li>
            Reverse engineer, decompile, or disassemble any part of the Service except where such
            restriction is prohibited by law;
          </li>
          <li>
            Use the Service to send unsolicited bulk communications or spam, or to mine data without
            authorisation;
          </li>
          <li>
            Resell or lease the Service without our prior written agreement, or use the Service to
            build a competing product in breach of our intellectual property rights.
          </li>
        </ul>
        <p className="text-muted-foreground mb-4 leading-relaxed">
          We may suspend or terminate access if we reasonably believe you have breached this section or
          pose a security risk.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-10 mb-3">5. Your content</h2>
        <p className="text-muted-foreground mb-4 leading-relaxed">
          You retain ownership of intellectual property rights in content you submit to the Service
          (&quot;Customer Content&quot;). You grant {LEGAL_COMPANY_NAME} a worldwide, non-exclusive licence to
          host, store, reproduce, process, and display Customer Content solely as reasonably necessary
          to provide, secure, and improve the Service for you and your collaborators — including backups,
          support, and compliance with law. You are responsible for the legality of Customer Content
          and for obtaining rights licences from your collaborators where needed.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-10 mb-3">
          6. Our intellectual property
        </h2>
        <p className="text-muted-foreground mb-4 leading-relaxed">
          The Service, including software, branding, documentation, and design, is owned by{' '}
          {LEGAL_COMPANY_NAME} or its licensors and is protected by intellectual property laws. Except
          for the limited rights expressly granted in these Terms, we reserve all rights. Feedback you
          provide may be used by us without obligation or restriction.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-10 mb-3">
          7. Subscriptions, trials, and fees
        </h2>
        <p className="text-muted-foreground mb-4 leading-relaxed">
          Certain features may require a paid subscription. Fees, billing cycles, and taxes (if any)
          are presented at purchase or in your order flow. Unless we state otherwise, subscriptions
          renew automatically until cancelled in accordance with the instructions we provide. We may
          offer trials; when a trial ends, access to paid features may end unless you subscribe. We use
          third-party payment processors; their terms may also apply.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-10 mb-3">8. Third-party services</h2>
        <p className="text-muted-foreground mb-4 leading-relaxed">
          The Service may integrate with or link to third-party services (including identity, email, and
          storage integrations). Your use of those services is governed by their respective terms and
          privacy notices. We are not responsible for third-party services we do not control.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-10 mb-3">9. Confidentiality</h2>
        <p className="text-muted-foreground mb-4 leading-relaxed">
          Each party may receive non-public information from the other. The recipient will use reasonable
          care to protect such information and will not disclose it except as permitted by these Terms,
          with consent, or as required by law.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-10 mb-3">10. Data protection</h2>
        <p className="text-muted-foreground mb-4 leading-relaxed">
          Our processing of personal data in connection with the Service is described in our{' '}
          <Link to="/privacy" className="text-primary underline underline-offset-2">
            Privacy Policy
          </Link>
          . Where we process personal data on behalf of your organisation as a processor, you remain
          responsible for providing any required notices to your end users.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-10 mb-3">
          11. Disclaimer of warranties
        </h2>
        <p className="text-muted-foreground mb-4 leading-relaxed">
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS
          AVAILABLE&quot;, WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY,
          INCLUDING IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND
          NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL MEET YOUR REQUIREMENTS OR BE
          UNINTERRUPTED OR ERROR-FREE.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-10 mb-3">12. Limitation of liability</h2>
        <p className="text-muted-foreground mb-4 leading-relaxed">
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, NEITHER {LEGAL_COMPANY_NAME} NOR ITS AFFILIATES OR
          SUPPLIERS WILL BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE
          DAMAGES, OR FOR LOSS OF PROFITS, REVENUE, DATA, OR GOODWILL, ARISING OUT OF OR IN CONNECTION
          WITH THE SERVICE OR THESE TERMS, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.
          OUR AGGREGATE LIABILITY FOR CLAIMS ARISING OUT OF OR RELATING TO THE SERVICE OR THESE TERMS
          WILL NOT EXCEED THE GREATER OF (A) THE AMOUNTS YOU PAID TO US FOR THE SERVICE IN THE TWELVE
          (12) MONTHS BEFORE THE CLAIM, OR (B) ONE HUNDRED BRITISH POUNDS (GBP £100), IF NO FEES WERE
          PAID. NOTHING IN THESE TERMS EXCLUDES OR LIMITS LIABILITY THAT CANNOT BE EXCLUDED OR LIMITED
          UNDER APPLICABLE LAW (INCLUDING DEATH OR PERSONAL INJURY CAUSED BY NEGLIGENCE OR FRAUD).
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-10 mb-3">13. Indemnity</h2>
        <p className="text-muted-foreground mb-4 leading-relaxed">
          You will defend, indemnify, and hold harmless {LEGAL_COMPANY_NAME} and its affiliates from
          third-party claims, damages, and costs (including reasonable legal fees) arising from your
          Customer Content, your breach of these Terms, or your misuse of the Service — except to the
          extent caused by our material breach or wilful misconduct.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-10 mb-3">14. Suspension and termination</h2>
        <p className="text-muted-foreground mb-4 leading-relaxed">
          You may stop using the Service at any time. We may suspend or terminate access for breach,
          risk of harm, legal requirement, or non-payment where applicable. Upon termination, your right
          to access the Service ceases. We may retain or delete data in line with our Privacy Policy and
          legal obligations. Sections that by their nature should survive will survive termination.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-10 mb-3">15. Changes to the Terms</h2>
        <p className="text-muted-foreground mb-4 leading-relaxed">
          We may modify these Terms from time to time. We will post the updated Terms on this page and
          update the &quot;Last updated&quot; date. If changes are material, we will provide additional
          notice where appropriate. Continued use after the effective date constitutes acceptance of the
          revised Terms. If you do not agree, you must stop using the Service.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-10 mb-3">16. Governing law and disputes</h2>
        <p className="text-muted-foreground mb-4 leading-relaxed">
          These Terms are governed by the laws of England and Wales, without regard to conflict-of-law
          principles. The courts of England and Wales will have exclusive jurisdiction for disputes
          arising out of or relating to these Terms, subject to any mandatory provisions of local law that
          apply to you as a consumer and cannot be waived.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-10 mb-3">17. General</h2>
        <p className="text-muted-foreground mb-4 leading-relaxed">
          These Terms, together with our Privacy Policy and Cookie Policy, constitute the entire
          agreement between you and {LEGAL_COMPANY_NAME} regarding the Service. If any provision is
          held invalid, the remainder remains in effect. Our failure to enforce a provision is not a
          waiver. You may not assign these Terms without our consent; we may assign them in connection
          with a merger or sale of assets.
        </p>

        <h2 className="text-xl font-semibold text-foreground mt-10 mb-3">18. Contact</h2>
        <p className="text-muted-foreground mb-4 leading-relaxed">
          For questions about these Terms:{' '}
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

export default TermsPage;
