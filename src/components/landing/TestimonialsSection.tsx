import { motion } from "framer-motion";
import { MessageSquare } from "lucide-react";

const TestimonialsSection = () => {
  return (
    <section id="testimonials" className="py-24 bg-secondary/30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center"
        >
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-6">
            <MessageSquare size={32} className="text-primary" />
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-foreground mb-4">
            Built for teams who ship
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            TaskCalendar is designed to help teams of all sizes organize their work,
            collaborate effectively, and deliver projects on time. Sign up and experience it yourself.
          </p>
        </motion.div>
      </div>
    </section>
  );
};

export default TestimonialsSection;
