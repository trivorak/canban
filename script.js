// ============================================================
// SHARED CONSTANTS
// ============================================================

// 16 preset tag colors — an evenly spaced rainbow (22.5° per hue).
// Each entry pairs a light-theme tone with a dark-theme tone so tag text
// stays readable on either surface. Tags store only the hue `key`; the
// actual color is resolved per theme via CSS custom properties, which
// avoids a hardcoded hex that would be illegible in one of the themes.
const TAG_COLORS = [
    { key: 'red', label: 'Red' },
    { key: 'red-orange', label: 'Red-orange' },
    { key: 'orange', label: 'Orange' },
    { key: 'amber', label: 'Amber' },
    { key: 'yellow', label: 'Yellow' },
    { key: 'lime', label: 'Lime' },
    { key: 'green', label: 'Green' },
    { key: 'emerald', label: 'Emerald' },
    { key: 'teal', label: 'Teal' },
    { key: 'cyan', label: 'Cyan' },
    { key: 'sky', label: 'Sky' },
    { key: 'blue', label: 'Blue' },
    { key: 'indigo', label: 'Indigo' },
    { key: 'violet', label: 'Violet' },
    { key: 'purple', label: 'Purple' },
    { key: 'magenta', label: 'Magenta' }
];

const TAG_COLOR_KEYS = TAG_COLORS.map(entry => entry.key);
const DEFAULT_TAG_COLOR = 'red';

// Tags created before the presets existed stored a hex value. Map those onto
// the nearest preset so old boards keep working without a data migration.
const LEGACY_TAG_COLORS = {
    '#cc0000': 'red',
    '#b92031': 'red',
    '#d71f34': 'red',
    '#45181b': 'red',
    '#720f1a': 'red',
    '#961b24': 'red',
    '#f7b500': 'amber',
    '#dda32f': 'amber',
    '#efc04b': 'yellow',
    '#fce47e': 'yellow',
    '#119e49': 'green',
    '#557a2d': 'lime',
    '#87b65d': 'lime',
    '#117072': 'teal',
    '#0f545a': 'teal',
    '#66b2b2': 'teal',
    '#335a89': 'blue',
    '#243b5e': 'indigo',
    '#809fce': 'sky',
    '#ca5728': 'orange',
    '#e57751': 'orange',
    '#f5a77e': 'orange',
    '#4a6cf7': 'blue'
};

// Resolve whatever a tag has stored (preset key, legacy hex, or nothing)
// into a valid preset key.
function normalizeTagColor(value) {
    if (!value) return DEFAULT_TAG_COLOR;
    const key = String(value).trim().toLowerCase();
    if (TAG_COLOR_KEYS.includes(key)) return key;
    return LEGACY_TAG_COLORS[key] || DEFAULT_TAG_COLOR;
}

// ============================================================
// DATA LAYER
// ============================================================

class KanbanData {
    constructor() {
        // Start from a local cache (or defaults) so the UI is instant.
        // The real source of truth is the per-user row in SQLite, fetched
        // during login/bootstrap and synced back on every change.
        this.data = this.getCachedData();
        this.currentBoardId = this.data.currentBoardId || null;
        this.listeners = [];

        // Debounce server sync so rapid edits don't flood the API.
        this._saveTimer = null;
    }

    // ---- Local cache (fallback while offline / pre-login) ----
    getCachedData() {
        const stored = localStorage.getItem('kanbanData');
        if (stored) {
            try {
                return JSON.parse(stored);
            } catch {
                return this.getDefaultData();
            }
        }
        return this.getDefaultData();
    }

    getDefaultData() {
        return {
            boards: [
                {
                    id: 'board-1',
                    title: 'My Board',
                    tags: [],
                    columns: [
                        { id: 'col-1', title: 'To Do', cards: [] },
                        { id: 'col-2', title: 'In Progress', cards: [] },
                        { id: 'col-3', title: 'Done', cards: [] }
                    ]
                }
            ],
            currentBoardId: 'board-1',
            todos: []
        };
    }

    // ---- Server sync ----
    // Replace in-memory data with the server's copy for the logged-in user.
    async loadFromServer() {
        const res = await fetch('/api/state', { credentials: 'same-origin' });
        if (!res.ok) {
            if (res.status === 401) throw new Error('Not authenticated');
            throw new Error('Failed to load data');
        }
        const serverData = await res.json();
        if (serverData && typeof serverData === 'object' && Array.isArray(serverData.boards)) {
            this.data = serverData;
            this.currentBoardId = this.data.currentBoardId || null;
            // Update the local cache.
            localStorage.setItem('kanbanData', JSON.stringify(this.data));
            this.notifyListeners();
        }
        return this.data;
    }

    // Persist locally immediately, and to the server (debounced).
    save() {
        localStorage.setItem('kanbanData', JSON.stringify(this.data));
        this.notifyListeners();
        this.syncToServer();
    }

