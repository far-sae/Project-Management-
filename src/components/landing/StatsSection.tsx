import { motion } from "framer-motion";
import { CheckCircle, Users, FolderKanban, Clock } from "lucide-react";

const stats = [
  { icon: Users, label: "Team Collaboration", description: "Work together in real-time with your entire team" },
  { icon: FolderKanban, label: "Project Boards", description: "Organize tasks with flexible Kanban boards" },
  { icon: CheckCircle, label: "Task Tracking", description: "Never lose track of what needs to be done" },
  { icon: Clock, label: "Timeline Views", description: "Plan and visualize your project schedule" },
];

const StatsSection = () => {
  return (
    <section className="py-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
          {stats.map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.1 }}
              className="text-center"
            >
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                <stat.icon size={24} className="text-primary" />
              </div>
              <p className="font-bold text-foreground mb-1">{stat.label}</p>
              <p className="text-sm text-muted-foreground">{stat.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default StatsSection;
