const SUPABASE_URL = 'https://dqvapavughrriimcjsdj.supabase.co';
const SUPABASE_KEY = 'sb_publishable_A5L1yGGZWaHghIUcD5sgzQ_Djeq1N3G';
const LEGACY_KEYS = {
  entries: 'meu-controle-de-gastos-v1',
  budgets: 'meu-controle-de-gastos-orcamentos-v1',
  openings: 'meu-controle-de-gastos-cartao-inicial-v1',
  imported: 'meu-controle-de-gastos-importado-supabase-v1'
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (!window.supabase) {
  document.querySelector('#bootMsg').textContent = 'Não foi possível carregar o Supabase. Verifique sua conexão e recarregue a página.';
  throw new Error('supabase-js não carregou');
}
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const icons = { 'Alimentação': '🍽️', 'Transporte': '🚗', 'Moradia': '🏠', 'Saúde': '💊', 'Lazer': '🎉', 'Compras': '🛍️', 'Educação': '📚', 'Contas': '🧾', 'Salário': '💼', 'Freelance': '💻', 'Outros': '📌' };
let expenses = [], budgets = {}, cardOpenings = {}, fixedExpenses = [], fixedPaid = {}, currentUser = null, authMode = 'signin', toastTimer = null;
let calculatorDisplay = '0', calculatorAccumulator = null, calculatorOperator = null, calculatorWaiting = true;
let editingId = null;
let cardOnly = false;
const $ = selector => document.querySelector(selector);
const monthFilter = $('#monthFilter'), searchInput = $('#searchInput'), typeFilter = $('#typeFilter'), categoryFilter = $('#categoryFilter'), budgetInput = $('#budgetInput'), expenseList = $('#expenseList'), emptyState = $('#emptyState'), modalBackdrop = $('#modalBackdrop'), form = $('#expenseForm');
function readJson(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function currentMonth() { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; }
function formatCurrency(value) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0); }
function formatDate(value) { return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(new Date(`${value}T12:00:00`)).replace('.', ''); }
function showCalculatorValue(value = calculatorDisplay) { $('#calculatorDisplay').value = value === 'Erro' ? value : String(value).replace('.', ','); }
function calculatorNumber(value) { const number = Number(value); return Number.isFinite(number) ? String(Number(number.toPrecision(12))) : 'Erro'; }
function calculateResult(left, right, operator) {
  if (operator === '+') return left + right;
  if (operator === '-') return left - right;
  if (operator === '*') return left * right;
  if (operator === '/') return right === 0 ? NaN : left / right;
  return right;
}
function inputCalculator(action, value = '') {
  if (action === 'clear') { calculatorDisplay = '0'; calculatorAccumulator = null; calculatorOperator = null; calculatorWaiting = true; showCalculatorValue(); return; }
  if (action === 'digit') {
    if (calculatorWaiting || calculatorDisplay === 'Erro') { calculatorDisplay = value; calculatorWaiting = false; }
    else if (calculatorDisplay.replace('-', '').replace('.', '').length < 12) calculatorDisplay = calculatorDisplay === '0' ? value : calculatorDisplay + value;
  } else if (action === 'decimal') {
    if (calculatorWaiting || calculatorDisplay === 'Erro') { calculatorDisplay = '0.'; calculatorWaiting = false; }
    else if (!calculatorDisplay.includes('.')) calculatorDisplay += '.';
  } else if (action === 'backspace') {
    calculatorDisplay = calculatorWaiting || calculatorDisplay === 'Erro' ? '0' : calculatorDisplay.slice(0, -1);
    if (calculatorDisplay === '' || calculatorDisplay === '-') calculatorDisplay = '0';
    calculatorWaiting = false;
  } else if (action === 'sign') {
    if (calculatorDisplay !== '0' && calculatorDisplay !== 'Erro') calculatorDisplay = calculatorDisplay.startsWith('-') ? calculatorDisplay.slice(1) : '-' + calculatorDisplay;
  } else if (action === 'percent') {
    calculatorDisplay = calculatorDisplay === 'Erro' ? '0' : calculatorNumber(Number(calculatorDisplay) / 100);
    calculatorWaiting = true;
  } else if (action === 'operator') {
    if (calculatorDisplay === 'Erro') { calculatorDisplay = '0'; calculatorAccumulator = null; calculatorOperator = null; }
    if (calculatorOperator && !calculatorWaiting) {
      const result = calculatorNumber(calculateResult(calculatorAccumulator, Number(calculatorDisplay), calculatorOperator));
      if (result === 'Erro') { calculatorDisplay = result; calculatorAccumulator = null; calculatorOperator = null; calculatorWaiting = true; showCalculatorValue(); return; }
      calculatorDisplay = result; calculatorAccumulator = Number(result);
    } else calculatorAccumulator = Number(calculatorDisplay);
    calculatorOperator = value; calculatorWaiting = true;
  } else if (action === 'equals' && calculatorOperator) {
    const result = calculatorNumber(calculateResult(calculatorAccumulator, Number(calculatorDisplay), calculatorOperator));
    calculatorDisplay = result; calculatorAccumulator = null; calculatorOperator = null; calculatorWaiting = true;
  }
  showCalculatorValue();
}
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char])); }
function isCardPayment(payment) { return /cr[eé]dito|cart[aã]o/i.test(String(payment || '')); }
function selectedMonth() { return monthFilter.value || currentMonth(); }
function filteredExpenses() {
  const month = selectedMonth(), search = searchInput.value.trim().toLowerCase(), type = typeFilter.value, category = categoryFilter.value;
  return expenses.filter(item => item.date.startsWith(month) && (!cardOnly || (item.type !== 'income' && isCardPayment(item.payment))) && (type === 'all' || item.type === type) && (category === 'all' || item.category === category) && (!search || `${item.description} ${item.category} ${item.payment}`.toLowerCase().includes(search))).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
}
function accumulatedBefore(month) {
  return expenses.filter(item => item.date.slice(0, 7) < month).reduce((sum, item) => {
    if (item.type === 'income') return sum + item.amount;
    return isCardPayment(item.payment) ? sum : sum - item.amount;
  }, 0);
}
function render() {
  const month = selectedMonth(), visible = filteredExpenses(), monthEntries = expenses.filter(item => item.date.startsWith(month));
  const income = monthEntries.filter(item => item.type === 'income').reduce((sum, item) => sum + item.amount, 0);
  const cardSpending = monthEntries.filter(item => item.type !== 'income' && isCardPayment(item.payment)).reduce((sum, item) => sum + item.amount, 0);
  const cardOpening = Number(cardOpenings[month] || 0);
  const totalCardSpending = cardOpening + cardSpending;
  const cashSpending = monthEntries.filter(item => item.type !== 'income' && !isCardPayment(item.payment)).reduce((sum, item) => sum + item.amount, 0);
  const totalSpending = totalCardSpending + cashSpending;
  const carryover = accumulatedBefore(month), balance = carryover + income - cashSpending, budget = Number(budgets[month] || 0);
  $('#balanceAmount').textContent = formatCurrency(balance);
  $('#incomeAmount').textContent = formatCurrency(income);
  $('#expenseAmount').textContent = formatCurrency(cashSpending);
  $('#entryCount').textContent = visible.length;
  $('#averageAmount').textContent = `Média exibida: ${formatCurrency(visible.length ? visible.reduce((sum, item) => sum + item.amount, 0) / visible.length : 0)}`;
  $('#periodLabel').textContent = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date(`${month}-15T12:00:00`)).replace(/^./, char => char.toUpperCase());
  budgetInput.value = budget || '';
  $('#carryoverLabel').textContent = carryover >= 0 ? `${formatCurrency(carryover)} trazidos de meses anteriores` : `${formatCurrency(Math.abs(carryover))} de saldo negativo anterior`;
  $('#cardOpeningInput').value = cardOpening || '';
  $('#cardPendingLabel').textContent = totalCardSpending ? `Cartão pendente: ${formatCurrency(totalCardSpending)}` : 'Sem gastos no cartão';
  if (budget) { const remaining = budget - totalSpending; $('#budgetStatus').textContent = remaining >= 0 ? `${formatCurrency(remaining)} restantes no orçamento` : `${formatCurrency(Math.abs(remaining))} acima do orçamento`; } else $('#budgetStatus').textContent = 'Defina seu orçamento acima';
  expenseList.innerHTML = visible.map(item => { const isIncome = item.type === 'income'; return `<div class="expense-item ${isIncome ? 'income-item' : ''}"><div class="category-icon">${isIncome ? '↗️' : (icons[item.category] || icons.Outros)}</div><div><div class="expense-name">${escapeHtml(item.description)}</div><div class="expense-meta">${isIncome ? 'Entrada' : escapeHtml(item.category)} · ${escapeHtml(item.payment)} · ${formatDate(item.date)}</div></div><div class="expense-value">${isIncome ? '+' : '-'} ${formatCurrency(item.amount)}</div><button class="edit-btn" data-id="${item.id}" aria-label="Editar ${escapeHtml(item.description)}">✎</button><button class="delete-btn" data-id="${item.id}" aria-label="Excluir ${escapeHtml(item.description)}">×</button></div>`; }).join('');
  emptyState.hidden = visible.length !== 0;
  renderCategories(monthEntries.filter(item => item.type !== 'income'), totalSpending);
  renderCardExpenses(monthEntries, cardOpening);
  renderIncomeEntries(monthEntries);
  renderFixedExpenses(month);
}
function renderIncomeEntries(items) {
  const incomeItems = items.filter(item => item.type === 'income').sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const total = incomeItems.reduce((sum, item) => sum + item.amount, 0);
  $('#incomeTotalSide').textContent = formatCurrency(total);
  $('#incomeList').innerHTML = incomeItems.length ? incomeItems.map(item => `<div class="card-expense-row"><span>${escapeHtml(item.description)}<small>${formatDate(item.date)} · ${escapeHtml(item.payment)}</small></span><strong class="income-side-value">+ ${formatCurrency(item.amount)}</strong></div>`).join('') : '<p class="muted card-empty">Nenhuma entrada neste mês.</p>';
}
function renderCardExpenses(items, opening) {
  const cardItems = items.filter(item => item.type !== 'income' && isCardPayment(item.payment)).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const total = opening + cardItems.reduce((sum, item) => sum + item.amount, 0);
  $('#cardTotal').textContent = formatCurrency(total);
  const openingRow = opening ? `<div class="card-expense-row"><span>Gastos anteriores<small>Já estavam na fatura</small></span><strong>${formatCurrency(opening)}</strong></div>` : '';
  $('#cardExpenseList').innerHTML = openingRow + (cardItems.length ? cardItems.map(item => `<div class="card-expense-row"><span>${escapeHtml(item.description)}<small>${formatDate(item.date)}</small></span><strong>${formatCurrency(item.amount)}</strong></div>`).join('') : (opening ? '' : '<p class="muted card-empty">Nenhum gasto no cartão neste mês.</p>'));
}
function renderFixedExpenses(month) {
  const list = $('#fixedExpenseList'), empty = $('#fixedEmpty');
  const paidIds = new Set(fixedPaid[month] || []);
  const pendingTotal = fixedExpenses.filter(item => !paidIds.has(item.id)).reduce((sum, item) => sum + item.amount, 0);
  $('#fixedPendingTotal').textContent = `${formatCurrency(pendingTotal)} pendentes`;
  list.innerHTML = fixedExpenses.length ? fixedExpenses.slice().sort((a, b) => a.dueDay - b.dueDay || a.description.localeCompare(b.description, 'pt-BR')).map(item => {
    const paid = paidIds.has(item.id);
    return `<div class="fixed-item ${paid ? 'is-paid' : ''}"><div class="category-icon">${icons[item.category] || icons.Outros}</div><div class="fixed-details"><div class="fixed-name">${escapeHtml(item.description)}</div><div class="fixed-status">${escapeHtml(item.category)} · ${escapeHtml(item.payment)} · vence dia ${item.dueDay}${paid ? ' · Pago neste mês' : ''}</div></div><strong class="expense-value">${formatCurrency(item.amount)}</strong><button class="fixed-paid-btn" type="button" data-fixed-paid="${item.id}" ${paid ? 'disabled' : ''}>${paid ? '✓ Já pago' : 'Marcar pago'}</button><button class="fixed-delete-btn" type="button" data-fixed-delete="${item.id}" aria-label="Excluir gasto fixo ${escapeHtml(item.description)}">×</button></div>`;
  }).join('') : '';
  empty.hidden = fixedExpenses.length > 0;
}

