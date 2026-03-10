import { Link } from "react-router-dom";

const BRAND_CONTACT_EMAIL = "info@securovix.com";

const Footer = () => {
  return (
    <footer className="border-t border-border py-12 bg-secondary/20">
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8 mb-12">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <img src="/logo.png" alt="TaskCalendar" className="w-8 h-8 rounded-lg object-cover" />
              <span className="font-bold text-lg text-gray-900">TaskCalendar</span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              The modern project management platform for teams that move fast.
            </p>
          </div>

          <div>
            <h4 className="font-semibold text-foreground mb-4">Product</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><a href="#features" className="hover:text-foreground transition-colors">Features</a></li>
              <li><a href="#cta" className="hover:text-foreground transition-colors">Pricing</a></li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-foreground mb-4">Company</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <Link to="/about" className="hover:text-foreground transition-colors">
                  About
                </Link>
              </li>
              <li>
                <a
                  href={`mailto:${BRAND_CONTACT_EMAIL}`}
                  className="hover:text-foreground transition-colors"
                >
                  Contact
                </a>
              </li>
              <li>
                <Link to="/contracts-info" className="hover:text-foreground transition-colors">
                  Contracts
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-foreground mb-4">Legal</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <Link to="/privacy" className="hover:text-foreground transition-colors">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link to="/terms" className="hover:text-foreground transition-colors">
                  Terms &amp; Conditions
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-border pt-8 text-center text-sm text-gray-700">
          © {new Date().getFullYear()} TaskCalendar. All rights reserved.
        </div>
      </div>
    </footer>
  );
};

export default Footer;
