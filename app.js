// ESTADOS Y VARIABLES GLOBALES
const apiKey = ""; 
const DB_URL_KEY = 'leo_agenda_db_url';
const API_KEY_STORAGE_KEY = 'leo_gemini_api_key';

let dbUrl = localStorage.getItem(DB_URL_KEY) || "";
let customApiKey = localStorage.getItem(API_KEY_STORAGE_KEY) || "";

function safeParse(key, fallback) {
    try { const data = localStorage.getItem(key); return data ? JSON.parse(data) : fallback; } 
    catch (e) { return fallback; }
}

// Inicialización de la base local
let tasks = safeParse('leo_agenda_v11', []);
let calendarDate = new Date();
let customAreas = safeParse('leo_custom_areas', ["Inbox", "Trabajo", "Personal", "Estudios"]);
let customContexts = safeParse('leo_custom_contexts', [{ name: "@casa", color: "purple" }, { name: "@oficina", color: "blue" }, { name: "@online", color: "teal" }]);
let expandedStates = safeParse('leo_expanded_states', {});

let currentState = { view: 'today', selectedArea: null, focusTargetId: null };
let currentFilters = { search: '', status: 'pending', priority: 'all', context: 'all' };
let currentSort = { by: 'date', order: 'asc' }; // Orden predeterminado por fecha de vencimiento
let navHistory = [];

let isBulkMode = false;
let selectedTaskIds = new Set();
let currentAttachments = []; 
let manageSelectedColor = 'blue';

// RECURRENCIA - ESTADOS GLOBALES PARA MODALS
let addSelectedDays = [1];
let editSelectedDays = [1];

