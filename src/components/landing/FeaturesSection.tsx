import { motion } from "framer-motion";
import { LayoutList, MessageSquare, BarChart3, Calendar, Users, Zap } from "lucide-react";

const features = [
  {
    icon: LayoutList,
    title: "Organize Everything",
    description: "Manage tasks with assignees, due dates, priorities, and custom tags. Keep every project structured and on track.",
  },
  {
    icon: MessageSquare,
    title: "Communicate Seamlessly",
    description: "Built-in conversations, comments, and real-time updates keep your entire team aligned without switching tools.",
  },
  {
    icon: BarChart3,
    title: "Visualize Progress",
    description: "Switch between board, list, and timeline views. Dashboards give you instant insight into project health.",
  },
  {
    icon: Calendar,
    title: "Plan with Timelines",
    description: "Gantt-style timelines let you map dependencies, set milestones, and see the big picture at a glance.",
  },
  {
    icon: Users,
    title: "Collaborate in Real-Time",
    description: "Invite your team, assign roles, and work together with live cursors, mentions, and instant notifications.",
  },
  {
    icon: Zap,
    title: "Automate Workflows",
    description: "Set up rules to automate repetitive tasks — move cards, assign owners, and send reminders automatically.",
  },
];

const FeaturesSection = () => {
  return (
    <section id="features" className="py-24 bg-secondary/30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl sm:text-4xl font-extrabold text-foreground mb-4">
            Everything your team needs
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            From planning to delivery, TaskCalendar gives your team the tools to move fast and stay organized.
          </p>
        </motion.div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((feature, i) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.1 }}
              className="bg-card rounded-2xl border border-border p-8 hover:shadow-lg hover:shadow-primary/5 transition-shadow"
            >
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-5">
                <feature.icon size={24} className="text-primary" />
              </div>
              <h3 className="text-lg font-bold text-foreground mb-2">{feature.title}</h3>
              <p className="text-muted-foreground leading-relaxed">{feature.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default FeaturesSection;
