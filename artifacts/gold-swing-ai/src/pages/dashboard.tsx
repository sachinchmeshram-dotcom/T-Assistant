import { Header } from "@/components/layout/header";
import { ChartWidget } from "@/components/trading/chart-widget";
import { SignalPanel } from "@/components/trading/signal-panel";
import { IndicatorsRow } from "@/components/trading/indicators-row";
import { HistoryTable } from "@/components/trading/history-table";
import { AnalyticsPanel } from "@/components/trading/analytics-panel";
import { motion } from "framer-motion";

export default function Dashboard() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      
      <main className="flex-grow container mx-auto px-4 py-6 md:py-8 flex flex-col gap-6 md:gap-8">
        {/* Top Section: Chart + Signal */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
          
          {/* Left Column (Chart) */}
          <motion.div 
            className="lg:col-span-7 xl:col-span-8 h-[500px] lg:h-auto min-h-[500px]"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <ChartWidget />
          </motion.div>

          {/* Right Column (Signal) */}
          <motion.div 
            className="lg:col-span-5 xl:col-span-4"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            <SignalPanel />
          </motion.div>
          
        </div>

        {/* Indicators Row */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <IndicatorsRow />
        </motion.div>

        {/* Bottom Section: History + Right Panel */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 pb-12">
          
          {/* Signal History */}
          <motion.div 
            className="lg:col-span-8"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
            <HistoryTable />
          </motion.div>

          {/* Right column: AI Learning */}
          <div className="lg:col-span-4 flex flex-col gap-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.35 }}
            >
              <AnalyticsPanel />
            </motion.div>
          </div>

        </div>
      </main>
    </div>
  );
}