const priorityColors = { urgente: 'text-danger-500', alta: 'text-brand-500', media: 'text-yellow-500', baja: 'text-navy-500' };
const contextColorMap = { 
    blue: { dot: 'bg-blue-500', text: 'text-blue-500', bg: 'bg-blue-500/10', border: 'border-blue-500/20' }, 
    purple: { dot: 'bg-purple-500', text: 'text-purple-500', bg: 'bg-purple-500/10', border: 'border-purple-500/20' }, 
    green: { dot: 'bg-green-500', text: 'text-green-500', bg: 'bg-green-500/10', border: 'border-green-500/20' }, 
    red: { dot: 'bg-red-500', text: 'text-red-500', bg: 'bg-red-500/10', border: 'border-red-500/20' }, 
    orange: { dot: 'bg-orange-500', text: 'text-orange-500', bg: 'bg-orange-500/10', border: 'border-orange-500/20' }, 
    gray: { dot: 'bg-gray-500', text: 'text-gray-500', bg: 'bg-gray-500/10', border: 'border-gray-500/20' }, 
    pink: { dot: 'bg-pink-500', text: 'text-pink-500', bg: 'bg-pink-500/10', border: 'border-pink-500/20' }, 
    teal: { dot: 'bg-teal-500', text: 'text-teal-500', bg: 'bg-teal-500/10', border: 'border-teal-500/20' },
    yellow: { dot: 'bg-yellow-500', text: 'text-yellow-500', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' },
    cyan: { dot: 'bg-cyan-500', text: 'text-cyan-500', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20' },
    indigo: { dot: 'bg-indigo-500', text: 'text-indigo-500', bg: 'bg-indigo-500/10', border: 'border-indigo-500/20' },
    rose: { dot: 'bg-rose-500', text: 'text-rose-500', bg: 'bg-rose-500/10', border: 'border-rose-500/20' },
    emerald: { dot: 'bg-emerald-500', text: 'text-emerald-500', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
    fuchsia: { dot: 'bg-fuchsia-500', text: 'text-fuchsia-500', bg: 'bg-fuchsia-500/10', border: 'border-fuchsia-500/20' }
};

let editState = { id: null, parentId: 'root' }; let postponeState = { id: null };
let draggedAreaIndex = null;
let speechRecognition = null; let isListening = false;
let confirmCallback = null;

// INICIALIZACIÓN SECUENCIAL
window.onload = async () => { 
    initSpeechRecognition(); 
    updateDateDisplay(); 
    document.getElementById('settingsDbUrlInput').value = dbUrl;
    document.getElementById('settingsApiKeyInput').value = customApiKey;
    
    let loadedFromCloud = false;
    if (dbUrl) { 
        loadedFromCloud = await loadDataFromCloud(); 
    } else { 
        showSyncStatus('none'); 
    }

    const hadMutations = migrateAndNormalizeTasks(); 
    if (hadMutations && dbUrl && loadedFromCloud) {
        await saveData();
    }

    refreshAllDropdowns(); 
    updateUI(); 
};

function saveCategories() {
    localStorage.setItem('leo_custom_areas', JSON.stringify(customAreas));
    localStorage.setItem('leo_custom_contexts', JSON.stringify(customContexts));
}

// MIGRACIÓN Y NORMALIZACIÓN
function migrateAndNormalizeTasks() { 
    let changed = false;
    if (!customAreas.includes("Inbox")) { customAreas.unshift("Inbox"); saveCategories(); changed = true; }
    const tenDaysMs = 10 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    
    function walk(nodes, parentArea) {
        if (!Array.isArray(nodes)) return;
        for (let i = nodes.length - 1; i >= 0; i--) {
            let n = nodes[i];
            if (n.isDeleted && n.deletedAt && (now - n.deletedAt > tenDaysMs)) { nodes.splice(i, 1); changed = true; continue; }
            
            if (n.status === undefined) { n.status = n.completed ? 'completed' : 'pending'; delete n.completed; changed = true; }
            if (!n.priority) { n.priority = 'baja'; changed = true; }
            if (!n.subtasks) { n.subtasks = []; changed = true; }
            if (n.notes === undefined) { n.notes = ''; changed = true; }
            if (n.attachments === undefined) { n.attachments = []; changed = true; }
            if (!n.area || n.area === 'General') { n.area = parentArea || 'Inbox'; changed = true; }
            if (n.context === undefined) { n.context = ''; changed = true; }
            if (n.time === undefined) { n.time = ''; changed = true; }
            
            if (n.recurrence && n.recurrence !== 'none' && !n.recurrenceRule) {
                n.recurrenceRule = {
                    frequency: n.recurrence === 'diario' ? 'daily' : n.recurrence === 'semanal' ? 'weekly' : 'monthly',
                    interval: 1,
                    baseOnCompletion: !!n.completionBased,
                    ...(n.recurrence === 'semanal' && { daysOfWeek: [1] }),
                    ...(n.recurrence === 'mensual' && { dayOfMonth: parseInt(n.date?.split('-')[2]) || 1 }),
                    ...(n.recurrence === 'dia_habil' && { nthBusinessDay: parseInt(n.businessDayNum) || 5 })
                };
                if (n.recurrence === 'dia_habil') { n.recurrenceRule.frequency = 'monthly'; }
                changed = true;
            }
            if (n.recurrence !== undefined) { delete n.recurrence; delete n.businessDayNum; delete n.completionBased; changed = true; }
            
            if (n.subtasks) walk(n.subtasks, n.area);
        }
    }
    if (Array.isArray(tasks)) { walk(tasks, null); } else { tasks = []; changed = true; }
    if (changed) { localStorage.setItem('leo_agenda_v11', JSON.stringify(tasks)); }
    return changed;
}

// COMUNICACIÓN CLOUD Y PERSISTENCIA
async function saveData() {
    localStorage.setItem('leo_agenda_v11', JSON.stringify(tasks));
    localStorage.setItem('leo_custom_areas', JSON.stringify(customAreas));
    localStorage.setItem('leo_custom_contexts', JSON.stringify(customContexts));
    
    if (!dbUrl) return;
    showSyncStatus('saving');
    try {
        const response = await fetch(dbUrl, { 
            method: 'POST', 
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(tasks),
            redirect: 'follow'
        });
        if (!response.ok) throw new Error('Respuesta HTTP no exitosa: ' + response.status);
        const textData = await response.text();
        if (textData.trim().startsWith('<')) throw new Error('El servidor devolvió HTML (Posible error de permisos)');
        showSyncStatus('synced');
    } catch (e) { 
        console.error("Error al guardar:", e); 
        showSyncStatus('offline'); 
        showNotice("Fallo al guardar: " + e.message.substring(0, 40));
    }
}
async function loadDataFromCloud() {
    if (!dbUrl) return false;
    showSyncStatus('loading');
    try {
        const res = await fetch(dbUrl, { method: 'GET', redirect: 'follow' });
        if (!res.ok) throw new Error("Fallo HTTP: " + res.status);
        const textData = await res.text();
        
        if (textData.trim().startsWith('<')) {
            throw new Error("La URL devolvió código HTML. Revisá los permisos de tu Apps Script.");
        }

        const data = JSON.parse(textData);
        if (Array.isArray(data)) { 
            tasks = data; 
            localStorage.setItem('leo_agenda_v11', JSON.stringify(tasks)); 
            showSyncStatus('synced'); 
            showNotice("Sincronizado");
            return true;
        }
        return false;
    } catch (e) { 
        console.error("Error al cargar:", e); 
        showSyncStatus('offline'); 
        showNotice("Modo Offline: " + e.message.substring(0, 50)); 
        return false;
    }
}

// LÓGICA DE RECURRENCIA
function parseDateLocal(dateStr) { if (!dateStr) return new Date(); const [y, m, d] = dateStr.split('-').map(Number); return new Date(y, m - 1, d, 0, 0, 0, 0); }
function formatDateLocal(dateObj) { const y = dateObj.getFullYear(); const m = String(dateObj.getMonth() + 1).padStart(2, '0'); const d = String(dateObj.getDate()).padStart(2, '0'); return `${y}-${m}-${d}`; }
function isBusinessDay(date) { const day = date.getDay(); return day !== 0 && day !== 6; }
function calculateNthBusinessDay(year, month, n) { let count = 0; let date = new Date(year, month, 1, 0, 0, 0, 0); let lastBd = null; while (date.getMonth() === month) { if (isBusinessDay(date)) { count++; lastBd = new Date(date); if (count === n) return date; } date.setDate(date.getDate() + 1); } return lastBd; }
function addMonthsSafely(baseDate, monthsToAdd, targetDay) { const result = new Date(baseDate); const expectedMonth = (baseDate.getMonth() + monthsToAdd) % 12; const expectedYear = baseDate.getFullYear() + Math.floor((baseDate.getMonth() + monthsToAdd) / 12); result.setDate(1); result.setFullYear(expectedYear); result.setMonth(expectedMonth); const daysInTargetMonth = new Date(expectedYear, expectedMonth + 1, 0, 0, 0, 0, 0).getDate(); const dayToSet = targetDay !== undefined ? targetDay : baseDate.getDate(); result.setDate(Math.min(dayToSet, daysInTargetMonth)); return result; }
function getStartOfWeek(date) { const result = new Date(date); const day = result.getDay(); const diff = result.getDate() - day + (day === 0 ? -6 : 1); result.setDate(diff); return result; }
function getDaysDifference(d1, d2) { const t1 = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate()); const t2 = new Date(d2.getFullYear(), d2.getMonth(), d2.getDate()); return Math.round((t2 - t1) / 86400000); }

function calculateNextOccurrence(task, completionDateStr = null) {
    const rule = task.recurrenceRule; if (!rule || rule.frequency === 'none') return '';
    const scheduledDate = parseDateLocal(task.date); const completionDate = completionDateStr ? parseDateLocal(completionDateStr) : new Date();
    const baseDate = rule.baseOnCompletion ? completionDate : scheduledDate; const interval = Math.max(1, rule.interval || 1);
    if (rule.frequency === 'after_completion') { const next = new Date(completionDate); next.setDate(next.getDate() + interval); return formatDateLocal(next); }
    switch (rule.frequency) {
        case 'daily': { const next = new Date(baseDate); next.setDate(next.getDate() + interval); return formatDateLocal(next); }
        case 'weekly': {
            const daysOfWeek = rule.daysOfWeek; if (!daysOfWeek || daysOfWeek.length === 0) { const next = new Date(baseDate); next.setDate(next.getDate() + (interval * 7)); return formatDateLocal(next); }
            const anchorDate = task.startDate ? parseDateLocal(task.startDate) : scheduledDate; const anchorWeekStart = getStartOfWeek(anchorDate);
            const sortedDays = [...daysOfWeek].sort((a, b) => a - b);
            let candidate = new Date(baseDate); let found = false; let safetyCounter = 0;
            while (!found && safetyCounter < 1000) {
                safetyCounter++; candidate.setDate(candidate.getDate() + 1); const candidateDay = candidate.getDay();
                if (sortedDays.includes(candidateDay)) { const candidateWeekStart = getStartOfWeek(candidate); const weekDiff = Math.floor(getDaysDifference(anchorWeekStart, candidateWeekStart) / 7); if (weekDiff % interval === 0) found = true; }
            } return formatDateLocal(candidate);
        }
        case 'monthly': {
            if (rule.nthBusinessDay !== undefined) { const targetMonthDate = addMonthsSafely(baseDate, interval, 1); return formatDateLocal(calculateNthBusinessDay(targetMonthDate.getFullYear(), targetMonthDate.getMonth(), rule.nthBusinessDay)); }
            const targetDay = rule.dayOfMonth !== undefined ? rule.dayOfMonth : baseDate.getDate(); return formatDateLocal(addMonthsSafely(baseDate, interval, targetDay));
        }
        case 'yearly': {
            const next = new Date(baseDate); const targetMonth = rule.monthOfYear !== undefined ? (rule.monthOfYear - 1) : baseDate.getMonth(); const targetDay = rule.dayOfMonth !== undefined ? rule.dayOfMonth : baseDate.getDate();
            next.setFullYear(next.getFullYear() + interval); next.setDate(1); next.setMonth(targetMonth); const maxDays = new Date(next.getFullYear(), targetMonth + 1, 0, 0, 0, 0, 0).getDate(); next.setDate(Math.min(targetDay, maxDays)); return formatDateLocal(next);
        }
        case 'custom': { const targetDay = rule.dayOfMonth !== undefined ? rule.dayOfMonth : baseDate.getDate(); return formatDateLocal(addMonthsSafely(baseDate, interval, targetDay)); }
        default: return '';
    }
}

// FUNCIONES DE INTERFAZ RECURRENCIA (MODALS)
function toggleRecurrenceUI(mode) {
    const checked = document.getElementById(`${mode}HasRecurrence`).checked;
    document.getElementById(`${mode}RecurrenceContainer`).classList.toggle('hidden', !checked);
    refreshRecurrenceUI(mode);
}
function toggleDay(mode, dayVal) {
    const arr = mode === 'add' ? addSelectedDays : editSelectedDays;
    if (arr.includes(dayVal)) { const idx = arr.indexOf(dayVal); arr.splice(idx, 1); } else { arr.push(dayVal); arr.sort((a, b) => a - b); }
    for (let i=0; i<7; i++) {
        const btn = document.getElementById(`${mode}-day-${i}`);
        if (arr.includes(i)) { btn.classList.add('bg-brand-500', 'text-navy-900', 'border-brand-500', 'scale-110'); btn.classList.remove('bg-navy-800'); }
        else { btn.classList.remove('bg-brand-500', 'text-navy-900', 'border-brand-500', 'scale-110'); btn.classList.add('bg-navy-800'); }
    }
    validateAndProjectRecurrence(mode);
}
function refreshRecurrenceUI(mode) {
    const freq = document.getElementById(`${mode}Frequency`).value;
    document.getElementById(`${mode}IntervalLabel`).innerText = freq === 'daily' ? 'días' : freq === 'weekly' ? 'semanas' : freq === 'monthly' ? 'meses' : freq === 'yearly' ? 'años' : freq === 'after_completion' ? 'días post-resolución' : 'meses';
    document.getElementById(`${mode}WeeklyBlock`).classList.toggle('hidden', freq !== 'weekly');
    document.getElementById(`${mode}MonthlyBlock`).classList.toggle('hidden', freq !== 'monthly');
    document.getElementById(`${mode}YearlyBlock`).classList.toggle('hidden', freq !== 'yearly');
    document.getElementById(`${mode}CustomBlock`).classList.toggle('hidden', freq !== 'custom');
    document.getElementById(`${mode}CompletionBaseBlock`).classList.toggle('hidden', freq === 'after_completion');
    if (freq === 'monthly') {
        const isFixed = document.querySelector(`input[name="${mode}MonthlyMode"]:checked`).value === 'fixed';
        document.getElementById(`${mode}MonthlyFixedBlock`).classList.toggle('hidden', !isFixed);
        document.getElementById(`${mode}MonthlyBusinessBlock`).classList.toggle('hidden', isFixed);
    }
    validateAndProjectRecurrence(mode);
}
function buildRuleFromUI(mode) {
    if (!document.getElementById(`${mode}HasRecurrence`).checked) return null;
    const freq = document.getElementById(`${mode}Frequency`).value;
    const interval = parseInt(document.getElementById(`${mode}Interval`).value) || 1;
    const baseOnComp = freq === 'after_completion' ? true : document.getElementById(`${mode}BaseOnCompletion`).checked;
    let rule = { frequency: freq, interval, baseOnCompletion: baseOnComp };
    if (freq === 'weekly') rule.daysOfWeek = mode === 'add' ? [...addSelectedDays] : [...editSelectedDays];
    else if (freq === 'monthly') {
        const isFixed = document.querySelector(`input[name="${mode}MonthlyMode"]:checked`).value === 'fixed';
        if (isFixed) rule.dayOfMonth = parseInt(document.getElementById(`${mode}DayOfMonth`).value) || 1;
        else rule.nthBusinessDay = parseInt(document.getElementById(`${mode}NthBusinessDay`).value) || 5;
    }
    else if (freq === 'yearly') { rule.dayOfMonth = parseInt(document.getElementById(`${mode}YearDay`).value) || 1; rule.monthOfYear = parseInt(document.getElementById(`${mode}YearMonth`).value) || 1; }
    else if (freq === 'custom') { rule.dayOfMonth = parseInt(document.getElementById(`${mode}CustomDay`).value) || 1; }
    return rule;
}
function validateAndProjectRecurrence(mode) {
    const rule = buildRuleFromUI(mode); const projEl = document.getElementById(`${mode}RecurrenceProjection`);
    if (!rule) { projEl.innerText = ''; return; }
    const tDate = document.getElementById(mode === 'add' ? 'dateInput' : 'editDateInput').value;
    if (!tDate) { projEl.innerText = 'Seleccioná una fecha base para simular.'; return; }
    if (rule.frequency === 'weekly' && (!rule.daysOfWeek || rule.daysOfWeek.length === 0)) { projEl.innerText = 'Seleccioná al menos un día.'; return; }
    try { const simTask = { date: tDate, startDate: tDate, recurrenceRule: rule }; const nextDate = calculateNextOccurrence(simTask); projEl.innerText = nextDate ? `Próxima ejecución: ${nextDate}` : 'Configuración inválida.'; } 
    catch (e) { projEl.innerText = 'Error algorítmico.'; }
}

// LÓGICA DE TAREAS (CREATE / UPDATE / DELETE / COMPLETE)
async function addTask() { 
    const name = document.getElementById('taskInput').value.trim(); if (!name) return; 
    const area = document.getElementById('areaInput').value; const context = document.getElementById('contextInput').value; const priority = document.getElementById('priorityInput').value; 
    const dateInput = document.getElementById('dateInput').value; const timeInput = document.getElementById('timeInput').value; const notes = document.getElementById('notesInput').value.trim(); 
    const reminder = document.getElementById('reminderToggle').checked; const rule = buildRuleFromUI('add');
    const parentIdRaw = document.getElementById('parentInput').value; const parentId = parentIdRaw === 'root' ? 'root' : Number(parentIdRaw);
    const newTask = { id: Date.now(), name, area, context, priority, date: dateInput, startDate: dateInput, time: timeInput, notes, reminder, status: 'pending', attachments: [...currentAttachments], subtasks: [], recurrenceRule: rule };
    if (parentId === 'root') tasks.unshift(newTask); else insertTask(newTask, parentId);
    closeAddTaskModal(); refreshAllDropdowns(); renderTasks(); showNotice("Tarea guardada"); await saveData(); 
}
async function saveEdit() {
    const id = editState.id; const name = document.getElementById('editNameInput').value.trim(); if (!name) return;
    const status = document.getElementById('editStatusInput').value; const area = document.getElementById('editAreaInput').value; const context = document.getElementById('editContextInput').value; 
    const priority = document.getElementById('editPriorityInput').value; const date = document.getElementById('editDateInput').value; const time = document.getElementById('editTimeInput').value; 
    const notes = document.getElementById('editNotesInput').value.trim(); const reminder = document.getElementById('editReminderToggle').checked; const rule = buildRuleFromUI('edit');
    const newParentIdRaw = document.getElementById('editParentInput').value; const newParentId = newParentIdRaw === 'root' ? 'root' : Number(newParentIdRaw);
    let targetTask = null; if (newParentId !== editState.parentId) targetTask = extractTask(id);
    if (targetTask) { targetTask.name = name; targetTask.status = status; targetTask.area = area; targetTask.context = context; targetTask.priority = priority; targetTask.date = date; targetTask.time = time; targetTask.notes = notes; targetTask.reminder = reminder; targetTask.recurrenceRule = rule; targetTask.attachments = [...currentAttachments]; insertTask(targetTask, newParentId); }
    else { findAndMutateTask(id, (nodes, i) => { const n = nodes[i]; n.name = name; n.status = status; n.area = area; n.context = context; n.priority = priority; n.date = date; n.time = time; n.notes = notes; n.reminder = reminder; n.recurrenceRule = rule; n.attachments = [...currentAttachments]; }); }
    closeEditModal(); refreshAllDropdowns(); renderTasks(); showNotice("Guardado exitosamente"); await saveData(); 
}
async function toggleTaskUniversal(id) {
    findAndMutateTask(id, (nodes, i) => {
        const t = nodes[i];
        if (t.status !== 'completed' && t.recurrenceRule) {
            const todayStr = formatDateLocal(new Date());
            const nextDate = calculateNextOccurrence(t, todayStr);
            const historicalCopy = JSON.parse(JSON.stringify(t));
            historicalCopy.id = Date.now() + Math.random(); historicalCopy.status = 'completed'; historicalCopy.completedAt = todayStr; historicalCopy.recurrenceRule = null;
            t.date = nextDate; t.status = 'pending'; 
            function resetCompletion(task) { task.status = 'pending'; if (task.subtasks) task.subtasks.forEach(resetCompletion); }
            if(t.subtasks) t.subtasks.forEach(resetCompletion);
            nodes.splice(i, 0, historicalCopy);
        } else { t.status = t.status === 'completed' ? 'pending' : 'completed'; }
    });
    renderTasks(); renderCalendar(); await saveData();
}
async function deleteTaskUniversal(id) { const task = getTaskById(id); if (!task) return; const performDelete = async () => { if (findAndMutateTask(id, (nodes, i) => { nodes[i].isDeleted = true; nodes[i].deletedAt = Date.now(); })) { refreshAllDropdowns(); renderTasks(); renderCalendar(); showNotice("Enviada a papelera"); await saveData(); } }; if (task.subtasks && task.subtasks.length > 0) { showConfirm("Eliminar con subtareas", `¿Enviar a papelera con sus ${task.subtasks.length} subtareas?`, performDelete, true); } else { await performDelete(); } }

// MODALS LIFECYCLE
function openAddTaskModal() { 
    document.getElementById('taskInput').value = ''; 
    document.getElementById('dateInput').value = ''; 
    document.getElementById('timeInput').value = ''; 
    document.getElementById('notesInput').value = ''; 
    document.getElementById('priorityInput').value = 'baja';
    document.getElementById('areaInput').value = customAreas.includes('Inbox') ? 'Inbox' : (customAreas[0] || 'Inbox'); 
    document.getElementById('contextInput').value = ''; 
    
    currentAttachments = []; 
    renderAttachments('add'); 
    updateAddParentDropdown();
    document.getElementById('addHasRecurrence').checked = false; 
    addSelectedDays = [1]; 
    toggleDay('add', 1); 
    toggleRecurrenceUI('add');
    
    // 1. Mostrar el modal (removiendo el display: none)
    document.getElementById('addTaskModal').classList.remove('hidden'); 
    
    // 2. CORRECCIÓN ARQUITECTÓNICA: Reseteo de estado con el DOM visible.
    // Al modificar la propiedad 'checked' DESPUÉS de que el nodo es visible en el DOM activo, 
    // forzamos al motor de renderizado a repintar las clases pseudo-estado de Tailwind (peer-checked).
    // Si se hace antes (estando oculto), el motor JS actualiza la propiedad pero el CSS omite el repintado.
    const reminderToggle = document.getElementById('reminderToggle');
    if (reminderToggle) {
        reminderToggle.checked = false;
    }

    setTimeout(() => document.getElementById('taskInput').focus(), 100); 
}

function closeAddTaskModal() { 
    document.getElementById('addTaskModal').classList.add('hidden'); 
    
    // Limpieza de seguridad post-cierre (previene fugas de estado si el renderizado falla)
    const reminderToggle = document.getElementById('reminderToggle');
    if (reminderToggle) {
        reminderToggle.checked = false;
    }
}

function openEditModal(id) { 
    editState = { id, parentId: getParentId(id) }; let target = null;
    function traverse(nodes) { for(let n of nodes) { if(n.id === id) { target = n; return true; } if(n.subtasks && traverse(n.subtasks)) return true; } } traverse(tasks); if (!target) return;
    document.getElementById('editNameInput').value = target.name; refreshEditDropdowns(); document.getElementById('editStatusInput').value = target.status || 'pending';
    document.getElementById('editAreaInput').value = target.area || 'Inbox'; document.getElementById('editContextInput').value = target.context || ''; document.getElementById('editPriorityInput').value = target.priority || 'baja'; 
    document.getElementById('editDateInput').value = target.date || ''; document.getElementById('editTimeInput').value = target.time || ''; document.getElementById('editReminderToggle').checked = target.reminder || false; document.getElementById('editNotesInput').value = target.notes || '';
    currentAttachments = target.attachments ? [...target.attachments] : []; renderAttachments('edit'); updateEditParentDropdown();
    if (target.recurrenceRule) {
        const r = target.recurrenceRule; document.getElementById('editHasRecurrence').checked = true; document.getElementById('editFrequency').value = r.frequency; document.getElementById('editInterval').value = r.interval; document.getElementById('editBaseOnCompletion').checked = !!r.baseOnCompletion;
        if (r.frequency === 'weekly') { editSelectedDays = r.daysOfWeek || [1]; for(let i=0;i<7;i++){ if(editSelectedDays.includes(i)){ toggleDay('edit', i); toggleDay('edit', i); } else { const btn = document.getElementById(`edit-day-${i}`); btn.classList.remove('bg-brand-500', 'text-navy-900', 'border-brand-500', 'scale-110'); btn.classList.add('bg-navy-800'); } } }
        if (r.frequency === 'monthly') { if (r.nthBusinessDay !== undefined) { document.querySelector('input[name="editMonthlyMode"][value="business"]').checked = true; document.getElementById('editNthBusinessDay').value = r.nthBusinessDay; } else { document.querySelector('input[name="editMonthlyMode"][value="fixed"]').checked = true; document.getElementById('editDayOfMonth').value = r.dayOfMonth || 1; } }
        if (r.frequency === 'yearly') { document.getElementById('editYearDay').value = r.dayOfMonth || 1; document.getElementById('editYearMonth').value = r.monthOfYear || 1; }
        if (r.frequency === 'custom') { document.getElementById('editCustomDay').value = r.dayOfMonth || 1; }
    } else { document.getElementById('editHasRecurrence').checked = false; }
    toggleRecurrenceUI('edit'); document.getElementById('editModal').classList.remove('hidden'); 
}

function closeEditModal() { 
    document.getElementById('editModal').classList.add('hidden'); 
}

// UTILIDADES Y RENDERIZADO VISUAL
function showConfirm(title, message, onConfirm, isDanger = false) { document.getElementById('confirmModalTitle').innerText = title; document.getElementById('confirmModalMessage').innerText = message; confirmCallback = onConfirm; const btnConfirm = document.getElementById('confirmModalBtnAction'); if (isDanger) btnConfirm.className = "w-1/2 bg-danger-500 text-navy-50 py-3 rounded-md text-sm font-semibold hover:bg-danger-600 focus:outline-none"; else btnConfirm.className = "w-1/2 bg-brand-500 text-navy-900 py-3 rounded-md text-sm font-semibold hover:bg-brand-400 transition-colors focus:outline-none"; document.getElementById('confirmModal').classList.remove('hidden'); }
function closeConfirmModal(accepted) { document.getElementById('confirmModal').classList.add('hidden'); if (accepted && confirmCallback) confirmCallback(); confirmCallback = null; }
function showSyncStatus(status) { const dot = document.getElementById('sync-status-dot'); const text = document.getElementById('sync-status-text'); if (!dot || !text) return; dot.className = "w-1.5 h-1.5 rounded-full transition-all"; switch(status) { case 'saving': dot.classList.add('bg-blue-500', 'animate-pulse'); text.innerText = "Guardando..."; text.className = "text-blue-400"; break; case 'synced': dot.classList.add('bg-emerald-500'); text.innerText = "Sincronizado"; text.className = "text-emerald-400"; break; case 'loading': dot.classList.add('bg-brand-500', 'animate-pulse'); text.innerText = "Cargando..."; text.className = "text-brand-400"; break; case 'offline': dot.classList.add('bg-yellow-500'); text.innerText = "Modo Offline"; text.className = "text-yellow-400"; break; case 'error': dot.classList.add('bg-red-500'); text.innerText = "Fallo de Red"; text.className = "text-red-400"; break; default: dot.classList.add('bg-navy-500'); text.innerText = "Nube Desconectada"; text.className = "text-navy-400"; break; } }
function showNotice(msg) { const box = document.getElementById('notification-box'); const notice = document.createElement('div'); notice.className = "bg-brand-500 text-navy-900 px-6 py-4 rounded-md text-xs font-bold animate-in select-none pointer-events-auto border border-brand-600"; notice.innerText = msg; box.appendChild(notice); setTimeout(() => { notice.style.opacity = '0'; notice.style.transition = 'opacity 0.3s'; setTimeout(() => notice.remove(), 300); }, 2500); }
function openSettingsModal() { document.getElementById('settingsDbUrlInput').value = dbUrl; document.getElementById('settingsApiKeyInput').value = customApiKey; document.getElementById('settingsModal').classList.remove('hidden'); }
function closeSettingsModal() { document.getElementById('settingsModal').classList.add('hidden'); }
async function saveSettings() { dbUrl = document.getElementById('settingsDbUrlInput').value.trim(); customApiKey = document.getElementById('settingsApiKeyInput').value.trim(); if (dbUrl) localStorage.setItem(DB_URL_KEY, dbUrl); else localStorage.removeItem(DB_URL_KEY); if (customApiKey) localStorage.setItem(API_KEY_STORAGE_KEY, customApiKey); else localStorage.removeItem(API_KEY_STORAGE_KEY); closeSettingsModal(); showNotice("Configuración actualizada."); if (dbUrl) await loadDataFromCloud(); else { showSyncStatus('none'); updateUI(); } }
function updateDateDisplay() { document.getElementById('current-date-display').innerText = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }); }
function toggleSidebar(force) { const sidebar = document.getElementById('sidebar'); const overlay = document.getElementById('mobile-overlay'); const isOpen = !sidebar.classList.contains('-translate-x-full'); if (force === false || isOpen) { sidebar.classList.add('-translate-x-full'); overlay.classList.add('hidden'); } else { sidebar.classList.remove('-translate-x-full'); overlay.classList.remove('hidden'); } }
function toggleConfigMenu() { const content = document.getElementById('configMenuContent'); const chevron = document.getElementById('configMenuChevron'); if (content.classList.contains('hidden')) { content.classList.remove('hidden'); chevron.classList.add('rotate-180'); } else { content.classList.add('hidden'); chevron.classList.remove('rotate-180'); } }
function getContextStyles(contextName) { const found = customContexts.find(c => c.name === contextName); const color = found ? found.color : 'gray'; return contextColorMap[color] || contextColorMap['gray']; }
function formatDateAR(dateStr, timeStr) { if (!dateStr) return ''; const parts = dateStr.split('-'); if (parts.length !== 3) return dateStr; const formattedDate = `${parts[2]}/${parts[1]}`; return timeStr ? `${formattedDate}` : formattedDate; }

