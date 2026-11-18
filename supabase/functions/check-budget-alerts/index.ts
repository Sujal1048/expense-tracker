
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return Response.json(
      { error: "Method not allowed" },
      { status: 405, headers: corsHeaders },
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authorization = req.headers.get("Authorization");

    if (!authorization) {
      return Response.json(
        { error: "Authentication required" },
        { status: 401, headers: corsHeaders },
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: {
        headers: { Authorization: authorization },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return Response.json(
        { error: "Invalid or expired session" },
        { status: 401, headers: corsHeaders },
      );
    }

    // Use the same local calendar month as the expense tracker.
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    const monthStart = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const monthEnd = `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    const [expensesResult, budgetsResult] = await Promise.all([
      supabase
        .from("expenses")
        .select("amount, category")
        .eq("user_id", user.id)
        .gte("expense_date", monthStart)
        .lte("expense_date", monthEnd),

      supabase
        .from("budgets")
        .select("amount, category")
        .eq("user_id", user.id)
        .eq("month_start", monthStart),
    ]);

    if (expensesResult.error) throw expensesResult.error;
    if (budgetsResult.error) throw budgetsResult.error;

    const expenses = expensesResult.data ?? [];
    const budgets = budgetsResult.data ?? [];

    const totalSpent = expenses.reduce(
      (sum, expense) => sum + Number(expense.amount),
      0,
    );

    const alerts = budgets.flatMap((budget) => {
      const spent =
        budget.category === null
          ? totalSpent
          : expenses
              .filter((expense) => expense.category === budget.category)
              .reduce((sum, expense) => sum + Number(expense.amount), 0);

      const limit = Number(budget.amount);

      if (limit <= 0) return [];

      const percentage = (spent / limit) * 100;

      if (percentage < 80) return [];

      return [{
        category: budget.category ?? "Overall",
        spent: Number(spent.toFixed(2)),
        budget: limit,
        percentage: Number(percentage.toFixed(1)),
        level: percentage >= 100 ? "exceeded" : "warning",
        message:
          percentage >= 100
            ? `${budget.category ?? "Overall"} budget reached or exceeded.`
            : `${budget.category ?? "Overall"} budget is at least 80% used.`,
      }];
    });

    return Response.json(
      {
        month: monthStart,
        totalSpent: Number(totalSpent.toFixed(2)),
        alerts,
      },
      { headers: corsHeaders },
    );
  } catch (error) {
    console.error("Budget alert check failed:", error);

    return Response.json(
      { error: "Could not check budget alerts" },
      { status: 500, headers: corsHeaders },
    );
  }
});
