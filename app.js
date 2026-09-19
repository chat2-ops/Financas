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
let expenses = [], budgets = {}, cardOpenings = {}, currentUser = null, authMode = 'signin', toastTimer = null;
let editingId = null;
let cardOnly = false;
const $ = selector => document.querySelector(selector);
const monthFilter = $('#monthFilter'), searchInput = $('#searchInput'), typeFilter = $('#typeFilter'), categoryFilter = $('#categoryFilter'), budgetInput = $('#budgetInput'), expenseList = $('#expenseList'), emptyState = $('#emptyState'), modalBackdrop = $('#modalBackdrop'), form = $('#expenseForm');
function readJson(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function currentMonth() { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; }
function formatCurrency(value) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0); }
function formatDate(value) { return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(new Date(`${value}T12:00:00`)).replace('.', ''); }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char])); }
function selectedMonth() { return monthFilter.value || currentMonth(); }
function filteredExpenses() {
  const month = selectedMonth(), search = searchInput.value.trim().toLowerCase(), type = typeFilter.value, category = categoryFilter.value;
  return expenses.filter(item => item.date.startsWith(month) && (!cardOnly || (item.type !== 'income' && item.payment === 'Crédito')) && (type === 'all' || item.type === type) && (category === 'all' || item.category === category) && (!search || `${item.description} ${item.category} ${item.payment}`.toLowerCase().includes(search))).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
}
function accumulatedBefore(month) {
  return expenses.filter(item => item.date.slice(0, 7) < month).reduce((sum, item) => {
    if (item.type === 'income') return sum + item.amount;
    return item.payment === 'Crédito' ? sum : sum - item.amount;
  }, 0);
}
function render() {
  const month = selectedMonth(), visible = filteredExpenses(), monthEntries = expenses.filter(item => item.date.startsWith(month));
  const income = monthEntries.filter(item => item.type === 'income').reduce((sum, item) => sum + item.amount, 0);
  const cardSpending = monthEntries.filter(item => item.type !== 'income' && item.payment === 'Crédito').reduce((sum, item) => sum + item.amount, 0);
  const cardOpening = Number(cardOpenings[month] || 0);
  const totalCardSpending = cardOpening + cardSpending;
  const cashSpending = monthEntries.filter(item => item.type !== 'income' && item.payment !== 'Crédito').reduce((sum, item) => sum + item.amount, 0);
  const totalSpending = totalCardSpending + cashSpending;
  const carryover = accumulatedBefore(month), balance = carryover + income - cashSpending, budget = Number(budgets[month] || 0);
  $('#balanceAmount').textContent = formatCurrency(balance);
  $('#incomeAmount').textContent = formatCurrency(income);
  $('#expenseAmount').textContent = formatCurrency(totalSpending);
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
}
function renderIncomeEntries(items) {
  const incomeItems = items.filter(item => item.type === 'income').sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const total = incomeItems.reduce((sum, item) => sum + item.amount, 0);
  $('#incomeTotalSide').textContent = formatCurrency(total);
  $('#incomeList').innerHTML = incomeItems.length ? incomeItems.map(item => `<div class="card-expense-row"><span>${escapeHtml(item.description)}<small>${formatDate(item.date)} · ${escapeHtml(item.payment)}</small></span><strong class="income-side-value">+ ${formatCurrency(item.amount)}</strong></div>`).join('') : '<p class="muted card-empty">Nenhuma entrada neste mês.</p>';
}
function renderCardExpenses(items, opening) {
  const cardItems = items.filter(item => item.type !== 'income' && item.payment === 'Crédito').sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const total = opening + cardItems.reduce((sum, item) => sum + item.amount, 0);
  $('#cardTotal').textContent = formatCurrency(total);
  const openingRow = opening ? `<div class="card-expense-row"><span>Gastos anteriores<small>Já estavam na fatura</small></span><strong>${formatCurrency(opening)}</strong></div>` : '';
  $('#cardExpenseList').innerHTML = openingRow + (cardItems.length ? cardItems.map(item => `<div class="card-expense-row"><span>${escapeHtml(item.description)}<small>${formatDate(item.date)}</small></span><strong>${formatCurrency(item.amount)}</strong></div>`).join('') : (opening ? '' : '<p class="muted card-empty">Nenhum gasto no cartão neste mês.</p>'));
}
function renderCategories(items, total) {
  const groups = items.reduce((result, item) => { result[item.category] = (result[item.category] || 0) + item.amount; return result; }, {}), rows = Object.entries(groups).sort((a, b) => b[1] - a[1]);
  $('#categoryBars').innerHTML = rows.length ? rows.map(([category, amount]) => `<div class="category-row"><div class="category-label"><span>${icons[category] || '📌'} ${escapeHtml(category)}</span><span>${formatCurrency(amount)}</span></div><div class="bar-track"><div class="bar-fill" style="width:${total ? Math.max(3, amount / total * 100) : 0}%"></div></div></div>`).join('') : '<p class="muted">As categorias de gastos aparecerão aqui.</p>';
}
function openModal(item = null) {
  editingId = item ? item.id : null;
  form.reset();
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
  modalBackdrop.hidden = false;
  $('#descriptionInput').focus();
}
function closeModal() { modalBackdrop.hidden = true; form.reset(); editingId = null; $('#modalTitle').textContent = 'Adicionar entrada ou gasto'; $('#saveButton').textContent = 'Salvar lançamento'; }
function openCardModal() { openModal(); $('#modalTitle').textContent = 'Novo gasto no cartão'; $('#typeInput').value = 'expense'; $('#paymentInput').value = 'Crédito'; $('#categoryInput').value = 'Outros'; }
monthFilter.value = currentMonth();
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
  const [transactions, settings] = await Promise.all([fetchAll('transactions', ['created_at', 'id']), fetchAll('monthly_settings', ['month'])]);
  expenses = transactions.map(fromRow);
  budgets = {}; cardOpenings = {};
  settings.forEach(row => { budgets[row.month] = Number(row.budget); cardOpenings[row.month] = Number(row.card_opening); });
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
  saveBtn.disabled = true;
  try {
    if (id) {
      const { data: row, error } = await sb.from('transactions').update(data).eq('id', id).select().single();
      if (error) throw error;
      expenses = expenses.map(item => item.id === id ? fromRow(row) : item);
    } else {
      const { data: row, error } = await sb.from('transactions').insert({ ...data, user_id: currentUser.id }).select().single();
      if (error) throw error;
      expenses.push(fromRow(row));
    }
    if (data.payment !== 'Crédito') { cardOnly = false; $('#cardFilterBtn').classList.remove('active'); $('#cardFilterBtn').setAttribute('aria-pressed', 'false'); $('#cardFilterBtn').textContent = '💳 Só gastos no cartão'; }
    closeModal(); monthFilter.value = date.slice(0, 7); render();
  } catch (error) {
    showError('Não consegui salvar o lançamento.', error);
  } finally {
    saveBtn.disabled = false;
  }
});

$('#typeInput').addEventListener('change', () => { const isIncome = $('#typeInput').value === 'income'; $('#categoryInput').value = isIncome ? 'Salário' : 'Alimentação'; });
$('#exportBtn').addEventListener('click', () => { const rows = filteredExpenses(), csv = [['Data', 'Tipo', 'Descrição', 'Categoria', 'Pagamento', 'Valor'], ...rows.map(item => [item.date, item.type === 'income' ? 'Entrada' : 'Gasto', item.description, item.category, item.payment, item.amount.toFixed(2).replace('.', ',')])].map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(';')).join('\n'), blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' }), link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `financas-${selectedMonth()}.csv`; link.click(); URL.revokeObjectURL(link.href); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !modalBackdrop.hidden) closeModal(); });

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
      currentUser = null; expenses = []; budgets = {}; cardOpenings = {};
      showAuth();
    }
  }, 0);
});