// CORE ENGINE HELPERS
function findAndMutateTask(taskId, mutationFn) { function traverse(nodes) { for (let i = 0; i < nodes.length; i++) { if (nodes[i].id === taskId) { mutationFn(nodes, i); return true; } if (nodes[i].subtasks && traverse(nodes[i].subtasks)) return true; } return false; } return traverse(tasks); }
function extractTask(taskId) { let extracted = null; function walk(nodes) { for (let i = 0; i < nodes.length; i++) { if (nodes[i].id === taskId) { extracted = nodes.splice(i, 1)[0]; return true; } if (nodes[i].subtasks && walk(nodes[i].subtasks)) return true; } return false; } walk(tasks); return extracted; }
function insertTask(taskObj, parentId) { if (parentId === 'root') tasks.unshift(taskObj); else findAndMutateTask(parentId, (nodes, i) => { if (!nodes[i].subtasks) nodes[i].subtasks = []; nodes[i].subtasks.push(taskObj); expandedStates[parentId] = true; }); }
function getParentId(taskId) { let pId = 'root'; function search(nodes, currentParent) { for (let n of nodes) { if (n.id === taskId) { pId = currentParent; return true; } if (n.subtasks && search(n.subtasks, n.id)) return true; } return false; } search(tasks, 'root'); return pId; }
function isDescendant(ancestorId, targetId) { if (ancestorId === targetId) return true; let ancestorNode = null; function findAnc(nodes) { for(let n of nodes) { if (n.id === ancestorId) { ancestorNode = n; return; } if (n.subtasks) findAnc(n.subtasks); } } findAnc(tasks); if (!ancestorNode || !ancestorNode.subtasks) return false; let found = false; function checkTarget(nodes) { for(let n of nodes) { if (n.id === targetId) { found = true; return; } if (n.subtasks) checkTarget(n.subtasks); } } checkTarget(ancestorNode.subtasks); return found; }
function getTaskById(id) { let found = null; function walk(nodes) { for (let n of nodes) { if (n.id === id) { found = n; return; } if (n.subtasks && n.subtasks.length > 0) walk(n.subtasks); } } walk(tasks); return found; }
function getUniqueValues(nodes, key) { let vals = new Set(); function walk(ns) { if(!Array.isArray(ns)) return; ns.forEach(n => { if (n.isDeleted) return; if (n[key]) vals.add(n[key]); if(n.subtasks) walk(n.subtasks); }); } walk(nodes); return Array.from(vals); }
function getAllAreasOrdered() { const uniqueTasksAreas = getUniqueValues(tasks, 'area').filter(Boolean); const orphaned = uniqueTasksAreas.filter(a => !customAreas.includes(a)).sort((a, b) => String(a).localeCompare(String(b))); return [...customAreas.filter(Boolean), ...orphaned]; }

