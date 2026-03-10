import { useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Check, Grid3X3, Zap, Users, Star, Mail } from "lucide-react";
import { Link } from "react-router-dom";

const plans = [
  {
    icon: Grid3X3,
    name: "Starter",
    subtitle: "Free forever, limited features",
    price: { monthly: "Free", yearly: "Free" },
    period: "forever",
    originalPrice: null,
    badge: null,
    offer: null,
    extraNote: null,
    features: [
      "3 Projects",
      "20 Tasks per project",
      "1 Workspace",
      "1 Team member (solo)",
      "Basic task management",
      "Community support",
    ],
    cta: "Use Free Plan",
    ctaVariant: "outline" as const,
    ctaLink: "/signup",
    highlighted: false,
    bottomNote: null,
  },
  {
    icon: Zap,
    name: "Basic",
    subtitle: "For students & individuals",
    price: { monthly: "£5", yearly: "£3.50" },
    period: "/month",
    originalPrice: { monthly: "£7.99", yearly: "£5" },
    badge: null,
    offer: "🎉 First 3 months offer",
    extraNote: null,
    features: [
      "15 Projects",
      "Unlimited tasks",
      "3 Workspaces",
      "Up to 3 team members",
      "5GB File storage",
      "AI assistant",
      "Time tracking & tags",
      "Task dependencies & subtasks",
      "Email support",
    ],
    cta: "Get Started",
    ctaVariant: "outline" as const,
    ctaLink: "/signup",
    highlighted: false,
    bottomNote: null,
  },
  {
    icon: Users,
    name: "Advanced",
    subtitle: "For growing teams up to 10",
    price: { monthly: "£45", yearly: "£37.50" },
    period: "/month",
    originalPrice: { monthly: "£50", yearly: "£45" },
    badge: "Most Popular",
    offer: "🎉 First month offer",
    extraNote: "+£2.99/member beyond 10",
    features: [
      "Unlimited projects",
      "Unlimited tasks",
      "10 Workspaces",
      "Up to 10 team members",
      "20GB File storage",
      "Everything in Basic",
      "Team collaboration",
      "Advanced analytics",
      "Timeline & Contracts",
      "Priority support",
    ],
    cta: "Get Started",
    ctaVariant: "default" as const,
    ctaLink: "/signup",
    highlighted: true,
    bottomNote: "Need more than 10 members? Upgrade to Premium",
  },
  {
    icon: Star,
    name: "Premium",
    subtitle: "For large teams & enterprises",
    price: { monthly: "Custom", yearly: "Custom" },
    period: "contact us",
    originalPrice: null,
    badge: null,
    offer: null,
    extraNote: null,
    features: [
      "Unlimited everything",
      "Unlimited workspaces",
      "Unlimited team members",
      "Unlimited storage",
      "Everything in Advanced",
    ],
    cta: "Talk to Us",
    ctaVariant: "secondary" as const,
    ctaLink: "mailto:smtkur31@gmail.com",
    highlighted: false,
    bottomNote: "Email us at smtkur31@gmail.com",
    ctaIcon: Mail,
  },
];

const PricingSection = () => {
  const [yearly, setYearly] = useState(false);

  return (
    <section id="pricing" className="py-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl sm:text-4xl font-extrabold text-foreground mb-4">
            Simple, transparent pricing
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
            You'll receive a confirmation when you buy and when your plan renews (monthly or yearly). Cancel anytime.
          </p>

          <div className="flex items-center justify-center gap-3">
            <span className={`text-sm font-medium ${!yearly ? "text-foreground" : "text-muted-foreground"}`}>Monthly</span>
            <button
              type="button"
              onClick={() => setYearly(!yearly)}
              className={`relative w-12 h-6 rounded-full transition-colors ${yearly ? "bg-primary" : "bg-muted"}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-background shadow transition-transform ${yearly ? "translate-x-6" : ""}`}
              />
            </button>
            <span className={`text-sm font-medium ${yearly ? "text-foreground" : "text-muted-foreground"}`}>Yearly</span>
            {yearly && (
              <span className="text-xs font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                Save ~2 months
              </span>
            )}
          </div>
        </motion.div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {plans.map((plan, i) => (
            <motion.div
              key={plan.name}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1, duration: 0.4 }}
              className={`relative bg-card rounded-2xl border p-6 flex flex-col ${
                plan.highlighted
                  ? "border-primary shadow-lg shadow-primary/10"
                  : "border-border"
              }`}
            >
              {plan.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-xs font-semibold px-3 py-1 rounded-full flex items-center gap-1">
                  <Star size={12} /> {plan.badge}
                </div>
              )}

              <div className="text-center mb-6">
                <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center mx-auto mb-3">
                  <plan.icon size={20} className="text-foreground" />
                </div>
                <h3 className="text-xl font-bold text-foreground">{plan.name}</h3>
                <p className="text-sm text-muted-foreground">{plan.subtitle}</p>
              </div>

              <div className="text-center mb-6">
                <div className="flex items-baseline justify-center gap-1">
                  {plan.originalPrice && (
                    <span className="text-sm text-muted-foreground line-through">
                      {yearly ? plan.originalPrice.yearly : plan.originalPrice.monthly}
                    </span>
                  )}
                  <span className="text-4xl font-extrabold text-foreground">
                    {yearly ? plan.price.yearly : plan.price.monthly}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">{plan.period}</p>
                {plan.offer && (
                  <span className="inline-block mt-2 text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                    {plan.offer}
                  </span>
                )}
                {plan.extraNote && (
                  <p className="text-xs text-primary mt-2 font-medium">{plan.extraNote}</p>
                )}
              </div>

              <ul className="space-y-2.5 mb-8 flex-1">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Check size={16} className="text-primary shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>

              {plan.ctaLink.startsWith("mailto:") ? (
                <Button
                  variant={plan.ctaVariant}
                  className={`w-full ${plan.ctaVariant === "secondary" ? "bg-foreground text-background hover:bg-foreground/90" : ""}`}
                  asChild
                >
                  <a href={plan.ctaLink}>
                    {"ctaIcon" in plan && <Mail size={16} className="mr-2" />}
                    {plan.cta}
                  </a>
                </Button>
              ) : (
                <Button
                  variant={plan.ctaVariant}
                  className={`w-full ${plan.highlighted ? "bg-primary text-primary-foreground hover:bg-primary/90" : ""} ${plan.ctaVariant === "secondary" ? "bg-foreground text-background hover:bg-foreground/90" : ""}`}
                  asChild
                >
                  <Link to={plan.ctaLink}>{plan.cta}</Link>
                </Button>
              )}

              {plan.bottomNote && (
                <p className="text-xs text-muted-foreground text-center mt-3">{plan.bottomNote}</p>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default PricingSection;