function monthDueDate(month, day) {
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  return `${month}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

function renderCategories(items, total) {
  const groups = items.reduce((result, item) => { result[item.category] = (result[item.category] || 0) + item.amount; return result; }, {}), rows = Object.entries(groups).sort((a, b) => b[1] - a[1]);
  $('#categoryBars').innerHTML = rows.length ? rows.map(([category, amount]) => `<div class="category-row"><div class="category-label"><span>${icons[category] || '📌'} ${escapeHtml(category)}</span><span>${formatCurrency(amount)}</span></div><div class="bar-track"><div class="bar-fill" style="width:${total ? Math.max(3, amount / total * 100) : 0}%"></div></div></div>`).join('') : '<p class="muted">As categorias de gastos aparecerão aqui.</p>';
}
function syncInstallmentField() {
  const input = $('#installmentsInput');
  if (!input) return;
  const eligible = $('#typeInput').value === 'expense' && isCardPayment($('#paymentInput').value) && !editingId;
  $('#installmentField').hidden = !eligible;
  if (!eligible) input.value = '1';
  const count = Math.max(1, Number.parseInt(input.value, 10) || 1);
  $('#amountLabel').textContent = count > 1 ? 'Valor total da compra' : 'Valor';
  $('#dateLabel').textContent = count > 1 ? 'Data da 1ª parcela' : 'Data';
  $('#installmentHelp').textContent = count > 1
    ? `O total será dividido em ${count} lançamento(s), um por mês.`
    : 'Informe 1 para compra à vista no crédito ou o total de parcelas.';
}
function installmentDate(firstDate, offset) {
  const [year, month, day] = firstDate.split('-').map(Number);
  const monthIndex = month - 1 + offset;
  const targetYear = year + Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12 + 1;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}
function splitInstallments(total, count) {
  const cents = Math.round(Number(total) * 100);
  const base = Math.floor(cents / count), remainder = cents % count;
  return Array.from({ length: count }, (_, index) => (base + (index < remainder ? 1 : 0)) / 100);
}

function openModal(item = null) {
  editingId = item ? item.id : null;
  form.reset();
  $('#installmentsInput').value = '1';
  $('#modalTitle').textContent = item ? 'Editar lançamento' : 'Adicionar entrada ou gasto';
  $('#saveButton').textContent = item ? 'Salvar alterações' : 'Salvar lançamento';
  if (item) {
    $('#typeInput').value = item.type;
    $('#amountInput').value = item.amount;
    $('#descriptionInput').value = item.description;
    $('#dateInput').value = item.date;
    $('#categoryInput').value = item.category;
    $('#paymentInput').value = item.payment;
  } else $('#dateInput').value = new Date().toISOString().slice(0, 10);
  syncInstallmentField();
  modalBackdrop.hidden = false;
  $('#descriptionInput').focus();
}
function closeModal() { modalBackdrop.hidden = true; form.reset(); editingId = null; $('#installmentsInput').value = '1'; $('#modalTitle').textContent = 'Adicionar entrada ou gasto'; $('#saveButton').textContent = 'Salvar lançamento'; syncInstallmentField(); }
function openCardModal() { openModal(); $('#modalTitle').textContent = 'Novo gasto no cartão'; $('#typeInput').value = 'expense'; $('#paymentInput').value = 'Crédito'; $('#categoryInput').value = 'Outros'; syncInstallmentField(); }
monthFilter.value = currentMonth();
const calculatorPanel = $('#calculatorPanel');
$('#calculatorToggleBtn').addEventListener('click', () => { calculatorPanel.hidden = !calculatorPanel.hidden; $('#calculatorToggleBtn').setAttribute('aria-expanded', String(!calculatorPanel.hidden)); if (!calculatorPanel.hidden) $('#calculatorDisplay').focus(); });
$('#closeCalculatorBtn').addEventListener('click', () => { calculatorPanel.hidden = true; $('#calculatorToggleBtn').setAttribute('aria-expanded', 'false'); });
$('#calculatorKeys').addEventListener('click', event => { const key = event.target.closest('[data-calc]'); if (key) inputCalculator(key.dataset.calc, key.dataset.value || ''); });
$('#openModalBtn').addEventListener('click', openModal); $('#cardActionBtn').addEventListener('click', openCardModal); $('#emptyAddBtn').addEventListener('click', openModal); $('#closeModalBtn').addEventListener('click', closeModal); $('#cancelBtn').addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', event => { if (event.target === modalBackdrop) closeModal(); });
[monthFilter, searchInput, typeFilter, categoryFilter].forEach(element => element.addEventListener('input', render));
$('#cardFilterBtn').addEventListener('click', () => { cardOnly = !cardOnly; $('#cardFilterBtn').classList.toggle('active', cardOnly); $('#cardFilterBtn').setAttribute('aria-pressed', String(cardOnly)); $('#cardFilterBtn').textContent = cardOnly ? '↩️ Mostrar todos' : '💳 Só gastos no cartão'; render(); if (cardOnly) setTimeout(() => $('#cardSummary').scrollIntoView({ behavior: 'smooth', block: 'center' }), 0); });

function showToast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 6000);
}
function showError(action, error) {
  console.error(error);
  showToast(error && error.message ? `${action} (${error.message})` : action);
}
function fromRow(row) {
  return { id: row.id, type: row.type, description: row.description, amount: Number(row.amount), date: row.date, category: row.category, payment: row.payment, createdAt: new Date(row.created_at).getTime() };
}
async function fetchAll(table, orderColumns) {
  const pageSize = 1000;
  let from = 0, all = [];
  while (true) {
    let query = sb.from(table).select('*');
    orderColumns.forEach(column => { query = query.order(column); });
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) throw error;
    all = all.concat(data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}
async function loadData() {
  const [transactions, settings, fixedRows, paymentRows] = await Promise.all([
    fetchAll('transactions', ['created_at', 'id']),
    fetchAll('monthly_settings', ['month']),
    fetchAll('fixed_expenses', ['created_at', 'id']),
    fetchAll('fixed_expense_payments', ['month', 'created_at'])
  ]);
  expenses = transactions.map(fromRow);
  budgets = {}; cardOpenings = {};
  settings.forEach(row => { budgets[row.month] = Number(row.budget); cardOpenings[row.month] = Number(row.card_opening); });
  fixedExpenses = fixedRows.map(row => ({ id: row.id, description: row.description, amount: Number(row.amount), category: row.category, payment: row.payment, dueDay: Number(row.due_day) }));
  fixedPaid = {};
  paymentRows.forEach(row => { fixedPaid[row.month] = fixedPaid[row.month] || []; if (!fixedPaid[row.month].includes(row.fixed_expense_id)) fixedPaid[row.month].push(row.fixed_expense_id); });
}
async function saveSetting(month, values) {
  const { error } = await sb.from('monthly_settings').upsert({ user_id: currentUser.id, month, ...values, updated_at: new Date().toISOString() }, { onConflict: 'user_id,month' });
  if (error) throw error;
}

/* ---------- Importação dos dados antigos (localStorage) ---------- */
async function maybeImportLegacy() {
  const flag = `${LEGACY_KEYS.imported}:${currentUser.id}`;
  if (localStorage.getItem(flag)) return;
  const rawEntries = readJson(LEGACY_KEYS.entries, []), legacyBudgets = readJson(LEGACY_KEYS.budgets, {}), legacyOpenings = readJson(LEGACY_KEYS.openings, {});
  const entries = (Array.isArray(rawEntries) ? rawEntries : []).filter(item => item && /^\d{4}-\d{2}-\d{2}$/.test(item.date || '') && Number.isFinite(Number(item.amount)) && Number(item.amount) > 0);
  const months = [...new Set([...Object.keys(legacyBudgets), ...Object.keys(legacyOpenings)])].filter(month => /^\d{4}-\d{2}$/.test(month));
  if (!entries.length && !months.length) return;
  if (!confirm(`Encontrei ${entries.length} lançamento(s) salvo(s) neste aparelho. Importar para a sua conta?`)) { localStorage.setItem(flag, 'declined'); return; }
  const rows = entries.map(item => ({
    id: UUID_RE.test(item.id || '') ? item.id : crypto.randomUUID(),
    user_id: currentUser.id,
    type: item.type === 'income' ? 'income' : 'expense',
    description: String(item.description || 'Sem descrição').slice(0, 80),
    amount: Number(item.amount),
    date: item.date,
    category: item.category || 'Outros',
    payment: item.payment || 'Outro',
    created_at: new Date(Number(item.createdAt) || Date.now()).toISOString()
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from('transactions').upsert(rows.slice(i, i + 500), { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw error;
  }
  if (months.length) {
    const settingRows = months.map(month => ({ user_id: currentUser.id, month, budget: Math.max(0, Number(legacyBudgets[month] || 0)), card_opening: Math.max(0, Number(legacyOpenings[month] || 0)) }));
    const { error } = await sb.from('monthly_settings').upsert(settingRows, { onConflict: 'user_id,month', ignoreDuplicates: true });
    if (error) throw error;
  }
  localStorage.setItem(flag, 'imported');
  await loadData();
  showToast(`${rows.length} lançamento(s) importado(s) para a sua conta.`);
}

/* ---------- Orçamento e fatura inicial ---------- */
budgetInput.addEventListener('change', async () => {
  const month = selectedMonth(), value = Number(budgetInput.value || 0);
  try { await saveSetting(month, { budget: value }); budgets[month] = value; } catch (error) { showError('Não consegui salvar o orçamento.', error); }
  render();
});
$('#saveOpeningBtn').addEventListener('click', async () => {
  const month = selectedMonth(), value = Number($('#cardOpeningInput').value || 0);
  try { await saveSetting(month, { card_opening: value }); cardOpenings[month] = value; } catch (error) { showError('Não consegui salvar o valor da fatura.', error); }
  render();
});

/* ---------- Gastos fixos sincronizados pelo Supabase ---------- */
/* ---------- Integração com automação do Apple Wallet ---------- */
function randomWalletToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
$('#createWalletTokenBtn').addEventListener('click', async event => {
  const button = event.currentTarget;
  if (!currentUser) return showToast('Entre na sua conta para configurar o Atalho.');
  if (!confirm('Gerar um novo token? Se já existe um Atalho configurado, ele deixará de funcionar e precisará do novo token.')) return;
  button.disabled = true;
  try {
    const token = randomWalletToken();
    const tokenHash = await sha256Hex(token);
    const { error } = await sb.rpc('register_wallet_shortcut_token', { p_token_hash: tokenHash });
    if (error) throw error;
    $('#walletTokenOutput').value = token;
    $('#walletTokenBox').hidden = false;
    showToast('Token criado. Copie-o e guarde no app Atalhos.');
  } catch (error) {
    showError('Não consegui criar o token. Execute antes o arquivo supabase-wallet-shortcut.sql no Supabase.', error);
  } finally { button.disabled = false; }
});
$('#copyWalletTokenBtn').addEventListener('click', async () => {
  const token = $('#walletTokenOutput').value;
  if (!token) return;
  try { await navigator.clipboard.writeText(token); showToast('Token copiado. Cole-o no campo p_token do Atalho.'); }
  catch { $('#walletTokenOutput').focus(); $('#walletTokenOutput').select(); showToast('Selecione e copie o token para guardá-lo no Atalho.'); }
});
$('#revokeWalletTokenBtn').addEventListener('click', async event => {
  if (!currentUser || !confirm('Revogar o acesso do Atalho? As compras futuras deixarão de ser importadas.')) return;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const { error } = await sb.rpc('revoke_wallet_shortcut_token');
    if (error) throw error;
    $('#walletTokenOutput').value = '';
    $('#walletTokenBox').hidden = true;
    showToast('Acesso do Atalho revogado.');
  } catch (error) { showError('Não consegui revogar o acesso.', error); }
  finally { button.disabled = false; }
});

$('#fixedExpenseForm').addEventListener('submit', async event => {
  event.preventDefault();
  const submit = event.submitter || event.target.querySelector('[type="submit"]');
  const record = { user_id: currentUser.id, description: $('#fixedDescription').value.trim(), amount: Number($('#fixedAmount').value), category: $('#fixedCategory').value, payment: $('#fixedPayment').value, due_day: Math.max(1, Math.min(31, Number($('#fixedDueDay').value) || 1)) };
  submit.disabled = true;
  try {
    const { data, error } = await sb.from('fixed_expenses').insert(record).select().single();
    if (error) throw error;
    fixedExpenses.push({ id: data.id, description: data.description, amount: Number(data.amount), category: data.category, payment: data.payment, dueDay: Number(data.due_day) });
    event.target.reset(); $('#fixedDueDay').value = '10'; render(); showToast('Gasto fixo salvo e sincronizado com sua conta.');
  } catch (error) { showError('Não consegui salvar o gasto fixo. Confira se aplicou a configuração SQL incluída.', error); }
  finally { submit.disabled = false; }
});
$('#fixedExpenseList').addEventListener('click', async event => {
  const payButton = event.target.closest('[data-fixed-paid]');
  if (payButton) {
    const item = fixedExpenses.find(entry => entry.id === payButton.dataset.fixedPaid), month = selectedMonth();
    if (!item || (fixedPaid[month] || []).includes(item.id)) return;
    payButton.disabled = true;
    try {
      const { data: row, error } = await sb.rpc('pay_fixed_expense', { p_fixed_expense_id: item.id, p_month: month });
      if (error) {
        if (error.code === '23505') { await loadData(); render(); showToast('Esse gasto fixo já foi marcado como pago neste mês.'); return; }
        throw error;
      }
      expenses.push(fromRow(row)); fixedPaid[month] = [...(fixedPaid[month] || []), item.id]; render();
      showToast(`${item.description} marcado como pago e lançado nas despesas.`);
    } catch (error) { payButton.disabled = false; showError('Não consegui marcar o gasto fixo como pago. Confira se aplicou a configuração SQL incluída.', error); }
    return;
  }
  const deleteButton = event.target.closest('[data-fixed-delete]');
  if (deleteButton) {
    const id = deleteButton.dataset.fixedDelete;
    if (!confirm('Excluir este gasto fixo? Os lançamentos já registrados não serão apagados.')) return;
    const { error } = await sb.from('fixed_expenses').delete().eq('id', id);
    if (error) { showError('Não consegui excluir o gasto fixo.', error); return; }
    fixedExpenses = fixedExpenses.filter(item => item.id !== id);
    Object.keys(fixedPaid).forEach(month => { fixedPaid[month] = fixedPaid[month].filter(paidId => paidId !== id); });
    render();
  }
});
/* ---------- Lançamentos ---------- */
expenseList.addEventListener('click', async event => {
  const editButton = event.target.closest('.edit-btn');
  if (editButton) { const item = expenses.find(entry => entry.id === editButton.dataset.id); if (item) openModal(item); return; }
  const deleteButton = event.target.closest('.delete-btn');
  if (!deleteButton) return;
  const id = deleteButton.dataset.id;
  const { error } = await sb.from('transactions').delete().eq('id', id);
  if (error) { showError('Não consegui excluir o lançamento.', error); return; }
  expenses = expenses.filter(item => item.id !== id);
  render();
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  const date = $('#dateInput').value, type = $('#typeInput').value, category = $('#categoryInput').value, id = editingId, saveBtn = $('#saveButton');
  const data = { type, description: $('#descriptionInput').value.trim(), amount: Number($('#amountInput').value), date, category, payment: $('#paymentInput').value };
  const requestedCount = Number.parseInt($('#installmentsInput').value, 10) || 1;
  const installmentCount = !id && type === 'expense' && isCardPayment(data.payment) ? Math.max(1, Math.min(48, requestedCount)) : 1;
  if (requestedCount < 1 || requestedCount > 48) { showToast('Use de 1 a 48 parcelas.'); return; }
  if (installmentCount > 1 && Math.round(data.amount * 100) < installmentCount) { showToast('O valor total precisa ser de pelo menos R$ 0,01 por parcela.'); return; }
  saveBtn.disabled = true;
  try {
    if (id) {
      const { data: row, error } = await sb.from('transactions').update(data).eq('id', id).select().single();
      if (error) throw error;
      expenses = expenses.map(item => item.id === id ? fromRow(row) : item);
    } else if (installmentCount > 1) {
      const portions = splitInstallments(data.amount, installmentCount);
      const rowsToInsert = portions.map((amount, index) => {
        const suffix = ` (${index + 1}/${installmentCount})`;
        const description = `${data.description.slice(0, 80 - suffix.length)}${suffix}`;
        return { ...data, description, amount, date: installmentDate(date, index), user_id: currentUser.id };
      });
      const { data: rows, error } = await sb.from('transactions').insert(rowsToInsert).select();
      if (error) throw error;
      expenses.push(...rows.map(fromRow));
      showToast(`Compra registrada em ${installmentCount} parcelas.`);
    } else {
      const { data: row, error } = await sb.from('transactions').insert({ ...data, user_id: currentUser.id }).select().single();
      if (error) throw error;
      expenses.push(fromRow(row));
    }
    if (!isCardPayment(data.payment)) { cardOnly = false; $('#cardFilterBtn').classList.remove('active'); $('#cardFilterBtn').setAttribute('aria-pressed', 'false'); $('#cardFilterBtn').textContent = '💳 Só gastos no cartão'; }
    closeModal(); monthFilter.value = date.slice(0, 7); render();
  } catch (error) {
    showError('Não consegui salvar o lançamento.', error);
  } finally {
    saveBtn.disabled = false;
  }
});

$('#typeInput').addEventListener('change', () => { const isIncome = $('#typeInput').value === 'income'; $('#categoryInput').value = isIncome ? 'Salário' : 'Alimentação'; syncInstallmentField(); });
$('#paymentInput').addEventListener('change', syncInstallmentField);
$('#installmentsInput').addEventListener('input', syncInstallmentField);
$('#pdfExportBtn').addEventListener('click', () => {
  const month = selectedMonth();
  const monthEntries = expenses.filter(item => item.date.startsWith(month)).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  const income = monthEntries.filter(item => item.type === 'income').reduce((sum, item) => sum + item.amount, 0);
  const cardOpening = Number(cardOpenings[month] || 0);
  const cardSpending = monthEntries.filter(item => item.type !== 'income' && isCardPayment(item.payment)).reduce((sum, item) => sum + item.amount, 0);
  const cardTotal = cardOpening + cardSpending;
  const expensesTotal = cardSpending + monthEntries.filter(item => item.type !== 'income' && !isCardPayment(item.payment)).reduce((sum, item) => sum + item.amount, 0);
  const carryover = accumulatedBefore(month), cashSpending = monthEntries.filter(item => item.type !== 'income' && !isCardPayment(item.payment)).reduce((sum, item) => sum + item.amount, 0);
  const balance = carryover + income - cashSpending, budget = Number(budgets[month] || 0);
  const monthLabel = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date(`${month}-15T12:00:00`)).replace(/^./, char => char.toUpperCase());
  const generatedAt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeStyle: 'short' }).format(new Date());
  const paidIds = new Set(fixedPaid[month] || []);
  const fixedTotal = fixedExpenses.reduce((sum, item) => sum + item.amount, 0);
  const fixedPaidTotal = fixedExpenses.filter(item => paidIds.has(item.id)).reduce((sum, item) => sum + item.amount, 0);
  const fixedUnpaidTotal = Math.max(0, fixedTotal - fixedPaidTotal);
  const projectedTotal = expensesTotal + fixedUnpaidTotal;
  const grouped = monthEntries.filter(item => item.type !== 'income').reduce((acc, item) => { acc[item.category] = (acc[item.category] || 0) + item.amount; return acc; }, {});
  const categoryRows = Object.entries(grouped).sort((a, b) => b[1] - a[1]).map(([category, amount]) => `<tr><td>${escapeHtml(category)}</td><td>${formatCurrency(amount)}</td></tr>`).join('') || '<tr><td colspan="2">Nenhum gasto registrado.</td></tr>';
  const transactionRows = monthEntries.map(item => `<tr><td>${formatDate(item.date)}</td><td>${item.type === 'income' ? 'Entrada' : 'Gasto'}</td><td>${escapeHtml(item.description)}</td><td>${escapeHtml(item.category)}</td><td>${escapeHtml(item.payment)}</td><td class="amount">${item.type === 'income' ? '+' : '−'} ${formatCurrency(item.amount)}</td></tr>`).join('') || '<tr><td colspan="6">Nenhum lançamento neste mês.</td></tr>';
  const fixedRows = fixedExpenses.slice().sort((a, b) => a.dueDay - b.dueDay).map(item => `<tr><td>${escapeHtml(item.description)}</td><td>Dia ${item.dueDay}</td><td>${formatCurrency(item.amount)}</td><td>${paidIds.has(item.id) ? 'Pago' : 'Pendente'}</td></tr>`).join('') || '<tr><td colspan="4">Nenhum gasto fixo cadastrado.</td></tr>';
  const reportWindow = window.open('', '_blank');
  if (!reportWindow) { showToast('Permita a abertura de pop-ups para gerar o resumo em PDF.'); return; }
  reportWindow.document.open();
  reportWindow.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Resumo financeiro - ${escapeHtml(month)}</title><style>
    *{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#18332f;margin:32px auto;max-width:900px;padding:0 24px;font-size:12px}h1{font-size:25px;margin:0 0 5px}h2{font-size:15px;margin:24px 0 9px;color:#0f766e}.subtitle{color:#687875;margin:0 0 20px}.summary{display:grid;grid-template-columns:repeat(5,1fr);gap:9px}.tile{border:1px solid #dce7e4;border-radius:8px;padding:12px}.tile span{display:block;color:#687875;font-size:10px;margin-bottom:8px}.tile strong{font-size:15px}table{width:100%;border-collapse:collapse;margin-top:8px}th,td{text-align:left;border-bottom:1px solid #e4ece9;padding:7px 6px;vertical-align:top}th{background:#f1f7f5;color:#31504b;font-size:10px}.amount,td:last-child{white-space:nowrap}@media(max-width:650px){.summary{grid-template-columns:repeat(2,1fr)}}.note{color:#687875;font-size:10px;margin-top:20px}.report-actions{position:fixed;right:20px;top:16px;display:flex;gap:8px}.print,.exit{border:0;border-radius:8px;color:white;padding:10px 14px;font-weight:bold;cursor:pointer}.print{background:#0f766e}.exit{background:#51635f}@media print{@page{size:A4;margin:14mm}body{margin:0;max-width:none;padding:0}.report-actions{display:none}.summary{grid-template-columns:repeat(5,1fr)}tr{page-break-inside:avoid}h2{page-break-after:avoid}}</style></head><body><div class="report-actions"><button class="print" onclick="window.print()">Imprimir / Salvar em PDF</button><button class="exit" onclick="window.close();setTimeout(()=>{if(!window.closed)history.back()},300)">Sair do PDF</button></div><h1>Resumo financeiro</h1><p class="subtitle">${escapeHtml(monthLabel)} · Gerado em ${escapeHtml(generatedAt)}</p><div class="summary"><div class="tile"><span>Saldo disponível</span><strong>${formatCurrency(balance)}</strong></div><div class="tile"><span>Entradas</span><strong>${formatCurrency(income)}</strong></div><div class="tile"><span>Gastos do mês</span><strong>${formatCurrency(expensesTotal)}</strong></div><div class="tile"><span>Previsão c/ fixos pendentes</span><strong>${formatCurrency(projectedTotal)}</strong></div><div class="tile"><span>Orçamento</span><strong>${budget ? formatCurrency(budget) : 'Não definido'}</strong></div></div><p class="note">Saldo anterior: ${formatCurrency(carryover)} · Compras no cartão neste mês: ${formatCurrency(cardSpending)} · Saldo anterior da fatura: ${formatCurrency(cardOpening)} · Fatura total: ${formatCurrency(cardTotal)}</p><h2>Gastos fixos</h2><p class="note">Total cadastrado: ${formatCurrency(fixedTotal)} · Pago: ${formatCurrency(fixedPaidTotal)} · Pendente: ${formatCurrency(fixedUnpaidTotal)}</p><table><thead><tr><th>Conta</th><th>Vencimento</th><th>Valor</th><th>Status</th></tr></thead><tbody>${fixedRows}</tbody></table><h2>Gastos por categoria</h2><table><thead><tr><th>Categoria</th><th>Valor</th></tr></thead><tbody>${categoryRows}</tbody></table><h2>Lançamentos do mês</h2><table><thead><tr><th>Data</th><th>Tipo</th><th>Descrição</th><th>Categoria</th><th>Pagamento</th><th>Valor</th></tr></thead><tbody>${transactionRows}</tbody></table><p class="note">Relatório criado pelo Meu Controle Financeiro.</p></body></html>`);
  reportWindow.document.close();
  setTimeout(() => { reportWindow.focus(); reportWindow.print(); }, 500);
});
$('#exportBtn').addEventListener('click', () => { const rows = filteredExpenses(), csv = [['Data', 'Tipo', 'Descrição', 'Categoria', 'Pagamento', 'Valor'], ...rows.map(item => [item.date, item.type === 'income' ? 'Entrada' : 'Gasto', item.description, item.category, item.payment, item.amount.toFixed(2).replace('.', ',')])].map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(';')).join('\n'), blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' }), link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `financas-${selectedMonth()}.csv`; link.click(); URL.revokeObjectURL(link.href); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if (!modalBackdrop.hidden) closeModal();
    if (!calculatorPanel.hidden) { calculatorPanel.hidden = true; $('#calculatorToggleBtn').setAttribute('aria-expanded', 'false'); }
    return;
  }
  if (calculatorPanel.hidden || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
  if (/^[0-9]$/.test(event.key)) { event.preventDefault(); inputCalculator('digit', event.key); }
  else if (event.key === '.' || event.key === ',') { event.preventDefault(); inputCalculator('decimal'); }
  else if (['+', '-', '*', '/'].includes(event.key)) { event.preventDefault(); inputCalculator('operator', event.key); }
  else if (event.key === 'Enter' || event.key === '=') { event.preventDefault(); inputCalculator('equals'); }
  else if (event.key === 'Backspace') { event.preventDefault(); inputCalculator('backspace'); }
});