// NAVEGACIÓN Y FOCO
function navigate(view, areaName = null, pushHistory = true, focusId = null) { 
    if (pushHistory) navHistory.push(JSON.parse(JSON.stringify(currentState))); 
    currentState.view = view; 
    currentState.selectedArea = areaName; 
    currentState.focusTargetId = focusId; 
    if (window.innerWidth < 768) toggleSidebar(false); 
    updateUI(); 
}
function focusTaskTree(id) { 
    navigate('focus', null, true, id); 
}
function goBack() { 
    if (navHistory.length > 0) { 
        currentState = navHistory.pop(); 
        updateUI(); 
    } 
}

function exportData() { const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(tasks)); const dlAnchorElem = document.createElement('a'); dlAnchorElem.setAttribute("href", dataStr); dlAnchorElem.setAttribute("download", "agenda_backup.json"); dlAnchorElem.click(); }
function importData(event) { const file = event.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = async (e) => { try { const importedTasks = JSON.parse(e.target.result); if (Array.isArray(importedTasks)) { tasks = importedTasks; migrateAndNormalizeTasks(); await saveData(); renderTasks(); renderCalendar(); showNotice("Datos importados correctamente"); } } catch (err) { showNotice("Error al leer el archivo"); } }; reader.readAsText(file); }

// RENDERING
function renderSidebarAreas() { const allAreas = getAllAreasOrdered(); document.getElementById('sidebar-areas-list').innerHTML = allAreas.map(area => `<button onclick="navigate('area', '${area}')" data-area="${area}" class="sidebar-area-item w-full flex items-center space-x-3 px-3 py-2 rounded-md text-sm font-medium text-navy-300 transition-all border-r-2 border-transparent hover:bg-navy-700 hover:text-navy-50 focus:outline-none"><span class="w-1.5 h-1.5 rounded-full ${area === 'Inbox' ? 'bg-brand-500' : 'bg-navy-500'}"></span><span class="truncate">${area}</span></button>`).join(''); }
function populateSelect(id, items, defaultLabel = null, defaultValue = "all") { const el = document.getElementById(id); if (!el) return; const currentVal = el.value; let html = defaultLabel !== null ? `<option value="${defaultValue}">${defaultLabel}</option>` : ''; html += items.map(item => `<option value="${item}">${item}</option>`).join(''); el.innerHTML = html; if (currentVal !== null && Array.from(el.options).some(o => o.value === currentVal)) { el.value = currentVal; } else if (defaultLabel !== null) { el.value = defaultValue; } }
function refreshAllDropdowns() { const allAreas = getAllAreasOrdered(); const allContexts = [...new Set([...customContexts.map(c => c.name), ...getUniqueValues(tasks, 'context')])].filter(c => c && c.trim() !== '').sort(); populateSelect('areaInput', allAreas); populateSelect('contextInput', allContexts, "Sin contexto", ""); populateSelect('filterContext', allContexts, "Contexto (Todos)", "all"); renderSidebarAreas(); }
function refreshEditDropdowns() { const allAreas = getAllAreasOrdered(); const allContexts = [...new Set([...customContexts.map(c => c.name), ...getUniqueValues(tasks, 'context')])].filter(c => c && c.trim() !== '').sort(); populateSelect('editAreaInput', allAreas); populateSelect('editContextInput', allContexts, "Sin contexto", ""); }
function updateAddParentDropdown() { const area = document.getElementById('areaInput').value; const select = document.getElementById('parentInput'); let optionsHtml = '<option value="root">Ninguna (Tarea Principal)</option>'; function collectValidParents(nodes, depth = 0) { nodes.forEach(n => { if (n.area === area && !n.isDeleted) { const prefix = '— '.repeat(depth); optionsHtml += `<option value="${n.id}">${prefix}${n.name}</option>`; } if (n.subtasks) collectValidParents(n.subtasks, depth + 1); }); } collectValidParents(tasks); const prevValue = select.value; select.innerHTML = optionsHtml; if (prevValue && Array.from(select.options).some(o => o.value === String(prevValue))) select.value = prevValue; else select.value = 'root'; }
function updateEditParentDropdown() { const area = document.getElementById('editAreaInput').value; const taskId = editState.id; const select = document.getElementById('editParentInput'); let optionsHtml = '<option value="root">Ninguna (Tarea Principal)</option>'; function collectValidParents(nodes, depth = 0) { nodes.forEach(n => { if (n.id !== taskId && !n.isDeleted && !isDescendant(taskId, n.id) && n.area === area) { const prefix = '— '.repeat(depth); optionsHtml += `<option value="${n.id}">${prefix}${n.name}</option>`; } if (n.subtasks) collectValidParents(n.subtasks, depth + 1); }); } collectValidParents(tasks); const prevValue = select.value || editState.parentId; select.innerHTML = optionsHtml; if (prevValue && Array.from(select.options).some(o => o.value === String(prevValue))) select.value = prevValue; else select.value = 'root'; }

