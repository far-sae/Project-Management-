import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

const CTASection = () => {
  return (
    <section id="cta" className="py-24">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="relative rounded-3xl overflow-hidden p-12 sm:p-16 text-center bg-gradient-to-br from-orange-500 to-red-500"
        >
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white mb-4">
            Ready to transform how your team works?
          </h2>
          <p className="text-lg text-white/90 max-w-xl mx-auto mb-8">
            Join thousands of teams already using TaskCalendar to ship faster, stay organized, and collaborate better.
          </p>
          <Button
            size="lg"
            variant="secondary"
            className="h-12 px-8 text-base font-semibold"
            asChild
          >
            <Link to="/signup">
              Get Started Free <ArrowRight size={18} />
            </Link>
          </Button>
          <p className="text-sm text-white/70 mt-4">
            No credit card required · Free forever for small teams
          </p>
        </motion.div>
      </div>
    </section>
  );
};

export default CTASection;
