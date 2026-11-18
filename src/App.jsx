
import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import './index.css';

import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Tooltip,
  Sector,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';

const CATEGORIES = [
  'Food',
  'Transport',
  'Shopping',
  'Education',
  'Entertainment',
  'Bills',
  'Healthcare',
  'Other',
];

const PAYMENT_METHODS = ['UPI', 'Cash', 'Card', 'Bank Transfer', 'Other'];

function localDate() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function emptyForm() {
  return {
    title: '',
    amount: '',
    category: 'Food',
    expense_date: localDate(),
    payment_method: 'UPI',
    notes: '',
  };
}

function formatMoney(value) {
  return Number(value).toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
  });
}


function currentMonthStart() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');

  return `${year}-${month}-01`;
}

function currentMonthEnd() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');

  const lastDay = new Date(
    date.getFullYear(),
    date.getMonth() + 1,
    0
  ).getDate();

  return `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
}


function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState('login');
  const [serverlessAlerts, setServerlessAlerts] = useState([]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const [expenses, setExpenses] = useState([]);
  const [expensesLoading, setExpensesLoading] = useState(false);
  
  const [budgets, setBudgets] = useState([]);
  const [budgetAmount, setBudgetAmount] = useState('');
  const [budgetCategory, setBudgetCategory] = useState('All');
  const [budgetsLoading, setBudgetsLoading] = useState(false);
  const [budgetSaving, setBudgetSaving] = useState(false);

  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('All');

  const [selectedReportMonth, setSelectedReportMonth] = useState(
    localDate().slice(0, 7)
  );

  // Restore the session and subscribe to authentication changes.
  useEffect(() => {
    let mounted = true;

    async function loadSession() {
      const { data, error } = await supabase.auth.getSession();

      if (!mounted) return;

      if (error) setMessage(error.message);
      else setSession(data.session);

      setLoading(false);
    }

    loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);
  
  useEffect(() => {
    if (!session?.user) {
      setServerlessAlerts([]);
      return;
    }

    checkBudgetAlerts();
  }, [session?.user?.id]);

  
  async function checkBudgetAlerts() {
    const { data, error } = await supabase.functions.invoke(
      'check-budget-alerts',
      {
        body: {},
      }
    );

    if (error) {
      console.error('Budget alert check failed:', error);
      return;
    }

    setServerlessAlerts(data?.alerts ?? []);
  }


  // Load only the authenticated user's permitted expenses.
  async function loadExpenses() {
    setExpensesLoading(true);

    const { data, error } = await supabase
      .from('expenses')
      .select('*')
      .order('expense_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      setMessage(`Could not load expenses: ${error.message}`);
    } else {
      setExpenses(data ?? []);
    }

    setExpensesLoading(false);
  }

  async function loadBudgets() {
    setBudgetsLoading(true);

    const { data, error } = await supabase
      .from('budgets')
      .select('*')
      .eq('month_start', currentMonthStart())
      .order('category');

    if (error) {
      setMessage(`Could not load budgets: ${error.message}`);
    } else {
      setBudgets(data ?? []);
    }

    setBudgetsLoading(false);
  }


  useEffect(() => {
    const userId = session?.user?.id;

    if (!userId) {
      setExpenses([]);
      return;
    }

    loadExpenses();

    const channel = supabase
      .channel(`expenses-realtime-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'expenses',
        },
        () => {
          loadExpenses();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  
  useEffect(() => {
    const userId = session?.user?.id;

    if (!userId) {
      setBudgets([]);
      return;
    }

    loadBudgets();

    const channel = supabase
      .channel(`budgets-realtime-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'budgets',
        },
        () => {
          loadBudgets();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);


  function updateField(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  function resetForm() {
    setForm(emptyForm());
    setEditingId(null);
  }

  function startEditing(expense) {
    setForm({
      title: expense.title,
      amount: String(expense.amount),
      category: expense.category,
      expense_date: expense.expense_date,
      payment_method: expense.payment_method || 'UPI',
      notes: expense.notes || '',
    });

    setEditingId(expense.id);
    setMessage('');

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleSaveExpense(event) {
    event.preventDefault();
    setMessage('');

    if (!session?.user) {
      setMessage('Please log in before saving an expense.');
      return;
    }

    const title = form.title.trim();
    const amount = Number(form.amount);

    if (!title || title.length > 120) {
      setMessage('Title must contain 1–120 characters.');
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0 || amount > 9999999999.99) {
      setMessage('Enter a valid positive amount.');
      return;
    }

    if (!CATEGORIES.includes(form.category)) {
      setMessage('Select a valid category.');
      return;
    }

    if (!form.expense_date || form.expense_date > localDate()) {
      setMessage('Select a valid expense date, not a future date.');
      return;
    }

    setSaving(true);

    const expenseData = {
      title,
      amount: amount.toFixed(2),
      category: form.category,
      expense_date: form.expense_date,
      payment_method: form.payment_method,
      notes: form.notes.trim() || null,
    };

    try {
      let result;

      if (editingId) {
        // RLS ensures this update can affect only the owner's row.
        result = await supabase
          .from('expenses')
          .update(expenseData)
          .eq('id', editingId)
          .select()
          .maybeSingle();
      } else {
        result = await supabase
          .from('expenses')
          .insert({
            ...expenseData,
            user_id: session.user.id,
          })
          .select()
          .single();
      }

      if (result.error) throw result.error;

      if (editingId && !result.data) {
        throw new Error('Expense not found or access denied.');
      }

      resetForm();
      setMessage(editingId
        ? 'Expense updated successfully.'
        : 'Expense added successfully.');

      await loadExpenses();
      await checkBudgetAlerts();
    } catch (error) {
      setMessage(error.message || 'Could not save expense.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteExpense(id) {
    const confirmed = window.confirm(
      'Are you sure you want to delete this expense? This cannot be undone.'
    );

    if (!confirmed) return;

    setDeletingId(id);
    setMessage('');

    try {
      const { data, error } = await supabase
        .from('expenses')
        .delete()
        .eq('id', id)
        .select('id')
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        throw new Error('Expense not found or access denied.');
      }

      if (editingId === id) resetForm();

      setMessage('Expense deleted successfully.');
      await loadExpenses();
      await checkBudgetAlerts();
    } catch (error) {
      setMessage(error.message || 'Could not delete expense.');
    } finally {
      setDeletingId(null);
    }
  }

  async function handleSaveBudget(event) {
    event.preventDefault();
    setMessage('');

    if (!session?.user) {
      setMessage('Please log in before saving a budget.');
      return;
    }

    const amount = Number(budgetAmount);

    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage('Enter a valid positive budget amount.');
      return;
    }

    if (amount > 9999999999.99) {
      setMessage('The budget amount is too large.');
      return;
    }

    setBudgetSaving(true);

    try {
      const monthStart = currentMonthStart();

      // Find an existing budget for this month and category.
      let lookup = supabase
        .from('budgets')
        .select('id')
        .eq('month_start', monthStart);

      if (budgetCategory === 'All') {
        lookup = lookup.is('category', null);
      } else {
        lookup = lookup.eq('category', budgetCategory);
      }

      const { data: existing, error: lookupError } =
        await lookup.maybeSingle();

      if (lookupError) throw lookupError;

      const budgetData = {
        user_id: session.user.id,
        month_start: monthStart,
        category: budgetCategory === 'All' ? null : budgetCategory,
        amount: amount.toFixed(2),
      };

      let saveResult;

      if (existing) {
        saveResult = await supabase
          .from('budgets')
          .update({ amount: budgetData.amount })
          .eq('id', existing.id)
          .select()
          .single();
      } else {
        saveResult = await supabase
          .from('budgets')
          .insert(budgetData)
          .select()
          .single();
      }

      if (saveResult.error) throw saveResult.error;

      setBudgetAmount('');
      setMessage(
        `${budgetCategory === 'All' ? 'Monthly' : budgetCategory} budget saved successfully.`
      );

      await loadBudgets();
      await checkBudgetAlerts();
    } catch (error) {
      setMessage(error.message || 'Could not save budget.');
    } finally {
      setBudgetSaving(false);
    }
  }

  async function handleAuth(event) {
    event.preventDefault();
    setMessage('');
    setBusy(true);

    try {
      if (mode === 'register') {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: window.location.origin,
          },
        });

        if (error) throw error;

        setMessage(
          data.session
            ? 'Account created successfully!'
            : 'Registration submitted. Check your email to confirm your account.'
        );
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (error) throw error;

        setMessage('Logged in successfully!');
      }
    } catch (error) {
      setMessage(error.message || 'Authentication failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    const { error } = await supabase.auth.signOut();

    if (error) {
      setMessage(error.message);
      return;
    }

    setExpenses([]);
    resetForm();
    setEmail('');
    setPassword('');
    setMessage('');
  }

  if (loading) {
    return <main className="page"><p>Loading...</p></main>;
  }

  if (!session) {
    return (
      <main className="page">
        <section className="auth-card">
          <p className="eyebrow">PERSONAL FINANCE</p>
          <h1>Cloud Expense Tracker</h1>
          <p className="muted">
            Manage your expenses securely, wherever you are.
          </p>

          <div className="tabs">
            <button
              type="button"
              className={mode === 'login' ? 'active' : ''}
              onClick={() => {
                setMode('login');
                setMessage('');
              }}
            >
              Login
            </button>
            <button
              type="button"
              className={mode === 'register' ? 'active' : ''}
              onClick={() => {
                setMode('register');
                setMessage('');
              }}
            >
              Register
            </button>
          </div>

          <form onSubmit={handleAuth}>
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />

            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              required
            />

            <button className="primary-button" disabled={busy}>
              {busy
                ? 'Please wait...'
                : mode === 'register'
                  ? 'Create account'
                  : 'Login'}
            </button>
          </form>

          {message && <p className="message" role="status">{message}</p>}
        </section>
      </main>
    );
  }

  const filteredExpenses = expenses.filter((expense) => {
    const query = search.trim().toLowerCase();

    const matchesSearch =
      !query ||
      expense.title.toLowerCase().includes(query) ||
      expense.category.toLowerCase().includes(query) ||
      (expense.notes || '').toLowerCase().includes(query);

    const matchesCategory =
      filterCategory === 'All' || expense.category === filterCategory;

    return matchesSearch && matchesCategory;
  });

  const reportExpenses = expenses.filter(
    (expense) =>
      expense.expense_date.slice(0, 7) === selectedReportMonth
  );

  const reportTotal = reportExpenses.reduce(
    (sum, expense) => sum + Number(expense.amount),
    0
  );

  const averageExpense = reportExpenses.length
    ? reportTotal / reportExpenses.length
    : 0;

  // Group expenses by category.
  const categoryTotals = Object.values(
    reportExpenses.reduce((groups, expense) => {
      const category = expense.category || 'Other';

      if (!groups[category]) {
        groups[category] = { name: category, amount: 0 };
      }

      groups[category].amount += Number(expense.amount);

      return groups;
    }, {})
  ).sort((a, b) => b.amount - a.amount);

  // Identify the highest-spending category.
  const topCategory = categoryTotals[0] ?? null;

  // Prepare the last six calendar months for the bar chart.
  const monthlyTrend = Array.from({ length: 6 }, (_, index) => {
    const now = new Date();

    const monthDate = new Date(
      now.getFullYear(),
      now.getMonth() - (5 - index),
      1
    );

    const year = monthDate.getFullYear();
    const month = String(monthDate.getMonth() + 1).padStart(2, '0');
    const key = `${year}-${month}`;

    const total = expenses.reduce((sum, expense) => {
      return expense.expense_date.startsWith(key)
        ? sum + Number(expense.amount)
        : sum;
    }, 0);

    return {
      month: monthDate.toLocaleDateString('en-IN', {
        month: 'short',
        year: '2-digit',
      }),
      total: Number(total.toFixed(2)),
    };
  });

  // Colours for the category chart.
  const chartColors = [
    '#478568',
    '#5688D8',
    '#D9A14B',
    '#9875C9',
    '#6D9C9C',
    '#D47765',
    '#8A9A5B',
    '#8A8F98',
  ];

  const monthStart = currentMonthStart();
  const monthEnd = currentMonthEnd();

  const monthlyExpenses = expenses.filter(
    (expense) =>
      expense.expense_date >= monthStart &&
      expense.expense_date <= monthEnd
  );

  const monthlySpent = monthlyExpenses.reduce(
    (total, expense) => total + Number(expense.amount),
    0
  );

  const overallBudget = budgets.find(
    (budget) => budget.category === null
  );

  const budgetLimit = Number(overallBudget?.amount ?? 0);

  const budgetRemaining = budgetLimit - monthlySpent;

  const budgetPercentage = budgetLimit > 0
    ? (monthlySpent / budgetLimit) * 100
    : 0;


  const totalSpent = expenses.reduce(
    (total, expense) => total + Number(expense.amount),
    0
  );

  return (
    <main className="page">
      <section className="dashboard">
        <header className="dashboard-header">
          <div>
            <p className="eyebrow">PERSONAL FINANCE</p>
            <h1>My Dashboard</h1>
            <p className="muted">{session.user.email}</p>
          </div>

          <button className="secondary-button" onClick={handleLogout}>
            Logout
          </button>
        </header>
        
        <section className="serverless-alerts">
          <h2>Serverless Budget Alerts</h2>

          {serverlessAlerts.length === 0 ? (
            <p>
              No serverless budget alerts at 80% or above.
            </p>
          ) : (
            <div>
              {serverlessAlerts.map((alert, index) => (
                <div
                  key={`${alert.category}-${index}`}
                  className="budget-alert"
                >
                  <h3>
                    {alert.level === 'exceeded'
                      ? 'Budget Exceeded'
                      : 'Budget Warning'}
                  </h3>

                  <p>{alert.message}</p>

                  <p>
                    Category: {alert.category}
                  </p>

                  <p>
                    Spent: ₹{Number(alert.spent).toFixed(2)}
                    {' / '}
                    Budget: ₹{Number(alert.budget).toFixed(2)}
                  </p>

                  <p>
                    Used: {alert.percentage}%
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>


        <section className="summary-card">
          <p>Total expenses in loaded records</p>
          <h2>{formatMoney(totalSpent)}</h2>
          <p className="muted">
            {expenses.length} transaction(s), latest 100 records.
          </p>
        </section>

        <section className="transactions">
          <h2>Monthly budget</h2>

          <p className="muted">
            Set a spending limit for {new Date().toLocaleDateString('en-IN', {
              month: 'long',
              year: 'numeric',
            })}.
          </p>

          <form onSubmit={handleSaveBudget} className="expense-form">
            <label htmlFor="budgetCategory">Budget type</label>

            <select
              id="budgetCategory"
              value={budgetCategory}
              onChange={(event) => setBudgetCategory(event.target.value)}
            >
              <option value="All">Overall monthly budget</option>

              {CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category} budget
                </option>
              ))}
            </select>

            <label htmlFor="budgetAmount">Budget limit (₹)</label>

            <input
              id="budgetAmount"
              type="number"
              min="0.01"
              max="9999999999.99"
              step="0.01"
              value={budgetAmount}
              onChange={(event) => setBudgetAmount(event.target.value)}
              placeholder="e.g. 10000"
              required
            />

            <button className="primary-button" disabled={budgetSaving}>
              {budgetSaving ? 'Saving...' : 'Save monthly budget'}
            </button>
          </form>

          {budgetsLoading ? (
            <p>Loading budgets...</p>
          ) : (
            <div className="budget-list">
              {overallBudget ? (
                <div className="budget-item">
                  <div className="budget-heading">
                    <strong>Overall budget</strong>
                    <span>{formatMoney(budgetLimit)}</span>
                  </div>

                  <div className="budget-heading">
                    <span className="muted">
                      Spent: {formatMoney(monthlySpent)}
                    </span>
                    <span className="muted">
                      {budgetRemaining >= 0 ? 'Remaining' : 'Over budget'}:{' '}
                      {formatMoney(Math.abs(budgetRemaining))}
                    </span>
                  </div>

                  <div
                    className="budget-track"
                    role="progressbar"
                    aria-label="Monthly budget used"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.min(100, Math.max(0, budgetPercentage))}
                  >
                    <div
                      className={`budget-fill ${
                        budgetPercentage >= 100
                          ? 'over'
                          : budgetPercentage >= 80
                            ? 'warning'
                            : ''
                      }`}
                      style={{
                        width: `${Math.min(100, Math.max(0, budgetPercentage))}%`,
                      }}
                    />
                  </div>

                  <p className="muted">
                    {budgetPercentage.toFixed(1)}% of budget used
                  </p>

                  {budgetPercentage >= 100 && (
                    <p className="budget-alert">
                      You have reached or exceeded your monthly budget.
                    </p>
                  )}

                  {budgetPercentage >= 80 && budgetPercentage < 100 && (
                    <p className="budget-warning">
                      You have used at least 80% of your monthly budget.
                    </p>
                  )}
                </div>
              ) : (
                <p className="muted">
                  No overall budget set for this month yet.
                </p>
              )}

              <h3>Category budgets</h3>

              {budgets.filter((budget) => budget.category !== null).length === 0 ? (
                <p className="muted">
                  No category budgets set yet. You can add one using the form above.
                </p>
              ) : (
                budgets
                  .filter((budget) => budget.category !== null)
                  .map((budget) => {
                    const categorySpent = monthlyExpenses
                      .filter((expense) => expense.category === budget.category)
                      .reduce(
                        (total, expense) => total + Number(expense.amount),
                        0
                      );

                    const percentage =
                      (categorySpent / Number(budget.amount)) * 100;

                    return (
                      <div className="budget-item" key={budget.id}>
                        <div className="budget-heading">
                          <strong>{budget.category}</strong>
                          <span>{formatMoney(budget.amount)}</span>
                        </div>

                        <div className="budget-heading">
                          <span className="muted">
                            Spent: {formatMoney(categorySpent)}
                          </span>
                          <span className="muted">
                            {percentage.toFixed(1)}% used
                          </span>
                        </div>

                        <div className="budget-track">
                          <div
                            className={`budget-fill ${
                              percentage >= 100
                                ? 'over'
                                : percentage >= 80
                                  ? 'warning'
                                  : ''
                            }`}
                            style={{
                              width: `${Math.min(100, Math.max(0, percentage))}%`,
                            }}
                          />
                        </div>

                        {percentage >= 80 && (
                          <p className={
                            percentage >= 100
                              ? 'budget-alert'
                              : 'budget-warning'
                          }>
                            {percentage >= 100
                              ? 'Category budget reached or exceeded.'
                              : 'You have used at least 80% of this category budget.'}
                          </p>
                        )}
                      </div>
                    );
                  })
              )}
            </div>
          )}
        </section>
        
        <section className="transactions analytics-section">
          <div className="report-header">
            <div>
              <h2>Spending analysis</h2>
              <p className="muted">
                Explore your spending patterns and monthly activity.
              </p>
            </div>

            <div className="report-month-control">
              <label htmlFor="reportMonth">Report month</label>
              <input
                id="reportMonth"
                type="month"
                value={selectedReportMonth}
                max={localDate().slice(0, 7)}
                onChange={(event) => {
                  if (event.target.value) {
                    setSelectedReportMonth(event.target.value);
                  }
                }}
              />
            </div>
          </div>

          <div className="report-cards">
            <article className="report-card">
              <p>Total spent</p>
              <h3>{formatMoney(reportTotal)}</h3>
            </article>

            <article className="report-card">
              <p>Transactions</p>
              <h3>{reportExpenses.length}</h3>
            </article>

            <article className="report-card">
              <p>Average expense</p>
              <h3>{formatMoney(averageExpense)}</h3>
            </article>

            <article className="report-card">
              <p>Top category</p>
              <h3>{topCategory?.name ?? '—'}</h3>
              {topCategory && (
                <p className="muted">{formatMoney(topCategory.amount)}</p>
              )}
            </article>
          </div>
          <div className="chart-panel">
            <h3>Spending by category</h3>
            <p className="muted">
              How your expenses are distributed during the selected month.
            </p>

            {categoryTotals.length === 0 ? (
              <p className="empty-chart">
                No expenses recorded for this month yet.
              </p>
            ) : (
              <div className="chart-container">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={categoryTotals}
                      dataKey="amount"
                      nameKey="name"
                      cx="50%"
                      cy="45%"
                      outerRadius="65%"
                      paddingAngle={2}
                      label={({ name, percent }) =>
                        `${name} ${(percent * 100).toFixed(0)}%`
                      }
                      shape={(props) => {
                        const index = categoryTotals.findIndex(
                          (entry) => entry.name === props.payload?.name
                        );

                        return (
                          <Sector
                            {...props}
                            fill={chartColors[
                              (index < 0 ? 0 : index) % chartColors.length
                            ]}
                          />
                        );
                      }}
                    />
                    <Tooltip formatter={(value) => formatMoney(value)} />
                    <Legend
                      content={() => (
                        <ul
                          style={{
                            display: "flex",
                            justifyContent: "center",
                            flexWrap: "wrap",
                            gap: "16px",
                            listStyle: "none",
                            padding: 0,
                            margin: 0,
                          }}
                        >
                          {categoryTotals.map((entry, index) => (
                            <li
                              key={entry.name}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "6px",
                                color: "var(--text-secondary, #666)",
                                fontSize: "14px",
                              }}
                            >
                              <span
                                style={{
                                  display: "inline-block",
                                  width: "12px",
                                  height: "12px",
                                  backgroundColor:
                                    chartColors[index % chartColors.length],
                                  flexShrink: 0,
                                }}
                              />
                              {entry.name}
                            </li>
                          ))}
                        </ul>
                      )}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
          <div className="chart-panel">
            <h3>Six-month spending trend</h3>
            <p className="muted">
              Compare monthly spending to identify increases and decreases.
            </p>

            <div className="chart-container">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={monthlyTrend}
                  margin={{ top: 12, right: 12, left: 8, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis
                    tickFormatter={(value) =>
                      value >= 1000
                        ? `₹${(value / 1000).toFixed(1)}k`
                        : `₹${value}`
                    }
                    width={65}
                  />
                  <Tooltip formatter={(value) => formatMoney(value)} />
                  <Bar
                    dataKey="total"
                    name="Monthly spending"
                    fill="#478568"
                    radius={[5, 5, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

        </section>


        <section className="transactions">
          <h2>{editingId ? 'Edit expense' : 'Add an expense'}</h2>

          <form onSubmit={handleSaveExpense} className="expense-form">
            <label htmlFor="title">Expense title</label>
            <input
              id="title"
              name="title"
              value={form.title}
              onChange={updateField}
              maxLength={120}
              placeholder="e.g. Lunch at college"
              required
            />

            <label htmlFor="amount">Amount (₹)</label>
            <input
              id="amount"
              name="amount"
              type="number"
              min="0.01"
              max="9999999999.99"
              step="0.01"
              value={form.amount}
              onChange={updateField}
              placeholder="150.00"
              required
            />

            <label htmlFor="category">Category</label>
            <select
              id="category"
              name="category"
              value={form.category}
              onChange={updateField}
              required
            >
              {CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>

            <label htmlFor="expense_date">Expense date</label>
            <input
              id="expense_date"
              name="expense_date"
              type="date"
              max={localDate()}
              value={form.expense_date}
              onChange={updateField}
              required
            />

            <label htmlFor="payment_method">Payment method</label>
            <select
              id="payment_method"
              name="payment_method"
              value={form.payment_method}
              onChange={updateField}
            >
              {PAYMENT_METHODS.map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>

            <label htmlFor="notes">Notes (optional)</label>
            <textarea
              id="notes"
              name="notes"
              rows={3}
              maxLength={1000}
              value={form.notes}
              onChange={updateField}
              placeholder="Additional details..."
            />

            <button className="primary-button" disabled={saving}>
              {saving
                ? 'Saving...'
                : editingId
                  ? 'Save changes'
                  : 'Add expense'}
            </button>

            {editingId && (
              <button
                type="button"
                className="secondary-button"
                onClick={resetForm}
                disabled={saving}
              >
                Cancel editing
              </button>
            )}
          </form>

          {message && <p className="message" role="status">{message}</p>}
        </section>

        <section className="transactions">
          <h2>Expense history</h2>

          <div className="filter-row">
            <input
              aria-label="Search expenses"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search title, category or notes..."
            />

            <select
              aria-label="Filter by category"
              value={filterCategory}
              onChange={(event) => setFilterCategory(event.target.value)}
            >
              <option value="All">All categories</option>
              {CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>

          {expensesLoading ? (
            <p>Loading expenses...</p>
          ) : filteredExpenses.length === 0 ? (
            <p className="muted">
              {expenses.length === 0
                ? 'No expenses yet. Add your first expense above.'
                : 'No expenses match your search.'}
            </p>
          ) : (
            filteredExpenses.map((expense) => (
              <article className="expense-row" key={expense.id}>
                <div className="expense-info">
                  <strong>{expense.title}</strong>
                  <p className="muted">
                    {expense.category} · {expense.expense_date}
                  </p>
                  <p className="muted">
                    {expense.payment_method || 'Payment method not specified'}
                  </p>
                  {expense.notes && <p className="muted">{expense.notes}</p>}
                </div>

                <div className="expense-actions">
                  <strong>{formatMoney(expense.amount)}</strong>
                  <button
                    className="small-button"
                    onClick={() => startEditing(expense)}
                    disabled={Boolean(deletingId)}
                  >
                    Edit
                  </button>
                  <button
                    className="small-button delete-button"
                    onClick={() => handleDeleteExpense(expense.id)}
                    disabled={Boolean(deletingId)}
                  >
                    {deletingId === expense.id ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </article>
            ))
          )}
        </section>
      </section>
    </main>
  );
}

export default App;