// NAVIGATION & FILTERS CONTINUATION
function updateFilters() { currentFilters = { search: document.getElementById('searchInput').value.trim(), status: document.getElementById('filterStatus').value, priority: document.getElementById('filterPriority').value, context: document.getElementById('filterContext').value }; renderTasks(); }
function resetFilters() { document.getElementById('searchInput').value = ''; document.getElementById('filterStatus').value = 'pending'; document.getElementById('filterPriority').value = 'all'; document.getElementById('filterContext').value = 'all'; document.getElementById('sortSelect').value = 'date-asc'; currentSort = { by: 'date', order: 'asc' }; updateFilters(); showNotice("Filtros restablecidos"); }
function updateSort() { const val = document.getElementById('sortSelect').value.split('-'); currentSort = { by: val[0], order: val[1] }; renderTasks(); }

function updateUI() {
    const btnBack = document.getElementById('btnBack'); if (navHistory.length > 0) btnBack.classList.remove('hidden'); else btnBack.classList.add('hidden');
    const titleEl = document.getElementById('view-title');
    const titles = { 'today':'Hoy y atrasadas', 'tomorrow':'Mañana', 'week':'Esta semana', 'fortnight':'Próximos 15 días', 'all':'Todas las tareas', 'calendar':'Calendario', 'focus':'Dependencia específica', 'trash':'Papelera (10 días)' };
    titleEl.innerText = currentState.view === 'area' ? `Área: ${currentState.selectedArea}` : titles[currentState.view];
    const isTrash = currentState.view === 'trash';
    ['nav-today', 'nav-tomorrow', 'nav-week', 'nav-fortnight', 'nav-all', 'nav-calendar', 'nav-trash'].forEach(id => { const el = document.getElementById(id); if (id === `nav-${currentState.view}`) { el.classList.add('bg-navy-900', 'text-brand-500', 'border-r-2', 'border-brand-500'); el.classList.remove('text-navy-300', 'border-transparent'); if(id === 'nav-trash') el.querySelector('svg').classList.remove('text-danger-500'); } else { el.classList.remove('bg-navy-900', 'text-brand-500', 'border-r-2', 'border-brand-500'); el.classList.add('text-navy-300', 'border-transparent'); if(id === 'nav-trash') el.querySelector('svg').classList.add('text-danger-500'); } });
    document.querySelectorAll('.sidebar-area-item').forEach(el => { if (currentState.view === 'area' && el.dataset.area === currentState.selectedArea) { el.classList.add('border-brand-500', 'bg-navy-900', 'text-brand-500'); el.classList.remove('border-transparent', 'text-navy-300'); } else { el.classList.remove('border-brand-500', 'bg-navy-900', 'text-brand-500'); el.classList.add('border-transparent', 'text-navy-300'); } });
    document.getElementById('view-list').classList.toggle('hidden', currentState.view === 'calendar'); 
    if (currentState.view === 'calendar') { document.getElementById('omnibar-container').classList.add('hidden'); document.getElementById('btnAIToggle').classList.remove('text-brand-500', 'bg-navy-700'); document.getElementById('btnAIToggle').classList.add('text-navy-400'); }
    document.getElementById('view-calendar').classList.toggle('hidden', currentState.view !== 'calendar'); 
    document.getElementById('filters-container').classList.toggle('hidden', currentState.view === 'calendar');
    document.getElementById('btnEmptyTrash').classList.toggle('hidden', !isTrash);
    document.getElementById('searchWrap').classList.toggle('hidden', isTrash);
    document.getElementById('filterStatus').classList.toggle('hidden', isTrash);
    document.getElementById('filterPriority').classList.toggle('hidden', isTrash);
    document.getElementById('filterContext').classList.toggle('hidden', isTrash);
    document.getElementById('sortSelect').classList.toggle('hidden', isTrash);
    document.getElementById('btnBulkMode').classList.toggle('hidden', isTrash);
    document.getElementById('btnResetFilters').classList.toggle('hidden', isTrash);
    document.getElementById('btnAIToggle').classList.toggle('hidden', isTrash);
    document.getElementById('filtersDivider').classList.toggle('hidden', isTrash);
    const fab = document.getElementById('mainFab');
    if (isTrash) fab.classList.add('hidden'); else { fab.classList.remove('hidden'); if (isBulkMode) fab.classList.add('translate-y-24', 'opacity-0'); else fab.classList.remove('translate-y-24', 'opacity-0'); }
    if (currentState.view === 'calendar' && isBulkMode) toggleBulkMode();
    if (currentState.view === 'calendar') renderCalendar(); else renderTasks();
}

// TREE AND LIST RENDER LOGIC
function containsFocusNode(node, targetId) { if (node.id === targetId) return true; if (!node.subtasks) return false; return node.subtasks.some(s => containsFocusNode(s, targetId)); }
function sortTasks(taskList) { if (currentSort.by === 'none') return taskList; const priorityWeight = { urgente: 4, alta: 3, media: 2, baja: 1 }; return taskList.sort((a, b) => { let valA, valB; if (currentSort.by === 'priority') { valA = priorityWeight[a.priority] || 0; valB = priorityWeight[b.priority] || 0; } else if (currentSort.by === 'date') { valA = a.date || '9999-12-31'; valB = b.date || '9999-12-31'; } else if (currentSort.by === 'name') { valA = (a.name || '').toLowerCase(); valB = (b.name || '').toLowerCase(); } else if (currentSort.by === 'context') { valA = (a.context || '\uFFFF').toLowerCase(); valB = (b.context || '\uFFFF').toLowerCase(); } let comparison = 0; if (valA < valB) comparison = -1; if (valA > valB) comparison = 1; return currentSort.order === 'desc' ? -comparison : comparison; }); }

function pruneTree(nodeList, inFocusedSubtree = false) {
    if (!Array.isArray(nodeList)) return [];
    const todayStr = formatDateLocal(new Date());
    const tomorrowObj = new Date(); tomorrowObj.setDate(tomorrowObj.getDate() + 1); const tomorrowStr = formatDateLocal(tomorrowObj);
    const daysToSunday = tomorrowObj.getDay() === 0 ? 0 : 7 - tomorrowObj.getDay();
    const endOfWeekObj = new Date(); endOfWeekObj.setDate(endOfWeekObj.getDate() + daysToSunday); const endOfWeekStr = formatDateLocal(endOfWeekObj);
    const fortnightObj = new Date(); fortnightObj.setDate(fortnightObj.getDate() + 15); const fortnightStr = formatDateLocal(fortnightObj);
    
    let filtered = nodeList.map(node => {
        if (node.isDeleted) return null; 
        let matches = true;
        if (currentFilters.search !== '') { const sTerm = currentFilters.search.toLowerCase(); const textMatch = node.name.toLowerCase().includes(sTerm) || (node.area || '').toLowerCase().includes(sTerm) || (node.context || '').toLowerCase().includes(sTerm); if (!textMatch) matches = false; }
        if (currentFilters.status === 'pending' && node.status === 'completed') matches = false; 
        if (currentFilters.status === 'in_progress' && node.status !== 'in_progress') matches = false; 
        if (currentFilters.status === 'completed' && node.status !== 'completed') matches = false; 
        if (currentFilters.priority !== 'all' && node.priority !== currentFilters.priority) matches = false; 
        if (currentFilters.context !== 'all' && node.context !== currentFilters.context) matches = false;
        if (currentState.view === 'today') { if (!node.date || node.date > todayStr) matches = false; }
        else if (currentState.view === 'tomorrow') { if (!node.date || node.date !== tomorrowStr) matches = false; }
        else if (currentState.view === 'week') { if (!node.date || node.date > endOfWeekStr) matches = false; }
        else if (currentState.view === 'fortnight') { if (!node.date || node.date > fortnightStr) matches = false; }
        else if (currentState.view === 'area') { if (node.area !== currentState.selectedArea) matches = false; }
        else if (currentState.view === 'focus') { if (!inFocusedSubtree && !containsFocusNode(node, currentState.focusTargetId)) matches = false; }
        
        const isNowFocused = inFocusedSubtree || (currentState.view === 'focus' && node.id === currentState.focusTargetId);
        const prunedSubtasks = pruneTree(node.subtasks || [], isNowFocused);
        if (matches || prunedSubtasks.length > 0) return { ...node, subtasks: prunedSubtasks, _explicitMatch: matches }; 
        return null;
    }).filter(Boolean);
    return sortTasks(filtered);
}

// FLATTEN MATCHES
function flattenMatches(prunedNodes, path = []) {
    let flat = []; if (!Array.isArray(prunedNodes)) return flat;
    prunedNodes.forEach(node => {
        const currentPath = [...path, { id: node.id, name: node.name }];
        if (node._explicitMatch) flat.push({ ...node, _parentPath: path, subtasks: [] });
        if (node.subtasks && node.subtasks.length > 0) flat = flat.concat(flattenMatches(node.subtasks, currentPath));
    }); return flat;
}