    syncToServer() {
        if (this._saveTimer) return; // already queued
        this._saveTimer = setTimeout(() => {
            this._saveTimer = null;
            fetch('/api/state', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify(this.data)
            }).catch(() => {
                // Offline or not logged in — data stays in localStorage.
            });
        }, 250);
    }

    // ============ BOARD METHODS ============
    getBoards() {
        return this.data.boards;
    }

    getCurrentBoard() {
        return this.data.boards.find(b => b.id === this.data.currentBoardId) || this.data.boards[0];
    }

    setCurrentBoard(boardId) {
        this.data.currentBoardId = boardId;
        this.save();
    }

    addBoard(title) {
        const newBoard = {
            id: 'board-' + Date.now(),
            title: title || 'Untitled Board',
            tags: [],
            columns: [
                { id: 'col-' + Date.now() + '-1', title: 'To Do', cards: [] },
                { id: 'col-' + Date.now() + '-2', title: 'In Progress', cards: [] },
                { id: 'col-' + Date.now() + '-3', title: 'Done', cards: [] }
            ]
        };
        this.data.boards.push(newBoard);
        this.data.currentBoardId = newBoard.id;
        this.save();
        return newBoard;
    }

    deleteBoard(boardId) {
        if (this.data.boards.length <= 1) {
            alert('Cannot delete the last board.');
            return false;
        }
        this.data.boards = this.data.boards.filter(b => b.id !== boardId);
        if (this.data.currentBoardId === boardId) {
            this.data.currentBoardId = this.data.boards[0].id;
        }
        this.save();
        return true;
    }

    addColumn(boardId, title) {
        const board = this.data.boards.find(b => b.id === boardId);
        if (!board) return null;
        const newCol = {
            id: 'col-' + Date.now(),
            title: title || 'Untitled',
            cards: []
        };
        board.columns.push(newCol);
        this.save();
        return newCol;
    }

    addTag(boardId, color, name) {
        const board = this.data.boards.find(b => b.id === boardId);
        if (!board) return false;
        board.tags = board.tags || [];
        board.tags.push({ id: 'tag-' + Date.now(), color: normalizeTagColor(color), name });
        this.save();
        return true;
    }

    deleteTag(boardId, tagId) {
        const board = this.data.boards.find(b => b.id === boardId);
        if (!board) return false;
        board.tags = (board.tags || []).filter(tag => tag.id !== tagId);
        board.columns.forEach(column => column.cards.forEach(card => {
            if (card.tagId === tagId) delete card.tagId;
            if (card.tagIds) card.tagIds = card.tagIds.filter(id => id !== tagId);
        }));
        this.save();
        return true;
    }

    deleteColumn(boardId, columnId) {
        const board = this.data.boards.find(b => b.id === boardId);
        if (!board) return false;
        const column = board.columns.find(c => c.id === columnId);
        if (!column || column.title.trim().toLowerCase() === 'done') return false;
        board.columns = board.columns.filter(c => c.id !== columnId);
        this.save();
        return true;
    }

    reorderColumns(boardId, columnIds) {
        const board = this.data.boards.find(b => b.id === boardId);
        if (!board) return false;
        const columnsById = new Map(board.columns.map(column => [column.id, column]));
        const orderedColumns = columnIds.map(id => columnsById.get(id)).filter(Boolean);
        if (orderedColumns.length !== board.columns.length) return false;
        board.columns = orderedColumns;
        this.save();
        return true;
    }

    clearColumn(boardId, columnId) {
        const board = this.data.boards.find(b => b.id === boardId);
        if (!board) return false;
        const column = board.columns.find(c => c.id === columnId);
        if (!column) return false;
        column.cards = [];
        this.save();
        return true;
    }

    addCard(boardId, columnId, title, description) {
        const board = this.data.boards.find(b => b.id === boardId);
        if (!board) return null;
        const column = board.columns.find(c => c.id === columnId);
        if (!column) return null;
        const newCard = {
            id: 'card-' + Date.now(),
            title: title || 'Untitled',
            description: description || '',
            tagIds: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        column.cards.push(newCard);
        this.save();
        return newCard;
    }

    updateCard(boardId, columnId, cardId, updates) {
        const board = this.data.boards.find(b => b.id === boardId);
        if (!board) return false;
        const column = board.columns.find(c => c.id === columnId);
        if (!column) return false;
        const card = column.cards.find(c => c.id === cardId);
        if (!card) return false;

        if (updates.title !== undefined) card.title = updates.title;
        if (updates.description !== undefined) card.description = updates.description;
        if (updates.tagIds !== undefined) card.tagIds = updates.tagIds;
        card.updatedAt = new Date().toISOString();

        this.save();
        return true;
    }

    deleteCard(boardId, columnId, cardId) {
        const board = this.data.boards.find(b => b.id === boardId);
        if (!board) return false;
        const column = board.columns.find(c => c.id === columnId);
        if (!column) return false;
        column.cards = column.cards.filter(c => c.id !== cardId);
        this.save();
        return true;
    }

    moveCard(boardId, fromColumnId, toColumnId, cardId, insertIndex = null) {
        const board = this.data.boards.find(b => b.id === boardId);
        if (!board) return false;

        const fromCol = board.columns.find(c => c.id === fromColumnId);
        const toCol = board.columns.find(c => c.id === toColumnId);
        if (!fromCol || !toCol) return false;

        const cardIndex = fromCol.cards.findIndex(c => c.id === cardId);
        if (cardIndex === -1) return false;

        const [card] = fromCol.cards.splice(cardIndex, 1);
        card.updatedAt = new Date().toISOString();
        const destinationIndex = insertIndex === null
            ? toCol.cards.length
            : Math.max(0, Math.min(insertIndex, toCol.cards.length));
        toCol.cards.splice(destinationIndex, 0, card);
        this.save();
        return true;
    }

    reorderCards(boardId, columnId, cardIds) {
        const board = this.data.boards.find(b => b.id === boardId);
        if (!board) return false;
        const column = board.columns.find(c => c.id === columnId);
        if (!column) return false;

        const orderedCards = [];
        for (const id of cardIds) {
            const card = column.cards.find(c => c.id === id);
            if (card) orderedCards.push(card);
        }
        column.cards = orderedCards;
        this.save();
        return true;
    }

    // ============ TODO METHODS ============
    getTodos() {
        return this.data.todos || [];
    }

    addTodo(title, dueDate = '') {
        const newTodo = {
            id: 'todo-' + Date.now(),
            title: title || 'Untitled Todo',
            completed: false,
            dueDate: dueDate || '',
            subtodos: []
        };
        if (!this.data.todos) {
            this.data.todos = [];
        }
        this.data.todos.push(newTodo);
        this.save();
        return newTodo;
    }

    updateTodo(todoId, updates) {
        const todo = this.data.todos.find(t => t.id === todoId);
        if (!todo) return false;
        if (updates.title !== undefined) todo.title = updates.title;
        if (updates.completed !== undefined) todo.completed = updates.completed;
        if (updates.dueDate !== undefined) todo.dueDate = updates.dueDate || '';
        this.save();
        return true;
    }

    deleteTodo(todoId) {
        this.data.todos = this.data.todos.filter(t => t.id !== todoId);
        this.save();
        return true;
    }

    clearCompletedTodos() {
        const todos = this.data.todos || [];
        const beforeCount = todos.length;
        this.data.todos = todos.filter(t => !t.completed);
        if (this.data.todos.length === beforeCount) return false;
        this.save();
        return true;
    }

    reorderTodosBySection(section, orderedTodoIds) {
        const todos = this.data.todos || [];
        const isTargetSection = (todo) => section === 'completed' ? todo.completed : !todo.completed;
        const targetTodos = todos.filter(isTargetSection);
        if (targetTodos.length !== orderedTodoIds.length) return false;

        const todoById = new Map(targetTodos.map(todo => [todo.id, todo]));
        const reorderedTarget = orderedTodoIds.map(id => todoById.get(id)).filter(Boolean);
        if (reorderedTarget.length !== targetTodos.length) return false;

        let cursor = 0;
        this.data.todos = todos.map(todo => (isTargetSection(todo) ? reorderedTarget[cursor++] : todo));
        this.save();
        return true;
    }

    addSubtodo(todoId, title, dueDate = '') {
        const todo = this.data.todos.find(t => t.id === todoId);
        if (!todo) return null;
        const newSub = {
            id: 'sub-' + Date.now(),
            title: title || 'Untitled Subtask',
            completed: false,
            dueDate: dueDate || ''
        };
        todo.subtodos.push(newSub);
        this.save();
        return newSub;
    }

    updateSubtodo(todoId, subtodoId, updates) {
        const todo = this.data.todos.find(t => t.id === todoId);
        if (!todo) return false;
        const subtodo = todo.subtodos.find(s => s.id === subtodoId);
        if (!subtodo) return false;
        if (updates.title !== undefined) subtodo.title = updates.title;
        if (updates.completed !== undefined) subtodo.completed = updates.completed;
        if (updates.dueDate !== undefined) subtodo.dueDate = updates.dueDate || '';
        this.save();
        return true;
    }

    deleteSubtodo(todoId, subtodoId) {
        const todo = this.data.todos.find(t => t.id === todoId);
        if (!todo) return false;
        todo.subtodos = todo.subtodos.filter(s => s.id !== subtodoId);
        this.save();
        return true;
    }

    toggleTodo(todoId) {
        const todo = this.data.todos.find(t => t.id === todoId);
        if (!todo) return false;
        todo.completed = !todo.completed;
        this.save();
        return true;
    }

    toggleSubtodo(todoId, subtodoId) {
        const todo = this.data.todos.find(t => t.id === todoId);
        if (!todo) return false;
        const subtodo = todo.subtodos.find(s => s.id === subtodoId);
        if (!subtodo) return false;
        subtodo.completed = !subtodo.completed;
        this.save();
        return true;
    }

    exportData() {
        return JSON.stringify(this.data, null, 2);
    }

    importData(jsonData) {
        try {
            const parsed = JSON.parse(jsonData);
            if (parsed.boards && Array.isArray(parsed.boards)) {
                this.data = parsed;
                this.save();
                return true;
            }
            return false;
        } catch {
            return false;
        }
    }

    addListener(fn) {
        this.listeners.push(fn);
    }

    notifyListeners() {
        this.listeners.forEach(fn => fn(this.data));
    }
}

// ============================================================
// UI RENDERER
// ============================================================

class KanbanUI {
    constructor(dataManager) {
        this.data = dataManager;
        this.currentBoard = null;
        this.draggedCard = null;
        this.draggedFromColumn = null;
        this.editingCardId = null;
        this.editingColumnId = null;
        this.editingTodoId = null;
        this.editingSubtodoTodoId = null;
        this.editingSubtodoId = null;
        this.selectedTodoId = null;
        this.selectedKanbanCardId = null;
        this.selectedKanbanColumnId = null;
        this.boardEditMode = false;
        this.showCompletedTodos = true;
        // Currently chosen preset in the tag color picker.
        this.selectedTagColor = DEFAULT_TAG_COLOR;

        // DOM refs
        this.boardTabsEl = document.getElementById('boardTabs');
        this.boardContainerEl = document.getElementById('boardContainer');
        this.addBoardBtn = document.getElementById('addBoardBtn');
        this.editBoardBtn = document.getElementById('editBoardBtn');
        this.editBoardLabel = document.getElementById('editBoardLabel');
        this.manageTagsBtn = document.getElementById('manageTagsBtn');
        this.manageTagsModal = document.getElementById('manageTagsModal');

        // Modals
        this.columnModal = document.getElementById('addColumnModal');
        this.cardModal = document.getElementById('addCardModal');
        this.editCardModal = document.getElementById('editCardModal');
        this.addTodoModal = document.getElementById('addTodoModal');
        this.addSubtodoModal = document.getElementById('addSubtodoModal');
        this.editTodoModal = document.getElementById('editTodoModal');
        this.editSubtodoModal = document.getElementById('editSubtodoModal');

        // Tab elements
        this.mainTabs = document.querySelectorAll('.main-tab');
        this.kanbanTab = document.getElementById('kanbanTab');
        this.todoTab = document.getElementById('todoTab');
        this.todoListEl = document.getElementById('todoList');

        this.init();
    }

    init() {
        this.setupThemeToggle();
        this.setupEventListeners();
        this.setupOptionalDatePickers();
        this.setupTabSwitching();
        this.data.addListener(() => {
            this.render();
            this.renderTodos();
        });
        this.render();
        this.renderTodos();
    }

    setupThemeToggle() {
        const themeKey = 'kanbanTheme';
        const applyTheme = (theme) => {
            document.documentElement.setAttribute('data-theme', theme);
            try {
                localStorage.setItem(themeKey, theme);
            } catch (e) { /* localStorage may be unavailable */ }
        };

        // Restore saved preference, else follow the OS preference.
        let saved = null;
        try {
            saved = localStorage.getItem(themeKey);
        } catch (e) { /* ignore */ }
        const initial = saved || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        applyTheme(initial);
        document.body.classList.add('theme-ready');

        const btn = document.getElementById('themeToggleBtn');
        if (btn) {
            btn.addEventListener('click', () => {
                const current = document.documentElement.getAttribute('data-theme') || 'light';
                applyTheme(current === 'dark' ? 'light' : 'dark');
            });
        }
    }

    setupOptionalDatePickers() {
        document.querySelectorAll('.due-date-field input[type="date"]').forEach((input) => {
            input.addEventListener('click', () => {
                if (!input.value) {
                    input.value = this.getTodayIsoDate();
                }
            });
        });
    }

