import { supabase } from "./config";
import { Contract } from "./contracts";
import { format, subMonths, differenceInDays } from "date-fns";

export interface ContractMetrics {
  totalContracts: number;
  totalValue: number;
  averageValue: number;
  byStatus: {
    draft: number;
    pending: number;
    accepted: number;
    expired: number;
  };
  byCurrency: Array<{
    currency: string;
    count: number;
    totalValue: number;
    symbol: string;
  }>;
  byClient: Array<{
    clientName: string;
    count: number;
    totalValue: number;
    contracts: Contract[];
  }>;
  monthlyValue: Array<{
    month: string;
    value: number;
    count: number;
  }>;
  expiringSoon: Contract[];
  recentlyCreated: Contract[];
}

export interface RevenueMetrics {
  totalRevenue: number;
  monthlyRecurringRevenue: number;
  annualRunRate: number;
  byPlan: Array<{
    plan: string;
    count: number;
    revenue: number;
  }>;
  monthly: Array<{
    month: string;
    subscription: number;
    contracts: number;
    total: number;
  }>;
}

export interface BusinessMetrics {
  contracts: ContractMetrics;
  revenue: RevenueMetrics;
  health: {
    activeContracts: number;
    expiringNext30Days: number;
    averageContractDuration: number;
    contractConversionRate: number;
    topPerformingClients: Array<{
      clientName: string;
      totalValue: number;
      contractCount: number;
    }>;
  };
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  GBP: "£",
  EUR: "€",
  INR: "₹",
  AED: "د.إ",
};

export class BusinessReportingService {
  // ── Contract Metrics ──────────────────────────────────
  static async getContractMetrics(
    organizationId: string,
    startDate?: Date,
    endDate?: Date,
  ): Promise<ContractMetrics> {
    try {
      // Get all contracts for the organization
      const { data: contracts, error } = await supabase
        .from("contracts")
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false });

      if (error) throw error;

      const typedContracts = (contracts || []).map(this.mapContract);

      // Filter by date range if provided
      const filteredContracts = typedContracts.filter((c) => {
        if (!startDate || !endDate) return true;
        const created = new Date(c.createdAt);
        return created >= startDate && created <= endDate;
      });

      // Basic metrics
      const totalContracts = filteredContracts.length;
      const totalValue = filteredContracts.reduce(
        (sum, c) => sum + (c.value || 0),
        0,
      );
      const averageValue = totalContracts > 0 ? totalValue / totalContracts : 0;

      // By status
      const byStatus = {
        draft: filteredContracts.filter((c) => c.status === "draft").length,
        pending: filteredContracts.filter((c) => c.status === "pending").length,
        accepted: filteredContracts.filter((c) => c.status === "accepted")
          .length,
        expired: filteredContracts.filter((c) => c.status === "expired").length,
      };

      // By currency
      const currencyMap = new Map<
        string,
        { count: number; totalValue: number }
      >();
      filteredContracts.forEach((c) => {
        const curr = c.currency || "USD";
        const current = currencyMap.get(curr) || { count: 0, totalValue: 0 };
        currencyMap.set(curr, {
          count: current.count + 1,
          totalValue: current.totalValue + (c.value || 0),
        });
      });

      const byCurrency = Array.from(currencyMap.entries()).map(
        ([currency, data]) => ({
          currency,
          count: data.count,
          totalValue: data.totalValue,
          symbol: CURRENCY_SYMBOLS[currency] || "$",
        }),
      );

      // By client
      const clientMap = new Map<
        string,
        { count: number; totalValue: number; contracts: Contract[] }
      >();
      filteredContracts.forEach((c) => {
        const client = c.client || "Unknown";
        const current = clientMap.get(client) || {
          count: 0,
          totalValue: 0,
          contracts: [],
        };
        clientMap.set(client, {
          count: current.count + 1,
          totalValue: current.totalValue + (c.value || 0),
          contracts: [...current.contracts, c],
        });
      });

      const byClient = Array.from(clientMap.entries())
        .map(([clientName, data]) => ({
          clientName,
          count: data.count,
          totalValue: data.totalValue,
          contracts: data.contracts,
        }))
        .sort((a, b) => b.totalValue - a.totalValue);

      // Monthly value
      const monthlyMap = new Map<string, { value: number; count: number }>();
      filteredContracts.forEach((c) => {
        const month = format(new Date(c.createdAt), "MMM yyyy");
        const current = monthlyMap.get(month) || { value: 0, count: 0 };
        monthlyMap.set(month, {
          value: current.value + (c.value || 0),
          count: current.count + 1,
        });
      });

      const monthlyValue = Array.from(monthlyMap.entries())
        .map(([month, data]) => ({
          month,
          value: data.value,
          count: data.count,
        }))
        .sort((a, b) => {
          const dateA = new Date(a.month);
          const dateB = new Date(b.month);
          return dateA.getTime() - dateB.getTime();
        });