// BUILD TASK ROWS
function buildTaskRows(nodes, path = []) {
    if (!nodes || nodes.length === 0) return '';
    const isTrash = currentState.view === 'trash';
    const indentMap = { 1: 'pl-3 md:pl-5', 2: 'pl-8 md:pl-10', 3: 'pl-12 md:pl-14', 4: 'pl-16 md:pl-18', 5: 'pl-20 md:pl-22' };
    const isFiltering = currentFilters.search !== '' || currentFilters.priority !== 'all' || currentFilters.context !== 'all' || currentFilters.status === 'in_progress' || currentFilters.status === 'completed';
    const todayStr = formatDateLocal(new Date());

    return nodes.map(task => {
        const hasChildren = task.subtasks && task.subtasks.length > 0;
        const isExpanded = isTrash || (currentState.view === 'focus' || isFiltering) ? true : (expandedStates[task.id] || false);
        const logicalDepth = path.length + 1;
        const indentClass = isTrash ? 'pl-3 md:pl-5' : (indentMap[logicalDepth] || 'pl-20 md:pl-22');
        const isCompleted = task.status === 'completed';
        const isOverdue = task.date && task.date < todayStr && !isCompleted;

        // El indicador de "Sin fecha" se muestra en un tono grisáceo neutro (text-navy-400)
        let dateDisplayHTML = `<span class="text-navy-400 text-[11px] font-semibold flex items-center gap-1.5 tracking-wide"><span class="w-2.5 h-[1.5px] bg-navy-400 inline-block"></span> Sin fecha</span>`;
        if (task.date) { const dateColorClass = isOverdue ? 'text-danger-500 font-bold' : 'text-brand-500'; dateDisplayHTML = `<span class="${dateColorClass} text-[11px] font-semibold flex items-center gap-1.5 tracking-wide"><svg class="w-3.5 h-3.5 mb-[1px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>${formatDateAR(task.date, false)} ${isOverdue ? '(Vencida)' : ''}</span>`; }

        const recurrenceBadge = task.recurrenceRule ? `<span class="ml-2 flex items-center gap-1 text-brand-500 bg-brand-500/10 border border-brand-500/30 px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wide font-bold"><svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>Repite</span>` : '';

        let subtasksHtml = (isExpanded && !isTrash) ? buildTaskRows(task.subtasks, [...path, {id: task.id, name: task.name}]) : '';
        const subtaskListHTML = isTrash ? '' : `<div class="subtasks-list" data-parent-id="${task.id}" style="${(hasChildren && !isExpanded) ? 'display: none;' : ''}">${subtasksHtml}</div>`;
        
        const bulkCheckboxHTML = (isBulkMode && !isTrash) ? `<div class="shrink-0 mr-2 flex items-center justify-center cursor-pointer py-1 pr-1" onclick="toggleBulkSelect(${task.id}, event)"><input type="checkbox" class="w-[18px] h-[18px] rounded-sm border border-navy-500 text-brand-500 bg-navy-800 focus:ring-0 cursor-pointer pointer-events-none transition-colors" ${selectedTaskIds.has(task.id) ? 'checked' : ''}></div>` : '';
        const isInProgress = task.status === 'in_progress'; const isMuted = !task._explicitMatch && isFiltering && !isTrash;
        
        let contextHtml = ''; if (task.context && task.context.trim() !== '') { const ctxStyles = getContextStyles(task.context); contextHtml = `<span class="mx-1 shrink-0 text-navy-600">&bull;</span><span class="truncate font-semibold tracking-wide ${ctxStyles.text} max-w-[80px] sm:max-w-[120px]">${task.context}</span>`; }
        let dependencyHtml = ''; if (task._parentPath && task._parentPath.length > 0) { const immediateParent = task._parentPath[task._parentPath.length - 1]; dependencyHtml = `<span class="mx-1 shrink-0 text-navy-600">&bull;</span><span class="text-navy-400 truncate max-w-[150px] sm:max-w-[250px]" title="Subtarea de: ${immediateParent.name}">Subtarea de: <span class="text-brand-400 font-semibold cursor-pointer hover:underline" onclick="event.stopPropagation(); focusTaskTree(${immediateParent.id})">${immediateParent.name}</span></span>`; }

        const nameStyle = isCompleted ? 'line-through text-navy-500' : (isOverdue ? 'text-danger-500 font-semibold' : (isInProgress ? 'text-info-500' : (isMuted ? 'text-navy-400 italic opacity-80' : 'text-navy-50')));

        let actionButtonsHtml = '';
        if (isTrash) { actionButtonsHtml = `<div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity absolute right-full pr-3 bg-gradient-to-l from-navy-800/0 via-navy-800 to-transparent pl-6"><button onclick="event.stopPropagation(); restoreTask(${task.id})" title="Restaurar" class="p-1 text-emerald-500 hover:text-emerald-400 rounded hover:bg-navy-700 transition-all focus:outline-none"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/></svg></button><button onclick="event.stopPropagation(); hardDeleteTask(${task.id})" title="Eliminar definitivamente" class="p-1 text-danger-500 hover:text-danger-400 rounded hover:bg-navy-700 transition-all focus:outline-none"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button></div>`; } 
        else if (!isBulkMode) {
            let statusActionHtml = ''; if (isInProgress) statusActionHtml = `<button onclick="event.stopPropagation(); setTaskStatus(${task.id}, 'pending')" title="Pausar" class="p-1 text-info-500 hover:text-navy-50 rounded hover:bg-navy-700 transition-all focus:outline-none"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg></button>`; else if (!isCompleted) statusActionHtml = `<button onclick="event.stopPropagation(); setTaskStatus(${task.id}, 'in_progress')" title="Marcar en progreso" class="p-1 text-navy-400 hover:text-info-500 rounded hover:bg-navy-700 transition-all focus:outline-none"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg></button>`;
            actionButtonsHtml = `<div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity absolute right-full pr-3 bg-gradient-to-l from-navy-800/0 via-navy-800 to-transparent pl-6">${statusActionHtml}<button onclick="openPostponeModal(${task.id}, event)" title="Posponer" class="p-1 text-navy-400 hover:text-brand-500 rounded hover:bg-navy-700 transition-all focus:outline-none"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg></button><button onclick="event.stopPropagation(); openEditModal(${task.id})" title="Editar" class="p-1 text-navy-400 hover:text-navy-50 rounded hover:bg-navy-700 transition-all focus:outline-none"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg></button><button onclick="event.stopPropagation(); deleteTaskUniversal(${task.id})" title="Eliminar" class="p-1 text-navy-500 hover:text-danger-500 rounded hover:bg-navy-700 transition-all focus:outline-none"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button></div>`;
        }

        return `
            <div class="task-item" data-id="${task.id}">
                <div class="group flex flex-col py-1.5 pr-4 border-b border-navy-700 hover:bg-navy-700/50 transition-colors ${indentClass}">
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-3 flex-1 min-w-0">
                            ${bulkCheckboxHTML}
                            ${(hasChildren && !isTrash) ? `<button onclick="toggleExpand(${task.id}, event)" class="p-0.5 text-navy-400 hover:text-navy-50 transition-transform ${isExpanded ? 'rotate-90' : ''} focus:outline-none shrink-0"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg></button>` : `<div class="w-4 shrink-0"></div>`}
                            <input type="checkbox" ${isCompleted ? 'checked' : ''} ${isTrash ? 'disabled' : `onchange="toggleTaskUniversal(${task.id})"`} class="task-cb shrink-0 ${(isBulkMode || isTrash) ? 'opacity-40 pointer-events-none' : ''} ${isInProgress ? 'is-in-progress' : ''}">
                            <div class="flex flex-col min-w-0 flex-1">
                                <div class="flex items-center gap-2 min-w-0">
                                    <span class="text-[14px] font-medium task-name ${nameStyle} truncate ${isTrash ? 'pointer-events-none' : 'cursor-pointer'} select-none leading-none transition-colors" onclick="${isTrash ? '' : (isBulkMode ? `toggleBulkSelect(${task.id}, event)` : `openEditModal(${task.id})`)}">${task.name}</span>
                                    ${(hasChildren && !isTrash) ? `<span class="bg-navy-700 text-navy-400 px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 shadow-inner">+${task.subtasks.length} sub.</span>` : ''}
                                    ${recurrenceBadge}
                                    ${(task.attachments && task.attachments.length > 0) ? `<svg class="w-3.5 h-3.5 text-blue-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/></svg>` : ''}
                                    ${(isTrash && hasChildren) ? `<span class="text-[9px] bg-navy-700 text-navy-400 px-1.5 py-0.5 rounded ml-2">+${task.subtasks.length} sub.</span>` : ''}
                                </div>
                                <div class="flex items-center text-[11px] mt-1 leading-none min-w-0 select-none">
                                    <div class="flex items-center text-navy-400 ${isTrash ? '' : 'cursor-pointer hover:text-navy-300'} transition-colors shrink-0 min-w-0" onclick="${isTrash ? '' : (isBulkMode ? `toggleBulkSelect(${task.id}, event)` : `openEditModal(${task.id})`)}">
                                        <span class="truncate">${task.area}</span>${contextHtml}${dependencyHtml}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="flex items-center gap-3 shrink-0 relative">
                            ${actionButtonsHtml}
                            <div class="w-28 flex flex-col items-start justify-center gap-1.5 shrink-0 pl-2">
                                <svg title="Prioridad: ${task.priority}" class="w-3.5 h-3.5 ${priorityColors[task.priority]}" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M3 6a3 3 0 013-3h10a1 1 0 01.8 1.6L14.25 8l2.55 3.4A1 1 0 0116 13H6a1 1 0 00-1 1v3a1 1 0 11-2 0V6z" clip-rule="evenodd"/></svg>
                                ${dateDisplayHTML}
                            </div>
                        </div>
                    </div>
                </div>
                ${subtaskListHTML}
            </div>
        `;
    }).join('');
}

function renderTasks() {
    const list = document.getElementById('taskList'); const empty = document.getElementById('emptyState');
    let nodesToRender = [];
    if (currentState.view === 'trash') {
        function collectDeleted(nodes) { nodes.forEach(n => { if (n.isDeleted) nodesToRender.push(n); else if (n.subtasks) collectDeleted(n.subtasks); }); }
        collectDeleted(tasks); nodesToRender.sort((a,b) => (b.deletedAt || 0) - (a.deletedAt || 0));
    } else {
        const pruned = pruneTree(tasks);
        const isFlatView = ['today', 'tomorrow', 'week', 'fortnight'].includes(currentState.view) || (currentFilters.search !== '' || currentFilters.priority !== 'all' || currentFilters.context !== 'all' || currentFilters.status !== 'pending');
        nodesToRender = isFlatView ? flattenMatches(pruned) : pruned;
    }

    if (nodesToRender.length === 0) { list.innerHTML = ''; empty.innerText = currentState.view === 'trash' ? "La papelera está vacía." : "No se encontraron tareas bajo los criterios actuales."; empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');
    list.innerHTML = `<div id="taskList-root" class="flex flex-col min-h-[50px] pb-4">${buildTaskRows(nodesToRender)}</div>`;
}

// VARIOUS OTHER UTILS
function toggleExpand(id, event) { if (event) event.stopPropagation(); expandedStates[id] = !expandedStates[id]; localStorage.setItem('leo_expanded_states', JSON.stringify(expandedStates)); renderTasks(); }

function renderCalendar() { const grid = document.getElementById('calendar-grid'); grid.innerHTML = ''; document.getElementById('calendar-month').innerText = calendarDate.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }); const year = calendarDate.getFullYear(); const month = calendarDate.getMonth(); const firstDay = new Date(year, month, 1).getDay(); const daysInMonth = new Date(year, month + 1, 0).getDate(); for (let i = 0; i < firstDay; i++) grid.innerHTML += '<div></div>'; for (let day = 1; day <= daysInMonth; day++) { const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`; let hasTask = false; function check(ns) { if(!Array.isArray(ns)) return; for(let n of ns) { if(n.isDeleted) continue; if(n.status !== 'completed' && n.date === dateStr) { hasTask = true; return; } if(n.subtasks) check(n.subtasks); } } check(tasks); const isToday = formatDateLocal(new Date()) === dateStr; const dayEl = document.createElement('div'); dayEl.className = `calendar-day ${isToday ? 'today' : ''}`; dayEl.innerHTML = `<span>${day}</span>${hasTask ? '<div class="absolute bottom-2 w-1.5 h-1.5 bg-brand-500 rounded-full"></div>' : ''}`; dayEl.onclick = () => openDayDetail(dateStr); grid.appendChild(dayEl); } }
function changeMonth(delta) { calendarDate.setMonth(calendarDate.getMonth() + delta); renderCalendar(); }
function openDayDetail(dateStr) { const dayTasks = []; function collect(ns, pName) { if (!Array.isArray(ns)) return; ns.forEach(n => { if (n.isDeleted) return; if (n.status !== 'completed' && n.date === dateStr) dayTasks.push({ ...n, type: pName ? `Depende de: ${pName}` : 'Principal' }); if (n.subtasks) collect(n.subtasks, n.name); }); } collect(tasks, null); document.getElementById('modalDateTitle').innerText = new Date(dateStr + "T00:00:00").toLocaleDateString('es-AR', { day: 'numeric', month: 'long' }); const content = document.getElementById('modalContent'); if (dayTasks.length === 0) content.innerHTML = '<p class="text-navy-400 text-sm text-center italic py-10">Libre de tareas.</p>'; else content.innerHTML = dayTasks.map(t => `<div class="p-4 bg-navy-900 border border-navy-700 rounded-md flex items-center justify-between cursor-pointer hover:bg-navy-800 transition-colors" onclick="openEditModal(${t.id}); closeModal();"><div><p class="font-semibold text-sm ${t.status === 'in_progress' ? 'text-info-500' : 'text-navy-50'}">${t.name}</p><p class="text-[9px] text-navy-400 uppercase tracking-wider font-bold">${t.area}${t.context ? ` &bull; ${t.context}` : ''} &bull; <span class="text-brand-500">${t.type}</span></p></div><div class="flex flex-col items-end gap-1"><svg class="w-3.5 h-3.5 ${priorityColors[t.priority]}" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M3 6a3 3 0 013-3h10a1 1 0 01.8 1.6L14.25 8l2.55 3.4A1 1 0 0116 13H6a1 1 0 00-1 1v3a1 1 0 11-2 0V6z" clip-rule="evenodd"/></svg></div></div>`).join(''); document.getElementById('dayDetailModal').classList.remove('hidden'); }
function closeModal() { document.getElementById('dayDetailModal').classList.add('hidden'); }

function openManageModal() { document.getElementById('manageModalTitle').innerText = 'Gestionar Categorías'; renderManageItems(); document.getElementById('manageModal').classList.remove('hidden'); }
function closeManageModal() { document.getElementById('manageModal').classList.add('hidden'); }

// FUNCIONES DE GESTIÓN DE ÁREAS Y CONTEXTOS

// Función para mantener la integridad de los datos al editar categorías
function cascadeUpdateCategory(type, oldVal, newVal) {
    function walk(nodes) {
        if (!nodes) return;
        for (let t of nodes) {
            if (type === 'area' && t.area === oldVal) t.area = newVal;
            if (type === 'context' && t.context === oldVal) t.context = newVal;
            if (t.subtasks) walk(t.subtasks);
        }
    }
    walk(tasks);
}

window.deleteCustomArea = async function(index) {
    if(confirm("¿Seguro que querés eliminar esta área?")) {
        customAreas.splice(index, 1);
        await saveData();
        renderManageItems();
        if(typeof refreshAllDropdowns === 'function') refreshAllDropdowns();
    }
};

window.editCustomArea = async function(index) {
    const oldName = customAreas[index];
    const newName = prompt("Editar nombre del área:", oldName);
    if (newName && newName.trim() !== "" && newName.trim() !== oldName) {
        const finalName = newName.trim();
        customAreas[index] = finalName;
        cascadeUpdateCategory('area', oldName, finalName);
        await saveData();
        renderManageItems();
        if(typeof refreshAllDropdowns === 'function') refreshAllDropdowns();
    }
};

window.addCustomArea = async function() {
    const val = document.getElementById('newAreaInput').value.trim();
    if(val) {
        customAreas.push(val);
        await saveData();
        renderManageItems();
        if(typeof refreshAllDropdowns === 'function') refreshAllDropdowns();
    }
};

window.deleteCustomContext = async function(index) {
    if(confirm("¿Seguro que querés eliminar este contexto?")) {
        customContexts.splice(index, 1);
        await saveData();
        renderManageItems();
        if(typeof refreshAllDropdowns === 'function') refreshAllDropdowns();
    }
};

window.editCustomContext = async function(index) {
    const oldCtx = customContexts[index];
    const newName = prompt("Editar nombre del contexto:", oldCtx.name);
    if (newName && newName.trim() !== "" && newName.trim() !== oldCtx.name) {
        let finalName = newName.trim();
        if (!finalName.startsWith('@')) finalName = '@' + finalName;
        cascadeUpdateCategory('context', oldCtx.name, finalName);
        customContexts[index].name = finalName;
        await saveData();
        renderManageItems();
        if(typeof refreshAllDropdowns === 'function') refreshAllDropdowns();
    }
};

window.addCustomContext = async function() {
    const val = document.getElementById('newContextInput').value.trim();
    if(val) {
        const name = val.startsWith('@') ? val : '@' + val;
        customContexts.push({name: name, color: manageSelectedColor});
        await saveData();
        renderManageItems();
        if(typeof refreshAllDropdowns === 'function') refreshAllDropdowns();
    }
};

window.selectManageColor = function(color) {
    manageSelectedColor = color;
    renderManageItems();
};

function renderManageItems() {
    const container = document.getElementById('manageModalContent');
    
    // Mapeo seguro de colores para evitar fallos del compilador JIT de Tailwind
    const colorHexMap = { 'blue': '#3b82f6', 'purple': '#a855f7', 'green': '#22c55e', 'red': '#ef4444', 'orange': '#f97316', 'gray': '#6b7280', 'pink': '#ec4899', 'teal': '#14b8a6', 'yellow': '#eab308', 'cyan': '#06b6d4', 'indigo': '#6366f1', 'rose': '#f43f5e', 'emerald': '#10b981', 'fuchsia': '#d946ef' };
    
    let colorSwatches = Object.keys(colorHexMap).map(c => `
        <button onclick="selectManageColor('${c}')" 
                class="w-5 h-5 rounded-full outline-none focus:outline-none flex-shrink-0" 
                style="background-color: ${colorHexMap[c]}; ${manageSelectedColor === c ? 'box-shadow: 0 0 0 2px #0f172a, 0 0 0 4px ' + colorHexMap[c] + ';' : ''}"
                title="${c}" type="button"></button>
    `).join('');

    let html = `
    <div class="mb-6">
        <h3 class="font-medium text-base mb-2 text-navy-50">Áreas</h3>
        <div class="flex gap-2 mb-3">
            <input type="text" id="newAreaInput" placeholder="Nueva área..." class="border border-navy-600 bg-navy-900 text-navy-50 rounded p-1.5 flex-1 text-sm placeholder-navy-400">
            <button onclick="addCustomArea()" class="bg-brand-500 text-navy-900 px-3 py-1.5 rounded text-sm font-medium hover:bg-brand-400">Agregar</button>
        </div>
        <ul class="space-y-1.5 max-h-40 overflow-y-auto pr-2">`;
        
    customAreas.forEach((area, i) => {
        html += `
        <li class="flex justify-between items-center p-1.5 bg-navy-800 rounded border border-navy-700">
            <span class="text-navy-50 text-sm">${area}</span>
            <div class="flex gap-2">
                <button onclick="editCustomArea(${i})" class="text-brand-400 text-xs font-medium px-1.5 py-0.5 hover:bg-navy-700 rounded transition-colors">Editar</button>
                <button onclick="deleteCustomArea(${i})" class="text-danger-500 text-xs font-medium px-1.5 py-0.5 hover:bg-navy-700 rounded transition-colors">Borrar</button>
            </div>
        </li>`;
    });

    html += `
        </ul>
    </div>
    <div>
        <h3 class="font-medium text-base mb-2 text-navy-50">Contextos</h3>
        <div class="flex flex-col gap-2 mb-3">
            <div class="flex flex-wrap gap-1.5 p-2 bg-navy-900 border border-navy-600 rounded">
                ${colorSwatches}
            </div>
            <div class="flex gap-2">
                <input type="text" id="newContextInput" placeholder="Ej: @reunión" class="border border-navy-600 bg-navy-900 text-navy-50 rounded p-1.5 flex-1 text-sm placeholder-navy-400">
                <button onclick="addCustomContext()" class="bg-brand-500 text-navy-900 px-3 py-1.5 rounded text-sm font-medium hover:bg-brand-400">Agregar</button>
            </div>
        </div>
        <ul class="space-y-1.5 max-h-40 overflow-y-auto pr-2">`;

    customContexts.forEach((ctx, i) => {
        const hexColor = colorHexMap[ctx.color] || '#3b82f6';
        html += `
        <li class="flex justify-between items-center p-1.5 bg-navy-800 rounded border border-navy-700">
            <span style="color: ${hexColor};" class="font-medium text-sm">${ctx.name}</span>
            <div class="flex gap-2">
                <button onclick="editCustomContext(${i})" class="text-brand-400 text-xs font-medium px-1.5 py-0.5 hover:bg-navy-700 rounded transition-colors">Editar</button>
                <button onclick="deleteCustomContext(${i})" class="text-danger-500 text-xs font-medium px-1.5 py-0.5 hover:bg-navy-700 rounded transition-colors">Borrar</button>
            </div>
        </li>`;
    });

    html += `</ul></div>`;
    
    container.innerHTML = html;
}

async function setTaskStatus(id, newStatus) { findAndMutateTask(id, (nodes, i) => { nodes[i].status = newStatus; }); renderTasks(); renderCalendar(); await saveData(); }
async function restoreTask(id) { if (findAndMutateTask(id, (nodes, i) => { nodes[i].isDeleted = false; delete nodes[i].deletedAt; })) { refreshAllDropdowns(); renderTasks(); renderCalendar(); showNotice("Tarea restaurada"); await saveData(); } }
async function hardDeleteTask(id) { showConfirm("Eliminar", "¿Eliminar definitivamente?", async () => { if (findAndMutateTask(id, (nodes, i) => nodes.splice(i, 1))) { refreshAllDropdowns(); renderTasks(); showNotice("Eliminada"); await saveData(); } }, true); }
async function emptyTrash() { showConfirm("Vaciar Papelera", "¿Vaciar toda la papelera?", async () => { let changed = false; function walk(nodes) { for (let i = nodes.length - 1; i >= 0; i--) { if (nodes[i].isDeleted) { nodes.splice(i, 1); changed = true; } else if (nodes[i].subtasks) walk(nodes[i].subtasks); } } walk(tasks); if (changed) { renderTasks(); showNotice("Papelera vaciada"); await saveData(); } }, true); }

// BULK ACTIONS
// BULK ACTIONS
window.toggleBulkMode = function() { 
    isBulkMode = !isBulkMode; 
    selectedTaskIds.clear(); 
    document.getElementById('btnBulkMode').classList.toggle('text-brand-500', isBulkMode); 
    
    const bar = document.getElementById('bulkActionBar');
    if (bar) {
        bar.classList.toggle('translate-y-32', !isBulkMode); 
        bar.classList.toggle('opacity-0', !isBulkMode); 
        // Elevación forzada para evitar solapamiento de capas invisibles
        bar.style.zIndex = isBulkMode ? "9999" : "-1";
    }
    
    document.getElementById('bulkCount').innerText = '0'; 
    window.updateBulkButtonsState();
    renderTasks(); 
};

window.toggleBulkSelect = function(id, e) { 
    if (e) e.stopPropagation(); 
    if (selectedTaskIds.has(id)) selectedTaskIds.delete(id); 
    else selectedTaskIds.add(id); 
    
    document.getElementById('bulkCount').innerText = selectedTaskIds.size; 
    window.updateBulkButtonsState();
    renderTasks(); 
};

window.updateBulkButtonsState = function() {
    const bar = document.getElementById('bulkActionBar');
    if (!bar) return;
    const hasSelection = selectedTaskIds.size > 0;
    
    const buttons = bar.querySelectorAll('button');
    buttons.forEach(btn => {
        btn.disabled = !hasSelection;
        if (!hasSelection) {
            btn.style.opacity = '0.4';
            btn.style.cursor = 'not-allowed';
            btn.style.pointerEvents = 'none';
        } else {
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
            btn.style.pointerEvents = 'auto';
        }
    });
};
window.bulkDelete = async function() { 
    if (selectedTaskIds.size === 0) return; 
    if (confirm(`¿Seguro que querés enviar ${selectedTaskIds.size} tareas a la papelera?`)) {
        selectedTaskIds.forEach(id => {
            findAndMutateTask(id, (nodes, i) => { 
                nodes[i].isDeleted = true; 
                nodes[i].deletedAt = Date.now(); 
            });
        }); 
        toggleBulkMode(); 
        renderTasks(); 
        showNotice("Tareas eliminadas"); 
        await saveData(); 
    }
};

window.bulkComplete = async function() { 
    if (selectedTaskIds.size === 0) return; 
    selectedTaskIds.forEach(id => toggleTaskUniversal(id)); 
    toggleBulkMode(); 
    renderTasks(); 
    showNotice("Tareas actualizadas"); 
    await saveData(); 
};

window.bulkPostpone = function() {
    if (selectedTaskIds.size === 0) return;
    if (typeof openPostponeModal === 'function') {
        openPostponeModal('bulk');
    } else {
        postponeState = { id: 'bulk' };
        document.getElementById('postponeModal').classList.remove('hidden');
    }
};

function openBulkMoveModal() { 
    if (selectedTaskIds.size === 0) return;
    populateSelect('bulkAreaInput', getAllAreasOrdered());
    const allContexts = [...new Set([...customContexts.map(c => c.name), ...getUniqueValues(tasks, 'context')])].filter(c => c && c.trim() !== '').sort();
    populateSelect('bulkContextInput', allContexts, "Mantener contexto actual", "");
    document.getElementById('bulkMoveModal').classList.remove('hidden'); 
}

function closeBulkMoveModal() { 
    document.getElementById('bulkMoveModal').classList.add('hidden'); 
}

async function applyBulkMove() {
    const newArea = document.getElementById('bulkAreaInput').value;
    const newContext = document.getElementById('bulkContextInput').value;
    selectedTaskIds.forEach(id => {
        findAndMutateTask(id, (nodes, i) => {
            nodes[i].area = newArea;
            if (newContext !== "") nodes[i].context = newContext;
        });
    });
    toggleBulkMode();
    closeBulkMoveModal();
    refreshAllDropdowns();
    renderTasks();
    showNotice("Tareas reubicadas");
    await saveData();
}
// POSTPONE ACTIONS
function openPostponeModal(id, e) { if (e) e.stopPropagation(); postponeState = { id }; document.getElementById('postponeModal').classList.remove('hidden'); }
function closePostponeModal() { document.getElementById('postponeModal').classList.add('hidden'); }
async function postponeAction(type) { let fd = ''; if (type === 'tomorrow') { const tom = new Date(); tom.setDate(tom.getDate() + 1); fd = tom.toISOString().split('T')[0]; } else if (type === 'nextWeek') { const nw = new Date(); nw.setDate(nw.getDate() + 7); fd = nw.toISOString().split('T')[0]; } else if (type === 'custom') { fd = document.getElementById('postponeCustomDate').value; if (!fd) return; } if (postponeState.id === 'bulk') { selectedTaskIds.forEach(taskId => findAndMutateTask(taskId, (nodes, i) => { nodes[i].date = fd; })); toggleBulkMode(); } else { findAndMutateTask(postponeState.id, (nodes, i) => { nodes[i].date = fd; }); } closePostponeModal(); renderTasks(); await saveData(); }

// FILE UPLOAD AND ATTACHMENTS
window.handleFileUpload = async function(event, mode) {
    const file = event.target.files[0];
    if (!file) return;

    showNotice(`Subiendo "${file.name}" a Google Drive...`);

    const reader = new FileReader();
    
    reader.onload = async function(e) {
        const base64Content = e.target.result.split(',')[1];
        
        try {
            // Corrección estructural: se alinea el identificador con el parámetro esperado por el servidor
            const payload = {
                action: 'uploadFile', 
                fileName: file.name,
                mimeType: file.type,
                fileData: base64Content
            };

            const response = await fetch(dbUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(payload),
                redirect: 'follow'
            });

            if (!response.ok) throw new Error('Rechazo del servidor HTTP: ' + response.status);
            
            const serverResponse = await response.text();
            
            if (serverResponse.trim().startsWith('<')) {
                throw new Error('El servidor devolvió un documento HTML. Verificar permisos.');
            }

            let finalUrl = serverResponse.trim();
            
            try {
                const parsed = JSON.parse(finalUrl);
                // El servidor devuelve un objeto con la propiedad 'url', la cual es interceptada aquí
                finalUrl = parsed.url || parsed.link || parsed.fileUrl || parsed.fileId || finalUrl;
            } catch (jsonError) {
                // Silenciamiento del error de parseo si el servidor devuelve texto plano
            }

            if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
                console.error("Respuesta anómala del servidor:", serverResponse);
                throw new Error('El servidor no devolvió una URL válida: ' + finalUrl.substring(0, 30));
            }

            const fileData = {
                name: file.name,
                type: file.type,
                data: finalUrl
            };
            
            currentAttachments.push(fileData);
            showNotice("Archivo alojado y vinculado correctamente.");
            
            if (typeof renderAttachments === 'function') {
                renderAttachments(mode);
            }
            
        } catch (err) {
            console.error("Error en la transmisión a Drive:", err);
            showNotice("Fallo al subir: " + err.message.substring(0, 50));
        }
    };
    
    reader.onerror = function() {
        showNotice("Error local de lectura de disco.");
    };

    reader.readAsDataURL(file);
    event.target.value = '';
};

