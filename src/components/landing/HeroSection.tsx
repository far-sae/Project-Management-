import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { ArrowRight, LayoutDashboard, Users, BarChart3 } from "lucide-react";
import { Link } from "react-router-dom";

const HeroSection = () => {
  return (
    <section className="relative pt-[calc(8rem+1px)] pb-20 overflow-hidden">
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-20 left-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-80 h-80 bg-orange-500/5 rounded-full blur-3xl" />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7 }}
          >
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-tight tracking-tight mb-6">
              Organize work.{" "}
              <span className="text-gradient">Deliver results.</span>
            </h1>

            <p className="text-lg text-muted-foreground max-w-lg mb-8 leading-relaxed">
              The all-in-one project management platform that helps your team plan, track, and ship
              faster — with boards, timelines, and real-time collaboration.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 max-w-md mb-8">
              <Button size="lg" className="h-12 px-6 shrink-0" asChild>
                <Link to="/signup">
                  Get Started Free <ArrowRight size={16} />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="h-12 px-6" asChild>
                <Link to="/login">Log in</Link>
              </Button>
            </div>

            <p className="text-sm text-muted-foreground">
              No credit card required
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="relative"
          >
            <div className="relative bg-card rounded-2xl border border-border shadow-2xl shadow-primary/10 p-6 overflow-hidden">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-3 h-3 rounded-full bg-destructive/60" />
                <div className="w-3 h-3 rounded-full bg-primary/60" />
                <div className="w-3 h-3 rounded-full bg-orange-500/60" />
                <span className="ml-3 text-xs font-semibold text-foreground/90">TaskCalendar — Sprint Board</span>
              </div>

              <div className="grid grid-cols-3 gap-3">
                {[
                  { title: "To Do", color: "bg-muted", items: ["Design homepage", "Write API docs"] },
                  { title: "In Progress", color: "bg-primary/10", items: ["Build dashboard", "User auth"] },
                  { title: "Done", color: "bg-orange-500/10", items: ["Setup CI/CD", "DB schema"] },
                ].map((col) => (
                  <div key={col.title} className={`${col.color} rounded-lg p-3`}>
                    <p className="text-xs font-semibold text-foreground mb-2">{col.title}</p>
                    {col.items.map((item) => (
                      <div key={item} className="bg-background rounded-md p-2 mb-2 shadow-sm border border-border">
                        <p className="text-xs text-foreground">{item}</p>
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              <div className="absolute -top-3 -right-3 bg-primary text-primary-foreground rounded-full p-2 shadow-lg">
                <LayoutDashboard size={16} />
              </div>
            </div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6, duration: 0.5 }}
              className="absolute -bottom-4 -left-4 bg-card rounded-xl border border-border shadow-lg p-3 flex items-center gap-2"
            >
              <Users size={16} className="text-primary" />
              <span className="text-xs font-medium text-foreground">Team collaboration</span>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.8, duration: 0.5 }}
              className="absolute -top-4 -left-6 bg-card rounded-xl border border-border shadow-lg p-3 flex items-center gap-2"
            >
              <BarChart3 size={16} className="text-orange-500" />
              <span className="text-xs font-medium text-foreground">Track progress</span>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