      // Expiring soon (next 30 days)
      const today = new Date();
      const next30Days = new Date();
      next30Days.setDate(today.getDate() + 30);

      const expiringSoon = typedContracts
        .filter(
          (c) =>
            c.status === "accepted" &&
            c.endDate &&
            new Date(c.endDate) >= today &&
            new Date(c.endDate) <= next30Days,
        )
        .sort((a, b) => {
          if (!a.endDate || !b.endDate) return 0;
          return new Date(a.endDate).getTime() - new Date(b.endDate).getTime();
        });

      // Recently created
      const recentlyCreated = typedContracts
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        )
        .slice(0, 10);

      return {
        totalContracts,
        totalValue,
        averageValue,
        byStatus,
        byCurrency,
        byClient,
        monthlyValue,
        expiringSoon,
        recentlyCreated,
      };
    } catch (error) {
      console.error("Error getting contract metrics:", error);
      throw error;
    }
  }

  // ── Revenue Metrics ───────────────────────────────────
  static async getRevenueMetrics(
    organizationId: string,
  ): Promise<RevenueMetrics> {
    try {
      // Get subscriptions
      const { data: subscriptions, error: subError } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("organization_id", organizationId);

      if (subError) throw subError;

      // Get contracts with values
      const { data: contracts, error: contractError } = await supabase
        .from("contracts")
        .select("*")
        .eq("organization_id", organizationId);

      if (contractError) throw contractError;

      const typedSubscriptions = subscriptions || [];
      const typedContracts = (contracts || []).map(this.mapContract);

      // Plan pricing (you can move this to a config file)
      const PLAN_PRICES: Record<string, number> = {
        basic: 29,
        advanced: 79,
        premium: 199,
      };

      // Calculate MRR from active subscriptions
      const activeSubscriptions = typedSubscriptions.filter(
        (s) => s.status === "active",
      );
      const mrr = activeSubscriptions.reduce((sum, sub) => {
        const price = PLAN_PRICES[sub.plan as string] || 0;
        return sum + (sub.billing_cycle === "yearly" ? price / 12 : price);
      }, 0);

      // Revenue by plan
      const planMap = new Map<string, { count: number; revenue: number }>();
      activeSubscriptions.forEach((sub) => {
        const plan = (sub.plan as string) || "basic";
        const price = PLAN_PRICES[plan] || 0;
        const monthlyPrice =
          sub.billing_cycle === "yearly" ? price / 12 : price;
        const current = planMap.get(plan) || { count: 0, revenue: 0 };
        planMap.set(plan, {
          count: current.count + 1,
          revenue: current.revenue + monthlyPrice,
        });
      });

      const byPlan = Array.from(planMap.entries()).map(([plan, data]) => ({
        plan: plan.charAt(0).toUpperCase() + plan.slice(1),
        count: data.count,
        revenue: data.revenue,
      }));

      // Monthly revenue (last 12 months)
      const monthlyMap = new Map<
        string,
        { subscription: number; contracts: number; total: number }
      >();

      for (let i = 11; i >= 0; i--) {
        const date = subMonths(new Date(), i);
        const monthKey = format(date, "MMM yyyy");
        monthlyMap.set(monthKey, { subscription: 0, contracts: 0, total: 0 });
      }

      // Add subscription revenue
      typedSubscriptions.forEach((sub) => {
        if (sub.status === "active" && sub.created_at) {
          const monthKey = format(new Date(sub.created_at), "MMM yyyy");
          const price = PLAN_PRICES[sub.plan as string] || 0;
          const monthlyPrice =
            sub.billing_cycle === "yearly" ? price / 12 : price;

          if (monthlyMap.has(monthKey)) {
            const current = monthlyMap.get(monthKey)!;
            monthlyMap.set(monthKey, {
              ...current,
              subscription: current.subscription + monthlyPrice,
              total: current.total + monthlyPrice,
            });
          }
        }
      });

      // Add contract revenue (one-time payments)
      typedContracts.forEach((contract) => {
        if (contract.value && contract.status === "accepted") {
          const monthKey = format(new Date(contract.createdAt), "MMM yyyy");
          if (monthlyMap.has(monthKey)) {
            const current = monthlyMap.get(monthKey)!;
            monthlyMap.set(monthKey, {
              ...current,
              contracts: current.contracts + contract.value,
              total: current.total + contract.value,
            });
          }
        }
      });

      const monthly = Array.from(monthlyMap.entries()).map(([month, data]) => ({
        month,
        subscription: data.subscription,
        contracts: data.contracts,
        total: data.total,
      }));

      return {
        totalRevenue: typedContracts.reduce(
          (sum, c) => sum + (c.value || 0),
          0,
        ),
        monthlyRecurringRevenue: mrr,
        annualRunRate: mrr * 12,
        byPlan,
        monthly,
      };
    } catch (error) {
      console.error("Error getting revenue metrics:", error);
      throw error;
    }
  }

  // ── Business Health Metrics ───────────────────────────
  static async getBusinessMetrics(
    organizationId: string,
  ): Promise<BusinessMetrics> {
    try {
      const [contracts, revenue] = await Promise.all([
        this.getContractMetrics(organizationId),
        this.getRevenueMetrics(organizationId),
      ]);

      // Calculate average contract duration
      const contractsWithDuration = contracts.byClient
        .flatMap((c) => c.contracts)
        .filter((c) => c.startDate && c.endDate);

      const totalDuration = contractsWithDuration.reduce((sum, c) => {
        const start = new Date(c.startDate!);
        const end = new Date(c.endDate!);
        return sum + differenceInDays(end, start);
      }, 0);

      const averageContractDuration =
        contractsWithDuration.length > 0
          ? Math.round(totalDuration / contractsWithDuration.length)
          : 0;

      // Contract conversion rate (signed vs total)
      const totalContracts = contracts.totalContracts;
      const signedContracts =
        contracts.byStatus.accepted + contracts.byStatus.expired;
      const contractConversionRate =
        totalContracts > 0 ? (signedContracts / totalContracts) * 100 : 0;

      // Top performing clients
      const topPerformingClients = contracts.byClient.slice(0, 5).map((c) => ({
        clientName: c.clientName,
        totalValue: c.totalValue,
        contractCount: c.count,
      }));

      // Expiring in next 30 days
      const today = new Date();
      const next30Days = new Date();
      next30Days.setDate(today.getDate() + 30);

      const expiringNext30Days = contracts.expiringSoon.length;

      return {
        contracts,
        revenue,
        health: {
          activeContracts: contracts.byStatus.accepted,
          expiringNext30Days,
          averageContractDuration,
          contractConversionRate,
          topPerformingClients,
        },
      };
    } catch (error) {
      console.error("Error getting business metrics:", error);
      throw error;
    }
  }

  // ── Export Functions ──────────────────────────────────
  static async exportReport(
    organizationId: string,
    format: "pdf" | "excel" | "csv" = "csv",
  ): Promise<Blob> {
    const metrics = await this.getBusinessMetrics(organizationId);

    const reportData = {
      generatedAt: new Date().toISOString(),
      organizationId,
      metrics,
    };

    switch (format) {
      case "csv":
        return this.generateCSV(reportData);
      case "excel":
        return this.generateExcel(reportData);
      case "pdf":
        return this.generatePDF(reportData);
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  private static generateCSV(data: any): Blob {
    const rows = [
      ["Business Report", new Date().toLocaleDateString()],
      [],
      ["Contract Metrics", "Value"],
      ["Total Contracts", data.metrics.contracts.totalContracts],
      ["Total Value", data.metrics.contracts.totalValue],
      ["Average Value", data.metrics.contracts.averageValue],
      [],
      ["By Status", "Count"],
      ["Draft", data.metrics.contracts.byStatus.draft],
      ["Pending", data.metrics.contracts.byStatus.pending],
      ["Accepted", data.metrics.contracts.byStatus.accepted],
      ["Expired", data.metrics.contracts.byStatus.expired],
      [],
      ["Revenue Metrics", "Value"],
      [
        "Monthly Recurring Revenue",
        data.metrics.revenue.monthlyRecurringRevenue,
      ],
      ["Annual Run Rate", data.metrics.revenue.annualRunRate],
      [],
      ["Health Metrics", "Value"],
      ["Active Contracts", data.metrics.health.activeContracts],
      ["Expiring in 30 Days", data.metrics.health.expiringNext30Days],
      [
        "Avg Contract Duration",
        `${data.metrics.health.averageContractDuration} days`,
      ],
      [
        "Conversion Rate",
        `${data.metrics.health.contractConversionRate.toFixed(1)}%`,
      ],
    ];

    const csv = rows.map((row) => row.join(",")).join("\n");
    return new Blob([csv], { type: "text/csv" });
  }

  private static generateExcel(data: any): Blob {
    // For simplicity, return CSV with .xls extension
    const csv = this.generateCSV(data);
    return new Blob([csv], { type: "application/vnd.ms-excel" });
  }

  private static generatePDF(data: any): Blob {
    // For simplicity, return JSON
    // In production, use a library like jsPDF or react-pdf
    const json = JSON.stringify(data, null, 2);
    return new Blob([json], { type: "application/pdf" });
  }

  private static mapContract(data: any): Contract {
    return {
      contractId: data.contract_id,
      organizationId: data.organization_id,
      title: data.title,
      client: data.client,
      status: data.status || "draft",
      currency: data.currency || "USD",
      value: data.value != null ? Number(data.value) : undefined,
      startDate: data.start_date ? new Date(data.start_date) : undefined,
      endDate: data.end_date ? new Date(data.end_date) : undefined,
      createdBy: data.created_by,
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at),
    };
  }
}