function renderAttachments(mode) {
    // Determinación del nodo contenedor según el contexto de la interfaz
    const containerId = mode === 'edit' ? 'editAttachmentsList' : 'attachmentsList';
    const container = document.getElementById(containerId);
    
    if (!container) return;

    // Vaciado previo para evitar duplicidad en el renderizado
    container.innerHTML = '';
    
    currentAttachments.forEach((file, index) => {
        const div = document.createElement('div');
        div.className = "flex justify-between items-center bg-navy-800 p-2 rounded text-xs text-navy-50 mb-1 border border-navy-700";
        
        // Estructuración del hipervínculo para permitir la lectura/descarga directa de la carga útil (payload)
        const fileLink = file.data 
            ? `<a href="${file.data}" download="${file.name}" class="text-brand-400 hover:underline cursor-pointer truncate mr-2" title="Descargar o abrir archivo">${file.name}</a>` 
            : `<span class="truncate mr-2">${file.name}</span>`;

        div.innerHTML = `
            ${fileLink}
            <button type="button" onclick="currentAttachments.splice(${index}, 1); renderAttachments('${mode}');" class="text-danger-500 font-bold hover:bg-navy-700 px-2 py-1 rounded transition-colors">X</button>
        `;
        container.appendChild(div);
    });
}

// STUBS / SIMULATION IA
function initSpeechRecognition() {} function toggleVoiceCapture() { showNotice("Voz no disponible."); } function toggleAIFilter() { document.getElementById('omnibar-container').classList.toggle('hidden'); }
function processOmnibarCommand() { showNotice("Comando procesado localmente (Simulación)."); document.getElementById('omnibarInput').value = ''; }
function handleOmnibarKeydown(event) { if (event.key === 'Enter') processOmnibarCommand(); }
function breakdownTaskWithAI() { showNotice("Funcionalidad de IA en desarrollo."); }