    setupTabSwitching() {
        this.mainTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                this.activateMainTab(tab.dataset.tab);
            });
        });
    }

    activateMainTab(tabName) {
        this.mainTabs.forEach(t => t.classList.remove('active'));
        const selectedTab = Array.from(this.mainTabs).find(tab => tab.dataset.tab === tabName);
        if (selectedTab) selectedTab.classList.add('active');

        if (tabName === 'kanban') {
            this.kanbanTab.style.display = 'flex';
            this.todoTab.style.display = 'none';
            this.ensureValidKanbanSelection(true);
            this.focusSelectedKanbanCard();
            return;
        }

        this.kanbanTab.style.display = 'none';
        this.todoTab.style.display = 'flex';
        this.renderTodos(true);
    }

    setupEventListeners() {
        // Add Board
        this.addBoardBtn.addEventListener('click', () => {
            const title = prompt('Enter board name:');
            if (title !== null) {
                this.data.addBoard(title || 'Untitled Board');
            }
        });

        this.editBoardBtn.addEventListener('click', () => {
            if (!this.data.getCurrentBoard()) return;
            this.boardEditMode = !this.boardEditMode;
            this.render();
        });

        this.manageTagsBtn.addEventListener('click', () => {
            this.renderTagDefinitions();
            this.renderTagColorTrigger();
            this.manageTagsModal.classList.add('show');
        });

        // Trigger opens/closes the preset popup.
        document.getElementById('tagColorTrigger').addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.isTagColorPopupOpen()) {
                this.closeTagColorPopup();
            } else {
                this.openTagColorPopup();
            }
        });

        // Clicking anywhere else dismisses the popup.
        document.addEventListener('click', (e) => {
            if (!this.isTagColorPopupOpen()) return;
            if (e.target.closest('#tagColorPopup') || e.target.closest('#tagColorTrigger')) return;
            this.closeTagColorPopup();
        });

        // Keep the popup anchored to its trigger if the layout shifts.
        const repositionPopup = () => {
            if (this.isTagColorPopupOpen()) this.openTagColorPopup();
        };
        window.addEventListener('resize', repositionPopup);
        window.addEventListener('scroll', repositionPopup, true);

        document.getElementById('addTagBtn').addEventListener('click', () => {
            const color = normalizeTagColor(this.selectedTagColor);
            const nameInput = document.getElementById('tagNameInput');
            const name = nameInput.value.trim();
            const board = this.data.getCurrentBoard();
            if (!name || !board) return;
            this.data.addTag(board.id, color, name);
            nameInput.value = '';
            // Advance to the next preset so consecutive tags don't look alike.
            const nextIndex = (TAG_COLOR_KEYS.indexOf(color) + 1) % TAG_COLOR_KEYS.length;
            this.selectedTagColor = TAG_COLOR_KEYS[nextIndex];
            this.renderTagDefinitions();
            this.renderTagColorTrigger();
            this.closeTagColorPopup();
            nameInput.focus();
        });

        document.getElementById('closeTagsBtn').addEventListener('click', () => {
            this.closeTagColorPopup();
            this.manageTagsModal.classList.remove('show');
        });

        // Column Modal
        document.getElementById('saveColumnBtn').addEventListener('click', () => {
            const input = document.getElementById('columnTitleInput');
            const title = input.value.trim();
            if (title) {
                const board = this.data.getCurrentBoard();
                this.data.addColumn(board.id, title);
                input.value = '';
                this.columnModal.classList.remove('show');
            }
        });

        document.getElementById('cancelColumnBtn').addEventListener('click', () => {
            document.getElementById('columnTitleInput').value = '';
            this.columnModal.classList.remove('show');
        });

        // Card Modal (Add)
        document.getElementById('saveCardBtn').addEventListener('click', () => {
            const titleInput = document.getElementById('cardTitleInput');
            const descInput = document.getElementById('cardDescriptionInput');
            const title = titleInput.value.trim();
            const desc = descInput.value.trim();
            const tagIds = this.getSelectedTagIds('cardTagInput');
            if (title) {
                const board = this.data.getCurrentBoard();
                const columnId = this.cardModal.dataset.columnId;
                const card = this.data.addCard(board.id, columnId, title, desc);
                if (card) this.data.updateCard(board.id, columnId, card.id, { tagIds });
                titleInput.value = '';
                descInput.value = '';
                this.cardModal.classList.remove('show');
            }
        });

        document.getElementById('cancelCardBtn').addEventListener('click', () => {
            document.getElementById('cardTitleInput').value = '';
            document.getElementById('cardDescriptionInput').value = '';
            this.cardModal.classList.remove('show');
        });

        // Edit Card Modal
        document.getElementById('saveEditCardBtn').addEventListener('click', () => {
            const titleInput = document.getElementById('editCardTitleInput');
            const descInput = document.getElementById('editCardDescriptionInput');
            const title = titleInput.value.trim();
            const desc = descInput.value.trim();
            const tagIds = this.getSelectedTagIds('editCardTagInput');

            if (title && this.editingCardId && this.editingColumnId) {
                const board = this.data.getCurrentBoard();
                this.data.updateCard(board.id, this.editingColumnId, this.editingCardId, {
                    title: title,
                    description: desc,
                    tagIds
                });
                this.editCardModal.classList.remove('show');
                this.editingCardId = null;
                this.editingColumnId = null;
            }
        });

        document.getElementById('cancelEditCardBtn').addEventListener('click', () => {
            this.editCardModal.classList.remove('show');
            this.editingCardId = null;
            this.editingColumnId = null;
        });

        // Todo Modals
        const addTodoBtn = document.getElementById('addTodoBtn');
        if (addTodoBtn) {
            addTodoBtn.addEventListener('click', () => {
                this.addTodoModal.classList.add('show');
                document.getElementById('todoTitleInput').focus();
            });
        }

        const saveTodoBtn = document.getElementById('saveTodoBtn');
        if (saveTodoBtn) {
            saveTodoBtn.addEventListener('click', () => {
                const titleInput = document.getElementById('todoTitleInput');
                const dueDateInput = document.getElementById('todoDueDateInput');
                const title = titleInput.value.trim();
                const dueDate = dueDateInput.value || '';
                if (title) {
                    this.data.addTodo(title, dueDate);
                    titleInput.value = '';
                    dueDateInput.value = '';
                    this.addTodoModal.classList.remove('show');
                    this.renderTodos();
                } else {
                    alert('Please enter a todo title.');
                }
            });
        }

        const cancelTodoBtn = document.getElementById('cancelTodoBtn');
        if (cancelTodoBtn) {
            cancelTodoBtn.addEventListener('click', () => {
                document.getElementById('todoTitleInput').value = '';
                document.getElementById('todoDueDateInput').value = '';
                this.addTodoModal.classList.remove('show');
            });
        }

        // Subtodo Modal
        const saveSubtodoBtn = document.getElementById('saveSubtodoBtn');
        if (saveSubtodoBtn) {
            saveSubtodoBtn.addEventListener('click', () => {
                const titleInput = document.getElementById('subtodoTitleInput');
                const dueDateInput = document.getElementById('subtodoDueDateInput');
                const title = titleInput.value.trim();
                const dueDate = dueDateInput.value || '';
                const todoId = this.addSubtodoModal.dataset.todoId;
                if (title && todoId) {
                    this.data.addSubtodo(todoId, title, dueDate);
                    titleInput.value = '';
                    dueDateInput.value = '';
                    this.addSubtodoModal.classList.remove('show');
                    this.renderTodos();
                } else {
                    alert('Please enter a subtask title.');
                }
            });
        }

        const cancelSubtodoBtn = document.getElementById('cancelSubtodoBtn');
        if (cancelSubtodoBtn) {
            cancelSubtodoBtn.addEventListener('click', () => {
                document.getElementById('subtodoTitleInput').value = '';
                document.getElementById('subtodoDueDateInput').value = '';
                this.addSubtodoModal.classList.remove('show');
            });
        }

        // Edit Todo Modal
        const saveEditTodoBtn = document.getElementById('saveEditTodoBtn');
        if (saveEditTodoBtn) {
            saveEditTodoBtn.addEventListener('click', () => {
                const titleInput = document.getElementById('editTodoTitleInput');
                const dueDateInput = document.getElementById('editTodoDueDateInput');
                const title = titleInput.value.trim();
                const dueDate = dueDateInput.value || '';
                if (title && this.editingTodoId) {
                    this.data.updateTodo(this.editingTodoId, { title: title, dueDate: dueDate });
                    titleInput.value = '';
                    dueDateInput.value = '';
                    this.editTodoModal.classList.remove('show');
                    this.editingTodoId = null;
                    this.renderTodos();
                } else {
                    alert('Please enter a todo title.');
                }
            });
        }

        const cancelEditTodoBtn = document.getElementById('cancelEditTodoBtn');
        if (cancelEditTodoBtn) {
            cancelEditTodoBtn.addEventListener('click', () => {
                document.getElementById('editTodoTitleInput').value = '';
                document.getElementById('editTodoDueDateInput').value = '';
                this.editTodoModal.classList.remove('show');
                this.editingTodoId = null;
            });
        }

        const saveEditSubtodoBtn = document.getElementById('saveEditSubtodoBtn');
        if (saveEditSubtodoBtn) {
            saveEditSubtodoBtn.addEventListener('click', () => {
                const titleInput = document.getElementById('editSubtodoTitleInput');
                const dueDateInput = document.getElementById('editSubtodoDueDateInput');
                const title = titleInput.value.trim();
                const dueDate = dueDateInput.value || '';
                if (title && this.editingSubtodoTodoId && this.editingSubtodoId) {
                    this.data.updateSubtodo(this.editingSubtodoTodoId, this.editingSubtodoId, {
                        title,
                        dueDate
                    });
                    titleInput.value = '';
                    dueDateInput.value = '';
                    this.editSubtodoModal.classList.remove('show');
                    this.editingSubtodoTodoId = null;
                    this.editingSubtodoId = null;
                    this.renderTodos();
                } else {
                    alert('Please enter a subtask title.');
                }
            });
        }

        const cancelEditSubtodoBtn = document.getElementById('cancelEditSubtodoBtn');
        if (cancelEditSubtodoBtn) {
            cancelEditSubtodoBtn.addEventListener('click', () => {
                document.getElementById('editSubtodoTitleInput').value = '';
                document.getElementById('editSubtodoDueDateInput').value = '';
                this.editSubtodoModal.classList.remove('show');
                this.editingSubtodoTodoId = null;
                this.editingSubtodoId = null;
            });
        }

        // Close modals on overlay click
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.cancelAndCloseModals();
                }
            });
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                // Escape closes the color popup first, leaving the modal open.
                if (this.isTagColorPopupOpen()) {
                    this.closeTagColorPopup();
                    return;
                }
                this.cancelAndCloseModals();
                return;
            }

            if (this.handleKanbanKeyboardShortcuts(e)) return;

            if (!this.isKanbanTabActive() && e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'ArrowUp') {
                e.preventDefault();
                this.moveSelectedTodoInSection(-1);
                return;
            }

            if (!this.isKanbanTabActive() && e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'ArrowDown') {
                e.preventDefault();
                this.moveSelectedTodoInSection(1);
                return;
            }

            if (this.shouldIgnoreGlobalShortcut(e)) return;

            if (this.isKanbanTabActive() && e.key.toLowerCase() === 'e') {
                e.preventDefault();
                this.openEditSelectedKanbanCardModal();
                return;
            }

            if (e.key.toLowerCase() === 'a' && this.isKanbanTabActive()) {
                e.preventDefault();
                this.openQuickAddCardModal();
                return;
            }

            if (e.key.toLowerCase() === 'a' && !this.isKanbanTabActive()) {
                e.preventDefault();
                this.openQuickAddTodoModal();
                return;
            }

            if (!this.isKanbanTabActive() && e.key === 'ArrowDown') {
                e.preventDefault();
                this.moveTodoSelection(1);
                return;
            }

            if (!this.isKanbanTabActive() && e.key === 'ArrowUp') {
                e.preventDefault();
                this.moveTodoSelection(-1);
                return;
            }

            if (!this.isKanbanTabActive() && e.key.toLowerCase() === 's') {
                e.preventDefault();
                this.openQuickAddSubtodoModalForSelected();
                return;
            }

            if (!this.isKanbanTabActive() && e.key.toLowerCase() === 'e') {
                e.preventDefault();
                this.openEditSelectedTodoModal();
                return;
            }

            if (!this.isKanbanTabActive() && (e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar')) {
                e.preventDefault();
                this.toggleSelectedTodoCompletion();
                return;
            }

            if (e.key.toLowerCase() === 'k') {
                e.preventDefault();
                this.activateMainTab('kanban');
                return;
            }

            if (e.key.toLowerCase() === 't') {
                e.preventDefault();
                this.activateMainTab('todo');
            }
        });

        // Enter in any input/textarea inside an open modal submits it.
        // Targets the modal's primary save button so the same logic runs
        // whether the user clicks it or presses Enter.
        document.querySelectorAll('.modal input, .modal textarea').forEach((el) => {
            el.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter') return;

                // Allow Enter to insert a new line in multi-line textareas.
                const isTextarea = el.tagName === 'TEXTAREA';
                if (isTextarea && !e.shiftKey) {
                    e.preventDefault();
                } else if (!isTextarea) {
                    e.preventDefault();
                } else {
                    // Shift+Enter in a textarea: keep the newline, don't submit.
                    return;
                }

                const modal = el.closest('.modal');
                if (!modal || !modal.classList.contains('show')) return;
                const primaryBtn = modal.querySelector('.btn-primary');
                if (primaryBtn) {
                    primaryBtn.click();
                }
            });
        });

        // Logout
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                window.CanbanAuth.logout();
            });
        }
    }

    // ============ KANBAN RENDER ============
    render() {
        const boards = this.data.getBoards();
        const currentBoard = this.data.getCurrentBoard();
        this.currentBoard = currentBoard;

        this.updateBoardEditButton();
        this.renderTabs(boards, currentBoard);
        this.renderBoard(currentBoard);
    }

    updateBoardEditButton() {
        const hasBoard = Boolean(this.currentBoard);
        this.editBoardBtn.disabled = !hasBoard;
        this.editBoardBtn.setAttribute('aria-pressed', String(this.boardEditMode));
        this.editBoardLabel.textContent = this.boardEditMode ? 'Done editing' : 'Edit board';
    }

    isKanbanTabActive() {
        return this.kanbanTab.style.display !== 'none';
    }

    handleKanbanKeyboardShortcuts(event) {
        if (!this.isKanbanTabActive()) return false;
        if (document.querySelector('.modal.show')) return false;
        if (this.isTypingTarget(event.target)) return false;

        const key = event.key;
        const isArrowKey = key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight';
        if (!isArrowKey) return false;

        if (event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            if (key === 'ArrowUp') this.moveSelectedKanbanCardInColumn(-1);
            if (key === 'ArrowDown') this.moveSelectedKanbanCardInColumn(1);
            if (key === 'ArrowLeft') this.moveSelectedKanbanCardToAdjacentColumn(-1);
            if (key === 'ArrowRight') this.moveSelectedKanbanCardToAdjacentColumn(1);
            return true;
        }

        if (!event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            if (key === 'ArrowUp') this.moveKanbanSelectionVertical(-1);
            if (key === 'ArrowDown') this.moveKanbanSelectionVertical(1);
            if (key === 'ArrowLeft') this.moveKanbanSelectionHorizontal(-1);
            if (key === 'ArrowRight') this.moveKanbanSelectionHorizontal(1);
            return true;
        }

        return false;
    }

    shouldIgnoreGlobalShortcut(event) {
        if (event.ctrlKey || event.metaKey || event.altKey) return true;
        if (document.querySelector('.modal.show')) return true;
        return this.isTypingTarget(event.target);
    }

    isTypingTarget(target) {
        if (!target) return false;
        if (target.isContentEditable) return true;
        const tagName = target.tagName;
        return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
    }

    openQuickAddCardModal() {
        const board = this.data.getCurrentBoard();
        if (!board || !Array.isArray(board.columns) || board.columns.length === 0) return;

        const preferredColumn = board.columns.find(column => column.title.trim().toLowerCase() !== 'done') || board.columns[0];
        if (!preferredColumn) return;

        document.getElementById('cardTitleInput').value = '';
        document.getElementById('cardDescriptionInput').value = '';
        this.cardModal.dataset.columnId = preferredColumn.id;
        this.populateTagSelect('cardTagInput');
        this.cardModal.classList.add('show');
        document.getElementById('cardTitleInput').focus();
    }

    ensureValidKanbanSelection(selectTopLeft = false) {
        const board = this.data.getCurrentBoard();
        if (!board || !Array.isArray(board.columns)) {
            this.selectedKanbanCardId = null;
            this.selectedKanbanColumnId = null;
            return;
        }

        const firstSelectable = this.getFirstKanbanCardPosition(board);
        if (!firstSelectable) {
            this.selectedKanbanCardId = null;
            this.selectedKanbanColumnId = null;
            this.applyKanbanSelection();
            return;
        }

        const currentPosition = this.getSelectedKanbanPosition(board);
        if (selectTopLeft || !currentPosition) {
            this.selectedKanbanCardId = firstSelectable.card.id;
            this.selectedKanbanColumnId = firstSelectable.column.id;
        }

        this.applyKanbanSelection();
    }

    getFirstKanbanCardPosition(board) {
        for (let colIndex = 0; colIndex < board.columns.length; colIndex += 1) {
            const column = board.columns[colIndex];
            if (!column.cards || column.cards.length === 0) continue;
            return { colIndex, cardIndex: 0, column, card: column.cards[0] };
        }
        return null;
    }

    getSelectedKanbanPosition(board = this.data.getCurrentBoard()) {
        if (!board || !Array.isArray(board.columns) || !this.selectedKanbanCardId) return null;

        for (let colIndex = 0; colIndex < board.columns.length; colIndex += 1) {
            const column = board.columns[colIndex];
            const cardIndex = (column.cards || []).findIndex(card => card.id === this.selectedKanbanCardId);
            if (cardIndex !== -1) {
                return {
                    colIndex,
                    cardIndex,
                    column,
                    card: column.cards[cardIndex]
                };
            }
        }
        return null;
    }

    applyKanbanSelection() {
        const cards = this.boardContainerEl.querySelectorAll('.card');
        cards.forEach((cardEl) => {
            const isSelected = cardEl.dataset.cardId === this.selectedKanbanCardId;
            cardEl.classList.toggle('selected-card', isSelected);
            cardEl.setAttribute('tabindex', isSelected ? '0' : '-1');
        });
    }

    focusSelectedKanbanCard() {
        const selectedEl = this.boardContainerEl.querySelector('.card.selected-card');
        if (!selectedEl) return;
        selectedEl.focus();
        selectedEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    setSelectedKanbanCard(columnId, cardId, shouldFocus = false) {
        this.selectedKanbanColumnId = columnId;
        this.selectedKanbanCardId = cardId;
        this.applyKanbanSelection();
        if (shouldFocus) this.focusSelectedKanbanCard();
    }

    moveKanbanSelectionVertical(step) {
        const board = this.data.getCurrentBoard();
        const position = this.getSelectedKanbanPosition(board) || this.getFirstKanbanCardPosition(board);
        if (!position) return;

        const cards = position.column.cards || [];
        if (cards.length === 0) return;
        const nextIndex = (position.cardIndex + step + cards.length) % cards.length;
        const nextCard = cards[nextIndex];
        this.setSelectedKanbanCard(position.column.id, nextCard.id, true);
    }

    moveKanbanSelectionHorizontal(step) {
        const board = this.data.getCurrentBoard();
        const position = this.getSelectedKanbanPosition(board) || this.getFirstKanbanCardPosition(board);
        if (!position) return;

        const totalColumns = board.columns.length;
        for (let offset = 1; offset <= totalColumns; offset += 1) {
            const candidateIndex = (position.colIndex + (step * offset) + totalColumns) % totalColumns;
            const candidateColumn = board.columns[candidateIndex];
            if (!candidateColumn.cards || candidateColumn.cards.length === 0) continue;
            const nextCardIndex = Math.min(position.cardIndex, candidateColumn.cards.length - 1);
            const nextCard = candidateColumn.cards[nextCardIndex];
            this.setSelectedKanbanCard(candidateColumn.id, nextCard.id, true);
            return;
        }
    }

    moveSelectedKanbanCardInColumn(step) {
        const board = this.data.getCurrentBoard();
        const position = this.getSelectedKanbanPosition(board);
        if (!position) return;

        const destinationIndex = position.cardIndex + step;
        if (destinationIndex < 0 || destinationIndex >= position.column.cards.length) return;

        this.selectedKanbanColumnId = position.column.id;
        this.selectedKanbanCardId = position.card.id;
        this.data.moveCard(board.id, position.column.id, position.column.id, position.card.id, destinationIndex);
    }

    moveSelectedKanbanCardToAdjacentColumn(step) {
        const board = this.data.getCurrentBoard();
        const position = this.getSelectedKanbanPosition(board);
        if (!position) return;

        const destinationColIndex = position.colIndex + step;
        if (destinationColIndex < 0 || destinationColIndex >= board.columns.length) return;

        const destinationColumn = board.columns[destinationColIndex];
        const destinationIndex = Math.min(position.cardIndex, destinationColumn.cards.length);

        this.selectedKanbanColumnId = destinationColumn.id;
        this.selectedKanbanCardId = position.card.id;
        this.data.moveCard(board.id, position.column.id, destinationColumn.id, position.card.id, destinationIndex);
    }

    openEditSelectedKanbanCardModal() {
        const board = this.data.getCurrentBoard();
        const position = this.getSelectedKanbanPosition(board);
        if (!board || !position) return;
        this.openEditModal(board.id, position.column.id, position.card.id);
    }

    openQuickAddTodoModal() {
        document.getElementById('todoTitleInput').value = '';
        document.getElementById('todoDueDateInput').value = '';
        this.addTodoModal.classList.add('show');
        document.getElementById('todoTitleInput').focus();
    }

    moveTodoSelection(direction) {
        const todoItems = this.getVisibleTodoItems();
        if (todoItems.length === 0) return;

        const currentIndex = todoItems.findIndex(item => item.dataset.todoId === this.selectedTodoId);
        const baseIndex = currentIndex === -1 ? (direction > 0 ? 0 : todoItems.length - 1) : currentIndex;
        const nextIndex = Math.max(0, Math.min(todoItems.length - 1, baseIndex + direction));
        const nextTodoId = todoItems[nextIndex]?.dataset.todoId;
        if (!nextTodoId) return;

        this.selectedTodoId = nextTodoId;
        this.applyTodoSelection();
        todoItems[nextIndex].scrollIntoView({ block: 'nearest' });
    }

    openQuickAddSubtodoModalForSelected() {
        const selectedTodoId = this.selectedTodoId;
        if (!selectedTodoId) return;

        const todo = this.data.getTodos().find(t => t.id === selectedTodoId);
        if (!todo) return;

        document.getElementById('subtodoParentTitle').textContent = todo.title;
        document.getElementById('subtodoTitleInput').value = '';
        document.getElementById('subtodoDueDateInput').value = '';
        this.addSubtodoModal.dataset.todoId = selectedTodoId;
        this.addSubtodoModal.classList.add('show');
        document.getElementById('subtodoTitleInput').focus();
    }

    openEditSelectedTodoModal() {
        const selectedTodoId = this.selectedTodoId;
        if (!selectedTodoId) return;

        const todo = this.data.getTodos().find(t => t.id === selectedTodoId);
        if (!todo) return;

        this.editingTodoId = selectedTodoId;
        document.getElementById('editTodoTitleInput').value = todo.title;
        document.getElementById('editTodoDueDateInput').value = todo.dueDate || '';
        this.editTodoModal.classList.add('show');
        document.getElementById('editTodoTitleInput').focus();
        document.getElementById('editTodoTitleInput').select();
    }

    moveSelectedTodoInSection(step) {
        if (!this.selectedTodoId) return;

        const todos = this.data.getTodos();
        const selectedTodo = todos.find(todo => todo.id === this.selectedTodoId);
        if (!selectedTodo) return;

        const section = selectedTodo.completed ? 'completed' : 'active';
        const sectionTodos = todos.filter(todo => section === 'completed' ? todo.completed : !todo.completed);
        const currentIndex = sectionTodos.findIndex(todo => todo.id === this.selectedTodoId);
        if (currentIndex === -1) return;

        const targetIndex = currentIndex + step;
        if (targetIndex < 0 || targetIndex >= sectionTodos.length) return;

        const orderedIds = sectionTodos.map(todo => todo.id);
        const [movedId] = orderedIds.splice(currentIndex, 1);
        orderedIds.splice(targetIndex, 0, movedId);
        this.data.reorderTodosBySection(section, orderedIds);
    }

    toggleSelectedTodoCompletion() {
        if (!this.selectedTodoId) return;
        this.data.toggleTodo(this.selectedTodoId);
    }

    getVisibleTodoItems() {
        return Array.from(this.todoListEl.querySelectorAll('.todo-item'));
    }

    applyTodoSelection() {
        const todoItems = this.getVisibleTodoItems();
        todoItems.forEach(item => {
            const isSelected = item.dataset.todoId === this.selectedTodoId;
            item.classList.toggle('selected-todo', isSelected);
            item.setAttribute('tabindex', isSelected ? '0' : '-1');
        });
    }

    ensureValidTodoSelection() {
        const todoItems = this.getVisibleTodoItems();
        if (todoItems.length === 0) {
            this.selectedTodoId = null;
            return;
        }

        const exists = todoItems.some(item => item.dataset.todoId === this.selectedTodoId);
        if (!exists) {
            this.selectedTodoId = todoItems[0].dataset.todoId;
        }
        this.applyTodoSelection();
    }

    cancelAndCloseModals() {
        this.closeTagColorPopup();
        document.querySelectorAll('.modal.show').forEach(modal => modal.classList.remove('show'));

        this.editingCardId = null;
        this.editingColumnId = null;
        this.editingTodoId = null;
        this.editingSubtodoTodoId = null;
        this.editingSubtodoId = null;

        const fieldIds = [
            'columnTitleInput',
            'cardTitleInput',
            'cardDescriptionInput',
            'todoTitleInput',
            'todoDueDateInput',
            'subtodoTitleInput',
            'subtodoDueDateInput',
            'editTodoTitleInput',
            'editTodoDueDateInput',
            'editSubtodoTitleInput',
            'editSubtodoDueDateInput',
            'editCardTitleInput',
            'editCardDescriptionInput'
        ];

        fieldIds.forEach((id) => {
            const element = document.getElementById(id);
            if (element) element.value = '';
        });

        if (this.addSubtodoModal) delete this.addSubtodoModal.dataset.todoId;
        if (this.cardModal) delete this.cardModal.dataset.columnId;
    }

    populateTagSelect(selectId, selectedTagIds = []) {
        const select = document.getElementById(selectId);
        const tags = this.data.getCurrentBoard()?.tags || [];
        const selectedIds = Array.isArray(selectedTagIds) ? selectedTagIds : [selectedTagIds];
        select.dataset.selectedTagIds = JSON.stringify(selectedIds);
        select.innerHTML = '<option value="">Add a tag...</option>';
        tags.filter(tag => !selectedIds.includes(tag.id)).forEach(tag => {
            const option = document.createElement('option');
            option.value = tag.id;
            option.textContent = tag.name;
            select.appendChild(option);
        });
        this.renderSelectedTags(selectId);
        select.onchange = () => {
            if (!select.value) return;
            const updatedIds = [...this.getSelectedTagIds(selectId), select.value];
            this.populateTagSelect(selectId, updatedIds);
        };
    }

    getSelectedTagIds(selectId) {
        const select = document.getElementById(selectId);
        try {
            return JSON.parse(select.dataset.selectedTagIds || '[]');
        } catch {
            return [];
        }
    }

    renderSelectedTags(selectId) {
        const selectedTagsEl = document.getElementById(
            selectId === 'cardTagInput' ? 'cardSelectedTags' : 'editCardSelectedTags'
        );
        const tags = this.data.getCurrentBoard()?.tags || [];
        const selectedIds = this.getSelectedTagIds(selectId);
        selectedTagsEl.innerHTML = tags.filter(tag => selectedIds.includes(tag.id)).map(tag => `
            <span class="task-tag" data-tag-color="${normalizeTagColor(tag.color)}">
                ${this.escapeHtml(tag.name)}
                <button type="button" data-tag-id="${tag.id}" title="Remove ${this.escapeHtml(tag.name)}">${this.icons.close}</button>
            </span>
        `).join('');
        selectedTagsEl.querySelectorAll('button').forEach(button => {
            button.addEventListener('click', () => {
                this.populateTagSelect(
                    selectId,
                    this.getSelectedTagIds(selectId).filter(id => id !== button.dataset.tagId)
                );
            });
        });
    }

    renderTagDefinitions() {
        const list = document.getElementById('tagDefinitionList');
        const board = this.data.getCurrentBoard();
        const tags = board?.tags || [];
        list.innerHTML = tags.length
            ? tags.map(tag => `
                <div class="tag-definition">
                    <span class="task-tag" data-tag-color="${normalizeTagColor(tag.color)}">${this.escapeHtml(tag.name)}</span>
                    <button class="delete-tag-btn" data-tag-id="${tag.id}" title="Remove tag">${this.icons.close}</button>
                </div>
            `).join('')
            : '<p class="tag-empty">No tags defined yet.</p>';
        list.querySelectorAll('.delete-tag-btn').forEach(button => {
            button.addEventListener('click', () => {
                this.data.deleteTag(board.id, button.dataset.tagId);
                this.renderTagDefinitions();
            });
        });
    }

    // Paint the compact trigger with the currently selected preset.
    renderTagColorTrigger() {
        const trigger = document.getElementById('tagColorTrigger');
        const selected = normalizeTagColor(this.selectedTagColor);
        trigger.dataset.tagColor = selected;
        const entry = TAG_COLORS.find(item => item.key === selected);
        trigger.title = `Color: ${entry ? entry.label : selected}`;
    }

    // Build the 16-swatch preset grid. `selectedColor` highlights the active
    // choice; picking a swatch closes the popup.
    renderTagColorPicker() {
        const picker = document.getElementById('tagColorPicker');
        const selected = normalizeTagColor(this.selectedTagColor);
        picker.innerHTML = TAG_COLORS.map(entry => `
            <button
                type="button"
                class="tag-color-swatch${entry.key === selected ? ' selected' : ''}"
                data-tag-color="${entry.key}"
                role="radio"
                aria-checked="${entry.key === selected ? 'true' : 'false'}"
                title="${entry.label}"
                aria-label="${entry.label}"
            ></button>
        `).join('');
        picker.querySelectorAll('.tag-color-swatch').forEach(swatch => {
            swatch.addEventListener('click', () => {
                this.selectedTagColor = swatch.dataset.tagColor;
                this.renderTagColorTrigger();
                this.closeTagColorPopup();
                // Return focus to the trigger so keyboard flow is preserved.
                document.getElementById('tagColorTrigger').focus();
            });
        });
    }

    // Popup geometry: prefer opening below the trigger, flip above when there
    // isn't room, and clamp horizontally so it never leaves the viewport.
    openTagColorPopup() {
        const trigger = document.getElementById('tagColorTrigger');
        const popup = document.getElementById('tagColorPopup');
        this.renderTagColorPicker();
        popup.hidden = false;

        const margin = 8;
        const triggerRect = trigger.getBoundingClientRect();
        const popupRect = popup.getBoundingClientRect();

        const spaceBelow = window.innerHeight - triggerRect.bottom;
        const openUpward = spaceBelow < popupRect.height + margin && triggerRect.top > popupRect.height + margin;
        let top = openUpward
            ? triggerRect.top - popupRect.height - margin
            : triggerRect.bottom + margin;
        top = Math.max(margin, Math.min(top, window.innerHeight - popupRect.height - margin));

        let left = triggerRect.left;
        left = Math.max(margin, Math.min(left, window.innerWidth - popupRect.width - margin));

        popup.style.top = `${Math.round(top)}px`;
        popup.style.left = `${Math.round(left)}px`;
        trigger.setAttribute('aria-expanded', 'true');
    }

    closeTagColorPopup() {
        const popup = document.getElementById('tagColorPopup');
        popup.hidden = true;
        const trigger = document.getElementById('tagColorTrigger');
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
    }

    isTagColorPopupOpen() {
        const popup = document.getElementById('tagColorPopup');
        return popup ? !popup.hidden : false;
    }

    renderTabs(boards, currentBoard) {
        this.boardTabsEl.innerHTML = '';
        boards.forEach(board => {
            const tab = document.createElement('div');
            tab.className = 'board-tab' + (board.id === currentBoard.id ? ' active' : '');
            tab.innerHTML = `
            ${board.title}
            <span class="delete-board" data-board-id="${board.id}">×</span>
            `;
            tab.addEventListener('click', (e) => {
                if (e.target.classList.contains('delete-board')) return;
                this.data.setCurrentBoard(board.id);
            });

            const deleteBtn = tab.querySelector('.delete-board');
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm(`Delete board "${board.title}"?`)) {
                    this.data.deleteBoard(board.id);
                }
            });

            this.boardTabsEl.appendChild(tab);
        });
    }

    renderBoard(board) {
        if (!board) {
            this.boardContainerEl.innerHTML = `
            <div class="empty-state">
            <div class="emoji">${this.icons.board}</div>
            <p>No boards yet. Click "Add Board" to get started!</p>
            </div>
            `;
            return;
        }

        this.boardContainerEl.innerHTML = '';
        const boardEl = document.createElement('div');
        boardEl.className = 'board';
        boardEl.dataset.boardId = board.id;

        board.columns.forEach((column, index) => {
            const colEl = this.createColumnElement(board, column, index);
            boardEl.appendChild(colEl);
        });

        if (this.boardEditMode) {
            const addColBtn = document.createElement('div');
            addColBtn.className = 'column add-column';
            addColBtn.innerHTML = `${this.icons.add} Add Column`;
            addColBtn.addEventListener('click', () => {
                this.columnModal.classList.add('show');
                document.getElementById('columnTitleInput').focus();
            });

            boardEl.appendChild(addColBtn);
        }
        this.boardContainerEl.appendChild(boardEl);
        this.setupDragDrop(board);
        this.setupColumnDragDrop(board);
        this.ensureValidKanbanSelection();
    }

    createColumnElement(board, column, index = 0) {
        const colEl = document.createElement('div');
        colEl.className = 'column';
        colEl.dataset.columnId = column.id;
        colEl.dataset.boardId = board.id;
        // Cycle the Halliburton accent palette so columns are visually distinct.
        colEl.dataset.accent = String(index % 6);

        colEl.innerHTML = `
        <div class="column-header${this.boardEditMode ? ' draggable-column-header' : ''}" ${this.boardEditMode ? 'draggable="true"' : ''}>
        <h3><span class="column-dot"></span>${column.title} <span class="card-count">(${column.cards.length})</span></h3>
        <div class="column-actions">
        <button class="add-card-btn" title="Add Card">${this.icons.add}</button>
        <button class="clear-column-btn" title="Clear all cards">${this.icons.eraser}</button>
        ${this.boardEditMode && column.title.trim().toLowerCase() !== 'done' ? `<button class="delete-column-btn" title="Delete Column">${this.icons.trash}</button>` : ''}
        </div>
        </div>
        <div class="cards-container" data-column-id="${column.id}">
        ${column.cards.map(card => this.createCardHTML(card, column.id, column.title.trim().toLowerCase() === 'done', board.tags || [])).join('')}
        </div>
        `;

        colEl.querySelector('.add-card-btn').addEventListener('click', () => {
            this.cardModal.dataset.columnId = column.id;
            this.populateTagSelect('cardTagInput');
            this.cardModal.classList.add('show');
            document.getElementById('cardTitleInput').focus();
        });

        colEl.querySelector('.clear-column-btn').addEventListener('click', () => {
            if (column.cards.length === 0) return;
            if (confirm(`Clear all ${column.cards.length} cards from "${column.title}"?`)) {
                this.data.clearColumn(board.id, column.id);
            }
        });

        const deleteColumnBtn = colEl.querySelector('.delete-column-btn');
        if (deleteColumnBtn) {
            deleteColumnBtn.addEventListener('click', () => {
                if (confirm(`Delete column "${column.title}" and all its cards?`)) {
                    this.data.deleteColumn(board.id, column.id);
                }
            });
        }

        colEl.querySelectorAll('.card-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const cardId = btn.dataset.cardId;
                if (confirm('Delete this card?')) {
                    this.data.deleteCard(board.id, column.id, cardId);
                }
            });
        });

        colEl.querySelectorAll('.card-edit').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const cardId = btn.dataset.cardId;
                this.openEditModal(board.id, column.id, cardId);
            });
        });

        colEl.querySelectorAll('.card').forEach(cardEl => {
            cardEl.addEventListener('click', (e) => {
                if (e.target.closest('.card-actions')) return;
                this.setSelectedKanbanCard(column.id, cardEl.dataset.cardId, true);
            });

            cardEl.addEventListener('dblclick', (e) => {
                if (e.target.closest('.card-delete')) return;
                const cardId = cardEl.dataset.cardId;
                this.setSelectedKanbanCard(column.id, cardId, false);
                this.openEditModal(board.id, column.id, cardId);
            });
        });

        return colEl;
    }

    createCardHTML(card, columnId, isComplete, tags) {
        const hasDescription = card.description && card.description.trim().length > 0;
        const updatedInfo = card.updatedAt ? `Updated: ${new Date(card.updatedAt).toLocaleString()}` : '';
        const tagIds = card.tagIds || (card.tagId ? [card.tagId] : []);
        const taskTags = tags.filter(tag => tagIds.includes(tag.id));

        return `
        <div class="card${isComplete ? ' completed' : ''}" draggable="true" data-card-id="${card.id}" data-column-id="${columnId}">
        <div class="card-actions">
        <button class="card-edit" data-card-id="${card.id}" title="Edit card">${this.icons.edit}</button>
        <button class="card-delete" data-card-id="${card.id}" title="Delete card">${this.icons.close}</button>
        </div>
        <div class="card-title">${this.escapeHtml(card.title)}</div>
        ${taskTags.map(tag => `<span class="task-tag" data-tag-color="${normalizeTagColor(tag.color)}">${this.escapeHtml(tag.name)}</span>`).join('')}
        ${hasDescription ? `<div class="card-description">${this.escapeHtml(card.description)}</div>` : ''}
        ${updatedInfo ? `<div class="card-meta">${updatedInfo}</div>` : ''}
        </div>
        `;
    }

    openEditModal(boardId, columnId, cardId) {
        const board = this.data.getCurrentBoard();
        const column = board.columns.find(c => c.id === columnId);
        if (!column) return;
        const card = column.cards.find(c => c.id === cardId);
        if (!card) return;

        this.editingCardId = cardId;
        this.editingColumnId = columnId;

        document.getElementById('editCardTitleInput').value = card.title || '';
        document.getElementById('editCardDescriptionInput').value = card.description || '';
        this.populateTagSelect('editCardTagInput', card.tagIds || (card.tagId ? [card.tagId] : []));
        this.editCardModal.classList.add('show');
        document.getElementById('editCardTitleInput').focus();
        document.getElementById('editCardTitleInput').select();
    }

    // ============ TODO RENDER ============
    renderTodos(shouldFocusSelection = false) {
        const todos = this.data.getTodos();
        if (!todos || todos.length === 0) {
            this.todoListEl.innerHTML = `
            <div class="todo-empty">
            <div class="emoji">${this.icons.clipboard}</div>
            <p>No todos yet. Click "Add Todo" to get started!</p>
            </div>
            `;
            return;
        }

        const total = todos.length;
        const completedTodos = todos.filter(t => t.completed);
        const activeTodos = todos.filter(t => !t.completed);
        const completed = completedTodos.length;
        const totalSubtasks = todos.reduce((sum, t) => sum + (t.subtodos || []).length, 0);
        const completedSubtasks = todos.reduce((sum, t) => sum + (t.subtodos || []).filter(s => s.completed).length, 0);

        let html = `
        <div class="todo-stats">
        <span>${this.icons.stats} Total: <span class="stat-number">${total}</span></span>
        <span>${this.icons.check} Completed: <span class="stat-number">${completed}</span></span>
        <span>${this.icons.clipboard} Subtasks: <span class="stat-number">${completedSubtasks}/${totalSubtasks}</span></span>
        </div>
        `;

        html += `
        <section class="todo-section">
        <div class="todo-section-header">
        <h3>Open <span class="todo-section-count">${activeTodos.length}</span></h3>
        </div>
        <div class="todo-items" data-section="active">
        `;

        if (activeTodos.length === 0) {
            html += `<p class="todo-section-empty">No open todos.</p>`;
        }

        activeTodos.forEach(todo => {
            html += this.createTodoHTML(todo);
        });

        html += `</div></section>`;

        html += `
        <section class="todo-section completed-section">
        <div class="todo-section-header">
        <button class="todo-section-toggle" id="toggleCompletedBtn" type="button" aria-expanded="${this.showCompletedTodos ? 'true' : 'false'}">
        <span class="todo-section-title">Completed <span class="todo-section-count">${completedTodos.length}</span></span>
        <span class="todo-section-toggle-icon">${this.showCompletedTodos ? this.icons.chevronUp : this.icons.chevronDown}</span>
        </button>
        <button class="todo-clear-completed" id="clearCompletedBtn" type="button" ${completedTodos.length === 0 ? 'disabled' : ''}>Clear all</button>
        </div>
        `;

        if (this.showCompletedTodos) {
            html += `<div class="todo-items" data-section="completed">`;
            if (completedTodos.length === 0) {
                html += `<p class="todo-section-empty">No completed todos yet.</p>`;
            } else {
                completedTodos.forEach(todo => {
                    html += this.createTodoHTML(todo);
                });
            }
            html += `</div>`;
        }

        html += `</section>`;

        this.todoListEl.innerHTML = html;
        this.setupTodoEventListeners();
        this.ensureValidTodoSelection();
        if (shouldFocusSelection) this.focusSelectedTodo();
    }

    focusSelectedTodo() {
        const selected = this.todoListEl.querySelector('.todo-item.selected-todo');
        if (selected) selected.focus();
    }

    createTodoHTML(todo) {
        const isCompleted = todo.completed;
        const subtodos = todo.subtodos || [];
        const hasSubtodos = subtodos.length > 0;
        const dueDateText = this.formatDueDate(todo.dueDate);
        const isTodoOverdue = this.isOverdue(todo.dueDate, isCompleted);

        let html = `
        <div class="todo-item ${isCompleted ? 'completed' : ''}" draggable="true" data-todo-id="${todo.id}">
        <div class="todo-main">
        <input type="checkbox" class="todo-checkbox" ${isCompleted ? 'checked' : ''} />
        <div class="todo-content">
        <div class="todo-title">${this.escapeHtml(todo.title)}</div>
        ${dueDateText ? `<div class="todo-due${isTodoOverdue ? ' overdue' : ''}">Due ${this.escapeHtml(dueDateText)}</div>` : ''}
        </div>
        <div class="todo-actions">
        <button class="todo-add-sub" title="Add subtask">${this.icons.add}</button>
        <button class="todo-edit" title="Edit todo">${this.icons.edit}</button>
        <button class="todo-delete" title="Delete todo">${this.icons.trash}</button>
        </div>
        </div>
        `;

        if (hasSubtodos) {
            html += `<div class="subtodos">`;
            subtodos.forEach(sub => {
                const subDueDateText = this.formatDueDate(sub.dueDate);
                const isSubtodoOverdue = this.isOverdue(sub.dueDate, sub.completed);
                const isPendingUnderCompletedParent = isCompleted && !sub.completed;
                html += `
                <div class="subtodo-item ${sub.completed ? 'completed' : ''} ${isPendingUnderCompletedParent ? 'pending-parent-complete' : ''}" data-subtodo-id="${sub.id}">
                <input type="checkbox" class="subtodo-checkbox" ${sub.completed ? 'checked' : ''} />
                ${isPendingUnderCompletedParent ? `<span class="subtodo-parent-indicator" title="Parent todo is completed but this subtask is still open">${this.icons.close}</span>` : ''}
                <div class="subtodo-content">
                <span class="subtodo-title">${this.escapeHtml(sub.title)}</span>
                ${subDueDateText ? `<div class="subtodo-due${isSubtodoOverdue ? ' overdue' : ''}">Due ${this.escapeHtml(subDueDateText)}</div>` : ''}
                </div>
                <div class="subtodo-actions">
                <button class="subtodo-edit" title="Edit subtask">${this.icons.edit}</button>
                <button class="subtodo-delete" title="Delete subtask">${this.icons.trash}</button>
                </div>
                </div>
                `;
            });
            html += `</div>`;
        }

        html += `</div>`;
        return html;
    }

    setupTodoEventListeners() {
        const completedToggle = document.getElementById('toggleCompletedBtn');
        if (completedToggle) {
            completedToggle.addEventListener('click', () => {
                this.showCompletedTodos = !this.showCompletedTodos;
                this.renderTodos();
            });
        }

        const clearCompletedBtn = document.getElementById('clearCompletedBtn');
        if (clearCompletedBtn) {
            clearCompletedBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!confirm('Clear all completed todos? This cannot be undone.')) return;
                this.data.clearCompletedTodos();
            });
        }

        // Todo checkbox toggle
        document.querySelectorAll('.todo-checkbox').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const todoItem = e.target.closest('.todo-item');
                const todoId = todoItem.dataset.todoId;
                this.data.toggleTodo(todoId);
            });
        });

        // Subtodo checkbox toggle
        document.querySelectorAll('.subtodo-checkbox').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const subtodoItem = e.target.closest('.subtodo-item');
                const todoItem = e.target.closest('.todo-item');
                const todoId = todoItem.dataset.todoId;
                const subtodoId = subtodoItem.dataset.subtodoId;
                this.data.toggleSubtodo(todoId, subtodoId);
            });
        });

        // Add subtodo
        document.querySelectorAll('.todo-add-sub').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const todoItem = e.target.closest('.todo-item');
                const todoId = todoItem.dataset.todoId;
                this.selectedTodoId = todoId;
                const todo = this.data.getTodos().find(t => t.id === todoId);
                if (todo) {
                    document.getElementById('subtodoParentTitle').textContent = todo.title;
                    this.addSubtodoModal.dataset.todoId = todoId;
                    document.getElementById('subtodoDueDateInput').value = '';
                    this.addSubtodoModal.classList.add('show');
                    document.getElementById('subtodoTitleInput').focus();
                }
            });
        });

        // Edit todo
        document.querySelectorAll('.todo-edit').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const todoItem = e.target.closest('.todo-item');
                const todoId = todoItem.dataset.todoId;
                const todo = this.data.getTodos().find(t => t.id === todoId);
                if (todo) {
                    this.editingTodoId = todoId;
                    document.getElementById('editTodoTitleInput').value = todo.title;
                    document.getElementById('editTodoDueDateInput').value = todo.dueDate || '';
                    this.editTodoModal.classList.add('show');
                    document.getElementById('editTodoTitleInput').focus();
                    document.getElementById('editTodoTitleInput').select();
                }
            });
        });

        // Delete todo
        document.querySelectorAll('.todo-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const todoItem = e.target.closest('.todo-item');
                const todoId = todoItem.dataset.todoId;
                if (confirm('Delete this todo and all its subtasks?')) {
                    this.data.deleteTodo(todoId);
                }
            });
        });

        // Edit subtodo
        document.querySelectorAll('.subtodo-edit').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const subtodoItem = e.target.closest('.subtodo-item');
                const todoItem = e.target.closest('.todo-item');
                const todoId = todoItem.dataset.todoId;
                const subtodoId = subtodoItem.dataset.subtodoId;
                const todo = this.data.getTodos().find(t => t.id === todoId);
                if (todo) {
                    const subtodo = todo.subtodos.find(s => s.id === subtodoId);
                    if (subtodo) {
                        this.editingSubtodoTodoId = todoId;
                        this.editingSubtodoId = subtodoId;
                        document.getElementById('editSubtodoTitleInput').value = subtodo.title;
                        document.getElementById('editSubtodoDueDateInput').value = subtodo.dueDate || '';
                        this.editSubtodoModal.classList.add('show');
                        document.getElementById('editSubtodoTitleInput').focus();
                        document.getElementById('editSubtodoTitleInput').select();
                    }
                }
            });
        });

        // Delete subtodo
        document.querySelectorAll('.subtodo-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const subtodoItem = e.target.closest('.subtodo-item');
                const todoItem = e.target.closest('.todo-item');
                const todoId = todoItem.dataset.todoId;
                const subtodoId = subtodoItem.dataset.subtodoId;
                if (confirm('Delete this subtask?')) {
                    this.data.deleteSubtodo(todoId, subtodoId);
                }
            });
        });

        // Click on todo title to toggle (convenience)
        document.querySelectorAll('.todo-title').forEach(title => {
            title.addEventListener('click', () => {
                const todoItem = title.closest('.todo-item');
                const checkbox = todoItem.querySelector('.todo-checkbox');
                if (checkbox) {
                    checkbox.checked = !checkbox.checked;
                    checkbox.dispatchEvent(new Event('change'));
                }
            });
        });

        document.querySelectorAll('.todo-item').forEach(todoItem => {
            todoItem.addEventListener('click', () => {
                this.selectedTodoId = todoItem.dataset.todoId;
                this.applyTodoSelection();
            });
        });

        this.setupTodoDragDrop();
    }

    setupTodoDragDrop() {
        let draggedItem = null;
        let draggedSection = null;

        document.querySelectorAll('.todo-item').forEach(item => {
            item.addEventListener('dragstart', (e) => {
                draggedItem = item;
                draggedSection = item.closest('.todo-items')?.dataset.section || null;
                item.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', item.dataset.todoId);
            });

            item.addEventListener('dragend', () => {
                item.classList.remove('dragging');
                document.querySelectorAll('.todo-items.drag-over').forEach(container => {
                    container.classList.remove('drag-over');
                });
                draggedItem = null;
                draggedSection = null;
            });
        });

        document.querySelectorAll('.todo-items').forEach(container => {
            container.addEventListener('dragover', (e) => {
                const section = container.dataset.section;
                if (!draggedItem || section !== draggedSection) return;
                e.preventDefault();
                container.classList.add('drag-over');

                const insertBefore = this.getTodoDragInsertBefore(container, e.clientY);
                if (!insertBefore) {
                    container.appendChild(draggedItem);
                } else {
                    container.insertBefore(draggedItem, insertBefore);
                }
            });

            container.addEventListener('dragleave', () => {
                container.classList.remove('drag-over');
            });

            container.addEventListener('drop', (e) => {
                const section = container.dataset.section;
                if (!draggedItem || section !== draggedSection) return;
                e.preventDefault();
                container.classList.remove('drag-over');

                const orderedIds = Array.from(container.querySelectorAll('.todo-item')).map(item => item.dataset.todoId);
                this.data.reorderTodosBySection(section, orderedIds);
            });
        });
    }

    getTodoDragInsertBefore(container, yPosition) {
        const items = Array.from(container.querySelectorAll('.todo-item:not(.dragging)'));
        return items.find((item) => {
            const rect = item.getBoundingClientRect();
            return yPosition < rect.top + rect.height / 2;
        }) || null;
    }

    // ============ DRAG AND DROP ============
    setupDragDrop(board) {
        const cards = document.querySelectorAll('.card');
        const containers = document.querySelectorAll('.cards-container');

        cards.forEach(card => {
            card.addEventListener('dragstart', (e) => {
                this.draggedCard = card.dataset.cardId;
                this.draggedFromColumn = card.dataset.columnId;
                this.draggedCardElement = card;
                card.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', card.dataset.cardId);
            });

            card.addEventListener('dragend', () => {
                card.classList.remove('dragging');
                document.querySelectorAll('.cards-container.drag-over').forEach(el => {
                    el.classList.remove('drag-over');
                });
                this.draggedCard = null;
                this.draggedFromColumn = null;
                this.draggedCardElement = null;
                this.render();
            });
        });

        containers.forEach(container => {
            container.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                container.classList.add('drag-over');

                const draggedCard = this.draggedCardElement;
                if (!draggedCard) return;

                const targetCards = Array.from(container.querySelectorAll('.card:not(.dragging)'));
                const insertBefore = targetCards.find(card => {
                    const rect = card.getBoundingClientRect();
                    return e.clientY < rect.top + rect.height / 2;
                });

                if (insertBefore) {
                    container.insertBefore(draggedCard, insertBefore);
                } else {
                    container.appendChild(draggedCard);
                }
            });

            container.addEventListener('dragleave', () => {
                container.classList.remove('drag-over');
            });

            container.addEventListener('drop', (e) => {
                e.preventDefault();
                container.classList.remove('drag-over');

                const cardId = e.dataTransfer.getData('text/plain');
                const toColumnId = container.dataset.columnId;

                if (!cardId || !toColumnId || !this.draggedFromColumn) return;

                const boardId = board.id;
                const destinationIndex = Array.from(container.querySelectorAll('.card'))
                    .findIndex(card => card.dataset.cardId === cardId);

                this.data.moveCard(
                    boardId,
                    this.draggedFromColumn,
                    toColumnId,
                    cardId,
                    destinationIndex
                );
            });
        });
    }

    setupColumnDragDrop(board) {
        if (!this.boardEditMode) return;

        const boardEl = this.boardContainerEl.querySelector('.board');
        const columns = Array.from(boardEl.querySelectorAll('.column[data-column-id]'));

        columns.forEach(column => {
            const header = column.querySelector('.draggable-column-header');
            header.addEventListener('dragstart', (event) => {
                this.draggedColumn = column;
                column.classList.add('dragging-column');
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', column.dataset.columnId);
            });

            header.addEventListener('dragend', () => {
                column.classList.remove('dragging-column');
                this.draggedColumn = null;
                const columnIds = Array.from(boardEl.querySelectorAll('.column[data-column-id]'))
                    .map(item => item.dataset.columnId);
                this.data.reorderColumns(board.id, columnIds);
            });
        });

        boardEl.addEventListener('dragover', (event) => {
            if (!this.draggedColumn) return;
            event.preventDefault();
            const targetColumns = Array.from(boardEl.querySelectorAll('.column[data-column-id]:not(.dragging-column)'));
            const insertBefore = targetColumns.find(column => {
                const rect = column.getBoundingClientRect();
                return event.clientX < rect.left + rect.width / 2;
            });
            if (insertBefore) {
                boardEl.insertBefore(this.draggedColumn, insertBefore);
            } else {
                boardEl.appendChild(this.draggedColumn);
            }
        });
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    formatDueDate(dateValue) {
        if (!dateValue) return '';
        const parsed = new Date(`${dateValue}T00:00:00`);
        if (Number.isNaN(parsed.getTime())) return dateValue;
        return parsed.toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    }

    getTodayIsoDate() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    isOverdue(dateValue, isCompleted = false) {
        if (!dateValue || isCompleted) return false;
        const dueDate = new Date(`${dateValue}T00:00:00`);
        if (Number.isNaN(dueDate.getTime())) return false;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return dueDate < today;
    }

    icons = {
        // Edit / pencil
        edit: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>',
        // Delete / trash
        trash: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
        // Add / plus
        add: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
        // Broom / clear all
        broom: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 15-15"/><path d="m14 3 7 7"/><path d="m3 21 5-1 2-2-3-3-2 2z"/></svg>',
        // Eraser / clear all
        eraser: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 21-4-4a2 2 0 0 1 0-2.8l9.4-9.4a2 2 0 0 1 2.8 0l4 4a2 2 0 0 1 0 2.8L11 21z"/><path d="m5 12 7 7"/><path d="M16 21h5"/></svg>',
        // Close / x
        close: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
        // Bar chart
        stats: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>',
        // Checkmark
        check: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
        // Clipboard / list
        clipboard: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><line x1="9" y1="11" x2="15" y2="11"/><line x1="9" y1="15" x2="13" y2="15"/></svg>',
        chevronDown: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>',
        chevronUp: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><polyline points="18 15 12 9 6 15"/></svg>',
        board: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="18" rx="1"/><rect x="13" y="3" width="8" height="10" rx="1"/></svg>'
    };
}

