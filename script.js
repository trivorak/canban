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

    deleteColumn(boardId, columnId) {
        const board = this.data.boards.find(b => b.id === boardId);
        if (!board) return false;
        board.columns = board.columns.filter(c => c.id !== columnId);
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

    moveCard(boardId, fromColumnId, toColumnId, cardId) {
        const board = this.data.boards.find(b => b.id === boardId);
        if (!board) return false;

        const fromCol = board.columns.find(c => c.id === fromColumnId);
        const toCol = board.columns.find(c => c.id === toColumnId);
        if (!fromCol || !toCol) return false;

        const cardIndex = fromCol.cards.findIndex(c => c.id === cardId);
        if (cardIndex === -1) return false;

        const [card] = fromCol.cards.splice(cardIndex, 1);
        card.updatedAt = new Date().toISOString();
        toCol.cards.push(card);
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

    addTodo(title) {
        const newTodo = {
            id: 'todo-' + Date.now(),
            title: title || 'Untitled Todo',
            completed: false,
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
        this.save();
        return true;
    }

    deleteTodo(todoId) {
        this.data.todos = this.data.todos.filter(t => t.id !== todoId);
        this.save();
        return true;
    }

    addSubtodo(todoId, title) {
        const todo = this.data.todos.find(t => t.id === todoId);
        if (!todo) return null;
        const newSub = {
            id: 'sub-' + Date.now(),
            title: title || 'Untitled Subtask',
            completed: false
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
        this.editingSubtodoId = null;

        // DOM refs
        this.boardTabsEl = document.getElementById('boardTabs');
        this.boardContainerEl = document.getElementById('boardContainer');
        this.addBoardBtn = document.getElementById('addBoardBtn');
        this.exportBtn = document.getElementById('exportDataBtn');
        this.importBtn = document.getElementById('importDataBtn');
        this.importFileInput = document.getElementById('importFileInput');

        // Modals
        this.columnModal = document.getElementById('addColumnModal');
        this.cardModal = document.getElementById('addCardModal');
        this.editCardModal = document.getElementById('editCardModal');
        this.addTodoModal = document.getElementById('addTodoModal');
        this.addSubtodoModal = document.getElementById('addSubtodoModal');
        this.editTodoModal = document.getElementById('editTodoModal');

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

    setupTabSwitching() {
        this.mainTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                this.mainTabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                const tabName = tab.dataset.tab;
                if (tabName === 'kanban') {
                    this.kanbanTab.style.display = 'flex';
                    this.todoTab.style.display = 'none';
                } else {
                    this.kanbanTab.style.display = 'none';
                    this.todoTab.style.display = 'flex';
                    this.renderTodos();
                }
            });
        });
    }

    setupEventListeners() {
        // Add Board
        this.addBoardBtn.addEventListener('click', () => {
            const title = prompt('Enter board name:');
            if (title !== null) {
                this.data.addBoard(title || 'Untitled Board');
            }
        });

        // Export
        this.exportBtn.addEventListener('click', () => {
            const data = this.data.exportData();
            const blob = new Blob([data], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `kanban-backup-${new Date().toISOString().slice(0,10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
        });

        // Import
        this.importBtn.addEventListener('click', () => {
            this.importFileInput.click();
        });

        this.importFileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                const success = this.data.importData(ev.target.result);
                if (success) {
                    alert('Data imported successfully!');
                } else {
                    alert('Invalid data format.');
                }
                this.importFileInput.value = '';
            };
            reader.readAsText(file);
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
            if (title) {
                const board = this.data.getCurrentBoard();
                const columnId = this.cardModal.dataset.columnId;
                this.data.addCard(board.id, columnId, title, desc);
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

            if (title && this.editingCardId && this.editingColumnId) {
                const board = this.data.getCurrentBoard();
                this.data.updateCard(board.id, this.editingColumnId, this.editingCardId, {
                    title: title,
                    description: desc
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
                const input = document.getElementById('todoTitleInput');
                const title = input.value.trim();
                if (title) {
                    this.data.addTodo(title);
                    input.value = '';
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
                this.addTodoModal.classList.remove('show');
            });
        }

        // Subtodo Modal
        const saveSubtodoBtn = document.getElementById('saveSubtodoBtn');
        if (saveSubtodoBtn) {
            saveSubtodoBtn.addEventListener('click', () => {
                const input = document.getElementById('subtodoTitleInput');
                const title = input.value.trim();
                const todoId = this.addSubtodoModal.dataset.todoId;
                if (title && todoId) {
                    this.data.addSubtodo(todoId, title);
                    input.value = '';
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
                this.addSubtodoModal.classList.remove('show');
            });
        }

        // Edit Todo Modal
        const saveEditTodoBtn = document.getElementById('saveEditTodoBtn');
        if (saveEditTodoBtn) {
            saveEditTodoBtn.addEventListener('click', () => {
                const input = document.getElementById('editTodoTitleInput');
                const title = input.value.trim();
                if (title && this.editingTodoId) {
                    this.data.updateTodo(this.editingTodoId, { title: title });
                    input.value = '';
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
                this.editTodoModal.classList.remove('show');
                this.editingTodoId = null;
            });
        }

        // Close modals on overlay click
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.classList.remove('show');
                    this.editingCardId = null;
                    this.editingColumnId = null;
                    this.editingTodoId = null;
                    this.editingSubtodoId = null;
                }
            });
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                document.querySelectorAll('.modal.show').forEach(m => m.classList.remove('show'));
                this.editingCardId = null;
                this.editingColumnId = null;
                this.editingTodoId = null;
                this.editingSubtodoId = null;
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

        this.renderTabs(boards, currentBoard);
        this.renderBoard(currentBoard);
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

        if (boards.length > 0) {
            const addTab = document.createElement('div');
            addTab.className = 'board-tab add-board';
            addTab.innerHTML = this.icons.add;
            addTab.addEventListener('click', () => {
                this.columnModal.classList.add('show');
                document.getElementById('columnTitleInput').focus();
            });
            this.boardTabsEl.appendChild(addTab);
        }
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

        const addColBtn = document.createElement('div');
        addColBtn.className = 'column add-column';
        addColBtn.innerHTML = `${this.icons.add} Add Column`;
        addColBtn.addEventListener('click', () => {
            this.columnModal.classList.add('show');
            document.getElementById('columnTitleInput').focus();
        });

        boardEl.appendChild(addColBtn);
        this.boardContainerEl.appendChild(boardEl);
        this.setupDragDrop(board);
    }

    createColumnElement(board, column, index = 0) {
        const colEl = document.createElement('div');
        colEl.className = 'column';
        colEl.dataset.columnId = column.id;
        colEl.dataset.boardId = board.id;
        // Cycle the Halliburton accent palette so columns are visually distinct.
        colEl.dataset.accent = String(index % 6);

        colEl.innerHTML = `
        <div class="column-header">
        <h3><span class="column-dot"></span>${column.title} <span class="card-count">(${column.cards.length})</span></h3>
        <div class="column-actions">
        <button class="add-card-btn" title="Add Card">${this.icons.add}</button>
        <button class="delete-column-btn" title="Delete Column">${this.icons.trash}</button>
        </div>
        </div>
        <div class="cards-container" data-column-id="${column.id}">
        ${column.cards.map(card => this.createCardHTML(card, column.id)).join('')}
        </div>
        `;

        colEl.querySelector('.add-card-btn').addEventListener('click', () => {
            this.cardModal.dataset.columnId = column.id;
            this.cardModal.classList.add('show');
            document.getElementById('cardTitleInput').focus();
        });

        colEl.querySelector('.delete-column-btn').addEventListener('click', () => {
            if (confirm(`Delete column "${column.title}" and all its cards?`)) {
                this.data.deleteColumn(board.id, column.id);
            }
        });

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
            cardEl.addEventListener('dblclick', (e) => {
                if (e.target.closest('.card-delete')) return;
                const cardId = cardEl.dataset.cardId;
                this.openEditModal(board.id, column.id, cardId);
            });
        });

        return colEl;
    }

    createCardHTML(card, columnId) {
        const hasDescription = card.description && card.description.trim().length > 0;
        const updatedInfo = card.updatedAt ? `Updated: ${new Date(card.updatedAt).toLocaleString()}` : '';

        return `
        <div class="card" draggable="true" data-card-id="${card.id}" data-column-id="${columnId}">
        <div class="card-actions">
        <button class="card-edit" data-card-id="${card.id}" title="Edit card">${this.icons.edit}</button>
        <button class="card-delete" data-card-id="${card.id}" title="Delete card">${this.icons.close}</button>
        </div>
        <div class="card-title">${this.escapeHtml(card.title)}</div>
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
        this.editCardModal.classList.add('show');
        document.getElementById('editCardTitleInput').focus();
        document.getElementById('editCardTitleInput').select();
    }

    // ============ TODO RENDER ============
    renderTodos() {
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
        const completed = todos.filter(t => t.completed).length;
        const totalSubtasks = todos.reduce((sum, t) => sum + (t.subtodos || []).length, 0);
        const completedSubtasks = todos.reduce((sum, t) => sum + (t.subtodos || []).filter(s => s.completed).length, 0);

        let html = `
        <div class="todo-stats">
        <span>${this.icons.stats} Total: <span class="stat-number">${total}</span></span>
        <span>${this.icons.check} Completed: <span class="stat-number">${completed}</span></span>
        <span>${this.icons.clipboard} Subtasks: <span class="stat-number">${completedSubtasks}/${totalSubtasks}</span></span>
        </div>
        `;

        todos.forEach(todo => {
            html += this.createTodoHTML(todo);
        });

        this.todoListEl.innerHTML = html;
        this.setupTodoEventListeners();
    }

    createTodoHTML(todo) {
        const isCompleted = todo.completed;
        const subtodos = todo.subtodos || [];
        const hasSubtodos = subtodos.length > 0;

        let html = `
        <div class="todo-item ${isCompleted ? 'completed' : ''}" data-todo-id="${todo.id}">
        <div class="todo-main">
        <input type="checkbox" class="todo-checkbox" ${isCompleted ? 'checked' : ''} />
        <div class="todo-content">
        <div class="todo-title">${this.escapeHtml(todo.title)}</div>
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
                html += `
                <div class="subtodo-item ${sub.completed ? 'completed' : ''}" data-subtodo-id="${sub.id}">
                <input type="checkbox" class="subtodo-checkbox" ${sub.completed ? 'checked' : ''} />
                <span class="subtodo-title">${this.escapeHtml(sub.title)}</span>
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
                const todo = this.data.getTodos().find(t => t.id === todoId);
                if (todo) {
                    document.getElementById('subtodoParentTitle').textContent = todo.title;
                    this.addSubtodoModal.dataset.todoId = todoId;
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
                        const newTitle = prompt('Edit subtask title:', subtodo.title);
                        if (newTitle !== null && newTitle.trim()) {
                            this.data.updateSubtodo(todoId, subtodoId, { title: newTitle.trim() });
                        }
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
    }

    // ============ DRAG AND DROP ============
    setupDragDrop(board) {
        const cards = document.querySelectorAll('.card');
        const containers = document.querySelectorAll('.cards-container');

        cards.forEach(card => {
            card.addEventListener('dragstart', (e) => {
                this.draggedCard = card.dataset.cardId;
                this.draggedFromColumn = card.dataset.columnId;
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
            });
        });

        containers.forEach(container => {
            container.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                container.classList.add('drag-over');
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
                if (cardId === this.draggedCard && toColumnId === this.draggedFromColumn) return;

                const boardId = board.id;
                const success = this.data.moveCard(boardId, this.draggedFromColumn, toColumnId, cardId);

                if (success) {
                    const containerCards = container.querySelectorAll('.card');
                    const cardElement = container.querySelector(`[data-card-id="${cardId}"]`);
                    if (cardElement) {
                        const mouseY = e.clientY;
                        let insertBefore = null;
                        for (const c of containerCards) {
                            const rect = c.getBoundingClientRect();
                            if (mouseY < rect.top + rect.height / 2) {
                                insertBefore = c;
                                break;
                            }
                        }
                        if (insertBefore && insertBefore !== cardElement) {
                            container.insertBefore(cardElement, insertBefore);
                        } else if (!insertBefore) {
                            container.appendChild(cardElement);
                        }

                        const newOrder = Array.from(container.querySelectorAll('.card')).map(el => el.dataset.cardId);
                        this.data.reorderCards(boardId, toColumnId, newOrder);
                    }
                }
            });
        });

        document.querySelectorAll('.column').forEach(col => {
            col.addEventListener('dragover', (e) => {
                e.preventDefault();
                const container = col.querySelector('.cards-container');
                if (container) {
                    container.classList.add('drag-over');
                }
            });

            col.addEventListener('dragleave', (e) => {
                const container = col.querySelector('.cards-container');
                if (container) {
                    container.classList.remove('drag-over');
                }
            });

            col.addEventListener('drop', (e) => {
                e.preventDefault();
                const container = col.querySelector('.cards-container');
                if (container) {
                    container.classList.remove('drag-over');
                    const dropEvent = new DragEvent('drop', {
                        clientX: e.clientX,
                        clientY: e.clientY,
                        dataTransfer: e.dataTransfer
                    });
                    container.dispatchEvent(dropEvent);
                }
            });
        });
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    icons = {
        // Edit / pencil
        edit: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>',
        // Delete / trash
        trash: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
        // Add / plus
        add: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
        // Close / x
        close: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
        // Bar chart
        stats: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>',
        // Checkmark
        check: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
        // Clipboard / list
        clipboard: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><line x1="9" y1="11" x2="15" y2="11"/><line x1="9" y1="15" x2="13" y2="15"/></svg>',
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