/* ---------- Login ---------- */
function showAuth() {
  $('#bootMsg').hidden = true; $('.app-shell').hidden = true; $('#authScreen').hidden = false;
  if (!modalBackdrop.hidden) closeModal();
}
function showApp() {
  $('#bootMsg').hidden = true; $('#authScreen').hidden = true; $('.app-shell').hidden = false;
}
function setAuthMessage(text, kind = 'error') {
  const el = $('#authMessage');
  el.textContent = text; el.className = `auth-message ${kind}`;
}
function setAuthMode(mode) {
  authMode = mode;
  const signup = mode === 'signup';
  $('#authTitle').textContent = signup ? 'Criar conta' : 'Entrar';
  $('#authSubmit').textContent = signup ? 'Criar conta' : 'Entrar';
  $('#authToggle').textContent = signup ? 'Já tem conta? Entrar' : 'Não tem conta? Criar conta';
  $('#authPassword').autocomplete = signup ? 'new-password' : 'current-password';
  setAuthMessage('');
}
function translateAuthError(error) {
  const message = String(error && error.message || '');
  if (/invalid login credentials/i.test(message)) return 'E-mail ou senha incorretos.';
  if (/email not confirmed/i.test(message)) return 'Confirme seu e-mail antes de entrar.';
  if (/already registered/i.test(message)) return 'Este e-mail já tem conta. Tente entrar.';
  if (/at least/i.test(message)) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (/rate limit/i.test(message)) return 'Muitas tentativas. Aguarde um pouco e tente de novo.';
  return message || 'Não foi possível concluir. Tente novamente.';
}
$('#authToggle').addEventListener('click', () => setAuthMode(authMode === 'signin' ? 'signup' : 'signin'));
$('#authForm').addEventListener('submit', async event => {
  event.preventDefault();
  const email = $('#authEmail').value.trim(), password = $('#authPassword').value, submit = $('#authSubmit');
  submit.disabled = true; setAuthMessage('');
  try {
    if (authMode === 'signup') {
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) throw error;
      if (!data.session) { setAuthMode('signin'); setAuthMessage('Conta criada! Confirme o e-mail que enviamos e depois entre.', 'ok'); }
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
  } catch (error) {
    setAuthMessage(translateAuthError(error));
  } finally {
    submit.disabled = false;
  }
});
$('#signOutBtn').addEventListener('click', () => sb.auth.signOut());

async function startApp(user) {
  currentUser = user;
  $('#authScreen').hidden = true; $('#bootMsg').textContent = 'Carregando seus dados…'; $('#bootMsg').hidden = false;
  try { await loadData(); await maybeImportLegacy(); } catch (error) { showError('Não consegui carregar seus dados.', error); }
  $('#userEmail').textContent = user.email || '';
  $('#authPassword').value = '';
  showApp(); render();
}
sb.auth.onAuthStateChange((event, session) => {
  // adia a execução para não chamar o Supabase dentro do próprio callback
  setTimeout(() => {
    if (session && session.user) {
      if (!currentUser || currentUser.id !== session.user.id) startApp(session.user);
    } else {
      currentUser = null; expenses = []; budgets = {}; cardOpenings = {}; fixedExpenses = []; fixedPaid = {};
      showAuth();
    }
  }, 0);
});
