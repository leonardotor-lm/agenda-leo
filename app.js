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

// RECURRENCIA - ESTADOS GLOBALES PARA DIÁLOGOS
let addSelectedDays = [1];
let editSelectedDays = [1];

const priorityColors = { urgente: 'text-danger-500', alta: 'text-brand-500', media: 'text-brand-400', baja: 'text-navy-500' };

const contextColorMap = { 
    blue: { dot: 'bg-blue-500', text: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' }, 
    purple: { dot: 'bg-purple-500', text: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/20' }, 
    green: { dot: 'bg-green-500', text: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/20' }, 
    red: { dot: 'bg-red-500', text: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' },
    yellow: { dot: 'bg-yellow-500', text: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' },
    teal: { dot: 'bg-teal-500', text: 'text-teal-400', bg: 'bg-teal-500/10', border: 'border-teal-500/20' },
    orange: { dot: 'bg-orange-500', text: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20' }
};

// ============================================================================
// FUNCIONES NUCLEARES - SISTEMA DE ALMACENAMIENTO Y SINCRONIZACIÓN
// ============================================================================

async function saveData() {
    localStorage.setItem('leo_agenda_v11', JSON.stringify(tasks));
    localStorage.setItem('leo_custom_areas', JSON.stringify(customAreas));
    localStorage.setItem('leo_custom_contexts', JSON.stringify(customContexts));
    localStorage.setItem('leo_expanded_states', JSON.stringify(expandedStates));
    
    updateCounters();
    
    if (dbUrl) {
        setSyncStatus('syncing');
        try {
            const response = await fetch(dbUrl, {
                method: 'POST',
                body: JSON.stringify(tasks),
                headers: { 'Content-Type': 'text/plain;charset=utf-8' }
            });
            const result = await response.json();
            if (result.status === 'success') {
                setSyncStatus('online');
            } else {
                setSyncStatus('offline');
                console.error("Error remoto:", result.message);
            }
        } catch (error) {
            setSyncStatus('offline');
            console.error("Fallo de red:", error);
        }
    } else {
        setSyncStatus('offline');
    }
}

async function loadDataFromCloud() {
    if (!dbUrl) return;
    setSyncStatus('syncing');
    try {
        const response = await fetch(dbUrl);
        const data = await response.json();
        if (data && Array.isArray(data)) {
            tasks = data;
            migrateAndNormalizeTasks();
            localStorage.setItem('leo_agenda_v11', JSON.stringify(tasks));
            renderTasks();
            setSyncStatus('online');
        }
    } catch (error) {
        setSyncStatus('offline');
        console.error("Error al cargar datos remotos:", error);
    }
}

function setSyncStatus(status) {
    const dot = document.getElementById('sync-status-dot');
    const text = document.getElementById('sync-status-text');
    if (!dot || !text) return;
    
    dot.className = 'w-1.5 h-1.5 rounded-full';
    
    if (status === 'online') {
        dot.classList.add('bg-green-500', 'shadow-[0_0_8px_rgba(34,197,94,0.6)]');
        text.textContent = 'Sincronizado';
        text.className = 'text-[10px] font-bold text-green-400 uppercase tracking-wider';
    } else if (status === 'offline') {
        dot.classList.add('bg-navy-500');
        text.textContent = 'Modo Offline (Local)';
        text.className = 'text-[10px] font-bold text-navy-400 uppercase tracking-wider';
    } else if (status === 'syncing') {
        dot.classList.add('bg-brand-500', 'animate-pulse');
        text.textContent = 'Guardando...';
        text.className = 'text-[10px] font-bold text-brand-400 uppercase tracking-wider animate-pulse';
    }
}

// INICIALIZACIÓN
document.addEventListener('DOMContentLoaded', () => {
    migrateAndNormalizeTasks();
    updateDateDisplay();
    populateSidebar();
    renderTasks();
    if (dbUrl) loadDataFromCloud();
    else setSyncStatus('offline');
});

// ============================================================================
// FUNCIONES NUCLEARES - RECURSIVIDAD Y BÚSQUEDA
// ============================================================================

function findAndMutateTask(taskId, mutationFn, nodeList = tasks) {
    for (let i = 0; i < nodeList.length; i++) {
        if (nodeList[i].id === taskId) {
            mutationFn(nodeList, i);
            return true;
        }
        if (nodeList[i].subtasks && nodeList[i].subtasks.length > 0) {
            if (findAndMutateTask(taskId, mutationFn, nodeList[i].subtasks)) {
                return true;
            }
        }
    }
    return false;
}

function findTaskById(taskId, nodeList = tasks) {
    for (let node of nodeList) {
        if (node.id === taskId) return node;
        if (node.subtasks && node.subtasks.length > 0) {
            const found = findTaskById(taskId, node.subtasks);
            if (found) return found;
        }
    }
    return null;
}

// Migración de esquemas antiguos y limpieza de papelera (> 10 días)
function migrateAndNormalizeTasks() {
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

    function traverseAndClean(nodes) {
        for (let i = nodes.length - 1; i >= 0; i--) {
            let task = nodes[i];
            
            // Normalización de modelo
            if (!task.id) task.id = crypto.randomUUID();
            if (!task.area) task.area = 'Inbox';
            if (!task.priority) task.priority = 'media';
            if (!task.subtasks) task.subtasks = [];
            if (task.reminder === undefined) task.reminder = false;
            // Nueva propiedad estructural
            if (!task.reminderAlerts) task.reminderAlerts = []; 
            if (task.eventCreated === undefined) task.eventCreated = false;
            if (task.completedAt) task.completedAt = new Date(task.completedAt).toISOString();
            if (task.deletedAt) task.deletedAt = new Date(task.deletedAt).toISOString();
            if (task.createdAt === undefined) task.createdAt = new Date().toISOString();

            // Purga de papelera
            if (task.status === 'deleted' && task.deletedAt) {
                if (new Date(task.deletedAt) < tenDaysAgo) {
                    nodes.splice(i, 1);
                    continue; 
                }
            }
            if (task.subtasks.length > 0) {
                traverseAndClean(task.subtasks);
            }
        }
    }
    traverseAndClean(tasks);
}

// ============================================================================
// MOTOR LÓGICO - SISTEMA DE FECHAS Y RECURRENCIAS
// ============================================================================

function calculateNextOccurrence(task) {
    if (!task.date || !task.recurrenceRule) return null;
    
    const rule = task.recurrenceRule;
    
    // Pivote: Fecha original programada o Fecha real de completado
    let baseDate = new Date(task.date + 'T12:00:00'); // Hora media para evitar desvíos UTC
    
    if (rule.baseOnCompletion && task.completedAt) {
        baseDate = new Date(task.completedAt);
        baseDate.setHours(12, 0, 0, 0);
    }
    
    const nextDate = new Date(baseDate);
    const interval = parseInt(rule.interval) || 1;

    switch (rule.frequency) {
        case 'daily':
            nextDate.setDate(nextDate.getDate() + interval);
            break;
            
        case 'weekly':
            // Lógica iterativa para encontrar el siguiente día marcado en el arreglo
            let daysAdded = 0;
            let found = false;
            let currentDayOfWeek = nextDate.getDay();
            
            // Buscar en los próximos 7 días (multiplicado por el intervalo de semanas)
            for (let i = 1; i <= 7; i++) {
                nextDate.setDate(nextDate.getDate() + 1);
                currentDayOfWeek = nextDate.getDay();
                if (rule.daysOfWeek.includes(currentDayOfWeek)) {
                    found = true;
                    // Si el intervalo es > 1, sumamos semanas completas
                    if (interval > 1) {
                        nextDate.setDate(nextDate.getDate() + ((interval - 1) * 7));
                    }
                    break;
                }
            }
            // Fallback si no hay días seleccionados
            if (!found) nextDate.setDate(nextDate.getDate() + (7 * interval));
            break;
            
        case 'monthly':
            if (rule.monthlyMode === 'fixed') {
                const targetDay = rule.dayOfMonth || 1;
                nextDate.setMonth(nextDate.getMonth() + interval);
                
                // Control de fin de mes (ej. Febrero 30 -> Feb 28/29)
                const lastDayOfNextMonth = new Date(nextDate.getFullYear(), nextDate.getMonth() + 1, 0).getDate();
                nextDate.setDate(Math.min(targetDay, lastDayOfNextMonth));
                
            } else if (rule.monthlyMode === 'business') {
                // Cálculo complejo de día hábil
                nextDate.setMonth(nextDate.getMonth() + interval);
                nextDate.setDate(1); // Ir al inicio del mes
                
                let businessDaysCount = 0;
                const targetBusinessDay = rule.nthBusinessDay || 1;
                const tempDate = new Date(nextDate);
                
                // Recorrer el mes contando días hábiles
                while (businessDaysCount < targetBusinessDay) {
                    const day = tempDate.getDay();
                    if (day !== 0 && day !== 6) { // 0: Dom, 6: Sab
                        businessDaysCount++;
                    }
                    if (businessDaysCount < targetBusinessDay) {
                        tempDate.setDate(tempDate.getDate() + 1);
                    }
                    // Si pasamos al siguiente mes, abortamos y nos quedamos con el último hábil
                    if (tempDate.getMonth() !== nextDate.getMonth()) {
                        tempDate.setDate(tempDate.getDate() - 1);
                        while(tempDate.getDay() === 0 || tempDate.getDay() === 6) {
                            tempDate.setDate(tempDate.getDate() - 1);
                        }
                        break;
                    }
                }
                nextDate.setTime(tempDate.getTime());
            }
            break;
            
        case 'yearly':
            nextDate.setFullYear(nextDate.getFullYear() + interval);
            const tDay = rule.dayOfMonth || 1;
            const tMonth = (rule.monthOfYear || 1) - 1; // JS months 0-11
            nextDate.setMonth(tMonth);
            
            const lastDay = new Date(nextDate.getFullYear(), nextDate.getMonth() + 1, 0).getDate();
            nextDate.setDate(Math.min(tDay, lastDay));
            break;
            
        case 'after_completion':
            nextDate.setDate(nextDate.getDate() + interval);
            break;
            
        case 'custom':
            nextDate.setMonth(nextDate.getMonth() + interval);
            nextDate.setDate(rule.dayOfMonth || 1);
            break;
    }

    return nextDate.toISOString().split('T')[0];
}

// ============================================================================
// NAVEGACIÓN Y VISTAS (SPA)
// ============================================================================

function navigate(viewId, areaName = null, bypassHistory = false) {
    if (!bypassHistory) {
        navHistory.push(JSON.parse(JSON.stringify(currentState)));
        document.getElementById('btnBack').classList.remove('hidden');
    }
    
    currentState.view = viewId;
    currentState.selectedArea = areaName;
    currentState.focusTargetId = null;
    
    // Resetear filtros
    currentFilters.search = '';
    currentFilters.status = viewId === 'trash' ? 'all' : 'pending';
    document.getElementById('searchInput').value = '';
    document.getElementById('filterStatus').value = currentFilters.status;
    
    updateHeaderTitle();
    toggleCalendarView(viewId === 'calendar');
    
    if (viewId === 'calendar') renderCalendar();
    else renderTasks();
    
    if (window.innerWidth < 768) toggleSidebar(false);
}

function goBack() {
    if (navHistory.length > 0) {
        currentState = navHistory.pop();
        if (navHistory.length === 0) document.getElementById('btnBack').classList.add('hidden');
        
        currentFilters.status = currentState.view === 'trash' ? 'all' : 'pending';
        document.getElementById('filterStatus').value = currentFilters.status;
        
        updateHeaderTitle();
        toggleCalendarView(currentState.view === 'calendar');
        if (currentState.view === 'calendar') renderCalendar();
        else renderTasks();
    }
}

function updateHeaderTitle() {
    const titleEl = document.getElementById('view-title');
    document.getElementById('btnEmptyTrash').classList.add('hidden');
    
    if (currentState.view === 'today') titleEl.textContent = 'Hoy y Atrasadas';
    else if (currentState.view === 'tomorrow') titleEl.textContent = 'Mañana';
    else if (currentState.view === 'week') titleEl.textContent = 'Esta Semana';
    else if (currentState.view === 'fortnight') titleEl.textContent = 'Próximos 15 Días';
    else if (currentState.view === 'all') titleEl.textContent = 'Todas las Tareas';
    else if (currentState.view === 'calendar') titleEl.textContent = 'Calendario Mensual';
    else if (currentState.view === 'area') titleEl.textContent = `Área: ${currentState.selectedArea}`;
    else if (currentState.view === 'trash') {
        titleEl.textContent = 'Papelera de Reciclaje';
        document.getElementById('btnEmptyTrash').classList.remove('hidden');
    }
}

function updateDateDisplay() {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('current-date-display').textContent = new Date().toLocaleDateString('es-ES', options);
}

function toggleSidebar(show) {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('mobile-overlay');
    if (show) {
        sidebar.classList.remove('-translate-x-full');
        overlay.classList.remove('hidden');
    } else {
        sidebar.classList.add('-translate-x-full');
        overlay.classList.add('hidden');
    }
}

function toggleCalendarView(show) {
    if (show) {
        document.getElementById('view-list').classList.add('hidden');
        document.getElementById('filters-container').classList.add('hidden');
        document.getElementById('view-calendar').classList.remove('hidden');
    } else {
        document.getElementById('view-list').classList.remove('hidden');
        document.getElementById('filters-container').classList.remove('hidden');
        document.getElementById('view-calendar').classList.add('hidden');
    }
}

// ============================================================================
// ALGORITMOS DE FILTRADO Y PODA (PRUNING) - ZONA CRÍTICA
// ============================================================================

function isTaskInCurrentView(task) {
    if (task.status === 'deleted') return currentState.view === 'trash';
    if (currentState.view === 'trash') return false;

    if (currentState.view === 'area') {
        return task.area === currentState.selectedArea;
    }

    if (currentState.view === 'all' || currentState.view === 'calendar') return true;

    // Filtros temporales
    const today = new Date();
    today.setHours(0,0,0,0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    const weekEnd = new Date(today); weekEnd.setDate(weekEnd.getDate() + 7);
    const fortnightEnd = new Date(today); fortnightEnd.setDate(fortnightEnd.getDate() + 15);

    let taskDate = task.date ? new Date(task.date + 'T12:00:00') : null;
    if (taskDate) taskDate.setHours(0,0,0,0);

    if (currentState.view === 'today') {
        return taskDate && taskDate <= today;
    } else if (currentState.view === 'tomorrow') {
        return taskDate && taskDate.getTime() === tomorrow.getTime();
    } else if (currentState.view === 'week') {
        return taskDate && taskDate >= today && taskDate <= weekEnd;
    } else if (currentState.view === 'fortnight') {
        return taskDate && taskDate >= today && taskDate <= fortnightEnd;
    }
    return true;
}

function evaluateFilters(task) {
    if (currentFilters.status !== 'all' && currentState.view !== 'trash') {
        if (task.status !== currentFilters.status) return false;
    }
    if (currentFilters.priority !== 'all') {
        if (task.priority !== currentFilters.priority) return false;
    }
    if (currentFilters.context !== 'all') {
        if (task.context !== currentFilters.context) return false;
    }
    if (currentFilters.search.trim() !== '') {
        const query = currentFilters.search.toLowerCase();
        const tName = task.name ? task.name.toLowerCase() : '';
        const tNotes = task.notes ? task.notes.toLowerCase() : '';
        if (!tName.includes(query) && !tNotes.includes(query)) return false;
    }
    return true;
}

function pruneTree(nodeList, inFocusedSubtree = false) {
    let prunedNodes = [];
    for (let node of nodeList) {
        let newNode = { ...node, subtasks: [] };
        
        let viewMatch = isTaskInCurrentView(node);
        let filterMatch = evaluateFilters(node);
        let nodeIsMatch = viewMatch && filterMatch;

        // Si tenemos un foco específico, forzamos el match para la raíz y procesamos todos los hijos
        let isFocusedRoot = currentState.focusTargetId && node.id === currentState.focusTargetId;
        
        if (node.subtasks && node.subtasks.length > 0) {
            newNode.subtasks = pruneTree(node.subtasks, inFocusedSubtree || isFocusedRoot);
        }

        // Retenemos el nodo si: hace match, o tiene hijos que hacen match, o estamos dentro de un subárbol enfocado
        if (nodeIsMatch || newNode.subtasks.length > 0 || inFocusedSubtree || isFocusedRoot) {
            prunedNodes.push(newNode);
        }
    }
    return prunedNodes;
}

function sortNodes(nodes) {
    nodes.sort((a, b) => {
        if (currentSort.by === 'date') {
            const dA = a.date ? new Date(a.date).getTime() : Infinity;
            const dB = b.date ? new Date(b.date).getTime() : Infinity;
            return currentSort.order === 'asc' ? dA - dB : dB - dA;
        } else if (currentSort.by === 'priority') {
            const pMap = { 'urgente': 4, 'alta': 3, 'media': 2, 'baja': 1 };
            const pA = pMap[a.priority] || 0;
            const pB = pMap[b.priority] || 0;
            return pB - pA; // Siempre descendente para prioridad
        } else if (currentSort.by === 'name') {
            return a.name.localeCompare(b.name);
        }
        return 0;
    });

    nodes.forEach(n => {
        if (n.subtasks && n.subtasks.length > 0) sortNodes(n.subtasks);
    });
    return nodes;
}

// ============================================================================
// RENDERIZADO DEL DOM
// ============================================================================

function renderTasks() {
    const listEl = document.getElementById('taskList');
    const emptyEl = document.getElementById('emptyState');
    listEl.innerHTML = '';

    // Poda y filtrado
    let displayTree = pruneTree(tasks);

    // Enfoque (Drill-down)
    if (currentState.focusTargetId) {
        let focusedNode = null;
        function findFocus(nodes) {
            for (let n of nodes) {
                if (n.id === currentState.focusTargetId) { focusedNode = n; return; }
                if (n.subtasks.length > 0) findFocus(n.subtasks);
            }
        }
        findFocus(displayTree);
        if (focusedNode) displayTree = [focusedNode];
    }

    // Ordenamiento
    displayTree = sortNodes(displayTree);

    if (displayTree.length === 0) {
        emptyEl.textContent = currentState.view === 'trash' ? "La papelera está vacía." : "No se encontraron tareas con los filtros actuales.";
        emptyEl.classList.remove('hidden');
    } else {
        emptyEl.classList.add('hidden');
        renderNodeList(displayTree, listEl, 0);
    }
}

function renderNodeList(nodes, container, depth) {
    nodes.forEach(task => {
        const isTrash = task.status === 'deleted';
        const isRootFocus = currentState.focusTargetId === task.id;
        
        const taskEl = document.createElement('div');
        taskEl.className = `group flex flex-col p-3 border-b border-navy-700/50 hover:bg-navy-800 transition-colors ${isRootFocus ? 'bg-navy-800 ring-1 ring-brand-500/30' : ''}`;
        
        const paddingLeft = depth > 0 ? `${depth * 1.5}rem` : '0';
        
        let ctxBadge = '';
        if (task.context) {
            const ctxObj = customContexts.find(c => c.name === task.context) || { name: task.context, color: 'blue' };
            const cm = contextColorMap[ctxObj.color] || contextColorMap.blue;
            ctxBadge = `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold ${cm.bg} ${cm.text} border ${cm.border} uppercase tracking-wider">${task.context}</span>`;
        }

        let recurrenceBadge = '';
        if (task.recurrenceRule) {
            recurrenceBadge = `<svg class="w-3.5 h-3.5 text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>`;
        }

        let reminderBadge = '';
        if (task.reminder) {
            reminderBadge = `<svg class="w-3.5 h-3.5 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" title="Notificación Calendar (Etapa 1)"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>`;
        }

        let isExpanded = expandedStates[task.id];
        let hasChildren = task.subtasks && task.subtasks.length > 0;
        let expandChevron = '';
        if (hasChildren && !isRootFocus) {
            expandChevron = `
                <button onclick="toggleExpand('${task.id}')" class="p-1 text-navy-400 hover:text-navy-50 focus:outline-none transition-transform ${isExpanded ? 'rotate-90' : ''}">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
                </button>
            `;
        } else if (!isRootFocus) {
            expandChevron = `<div class="w-6"></div>`; // Placeholder
        }

        let dateStr = '';
        let isOverdue = false;
        if (task.date) {
            const parts = task.date.split('-');
            dateStr = `${parts[2]}/${parts[1]}/${parts[0]}`;
            if (task.time) dateStr += ` ${task.time}`;
            
            const today = new Date(); today.setHours(0,0,0,0);
            const tDate = new Date(task.date + 'T12:00:00'); tDate.setHours(0,0,0,0);
            if (tDate < today && task.status !== 'completed' && task.status !== 'deleted') {
                isOverdue = true;
            }
        }

        const pColor = priorityColors[task.priority] || 'text-navy-500';
        const checkboxState = task.status === 'completed' ? 'checked' : '';
        const checkboxClass = task.status === 'in_progress' ? 'is-in-progress' : '';
        const textClass = task.status === 'completed' ? 'line-through text-navy-500' : 'text-navy-50';

        let primaryActionArea = '';
        if (isTrash) {
            primaryActionArea = `<button onclick="restoreTask('${task.id}')" class="p-1.5 bg-navy-700 hover:bg-navy-600 rounded text-navy-300 hover:text-green-400 transition-colors" title="Restaurar"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/></svg></button>`;
        } else if (isBulkMode) {
            const isSel = selectedTaskIds.has(task.id) ? 'checked' : '';
            primaryActionArea = `<input type="checkbox" onchange="toggleSelection('${task.id}')" class="task-cb" ${isSel}>`;
        } else {
            primaryActionArea = `<input type="checkbox" onclick="toggleTaskUniversal('${task.id}')" class="task-cb ${checkboxClass}" ${checkboxState} title="Click para alternar estado">`;
        }

        let titleContent = `
            <span class="text-sm font-semibold tracking-wide ${textClass} break-words cursor-pointer" onclick="${isTrash ? '' : `openEditModal('${task.id}')`}">
                ${task.name}
            </span>
        `;
        if (task.subtasks.length > 0 && !isRootFocus) {
             titleContent += `<button onclick="focusTask('${task.id}')" class="ml-2 px-1.5 py-0.5 bg-navy-700 hover:bg-navy-600 rounded text-[9px] text-brand-400 font-bold uppercase tracking-wider transition-colors" title="Enfocar subárbol">Enfocar</button>`;
        }

        taskEl.innerHTML = `
            <div class="flex items-start gap-3" style="padding-left: ${paddingLeft};">
                <div class="flex items-center gap-1 mt-0.5">
                    ${expandChevron}
                    ${primaryActionArea}
                </div>
                
                <div class="flex-1 min-w-0">
                    <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                        ${titleContent}
                        ${ctxBadge}
                        ${recurrenceBadge}
                        ${reminderBadge}
                    </div>
                    
                    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[10px] font-semibold uppercase tracking-wider">
                        <span class="${pColor}">${task.priority}</span>
                        ${task.area ? `<span class="text-navy-400 flex items-center gap-1"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>${task.area}</span>` : ''}
                        ${dateStr ? `<span class="${isOverdue ? 'text-danger-500 font-bold' : 'text-navy-400'}">${dateStr}</span>` : ''}
                        ${task.status === 'in_progress' ? `<span class="text-info-500 animate-pulse">En curso</span>` : ''}
                    </div>
                    
                    ${task.notes ? `<p class="mt-1.5 text-xs text-navy-400 line-clamp-2">${task.notes}</p>` : ''}
                </div>

                <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    ${!isTrash && !isBulkMode ? `
                        <button onclick="openPostponeModal('${task.id}')" class="p-1.5 text-navy-400 hover:text-brand-500 rounded transition-colors" title="Posponer">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                        </button>
                        <button onclick="openEditModal('${task.id}')" class="p-1.5 text-navy-400 hover:text-brand-500 rounded transition-colors" title="Editar">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
                        </button>
                    ` : ''}
                    <button onclick="${isTrash ? `permanentlyDelete('${task.id}')` : `deleteTaskUniversal('${task.id}')`}" class="p-1.5 text-navy-400 hover:text-danger-500 rounded transition-colors" title="Eliminar">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                    </button>
                </div>
            </div>
        `;
        
        container.appendChild(taskEl);

        // Render recursivo si está expandido
        if (hasChildren && (isExpanded || isRootFocus)) {
            const subContainer = document.createElement('div');
            subContainer.className = 'flex flex-col';
            renderNodeList(task.subtasks, subContainer, depth + 1);
            container.appendChild(subContainer);
        }
    });
}

function updateCounters() {
    let counts = { today: 0, tomorrow: 0, week: 0, fortnight: 0, all: 0, trash: 0 };
    const areasCount = {};
    customAreas.forEach(a => areasCount[a] = 0);

    const today = new Date(); today.setHours(0,0,0,0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    const weekEnd = new Date(today); weekEnd.setDate(weekEnd.getDate() + 7);
    const fortnightEnd = new Date(today); fortnightEnd.setDate(fortnightEnd.getDate() + 15);

    function traverse(nodes) {
        nodes.forEach(task => {
            if (task.status === 'deleted') { counts.trash++; } 
            else if (task.status !== 'completed') {
                counts.all++;
                if (task.area && areasCount[task.area] !== undefined) areasCount[task.area]++;
                
                if (task.date) {
                    const tDate = new Date(task.date + 'T12:00:00'); tDate.setHours(0,0,0,0);
                    if (tDate <= today) counts.today++;
                    else if (tDate.getTime() === tomorrow.getTime()) counts.tomorrow++;
                    
                    if (tDate >= today && tDate <= weekEnd) counts.week++;
                    if (tDate >= today && tDate <= fortnightEnd) counts.fortnight++;
                }
            }
            if (task.subtasks.length > 0) traverse(task.subtasks);
        });
    }
    traverse(tasks);

    // Actualizar badges en la barra lateral
    const addBadge = (btnId, count) => {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        const existing = btn.querySelector('.nav-badge');
        if (existing) existing.remove();
        if (count > 0) {
            const badge = document.createElement('span');
            badge.className = 'nav-badge ml-auto bg-navy-900 text-brand-500 py-0.5 px-2 rounded-full text-[9px] font-black';
            badge.textContent = count;
            btn.appendChild(badge);
        }
    };

    addBadge('nav-today', counts.today);
    addBadge('nav-tomorrow', counts.tomorrow);
    addBadge('nav-week', counts.week);
    addBadge('nav-fortnight', counts.fortnight);
    addBadge('nav-all', counts.all);
    addBadge('nav-trash', counts.trash);

    // Reconstruir áreas en la sidebar
    const areaListContainer = document.getElementById('sidebar-areas-list');
    areaListContainer.innerHTML = '';
    customAreas.forEach(area => {
        const c = areasCount[area] || 0;
        const isActive = currentState.view === 'area' && currentState.selectedArea === area;
        
        const btn = document.createElement('button');
        btn.onclick = () => navigate('area', area);
        btn.className = `w-full flex items-center justify-between px-3 py-1.5 rounded-md text-sm font-medium transition-all focus:outline-none ${isActive ? 'bg-navy-700 text-brand-400 border-r-2 border-brand-500' : 'text-navy-300 hover:bg-navy-700 hover:text-navy-50 border-r-2 border-transparent'}`;
        
        btn.innerHTML = `
            <div class="flex items-center gap-2">
                <svg class="w-3.5 h-3.5 text-navy-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>
                <span class="truncate">${area}</span>
            </div>
            ${c > 0 ? `<span class="bg-navy-900 text-navy-400 py-0.5 px-2 rounded-full text-[9px] font-bold">${c}</span>` : ''}
        `;
        areaListContainer.appendChild(btn);
    });
}

function updateFilters() {
    currentFilters.search = document.getElementById('searchInput').value;
    currentFilters.status = document.getElementById('filterStatus').value;
    currentFilters.priority = document.getElementById('filterPriority').value;
    currentFilters.context = document.getElementById('filterContext').value;
    renderTasks();
}

function updateSort() {
    const val = document.getElementById('sortSelect').value;
    const [by, order] = val.split('-');
    currentSort = { by, order };
    renderTasks();
}

function resetFilters() {
    currentFilters = { search: '', status: 'pending', priority: 'all', context: 'all' };
    document.getElementById('searchInput').value = '';
    document.getElementById('filterStatus').value = 'pending';
    document.getElementById('filterPriority').value = 'all';
    document.getElementById('filterContext').value = 'all';
    renderTasks();
}

function toggleExpand(taskId) {
    expandedStates[taskId] = !expandedStates[taskId];
    renderTasks();
    saveData();
}

function focusTask(taskId) {
    if (!bypassHistory) navHistory.push(JSON.parse(JSON.stringify(currentState)));
    currentState.focusTargetId = taskId;
    document.getElementById('btnBack').classList.remove('hidden');
    renderTasks();
}

// ============================================================================
// MUTACIONES DE ESTADO (CREAR, EDITAR, COMPLETAR, BORRAR)
// ============================================================================

function extractFormRecurrence(mode) {
    const hasRec = document.getElementById(`${mode}HasRecurrence`).checked;
    if (!hasRec) return null;

    const freq = document.getElementById(`${mode}Frequency`).value;
    const interval = parseInt(document.getElementById(`${mode}Interval`).value) || 1;
    const baseOnComp = document.getElementById(`${mode}BaseOnCompletion`).checked;

    let rule = { frequency: freq, interval: interval, baseOnCompletion: baseOnComp };

    if (freq === 'weekly') {
        rule.daysOfWeek = mode === 'add' ? [...addSelectedDays] : [...editSelectedDays];
        if (rule.daysOfWeek.length === 0) return null;
    } else if (freq === 'monthly') {
        rule.monthlyMode = document.querySelector(`input[name="${mode}MonthlyMode"]:checked`).value;
        if (rule.monthlyMode === 'fixed') {
            rule.dayOfMonth = parseInt(document.getElementById(`${mode}DayOfMonth`).value) || 1;
        } else {
            rule.nthBusinessDay = parseInt(document.getElementById(`${mode}NthBusinessDay`).value) || 1;
        }
    } else if (freq === 'yearly') {
        rule.dayOfMonth = parseInt(document.getElementById(`${mode}YearDay`).value) || 1;
        rule.monthOfYear = parseInt(document.getElementById(`${mode}YearMonth`).value) || 1;
    } else if (freq === 'custom') {
        rule.dayOfMonth = parseInt(document.getElementById(`${mode}CustomDay`).value) || 1;
    }

    return rule;
}

// SISTEMA AMPLIADO DE RECORDATORIOS (Lectura de DOM)
function getSelectedReminderAlerts(mode) {
    const alerts = [];
    const container = document.getElementById(`${mode}ReminderAlerts`);
    if (container) {
        const checkboxes = container.querySelectorAll('input[type="checkbox"]:checked');
        checkboxes.forEach(cb => alerts.push(cb.value));
    }
    return alerts;
}

// SISTEMA AMPLIADO DE RECORDATORIOS (Seteo de DOM)
function setReminderAlertsUI(mode, alertsArray) {
    const container = document.getElementById(`${mode}ReminderAlerts`);
    if (container) {
        const checkboxes = container.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(cb => {
            cb.checked = alertsArray && alertsArray.includes(cb.value);
        });
    }
}

async function addTask() {
    const name = document.getElementById('taskInput').value.trim();
    if (!name) return showNotice('El nombre de la tarea es obligatorio', 'error');

    const area = document.getElementById('areaInput').value;
    const context = document.getElementById('contextInput').value;
    const priority = document.getElementById('priorityInput').value;
    const date = document.getElementById('dateInput').value;
    const time = document.getElementById('timeInput').value;
    const notes = document.getElementById('notesInput').value.trim();
    const parentId = document.getElementById('parentInput').value;
    
    // Captura de múltiples opciones de recordatorio
    const reminderAlerts = getSelectedReminderAlerts('add');
    const reminder = reminderAlerts.length > 0; // Trigger para GAS

    const recurrenceRule = extractFormRecurrence('add');

    const newTask = {
        id: crypto.randomUUID(),
        name,
        area,
        context: context === 'none' ? null : context,
        priority,
        date: date || null,
        time: time || null,
        notes,
        status: 'pending',
        subtasks: [],
        createdAt: new Date().toISOString(),
        reminder: reminder,
        reminderAlerts: reminderAlerts,
        eventCreated: false, // Flag inicial para evitar duplicados en Calendar
        recurrenceRule: recurrenceRule,
        attachments: [...currentAttachments]
    };

    if (parentId === 'root') {
        tasks.push(newTask);
    } else {
        const added = findAndMutateTask(parentId, (nodes, i) => {
            nodes[i].subtasks.push(newTask);
            expandedStates[nodes[i].id] = true;
        });
        if (!added) tasks.push(newTask); // Fallback
    }

    closeAddTaskModal();
    renderTasks();
    await saveData();
    showNotice('Tarea registrada con éxito');
}

let editingTaskId = null;

function openEditModal(taskId) {
    const task = findTaskById(taskId);
    if (!task) return;
    
    editingTaskId = taskId;
    document.getElementById('editNameInput').value = task.name;
    document.getElementById('editStatusInput').value = task.status === 'deleted' ? 'pending' : task.status;
    document.getElementById('editPriorityInput').value = task.priority;
    document.getElementById('editDateInput').value = task.date || '';
    document.getElementById('editTimeInput').value = task.time || '';
    document.getElementById('editNotesInput').value = task.notes || '';
    
    populateDropdowns('edit');
    document.getElementById('editAreaInput').value = task.area;
    document.getElementById('editContextInput').value = task.context || 'none';

    updateEditParentDropdown(taskId);
    
    let parentFound = false;
    function findParent(nodes, parentId) {
        for (let n of nodes) {
            if (n.subtasks.some(sub => sub.id === taskId)) {
                document.getElementById('editParentInput').value = n.id;
                parentFound = true;
                return;
            }
            if (n.subtasks.length > 0) findParent(n.subtasks, n.id);
        }
    }
    findParent(tasks, 'root');
    if (!parentFound) document.getElementById('editParentInput').value = 'root';

    // Rellenar opciones de recordatorio
    setReminderAlertsUI('edit', task.reminderAlerts || []);

    currentAttachments = task.attachments ? [...task.attachments] : [];
    renderAttachments('edit');

    // Recurrencia
    if (task.recurrenceRule) {
        document.getElementById('editHasRecurrence').checked = true;
        document.getElementById('editFrequency').value = task.recurrenceRule.frequency;
        document.getElementById('editInterval').value = task.recurrenceRule.interval || 1;
        document.getElementById('editBaseOnCompletion').checked = !!task.recurrenceRule.baseOnCompletion;
        
        const freq = task.recurrenceRule.frequency;
        if (freq === 'weekly') {
            editSelectedDays = task.recurrenceRule.daysOfWeek || [1];
        } else if (freq === 'monthly') {
            document.querySelector(`input[name="editMonthlyMode"][value="${task.recurrenceRule.monthlyMode}"]`).checked = true;
            document.getElementById('editDayOfMonth').value = task.recurrenceRule.dayOfMonth || 1;
            document.getElementById('editNthBusinessDay').value = task.recurrenceRule.nthBusinessDay || 1;
        } else if (freq === 'yearly') {
            document.getElementById('editYearDay').value = task.recurrenceRule.dayOfMonth || 1;
            document.getElementById('editYearMonth').value = task.recurrenceRule.monthOfYear || 1;
        } else if (freq === 'custom') {
            document.getElementById('editCustomDay').value = task.recurrenceRule.dayOfMonth || 1;
        }
    } else {
        document.getElementById('editHasRecurrence').checked = false;
        editSelectedDays = [1];
    }
    
    toggleRecurrenceUI('edit');
    
    document.getElementById('editModal').classList.remove('hidden');
}

async function saveEdit() {
    if (!editingTaskId) return;

    const newName = document.getElementById('editNameInput').value.trim();
    if (!newName) return showNotice('El nombre no puede estar vacío', 'error');
    
    const newArea = document.getElementById('editAreaInput').value;
    const newContext = document.getElementById('editContextInput').value;
    const newParentId = document.getElementById('editParentInput').value;
    
    const reminderAlerts = getSelectedReminderAlerts('edit');
    const newReminder = reminderAlerts.length > 0;

    let taskData = null;
    let oldParentId = 'root';

    // 1. Extraer la tarea de su ubicación actual
    function extractTask(nodes) {
        for (let i = 0; i < nodes.length; i++) {
            if (nodes[i].id === editingTaskId) {
                taskData = nodes.splice(i, 1)[0];
                return true;
            }
            if (nodes[i].subtasks.length > 0) {
                if (extractTask(nodes[i].subtasks)) {
                    oldParentId = nodes[i].id;
                    return true;
                }
            }
        }
        return false;
    }
    extractTask(tasks);

    if (taskData) {
        // 2. Actualizar datos
        taskData.name = newName;
        taskData.area = newArea;
        taskData.context = newContext === 'none' ? null : newContext;
        taskData.priority = document.getElementById('editPriorityInput').value;
        
        const oldDate = taskData.date;
        const newDate = document.getElementById('editDateInput').value;
        const newTime = document.getElementById('editTimeInput').value;
        
        taskData.date = newDate || null;
        taskData.time = newTime || null;
        
        // Si cambia la fecha y tenía un evento de calendar, lo desvinculamos para que GAS cree uno nuevo
        if (oldDate !== newDate) taskData.eventCreated = false;
        
        taskData.notes = document.getElementById('editNotesInput').value.trim();
        taskData.reminder = newReminder;
        taskData.reminderAlerts = reminderAlerts;
        taskData.recurrenceRule = extractFormRecurrence('edit');
        taskData.attachments = [...currentAttachments];

        const newStatus = document.getElementById('editStatusInput').value;
        
        // Si se completa en la edición y tiene recurrencia
        if (newStatus === 'completed' && taskData.status !== 'completed' && taskData.recurrenceRule) {
            handleRecurrenceOnComplete(taskData); // Genera la copia histórica y proyecta
        } else {
             taskData.status = newStatus;
             if (newStatus === 'completed') taskData.completedAt = new Date().toISOString();
        }

        // 3. Reinsertar en la nueva jerarquía
        if (newParentId === 'root') {
            tasks.push(taskData);
        } else {
            const added = findAndMutateTask(newParentId, (nodes, i) => {
                nodes[i].subtasks.push(taskData);
                expandedStates[nodes[i].id] = true;
            });
            if (!added) tasks.push(taskData); // Fallback
        }
    }

    closeEditModal();
    renderTasks();
    await saveData();
    showNotice('Cambios guardados con éxito');
}

// LOGICA DE COMPLETADO CON RECURRENCIA (El corazón del sistema)
function handleRecurrenceOnComplete(taskData) {
    taskData.completedAt = new Date().toISOString();
    const nextDate = calculateNextOccurrence(taskData);
    
    // 1. Crear clon histórico
    const historyClone = JSON.parse(JSON.stringify(taskData));
    historyClone.id = crypto.randomUUID();
    historyClone.status = 'completed';
    historyClone.eventCreated = true; // Evitar que el clon dispare calendar
    delete historyClone.recurrenceRule; // El clon es estático
    
    // 2. Encontrar dónde está la original para insertar el clon justo antes
    function insertClone(nodes) {
        for (let i = 0; i < nodes.length; i++) {
            if (nodes[i].id === taskData.id) {
                nodes.splice(i, 0, historyClone);
                return true;
            }
            if (nodes[i].subtasks && nodes[i].subtasks.length > 0) {
                if (insertClone(nodes[i].subtasks)) return true;
            }
        }
        return false;
    }
    insertClone(tasks);
    
    // 3. Proyectar la tarea original hacia el futuro
    taskData.status = 'pending';
    taskData.date = nextDate;
    taskData.eventCreated = false; // Permitir nuevo evento de calendar
    
    // 4. Resetear recursivamente las subtareas
    function resetSubtasks(nodes) {
        nodes.forEach(n => {
            n.status = 'pending';
            n.eventCreated = false;
            if (n.subtasks.length > 0) resetSubtasks(n.subtasks);
        });
    }
    if (taskData.subtasks && taskData.subtasks.length > 0) {
        resetSubtasks(taskData.subtasks);
    }
}

async function toggleTaskUniversal(taskId) {
    let changed = false;
    findAndMutateTask(taskId, (nodes, i) => {
        let t = nodes[i];
        if (t.status === 'pending') t.status = 'in_progress';
        else if (t.status === 'in_progress') {
            if (t.recurrenceRule) {
                handleRecurrenceOnComplete(t);
            } else {
                t.status = 'completed';
                t.completedAt = new Date().toISOString();
            }
        }
        else t.status = 'pending';
        changed = true;
    });
    if (changed) {
        renderTasks();
        await saveData();
    }
}

async function deleteTaskUniversal(taskId) {
    confirmAction('Mover a la papelera', '¿Seguro que querés eliminar esta tarea?', async () => {
        findAndMutateTask(taskId, (nodes, i) => {
            nodes[i].status = 'deleted';
            nodes[i].deletedAt = new Date().toISOString();
        });
        renderTasks();
        await saveData();
        showNotice('Movido a la papelera');
    });
}

async function permanentlyDelete(taskId) {
    confirmAction('Borrado Definitivo', 'Esta acción es irreversible.', async () => {
        findAndMutateTask(taskId, (nodes, i) => { nodes.splice(i, 1); });
        renderTasks();
        await saveData();
        showNotice('Eliminado permanentemente');
    });
}

async function restoreTask(taskId) {
    findAndMutateTask(taskId, (nodes, i) => {
        nodes[i].status = 'pending';
        delete nodes[i].deletedAt;
    });
    renderTasks();
    await saveData();
    showNotice('Tarea restaurada');
}

async function emptyTrash() {
    confirmAction('Vaciar Papelera', 'Se eliminarán todas las tareas de forma irreversible.', async () => {
        function cleanRecursively(nodes) {
            for (let i = nodes.length - 1; i >= 0; i--) {
                if (nodes[i].status === 'deleted') nodes.splice(i, 1);
                else if (nodes[i].subtasks.length > 0) cleanRecursively(nodes[i].subtasks);
            }
        }
        cleanRecursively(tasks);
        renderTasks();
        await saveData();
        showNotice('Papelera vaciada');
    });
}

// ============================================================================
// LÓGICA DE UI Y FORMULARIOS (POPULATE)
// ============================================================================

function populateDropdowns(mode) {
    const areaSelect = document.getElementById(`${mode}AreaInput`);
    const ctxSelect = document.getElementById(`${mode}ContextInput`);
    
    if (areaSelect) {
        areaSelect.innerHTML = '';
        customAreas.forEach(a => areaSelect.add(new Option(a, a)));
        if (currentState.view === 'area' && mode === 'add') {
            areaSelect.value = currentState.selectedArea;
        }
    }
    
    if (ctxSelect) {
        ctxSelect.innerHTML = '<option value="none">Ninguno</option>';
        customContexts.forEach(c => ctxSelect.add(new Option(c.name, c.name)));
    }
}

function updateAddParentDropdown() {
    const parentSelect = document.getElementById('parentInput');
    const currentArea = document.getElementById('areaInput').value;
    parentSelect.innerHTML = '<option value="root">Ninguna (Tarea Principal)</option>';
    
    function addOptions(nodes, depth) {
        nodes.forEach(n => {
            if (n.status !== 'deleted' && n.status !== 'completed' && n.area === currentArea) {
                const prefix = '- '.repeat(depth);
                parentSelect.add(new Option(`${prefix}${n.name}`, n.id));
                if (n.subtasks.length > 0) addOptions(n.subtasks, depth + 1);
            }
        });
    }
    addOptions(tasks, 0);
    if (currentState.focusTargetId) parentSelect.value = currentState.focusTargetId;
}

function updateEditParentDropdown(excludeId) {
    const parentSelect = document.getElementById('editParentInput');
    const currentArea = document.getElementById('editAreaInput').value;
    parentSelect.innerHTML = '<option value="root">Ninguna (Tarea Principal)</option>';
    
    function addOptions(nodes, depth) {
        nodes.forEach(n => {
            if (n.id !== excludeId && n.status !== 'deleted' && n.status !== 'completed' && n.area === currentArea) {
                const prefix = '- '.repeat(depth);
                parentSelect.add(new Option(`${prefix}${n.name}`, n.id));
                if (n.subtasks.length > 0) addOptions(n.subtasks, depth + 1);
            }
        });
    }
    addOptions(tasks, 0);
}

// ============================================================================
// CONTROL DE MODALES
// ============================================================================

function openAddTaskModal() {
    // BUG FIX: Reset explícito de los selectores múltiples de alerta
    setReminderAlertsUI('add', []);

    document.getElementById('taskInput').value = '';
    document.getElementById('dateInput').value = '';
    document.getElementById('timeInput').value = '';
    document.getElementById('notesInput').value = '';
    
    populateDropdowns('add');
    updateAddParentDropdown();
    
    // Reset Recurrencia
    document.getElementById('addHasRecurrence').checked = false;
    addSelectedDays = [1];
    toggleRecurrenceUI('add');
    
    currentAttachments = [];
    renderAttachments('add');
    
    document.getElementById('addTaskModal').classList.remove('hidden');
    setTimeout(() => document.getElementById('taskInput').focus(), 100);
}

function closeAddTaskModal() { document.getElementById('addTaskModal').classList.add('hidden'); }
function closeEditModal() { document.getElementById('editModal').classList.add('hidden'); editingTaskId = null; }

function openSettingsModal() { 
    document.getElementById('settingsDbUrlInput').value = dbUrl;
    document.getElementById('settingsApiKeyInput').value = customApiKey;
    document.getElementById('settingsModal').classList.remove('hidden'); 
    toggleConfigMenu();
}
function closeSettingsModal() { document.getElementById('settingsModal').classList.add('hidden'); }
function saveSettings() {
    const newUrl = document.getElementById('settingsDbUrlInput').value.trim();
    const newKey = document.getElementById('settingsApiKeyInput').value.trim();
    dbUrl = newUrl;
    customApiKey = newKey;
    localStorage.setItem(DB_URL_KEY, dbUrl);
    localStorage.setItem(API_KEY_STORAGE_KEY, customApiKey);
    closeSettingsModal();
    if (dbUrl) loadDataFromCloud();
    showNotice('Configuración guardada');
}

function toggleConfigMenu() {
    const m = document.getElementById('configMenuContent');
    const c = document.getElementById('configMenuChevron');
    if (m.classList.contains('hidden')) { m.classList.remove('hidden'); c.classList.add('rotate-180'); }
    else { m.classList.add('hidden'); c.classList.remove('rotate-180'); }
}

function confirmAction(title, message, actionFn) {
    document.getElementById('confirmModalTitle').textContent = title;
    document.getElementById('confirmModalMessage').textContent = message;
    
    const btn = document.getElementById('confirmModalBtnAction');
    btn.onclick = () => { closeConfirmModal(); actionFn(); };
    
    document.getElementById('confirmModal').classList.remove('hidden');
}
function closeConfirmModal() { document.getElementById('confirmModal').classList.add('hidden'); }

function showNotice(msg, type = 'success') {
    const box = document.getElementById('notification-box');
    const div = document.createElement('div');
    const colors = type === 'error' ? 'bg-danger-500 text-navy-50' : 'bg-brand-500 text-navy-900';
    div.className = `${colors} px-4 py-2 rounded-md shadow-lg text-xs font-bold slide-up flex items-center gap-2`;
    div.innerHTML = `<svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${type==='error'?'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z':'M5 13l4 4L19 7'}"/></svg> <span>${msg}</span>`;
    box.appendChild(div);
    setTimeout(() => { div.style.opacity = '0'; setTimeout(() => div.remove(), 300); }, 3000);
}

// ============================================================================
// RECURRENCIA - UI CONTROLS
// ============================================================================

function toggleRecurrenceUI(mode) {
    const isChecked = document.getElementById(`${mode}HasRecurrence`).checked;
    const container = document.getElementById(`${mode}RecurrenceContainer`);
    if (isChecked) {
        container.classList.remove('hidden');
        refreshRecurrenceUI(mode);
    } else {
        container.classList.add('hidden');
    }
}

function refreshRecurrenceUI(mode) {
    const freq = document.getElementById(`${mode}Frequency`).value;
    const intLabel = document.getElementById(`${mode}IntervalLabel`);
    
    document.getElementById(`${mode}WeeklyBlock`).classList.add('hidden');
    document.getElementById(`${mode}MonthlyBlock`).classList.add('hidden');
    document.getElementById(`${mode}YearlyBlock`).classList.add('hidden');
    document.getElementById(`${mode}CustomBlock`).classList.add('hidden');
    document.getElementById(`${mode}CompletionBaseBlock`).classList.remove('hidden');

    if (freq === 'daily' || freq === 'after_completion') { intLabel.textContent = 'días'; }
    else if (freq === 'weekly') { 
        intLabel.textContent = 'semanas'; 
        document.getElementById(`${mode}WeeklyBlock`).classList.remove('hidden');
        updateDaysUI(mode);
    }
    else if (freq === 'monthly') {
        intLabel.textContent = 'meses';
        document.getElementById(`${mode}MonthlyBlock`).classList.remove('hidden');
        const mMode = document.querySelector(`input[name="${mode}MonthlyMode"]:checked`).value;
        if (mMode === 'fixed') {
            document.getElementById(`${mode}MonthlyFixedBlock`).classList.remove('hidden');
            document.getElementById(`${mode}MonthlyBusinessBlock`).classList.add('hidden');
        } else {
            document.getElementById(`${mode}MonthlyFixedBlock`).classList.add('hidden');
            document.getElementById(`${mode}MonthlyBusinessBlock`).classList.remove('hidden');
        }
    }
    else if (freq === 'yearly') {
        intLabel.textContent = 'años';
        document.getElementById(`${mode}YearlyBlock`).classList.remove('hidden');
    }
    else if (freq === 'custom') {
        intLabel.textContent = 'meses';
        document.getElementById(`${mode}CustomBlock`).classList.remove('hidden');
        document.getElementById(`${mode}CompletionBaseBlock`).classList.add('hidden'); // Custom asume base fija
    }
    
    validateAndProjectRecurrence(mode);
}

function toggleDay(mode, dayNum) {
    let arr = mode === 'add' ? addSelectedDays : editSelectedDays;
    const idx = arr.indexOf(dayNum);
    if (idx > -1) { if (arr.length > 1) arr.splice(idx, 1); } 
    else { arr.push(dayNum); }
    updateDaysUI(mode);
    validateAndProjectRecurrence(mode);
}

function updateDaysUI(mode) {
    let arr = mode === 'add' ? addSelectedDays : editSelectedDays;
    for (let i = 0; i < 7; i++) {
        const btn = document.getElementById(`${mode}-day-${i}`);
        if (btn) {
            if (arr.includes(i)) btn.classList.add('selected');
            else btn.classList.remove('selected');
        }
    }
}

function validateAndProjectRecurrence(mode) {
    const projEl = document.getElementById(`${mode}RecurrenceProjection`);
    const dateVal = document.getElementById(`${mode}DateInput`).value;
    
    if (!document.getElementById(`${mode}HasRecurrence`).checked) {
        projEl.textContent = ""; return;
    }
    
    if (!dateVal) {
        projEl.innerHTML = `<span class="text-danger-500">Se requiere 'Fecha programada'</span>`;
        return;
    }

    const mockTask = { date: dateVal, recurrenceRule: extractFormRecurrence(mode) };
    const nextDateStr = calculateNextOccurrence(mockTask);
    
    if (nextDateStr) {
        const parts = nextDateStr.split('-');
        projEl.textContent = `Próxima: ${parts[2]}/${parts[1]}/${parts[0]}`;
    } else {
        projEl.textContent = "Regla inválida";
    }
}

// ============================================================================
// FUNCIONES MASIVAS Y CALENDARIO
// ============================================================================
function toggleBulkMode() {
    isBulkMode = !isBulkMode;
    selectedTaskIds.clear();
    const bar = document.getElementById('bulkActionBar');
    if (isBulkMode) { bar.classList.remove('translate-y-32', 'opacity-0'); } 
    else { bar.classList.add('translate-y-32', 'opacity-0'); }
    renderTasks();
    updateBulkCount();
}

function toggleSelection(taskId) {
    if (selectedTaskIds.has(taskId)) selectedTaskIds.delete(taskId);
    else selectedTaskIds.add(taskId);
    updateBulkCount();
}

function updateBulkCount() { document.getElementById('bulkCount').textContent = selectedTaskIds.size; }

async function bulkComplete() {
    if (selectedTaskIds.size === 0) return;
    selectedTaskIds.forEach(id => findAndMutateTask(id, (nodes, i) => {
        if (nodes[i].recurrenceRule) handleRecurrenceOnComplete(nodes[i]);
        else { nodes[i].status = 'completed'; nodes[i].completedAt = new Date().toISOString(); }
    }));
    toggleBulkMode(); await saveData(); renderTasks();
}

async function bulkDelete() {
    if (selectedTaskIds.size === 0) return;
    confirmAction('Borrado masivo', `¿Mover ${selectedTaskIds.size} tareas a la papelera?`, async () => {
        selectedTaskIds.forEach(id => findAndMutateTask(id, (nodes, i) => { nodes[i].status = 'deleted'; }));
        toggleBulkMode(); await saveData(); renderTasks();
    });
}

function openBulkMoveModal() {
    if (selectedTaskIds.size === 0) return;
    const aSelect = document.getElementById('bulkAreaInput');
    const cSelect = document.getElementById('bulkContextInput');
    aSelect.innerHTML = ''; customAreas.forEach(a => aSelect.add(new Option(a, a)));
    cSelect.innerHTML = '<option value="none">Ninguno / Quitar Contexto</option>';
    customContexts.forEach(c => cSelect.add(new Option(c.name, c.name)));
    document.getElementById('bulkMoveModal').classList.remove('hidden');
}

function closeBulkMoveModal() { document.getElementById('bulkMoveModal').classList.add('hidden'); }

async function applyBulkMove() {
    const newA = document.getElementById('bulkAreaInput').value;
    const newC = document.getElementById('bulkContextInput').value;
    selectedTaskIds.forEach(id => findAndMutateTask(id, (nodes, i) => {
        nodes[i].area = newA;
        nodes[i].context = newC === 'none' ? null : newC;
    }));
    closeBulkMoveModal(); toggleBulkMode(); await saveData(); renderTasks();
}

let postponeState = { id: null };
function openPostponeModal(taskId) {
    postponeState.id = taskId;
    document.getElementById('postponeCustomDate').value = '';
    document.getElementById('postponeModal').classList.remove('hidden');
}
function closePostponeModal() { document.getElementById('postponeModal').classList.add('hidden'); }

async function postponeAction(type) {
    let fd = '';
    if (type === 'tomorrow') { const tom = new Date(); tom.setDate(tom.getDate() + 1); fd = tom.toISOString().split('T')[0]; } 
    else if (type === 'nextWeek') { const nw = new Date(); nw.setDate(nw.getDate() + 7); fd = nw.toISOString().split('T')[0]; } 
    else if (type === 'custom') { fd = document.getElementById('postponeCustomDate').value; if (!fd) return; }
    
    findAndMutateTask(postponeState.id, (nodes, i) => { 
        nodes[i].date = fd; 
        nodes[i].eventCreated = false; // Permitir que GAS cree nuevo evento
    });
    
    closePostponeModal(); renderTasks(); await saveData();
}

// CALENDARIO RENDER
function renderCalendar() {
    const g = document.getElementById('calendar-grid');
    const m = document.getElementById('calendar-month');
    g.innerHTML = '';
    
    const y = calendarDate.getFullYear();
    const mo = calendarDate.getMonth();
    
    const options = { month: 'long', year: 'numeric' };
    m.textContent = calendarDate.toLocaleDateString('es-ES', options);
    
    const firstDay = new Date(y, mo, 1).getDay();
    const daysInMonth = new Date(y, mo + 1, 0).getDate();
    const today = new Date();
    
    // Contar tareas por día
    const dayCounts = {};
    function countForCal(nodes) {
        nodes.forEach(t => {
            if (t.status !== 'deleted' && t.date) {
                const parts = t.date.split('-');
                if (parseInt(parts[0]) === y && parseInt(parts[1]) - 1 === mo) {
                    const d = parseInt(parts[2]);
                    if (!dayCounts[d]) dayCounts[d] = { p: 0, c: 0 };
                    if (t.status === 'completed') dayCounts[d].c++; else dayCounts[d].p++;
                }
            }
            if (t.subtasks.length > 0) countForCal(t.subtasks);
        });
    }
    countForCal(tasks);
    
    for (let i = 0; i < firstDay; i++) {
        const d = document.createElement('div');
        d.className = 'calendar-day opacity-20';
        g.appendChild(d);
    }
    
    for (let i = 1; i <= daysInMonth; i++) {
        const isToday = i === today.getDate() && mo === today.getMonth() && y === today.getFullYear();
        const d = document.createElement('div');
        d.className = `calendar-day ${isToday ? 'today' : 'text-navy-50 bg-navy-900 border border-navy-700/50'}`;
        
        let html = `<span class="mb-1">${i}</span>`;
        if (dayCounts[i]) {
            html += `<div class="flex gap-1">`;
            if (dayCounts[i].p > 0) html += `<span class="w-2 h-2 rounded-full bg-brand-500" title="${dayCounts[i].p} pendientes"></span>`;
            if (dayCounts[i].c > 0) html += `<span class="w-2 h-2 rounded-full bg-green-500" title="${dayCounts[i].c} completadas"></span>`;
            html += `</div>`;
        }
        
        d.innerHTML = html;
        d.onclick = () => openDayDetail(y, mo, i);
        g.appendChild(d);
    }
}

function changeMonth(delta) {
    calendarDate.setMonth(calendarDate.getMonth() + delta);
    renderCalendar();
}

function openDayDetail(y, mo, d) {
    const tgt = `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dateObj = new Date(y, mo, d);
    document.getElementById('modalDateTitle').textContent = dateObj.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
    
    const cont = document.getElementById('modalContent');
    cont.innerHTML = '';
    
    let found = [];
    function findD(nodes) {
        nodes.forEach(t => {
            if (t.status !== 'deleted' && t.date === tgt) found.push(t);
            if (t.subtasks.length > 0) findD(t.subtasks);
        });
    }
    findD(tasks);
    
    if (found.length === 0) {
        cont.innerHTML = '<p class="text-xs text-navy-400 text-center py-4">No hay tareas programadas para este día.</p>';
    } else {
        found.sort((a, b) => (a.status === 'completed' ? 1 : 0) - (b.status === 'completed' ? 1 : 0));
        found.forEach(t => {
            const el = document.createElement('div');
            el.className = `p-2 rounded bg-navy-900 border border-navy-700 text-xs flex justify-between items-center ${t.status === 'completed' ? 'opacity-50' : ''}`;
            el.innerHTML = `
                <span class="${t.status === 'completed' ? 'line-through text-navy-400' : 'text-navy-50 font-semibold'}">${t.name}</span>
                <span class="${priorityColors[t.priority]} font-bold text-[9px] uppercase">${t.priority}</span>
            `;
            cont.appendChild(el);
        });
    }
    
    document.getElementById('dayDetailModal').classList.remove('hidden');
}
function closeModal() { document.getElementById('dayDetailModal').classList.add('hidden'); }

// ============================================================================
// IMPORT / EXPORT DATA
// ============================================================================
function exportData() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(tasks, null, 2));
    const dn = document.createElement('a');
    dn.setAttribute("href", dataStr);
    dn.setAttribute("download", `agenda_leo_backup_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(dn);
    dn.click();
    dn.remove();
    closeSettingsModal();
    showNotice('Backup descargado');
}

function importData(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const imported = JSON.parse(e.target.result);
            if (Array.isArray(imported)) {
                tasks = imported;
                migrateAndNormalizeTasks();
                renderTasks();
                await saveData();
                closeSettingsModal();
                showNotice('Datos importados correctamente');
            } else { showNotice('Formato de archivo inválido', 'error'); }
        } catch (err) { showNotice('Error al leer archivo', 'error'); }
    };
    reader.readAsText(file);
}

// STUBS - Funciones no implementadas requeridas por UI
function handleFileUpload(event, mode) { event.target.value = ''; showNotice("Carga simulada"); }
function renderAttachments(mode) {}
function toggleAIFilter() { document.getElementById('omnibar-container').classList.toggle('hidden'); }
function processOmnibarCommand() { document.getElementById('omnibarInput').value = ''; showNotice("Simulación IA"); }
function handleOmnibarKeydown(event) { if (event.key === 'Enter') processOmnibarCommand(); }
function closeManageModal() { document.getElementById('manageModal').classList.add('hidden'); }