// ============================================================
// AUTH + INIT
// ============================================================

const dataManager = new KanbanData();

// Small controller wired to #authModal in index.html.
// Exposed as window.CanbanAuth so the UI's logout button can reach it.
const AuthController = window.CanbanAuth = (() => {
    const modal = document.getElementById('authModal');
    const usernameEl = document.getElementById('authUsername');
    const passwordEl = document.getElementById('authPassword');
    const errorEl = document.getElementById('authError');
    const submitBtn = document.getElementById('authSubmitBtn');
    const switchBtn = document.getElementById('authSwitchBtn');
    const modeText = document.getElementById('authModeText');

    let isRegister = false;

    function show() {
        modal.classList.add('show');
        usernameEl.focus();
    }
    function hide() {
        modal.classList.remove('show');
        document.body.classList.add('authed');
    }
    function setError(msg) {
        errorEl.textContent = msg || '';
    }

    function setMode(register) {
        isRegister = register;
        submitBtn.textContent = register ? 'Sign Up' : 'Sign In';
        modeText.textContent = register ? 'Already have an account?' : "Don't have an account?";
        switchBtn.textContent = register ? 'Sign In' : 'Sign Up';
        passwordEl.autocomplete = register ? 'new-password' : 'current-password';
    }

    function submit() {
        const username = usernameEl.value.trim();
        const password = passwordEl.value;
        if (!username || !password) {
            setError('Enter a username and password');
            return;
        }
        setError('');
        submitBtn.disabled = true;
        submitBtn.textContent = isRegister ? 'Creating…' : 'Signing in…';

        const url = isRegister ? '/api/register' : '/api/login';
        fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ username, password })
        })
            .then(async (res) => {
                const body = await res.json().catch(() => ({}));
                if (!res.ok) {
                    throw new Error(body.error || 'Authentication failed');
                }
                return body;
            })
            .then(() => {
                // Logged in — pull the user's data from the server, then enter the app.
                return dataManager.loadFromServer().catch((err) => {
                    if (err.message !== 'Not authenticated') throw err;
                    // Fresh/first login: keep default or cached data; it will be saved on first change.
                });
            })
            .then(() => {
                hide();
                ensureUI();
            })
            .catch((err) => {
                setError(err.message || 'Something went wrong');
            })
            .finally(() => {
                submitBtn.disabled = false;
                submitBtn.textContent = isRegister ? 'Sign Up' : 'Sign In';
            });
    }

    submitBtn.addEventListener('click', submit);
    switchBtn.addEventListener('click', () => setMode(!isRegister));

    // Enter key submits from the auth fields.
    [usernameEl, passwordEl].forEach((el) => {
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submit();
        });
    });

    return {
        show,
        hide,
        logout() {
            fetch('/api/logout', { method: 'POST', credentials: 'same-origin' })
                .catch(() => {})
                .finally(() => {
                    document.body.classList.remove('authed');
                    usernameEl.value = '';
                    passwordEl.value = '';
                    setError('');
                    setMode(false);
                    show();
                });
        }
    };
})();

// Create the app UI once, on first successful auth.
let ui = null;
function ensureUI() {
    if (!ui) {
        ui = new KanbanUI(dataManager);
    }
}

// On load: silently check for an existing session.
(async () => {
    registerServiceWorker();

    try {
        const res = await fetch('/api/me', { credentials: 'same-origin' });
        if (res.ok) {
            await dataManager.loadFromServer();
            AuthController.hide();
            ensureUI();
            return;
        }
    } catch (e) {
        // Server unreachable — fall through to the login screen.
    }
    AuthController.show();
})();

function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {
            // Ignore registration failures; app still works without offline support.
        });
    });
}
