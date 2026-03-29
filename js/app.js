/**
 * ═══════════════════════════════════════════════════════════════
 * MuscuApp — Orchestrateur Principal (app.js)
 * ═══════════════════════════════════════════════════════════════
 *
 * Point d'entrée de l'application. Gère :
 *   1. Router / Navigation (bottom tab bar + History API)
 *   2. Initialisation (chargement JSON, profil, modules)
 *   3. Dashboard (accueil avec résumé du jour)
 *   4. Profil & Réglages (infos, objectifs, rappels)
 *   5. Multi-utilisateurs (3 profils max, sélecteur)
 *
 * Dépendances (chargées avant) :
 *   - window.TrainingModule
 *   - window.NutritionModule
 *   - window.StatsModule  (via window.MuscuStats ou new StatsModule)
 *   - window.ProgramsModule
 *
 * JavaScript vanilla · ES6 classes · Tout en français
 * ═══════════════════════════════════════════════════════════════
 */

'use strict';

/* ─────────────────────────────────────────────
   CONSTANTES
   ───────────────────────────────────────────── */

const APP_STORAGE = {
  users:         'muscuapp_users',
  currentUserId: 'muscuapp_currentUserId',
  reminders:     (uid) => `muscuapp_reminders_${uid}`,
};

const MAX_USERS        = 3;
const DATA_BASE_PATH   = 'data/';
const DEFAULT_GOALS    = { calories: 2500, protein: 150, fat: 80, carbs: 250 };
const PAGES            = ['home', 'training', 'nutrition', 'stats', 'profile'];

const REMINDER_TYPES = [
  { id: 'creatine', label: 'Créatine',      icon: '💊', defaultTime: '08:00' },
  { id: 'whey',     label: 'Whey',           icon: '🥛', defaultTime: '16:00' },
  { id: 'repas',    label: 'Repas',          icon: '🍽️', defaultTime: '12:00' },
  { id: 'custom',   label: 'Personnalisé',   icon: '⏰', defaultTime: '09:00' },
];

const JOURS_FR = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const MOIS_FR  = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
                  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];


/* ─────────────────────────────────────────────
   UTILITAIRES
   ───────────────────────────────────────────── */

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function escHTML(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

function formatDateFrFull(date = new Date()) {
  return `${JOURS_FR[date.getDay()]} ${date.getDate()} ${MOIS_FR[date.getMonth()]}`;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

/** Petit helper pour récupérer un élément DOM */
function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }


/* ═════════════════════════════════════════════════════════════
   1. ROUTER — Navigation entre pages + History API
   ═════════════════════════════════════════════════════════════ */

class Router {

  constructor() {
    this._currentPage = 'home';
    this._pages       = new Map();
    this._tabs        = new Map();
    this._callbacks   = new Map(); // page → callback quand on entre
  }

  init() {
    // Indexer les pages et onglets
    PAGES.forEach(name => {
      const page = document.getElementById(`page-${name}`);
      if (page) this._pages.set(name, page);
    });

    const tabItems = $$('#tab-bar .tab-item');
    tabItems.forEach(btn => {
      const target = btn.dataset.target;
      if (target) this._tabs.set(target, btn);
    });

    // Écouter les clics sur la tab bar
    const tabBar = $('#tab-bar');
    if (tabBar) {
      tabBar.addEventListener('click', (e) => {
        const btn = e.target.closest('.tab-item');
        if (!btn) return;
        const target = btn.dataset.target;
        if (target) this.navigateTo(target, true);
      });
    }

    // Écouter le back button
    window.addEventListener('popstate', (e) => {
      const page = (e.state && e.state.page) || 'home';
      this.navigateTo(page, false);
    });

    // Déterminer la page initiale depuis l'URL
    const hash = window.location.hash.replace('#', '');
    const initial = PAGES.includes(hash) ? hash : 'home';
    this.navigateTo(initial, true);
  }

  /** Naviguer vers une page */
  navigateTo(pageName, pushState = true) {
    if (!PAGES.includes(pageName)) pageName = 'home';
    if (pageName === this._currentPage && this._pages.get(pageName)?.classList.contains('active')) {
      return; // Déjà sur cette page
    }

    this._currentPage = pageName;

    // Mettre à jour les pages
    this._pages.forEach((el, name) => {
      if (name === pageName) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    });

    // Mettre à jour les onglets
    this._tabs.forEach((btn, name) => {
      btn.classList.toggle('active', name === pageName);
    });

    // History API
    if (pushState) {
      const url = pageName === 'home' ? '#' : `#${pageName}`;
      history.pushState({ page: pageName }, '', url);
    }

    // Callback d'entrée
    const cb = this._callbacks.get(pageName);
    if (cb) cb(pageName);
  }

  /** Enregistrer un callback quand on arrive sur une page */
  onEnter(pageName, callback) {
    this._callbacks.set(pageName, callback);
  }

  /** Page courante */
  get currentPage() {
    return this._currentPage;
  }
}


/* ═════════════════════════════════════════════════════════════
   2. USER MANAGER — Multi-utilisateurs (3 profils max)
   ═════════════════════════════════════════════════════════════ */

class UserManager {

  constructor() {
    this._users      = [];
    this._currentId  = null;
    this._listeners  = []; // callbacks appelés au changement d'utilisateur
  }

  init() {
    this._load();
  }

  // ── Persistence ──

  _load() {
    try {
      const raw = localStorage.getItem(APP_STORAGE.users);
      this._users = raw ? JSON.parse(raw) : [];
    } catch { this._users = []; }

    this._currentId = localStorage.getItem(APP_STORAGE.currentUserId) || null;

    // Vérifier cohérence
    if (this._currentId && !this._users.find(u => u.id === this._currentId)) {
      this._currentId = this._users.length > 0 ? this._users[0].id : null;
      this._saveCurrentId();
    }
  }

  _save() {
    localStorage.setItem(APP_STORAGE.users, JSON.stringify(this._users));
  }

  _saveCurrentId() {
    if (this._currentId) {
      localStorage.setItem(APP_STORAGE.currentUserId, this._currentId);
    } else {
      localStorage.removeItem(APP_STORAGE.currentUserId);
    }
  }

  // ── Getters ──

  get currentUser() {
    return this._users.find(u => u.id === this._currentId) || null;
  }

  get currentId() {
    return this._currentId;
  }

  get users() {
    return [...this._users];
  }

  get hasUser() {
    return this._currentId !== null && this.currentUser !== null;
  }

  get canAddUser() {
    return this._users.length < MAX_USERS;
  }

  // ── Mutations ──

  /**
   * Créer un nouveau profil
   * @param {Object} data — { name, weight, goals }
   * @returns {Object} le profil créé
   */
  createUser(data) {
    if (this._users.length >= MAX_USERS) {
      throw new Error(`Maximum de ${MAX_USERS} profils atteint`);
    }

    const user = {
      id:        generateId(),
      name:      (data.name || 'Utilisateur').trim(),
      weight:    parseFloat(data.weight) || 75,
      goals:     {
        calories: parseInt(data.goals?.calories) || DEFAULT_GOALS.calories,
        protein:  parseInt(data.goals?.protein)  || DEFAULT_GOALS.protein,
        fat:      parseInt(data.goals?.fat)      || DEFAULT_GOALS.fat,
        carbs:    parseInt(data.goals?.carbs)    || DEFAULT_GOALS.carbs,
      },
      createdAt: new Date().toISOString(),
    };

    this._users.push(user);
    this._currentId = user.id;
    this._save();
    this._saveCurrentId();

    // Initialiser les objectifs nutrition dans le format attendu par NutritionModule
    this._syncGoalsToNutrition(user);

    this._notifyListeners();
    return user;
  }

  /**
   * Mettre à jour le profil courant
   * @param {Object} data — champs à modifier
   */
  updateCurrentUser(data) {
    const user = this.currentUser;
    if (!user) return null;

    if (data.name !== undefined) user.name = data.name.trim();
    if (data.weight !== undefined) user.weight = parseFloat(data.weight) || user.weight;
    if (data.goals) {
      user.goals = {
        ...user.goals,
        ...data.goals,
      };
      this._syncGoalsToNutrition(user);
    }

    this._save();
    this._notifyListeners();
    return user;
  }

  /** Synchroniser les objectifs vers le format NutritionModule */
  _syncGoalsToNutrition(user) {
    const key = `nutritionGoals_${user.id}`;
    localStorage.setItem(key, JSON.stringify({
      calories: user.goals.calories,
      protein:  user.goals.protein,
      fat:      user.goals.fat,
      carbs:    user.goals.carbs,
    }));
  }

  /**
   * Changer d'utilisateur actif
   * @param {string} userId
   */
  switchUser(userId) {
    const user = this._users.find(u => u.id === userId);
    if (!user) return;
    this._currentId = userId;
    this._saveCurrentId();
    this._notifyListeners();
  }

  /**
   * Supprimer un profil
   * @param {string} userId
   */
  deleteUser(userId) {
    this._users = this._users.filter(u => u.id !== userId);
    if (this._currentId === userId) {
      this._currentId = this._users.length > 0 ? this._users[0].id : null;
    }
    this._save();
    this._saveCurrentId();
    this._notifyListeners();
  }

  // ── Listeners ──

  onChange(callback) {
    this._listeners.push(callback);
  }

  _notifyListeners() {
    const user = this.currentUser;
    this._listeners.forEach(fn => fn(user));
  }
}


/* ═════════════════════════════════════════════════════════════
   3. REMINDER MANAGER — Rappels avec Notification API
   ═════════════════════════════════════════════════════════════ */

class ReminderManager {

  constructor(userManager) {
    this._userManager = userManager;
    this._timers      = [];        // setInterval/setTimeout IDs
    this._permission  = 'default'; // Notification permission
  }

  init() {
    this._checkPermission();
    this._scheduleAll();
  }

  // ── Permissions ──

  async requestPermission() {
    if (!('Notification' in window)) return 'denied';
    if (Notification.permission === 'granted') {
      this._permission = 'granted';
      return 'granted';
    }
    if (Notification.permission !== 'denied') {
      const result = await Notification.requestPermission();
      this._permission = result;
      return result;
    }
    this._permission = 'denied';
    return 'denied';
  }

  _checkPermission() {
    if ('Notification' in window) {
      this._permission = Notification.permission;
    }
  }

  get permissionGranted() {
    return this._permission === 'granted';
  }

  // ── CRUD Rappels ──

  getReminders() {
    const uid = this._userManager.currentId;
    if (!uid) return [];
    try {
      const raw = localStorage.getItem(APP_STORAGE.reminders(uid));
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  saveReminders(reminders) {
    const uid = this._userManager.currentId;
    if (!uid) return;
    localStorage.setItem(APP_STORAGE.reminders(uid), JSON.stringify(reminders));
    this._scheduleAll();
  }

  addReminder(data) {
    const reminders = this.getReminders();
    const reminder = {
      id:      generateId(),
      type:    data.type || 'custom',
      label:   data.label || REMINDER_TYPES.find(r => r.id === data.type)?.label || 'Rappel',
      time:    data.time || '09:00',
      enabled: data.enabled !== false,
      days:    data.days || [1, 2, 3, 4, 5, 6, 0], // tous les jours par défaut
    };
    reminders.push(reminder);
    this.saveReminders(reminders);
    return reminder;
  }

  updateReminder(id, data) {
    const reminders = this.getReminders();
    const idx = reminders.findIndex(r => r.id === id);
    if (idx === -1) return null;
    reminders[idx] = { ...reminders[idx], ...data };
    this.saveReminders(reminders);
    return reminders[idx];
  }

  deleteReminder(id) {
    let reminders = this.getReminders();
    reminders = reminders.filter(r => r.id !== id);
    this.saveReminders(reminders);
  }

  /** Retourne les rappels actifs pour aujourd'hui */
  getTodayReminders() {
    const today = new Date().getDay();
    return this.getReminders()
      .filter(r => r.enabled && r.days.includes(today))
      .sort((a, b) => a.time.localeCompare(b.time));
  }

  // ── Planification ──

  _clearTimers() {
    this._timers.forEach(id => clearTimeout(id));
    this._timers = [];
  }

  _scheduleAll() {
    this._clearTimers();
    const reminders = this.getTodayReminders();
    const now = new Date();

    reminders.forEach(r => {
      const [h, m] = r.time.split(':').map(Number);
      const target = new Date();
      target.setHours(h, m, 0, 0);

      const diff = target.getTime() - now.getTime();
      if (diff > 0) {
        const timer = setTimeout(() => this._fire(r), diff);
        this._timers.push(timer);
      }
    });
  }

  _fire(reminder) {
    const typeInfo = REMINDER_TYPES.find(t => t.id === reminder.type);
    const icon = typeInfo?.icon || '⏰';
    const title = `${icon} ${reminder.label}`;
    const body  = `Il est ${reminder.time} — c'est l'heure !`;

    // Notification native
    if (this.permissionGranted) {
      try {
        new Notification(title, {
          body,
          icon:  'icons/icon-192.png',
          badge: 'icons/icon-192.png',
          tag:   `reminder-${reminder.id}`,
          vibrate: [200, 100, 200],
        });
      } catch (e) {
        console.warn('[Reminders] Notification échouée:', e);
      }
    }

    // Événement custom pour que le dashboard puisse réagir
    window.dispatchEvent(new CustomEvent('muscuapp:reminder', { detail: reminder }));
  }

  destroy() {
    this._clearTimers();
  }
}


/* ═════════════════════════════════════════════════════════════
   4. DASHBOARD — Page d'accueil
   ═════════════════════════════════════════════════════════════ */

class Dashboard {

  constructor(app) {
    this._app = app;
  }

  render() {
    this._renderGreeting();
    this._renderDate();
    this._renderTodayProgram();
    this._renderCaloriesGauge();
    this._renderReminders();
  }

  // ── Salutation ──

  _renderGreeting() {
    const el = $('#greeting');
    if (!el) return;
    const user = this._app.userManager.currentUser;
    const hour = new Date().getHours();
    let salut = 'Salut';
    if (hour < 6)       salut = 'Bonne nuit';
    else if (hour < 12) salut = 'Bonjour';
    else if (hour < 18) salut = 'Bon après-midi';
    else                salut = 'Bonsoir';

    el.textContent = user ? `${salut} ${user.name} !` : `${salut} !`;
  }

  // ── Date du jour ──

  _renderDate() {
    const el = $('#today-date');
    if (!el) return;
    el.textContent = formatDateFrFull();
  }

  // ── Programme du jour ──

  _renderTodayProgram() {
    const container = $('#home-program-body');
    if (!container) return;

    const training = this._app.modules.training;
    const program  = training ? training.getTodayProgram() : null;

    if (!program) {
      container.innerHTML = `
        <div class="empty-state">
          <p>Aucun programme actif</p>
          <button class="btn btn-secondary btn-sm" id="btn-goto-programs">
            Choisir un programme
          </button>
        </div>`;
      const btn = container.querySelector('#btn-goto-programs');
      if (btn) btn.addEventListener('click', () => this._app.router.navigateTo('training'));
      return;
    }

    const exerciseItems = program.exercises.slice(0, 5).map(ex => `
      <li class="program-exercise-item">
        <span class="exercise-name">${escHTML(ex.name)}</span>
        <span class="exercise-detail">${ex.sets}×${ex.reps}${ex.suggestedWeight ? ` • ${ex.suggestedWeight}kg` : ''}</span>
      </li>
    `).join('');

    const extra = program.exercises.length > 5
      ? `<li class="program-exercise-more">+${program.exercises.length - 5} exercices</li>`
      : '';

    container.innerHTML = `
      <div class="program-day-header">
        <strong>${escHTML(program.programName)}</strong>
        <span class="program-day-name">${escHTML(program.dayName)}</span>
      </div>
      <ul class="program-exercise-preview">${exerciseItems}${extra}</ul>
      <button class="btn btn-primary btn-md" id="btn-home-start-workout">
        🏋️ Commencer l'entraînement
      </button>`;

    const startBtn = container.querySelector('#btn-home-start-workout');
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        this._app.router.navigateTo('training');
        // Petit délai pour laisser la page s'afficher avant de cliquer le bouton start
        setTimeout(() => {
          const trainBtn = $('#btn-start-workout');
          if (trainBtn && !trainBtn.disabled) trainBtn.click();
        }, 200);
      });
    }
  }

  // ── Jauge calories ──

  _renderCaloriesGauge() {
    const container = $('#home-calories-gauge');
    if (!container) return;

    const nutrition = this._app.modules.nutrition;
    const summary   = nutrition ? nutrition.getTodaySummary() : null;

    if (!summary) {
      container.innerHTML = '<p class="text-muted">Données non disponibles</p>';
      return;
    }

    const current = summary.calories || 0;
    const goal    = summary.goal || DEFAULT_GOALS.calories;
    const pct     = Math.min(Math.round((current / goal) * 100), 150);
    const color   = pct > 100 ? '#FF453A' : pct > 80 ? '#FF9F0A' : '#30D158';

    container.innerHTML = `
      <div class="mini-gauge">
        <div class="mini-gauge-track">
          <div class="mini-gauge-fill" style="width: ${Math.min(pct, 100)}%; background: ${color}"></div>
        </div>
        <div class="mini-gauge-labels">
          <span class="mini-gauge-current">${current} kcal</span>
          <span class="mini-gauge-goal">/ ${goal}</span>
        </div>
      </div>
      <div class="mini-macros">
        <span class="mini-macro" style="color: #0A84FF">P: ${summary.protein || 0}g</span>
        <span class="mini-macro" style="color: #30D158">G: ${summary.carbs || 0}g</span>
        <span class="mini-macro" style="color: #FF9F0A">L: ${summary.fat || 0}g</span>
      </div>`;
  }

  // ── Rappels ──

  _renderReminders() {
    const list = $('#home-reminders-list');
    if (!list) return;

    const reminders = this._app.reminderManager.getTodayReminders();

    if (reminders.length === 0) {
      list.innerHTML = '<li class="empty-state-small">Aucun rappel aujourd\'hui</li>';
      return;
    }

    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    list.innerHTML = reminders.map(r => {
      const [h, m] = r.time.split(':').map(Number);
      const rMinutes = h * 60 + m;
      const passed = rMinutes <= nowMinutes;
      const typeInfo = REMINDER_TYPES.find(t => t.id === r.type);
      const icon = typeInfo?.icon || '⏰';

      return `
        <li class="reminder-item ${passed ? 'reminder-passed' : ''}">
          <span class="reminder-icon">${icon}</span>
          <span class="reminder-label">${escHTML(r.label)}</span>
          <span class="reminder-time">${r.time}</span>
        </li>`;
    }).join('');
  }
}


/* ═════════════════════════════════════════════════════════════
   5. PROFILE PAGE — Profil & Réglages
   ═════════════════════════════════════════════════════════════ */

class ProfilePage {

  constructor(app) {
    this._app     = app;
    this._editing = null; // 'info' | 'goals' | 'reminder' | null
  }

  render() {
    this._renderHeader();
    this._renderGoals();
    this._renderReminders();
    this._renderSettings();
  }

  // ── Avatar & Nom ──

  _renderHeader() {
    const user = this._app.userManager.currentUser;
    if (!user) return;

    const avatar = $('#profile-avatar');
    if (avatar) {
      const initial = user.name.charAt(0).toUpperCase();
      avatar.innerHTML = `<div class="avatar-circle">${initial}</div>`;
    }

    const name = $('#profile-name');
    if (name) name.textContent = user.name;
  }

  // ── Objectifs ──

  _renderGoals() {
    const list = $('#profile-goals-list');
    if (!list) return;

    const user = this._app.userManager.currentUser;
    if (!user) return;
    const g = user.goals;

    list.innerHTML = `
      <li class="goal-item">
        <span class="goal-icon">🔥</span>
        <span class="goal-label">Calories</span>
        <span class="goal-value">${g.calories} kcal</span>
      </li>
      <li class="goal-item">
        <span class="goal-icon">🥩</span>
        <span class="goal-label">Protéines</span>
        <span class="goal-value">${g.protein} g</span>
      </li>
      <li class="goal-item">
        <span class="goal-icon">🍚</span>
        <span class="goal-label">Glucides</span>
        <span class="goal-value">${g.carbs} g</span>
      </li>
      <li class="goal-item">
        <span class="goal-icon">🥑</span>
        <span class="goal-label">Lipides</span>
        <span class="goal-value">${g.fat} g</span>
      </li>
      <li class="goal-item">
        <span class="goal-icon">⚖️</span>
        <span class="goal-label">Poids</span>
        <span class="goal-value">${user.weight} kg</span>
      </li>
      <li class="goal-action">
        <button class="btn btn-secondary btn-sm" id="btn-edit-goals">Modifier les objectifs</button>
      </li>`;

    list.querySelector('#btn-edit-goals')?.addEventListener('click', () => this._showGoalsEditor());
  }

  // ── Éditeur d'objectifs (modale inline) ──

  _showGoalsEditor() {
    const user = this._app.userManager.currentUser;
    if (!user) return;

    const overlay = this._createOverlay('goals-editor', `
      <div class="modal-card">
        <h3 class="modal-title">Modifier le profil</h3>
        <div class="form-group">
          <label for="edit-name">Prénom</label>
          <input type="text" id="edit-name" class="form-input" value="${escHTML(user.name)}" maxlength="20">
        </div>
        <div class="form-group">
          <label for="edit-weight">Poids (kg)</label>
          <input type="number" id="edit-weight" class="form-input" value="${user.weight}" min="30" max="300" step="0.5">
        </div>
        <div class="form-group">
          <label for="edit-calories">Objectif calories</label>
          <input type="number" id="edit-calories" class="form-input" value="${user.goals.calories}" min="1000" max="6000" step="50">
        </div>
        <div class="form-group">
          <label for="edit-protein">Protéines (g)</label>
          <input type="number" id="edit-protein" class="form-input" value="${user.goals.protein}" min="50" max="400" step="5">
        </div>
        <div class="form-group">
          <label for="edit-carbs">Glucides (g)</label>
          <input type="number" id="edit-carbs" class="form-input" value="${user.goals.carbs}" min="50" max="600" step="5">
        </div>
        <div class="form-group">
          <label for="edit-fat">Lipides (g)</label>
          <input type="number" id="edit-fat" class="form-input" value="${user.goals.fat}" min="20" max="250" step="5">
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" id="btn-cancel-goals">Annuler</button>
          <button class="btn btn-primary" id="btn-save-goals">Enregistrer</button>
        </div>
      </div>`);

    overlay.querySelector('#btn-cancel-goals').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#btn-save-goals').addEventListener('click', () => {
      const data = {
        name:   overlay.querySelector('#edit-name').value,
        weight: parseFloat(overlay.querySelector('#edit-weight').value),
        goals: {
          calories: parseInt(overlay.querySelector('#edit-calories').value),
          protein:  parseInt(overlay.querySelector('#edit-protein').value),
          carbs:    parseInt(overlay.querySelector('#edit-carbs').value),
          fat:      parseInt(overlay.querySelector('#edit-fat').value),
        },
      };
      this._app.userManager.updateCurrentUser(data);
      // Rafraîchir le module nutrition avec les nouveaux objectifs
      if (this._app.modules.nutrition) this._app.modules.nutrition.refresh();
      overlay.remove();
      this.render();
      // Rafraîchir aussi le dashboard
      this._app.dashboard.render();
    });
  }

  // ── Rappels ──

  _renderReminders() {
    const container = $('#profile-reminders-settings');
    if (!container) return;

    const reminders = this._app.reminderManager.getReminders();
    const canNotify = this._app.reminderManager.permissionGranted;

    let html = '';

    // Bandeau permission notifications
    if (!canNotify && 'Notification' in window) {
      html += `
        <div class="notification-banner">
          <p>🔔 Active les notifications pour recevoir tes rappels</p>
          <button class="btn btn-primary btn-sm" id="btn-enable-notifs">Activer</button>
        </div>`;
    }

    // Liste des rappels
    if (reminders.length === 0) {
      html += `<div class="empty-state-small">Aucun rappel configuré</div>`;
    } else {
      html += '<ul class="reminder-settings-list">';
      reminders.forEach(r => {
        const typeInfo = REMINDER_TYPES.find(t => t.id === r.type);
        const icon = typeInfo?.icon || '⏰';
        html += `
          <li class="reminder-settings-item" data-reminder-id="${r.id}">
            <div class="reminder-settings-left">
              <span class="reminder-icon">${icon}</span>
              <div class="reminder-info">
                <span class="reminder-label">${escHTML(r.label)}</span>
                <span class="reminder-time-display">${r.time}</span>
              </div>
            </div>
            <div class="reminder-settings-right">
              <label class="toggle">
                <input type="checkbox" class="toggle-input reminder-toggle" data-id="${r.id}" ${r.enabled ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
              <button class="btn-icon btn-delete-reminder" data-id="${r.id}" title="Supprimer">✕</button>
            </div>
          </li>`;
      });
      html += '</ul>';
    }

    // Bouton ajouter
    html += `
      <div class="reminder-add-zone">
        <button class="btn btn-secondary btn-sm" id="btn-add-reminder">+ Ajouter un rappel</button>
      </div>`;

    container.innerHTML = html;

    // Bind events
    container.querySelector('#btn-enable-notifs')?.addEventListener('click', async () => {
      await this._app.reminderManager.requestPermission();
      this._renderReminders();
    });

    container.querySelectorAll('.reminder-toggle').forEach(cb => {
      cb.addEventListener('change', (e) => {
        this._app.reminderManager.updateReminder(e.target.dataset.id, { enabled: e.target.checked });
      });
    });

    container.querySelectorAll('.btn-delete-reminder').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        this._app.reminderManager.deleteReminder(id);
        this._renderReminders();
        this._app.dashboard._renderReminders();
      });
    });

    container.querySelector('#btn-add-reminder')?.addEventListener('click', () => this._showAddReminder());
  }

  _showAddReminder() {
    const typeOptions = REMINDER_TYPES.map(t =>
      `<option value="${t.id}">${t.icon} ${t.label}</option>`
    ).join('');

    const overlay = this._createOverlay('add-reminder', `
      <div class="modal-card">
        <h3 class="modal-title">Nouveau rappel</h3>
        <div class="form-group">
          <label for="reminder-type">Type</label>
          <select id="reminder-type" class="form-input">${typeOptions}</select>
        </div>
        <div class="form-group" id="reminder-custom-label-group" style="display:none">
          <label for="reminder-custom-label">Nom personnalisé</label>
          <input type="text" id="reminder-custom-label" class="form-input" placeholder="Ex: Vitamine D" maxlength="30">
        </div>
        <div class="form-group">
          <label for="reminder-time">Heure</label>
          <input type="time" id="reminder-time" class="form-input" value="09:00">
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" id="btn-cancel-reminder">Annuler</button>
          <button class="btn btn-primary" id="btn-save-reminder">Ajouter</button>
        </div>
      </div>`);

    // Afficher/masquer le champ label custom
    const typeSelect = overlay.querySelector('#reminder-type');
    const customGroup = overlay.querySelector('#reminder-custom-label-group');
    const timeInput = overlay.querySelector('#reminder-time');

    typeSelect.addEventListener('change', () => {
      const isCustom = typeSelect.value === 'custom';
      customGroup.style.display = isCustom ? 'block' : 'none';
      // Mettre l'heure par défaut du type
      const typeInfo = REMINDER_TYPES.find(t => t.id === typeSelect.value);
      if (typeInfo) timeInput.value = typeInfo.defaultTime;
    });

    overlay.querySelector('#btn-cancel-reminder').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#btn-save-reminder').addEventListener('click', () => {
      const type = typeSelect.value;
      const typeInfo = REMINDER_TYPES.find(t => t.id === type);
      const customLabel = overlay.querySelector('#reminder-custom-label').value.trim();

      this._app.reminderManager.addReminder({
        type,
        label: type === 'custom' && customLabel ? customLabel : typeInfo.label,
        time:  timeInput.value || '09:00',
      });

      overlay.remove();
      this._renderReminders();
      this._app.dashboard._renderReminders();
    });
  }

  // ── Réglages ──

  _renderSettings() {
    const list = $('#profile-settings-list');
    if (!list) return;

    const um = this._app.userManager;
    const users = um.users;

    let html = '';

    // Sélecteur multi-profils
    if (users.length > 1) {
      const options = users.map(u =>
        `<option value="${u.id}" ${u.id === um.currentId ? 'selected' : ''}>${escHTML(u.name)}</option>`
      ).join('');

      html += `
        <li class="settings-item">
          <span class="settings-icon">👥</span>
          <span class="settings-label">Profil actif</span>
          <select class="form-input form-input-sm" id="profile-switcher">${options}</select>
        </li>`;
    }

    // Ajouter un profil
    if (um.canAddUser) {
      html += `
        <li class="settings-item settings-action">
          <button class="btn btn-secondary btn-sm" id="btn-add-profile">
            + Nouveau profil (${users.length}/${MAX_USERS})
          </button>
        </li>`;
    }

    // Supprimer le profil courant
    if (users.length > 1) {
      html += `
        <li class="settings-item settings-action settings-danger">
          <button class="btn btn-danger btn-sm" id="btn-delete-profile">
            Supprimer ce profil
          </button>
        </li>`;
    }

    // Version
    html += `
      <li class="settings-item settings-version">
        <span class="settings-label">MuscuApp</span>
        <span class="settings-value text-muted">v1.0.0</span>
      </li>`;

    list.innerHTML = html;

    // Bind events
    list.querySelector('#profile-switcher')?.addEventListener('change', (e) => {
      this._app.switchToUser(e.target.value);
    });

    list.querySelector('#btn-add-profile')?.addEventListener('click', () => {
      this._app.showWelcome(true); // force = ajouter un profil
    });

    list.querySelector('#btn-delete-profile')?.addEventListener('click', () => {
      const user = um.currentUser;
      if (!user) return;
      if (confirm(`Supprimer le profil "${user.name}" ? Les données seront perdues.`)) {
        um.deleteUser(user.id);
        if (um.hasUser) {
          this._app.switchToUser(um.currentId);
        } else {
          this._app.showWelcome();
        }
      }
    });
  }

  // ── Overlay helper ──

  _createOverlay(id, html) {
    // Supprimer si déjà existant
    document.getElementById(id)?.remove();

    const overlay = document.createElement('div');
    overlay.id = id;
    overlay.className = 'modal-overlay';
    overlay.innerHTML = html;

    // Fermer en cliquant sur le fond
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    document.body.appendChild(overlay);

    // Focus premier input
    const firstInput = overlay.querySelector('input, select');
    if (firstInput) setTimeout(() => firstInput.focus(), 50);

    return overlay;
  }
}


/* ═════════════════════════════════════════════════════════════
   6. MUSCU APP — Orchestrateur principal
   ═════════════════════════════════════════════════════════════ */

class MuscuApp {

  constructor() {
    // Sous-systèmes
    this.router          = new Router();
    this.userManager     = new UserManager();
    this.reminderManager = new ReminderManager(this.userManager);
    this.dashboard       = new Dashboard(this);
    this.profilePage     = new ProfilePage(this);

    // Modules externes (initialisés après chargement JSON)
    this.modules = {
      training:  null,
      nutrition: null,
      stats:     null,
      programs:  null,
    };

    // Données JSON chargées
    this.data = {
      exercises: [],
      foods:     [],
      programs:  [],
    };
  }

  /* ═══════════════════════════════════════════
     INITIALISATION
     ═══════════════════════════════════════════ */

  async init() {
    console.log('[MuscuApp] Démarrage…');

    // 1. Charger les utilisateurs
    this.userManager.init();

    // 2. Charger les données JSON en parallèle
    await this._loadData();

    // 3. Initialiser le router
    this.router.init();
    this._bindRouterCallbacks();

    // 4. Vérifier si un profil existe
    if (this.userManager.hasUser) {
      await this._initModules();
      this.dashboard.render();
      this.profilePage.render();
      this.reminderManager.init();
      this._renderUserSwitcher();
    } else {
      this.showWelcome();
    }

    // 5. Écouter les changements d'utilisateur
    this.userManager.onChange(() => this._onUserChanged());

    // 6. Écouter les events de rappel
    window.addEventListener('muscuapp:reminder', () => {
      this.dashboard._renderReminders();
    });

    console.log('[MuscuApp] Prêt ✓');
  }

  // ── Chargement JSON ──

  async _loadData() {
    const [exercises, foods, programs] = await Promise.all([
      this._fetchJSON(`${DATA_BASE_PATH}exercises.json`),
      this._fetchJSON(`${DATA_BASE_PATH}foods.json`),
      this._fetchJSON(`${DATA_BASE_PATH}programs.json`),
    ]);

    this.data.exercises = exercises || [];
    this.data.foods     = foods || [];
    this.data.programs  = programs || [];

    console.log(`[MuscuApp] Données: ${this.data.exercises.length} exercices, ${this.data.foods.length} aliments, ${this.data.programs.length} programmes`);
  }

  async _fetchJSON(path) {
    try {
      const res = await fetch(path);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      console.warn(`[MuscuApp] Erreur chargement ${path}:`, e);
      return [];
    }
  }

  // ── Initialisation des modules ──

  async _initModules() {
    const userId = this.userManager.currentId;
    if (!userId) return;

    console.log(`[MuscuApp] Init modules pour userId=${userId}`);

    // Training Module
    if (window.TrainingModule) {
      this.modules.training = new window.TrainingModule({
        userId,
        exercises: this.data.exercises,
        programs:  this.data.programs,
        container: document.getElementById('page-training'),
      });
    } else {
      console.warn('[MuscuApp] TrainingModule non trouvé');
    }

    // Nutrition Module
    if (window.NutritionModule) {
      this.modules.nutrition = new window.NutritionModule({
        userId,
        foodsPath: `${DATA_BASE_PATH}foods.json`,
      });
      await this.modules.nutrition.init();
    } else {
      console.warn('[MuscuApp] NutritionModule non trouvé');
    }

    // Stats Module
    if (window.StatsModule) {
      this.modules.stats = new window.StatsModule();
      this.modules.stats.init();
    } else if (window.MuscuStats) {
      // Le module s'auto-instancie parfois
      this.modules.stats = window.MuscuStats;
    } else {
      console.warn('[MuscuApp] StatsModule non trouvé');
    }

    // Programs Module
    if (window.ProgramsModule) {
      this.modules.programs = new window.ProgramsModule(userId);
      await this.modules.programs.init('#training-program-selector');
    } else {
      console.warn('[MuscuApp] ProgramsModule non trouvé');
    }
  }

  /** Détruire tous les modules (avant réinitialisation) */
  _destroyModules() {
    if (this.modules.training && typeof this.modules.training.destroy === 'function') {
      this.modules.training.destroy();
    }
    if (this.modules.stats && typeof this.modules.stats.detruire === 'function') {
      this.modules.stats.detruire();
    }
    this.modules = { training: null, nutrition: null, stats: null, programs: null };
  }

  // ── Router callbacks ──

  _bindRouterCallbacks() {
    this.router.onEnter('home', () => {
      this.dashboard.render();
    });

    this.router.onEnter('profile', () => {
      this.profilePage.render();
    });

    this.router.onEnter('nutrition', () => {
      if (this.modules.nutrition) this.modules.nutrition.refresh();
    });

    this.router.onEnter('stats', () => {
      if (this.modules.stats && typeof this.modules.stats.rafraichir === 'function') {
        this.modules.stats.rafraichir();
      }
    });

    this.router.onEnter('training', () => {
      // Rien de spécial, le module gère son propre render
    });
  }

  // ── Sélecteur de profil (header global) ──

  _renderUserSwitcher() {
    const users = this.userManager.users;
    if (users.length <= 1) {
      // Supprimer le switcher s'il existe
      document.getElementById('user-switcher-bar')?.remove();
      return;
    }

    let bar = document.getElementById('user-switcher-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'user-switcher-bar';
      bar.className = 'user-switcher-bar';
      const app = document.getElementById('app');
      app?.parentNode.insertBefore(bar, app);
    }

    const options = users.map(u =>
      `<option value="${u.id}" ${u.id === this.userManager.currentId ? 'selected' : ''}>${escHTML(u.name)}</option>`
    ).join('');

    bar.innerHTML = `
      <select class="user-switcher-select" id="global-user-switcher">
        ${options}
      </select>`;

    bar.querySelector('#global-user-switcher').addEventListener('change', (e) => {
      this.switchToUser(e.target.value);
    });
  }

  // ── Changement d'utilisateur ──

  async switchToUser(userId) {
    this.userManager.switchUser(userId);
  }

  async _onUserChanged() {
    const user = this.userManager.currentUser;
    if (!user) return;

    const userId = user.id;
    console.log(`[MuscuApp] Changement utilisateur → ${user.name} (${userId})`);

    // Mettre à jour les modules existants
    if (this.modules.training) {
      this.modules.training.setUser(userId);
    }
    if (this.modules.nutrition) {
      this.modules.nutrition.setUser(userId);
    }
    if (this.modules.programs) {
      // ProgramsModule a besoin d'être recréé avec le nouvel userId
      this.modules.programs = new window.ProgramsModule(userId);
      await this.modules.programs.init('#training-program-selector');
    }
    if (this.modules.stats && typeof this.modules.stats.rafraichir === 'function') {
      this.modules.stats.rafraichir();
    }

    // Réinitialiser les rappels
    this.reminderManager.destroy();
    this.reminderManager.init();

    // Re-render
    this.dashboard.render();
    this.profilePage.render();
    this._renderUserSwitcher();
  }

  // ── Écran de bienvenue ──

  showWelcome(isAddProfile = false) {
    const title = isAddProfile ? 'Nouveau profil' : 'Bienvenue sur MuscuApp 💪';
    const subtitle = isAddProfile
      ? 'Crée un profil supplémentaire'
      : 'Configure ton profil pour commencer';

    const overlay = document.createElement('div');
    overlay.id = 'welcome-overlay';
    overlay.className = 'modal-overlay modal-overlay-fullscreen';

    overlay.innerHTML = `
      <div class="welcome-card">
        <h2 class="welcome-title">${title}</h2>
        <p class="welcome-subtitle">${subtitle}</p>

        <div class="form-group">
          <label for="welcome-name">Prénom</label>
          <input type="text" id="welcome-name" class="form-input" placeholder="Ton prénom" maxlength="20" autofocus>
        </div>

        <div class="form-group">
          <label for="welcome-weight">Poids (kg)</label>
          <input type="number" id="welcome-weight" class="form-input" placeholder="75" min="30" max="300" step="0.5">
        </div>

        <div class="form-group">
          <label for="welcome-calories">Objectif calories / jour</label>
          <input type="number" id="welcome-calories" class="form-input" placeholder="2500" min="1000" max="6000" step="50">
        </div>

        <div class="form-group">
          <label for="welcome-protein">Protéines (g)</label>
          <input type="number" id="welcome-protein" class="form-input" placeholder="150" min="50" max="400" step="5">
        </div>

        <div class="form-group">
          <label for="welcome-carbs">Glucides (g)</label>
          <input type="number" id="welcome-carbs" class="form-input" placeholder="250" min="50" max="600" step="5">
        </div>

        <div class="form-group">
          <label for="welcome-fat">Lipides (g)</label>
          <input type="number" id="welcome-fat" class="form-input" placeholder="80" min="20" max="250" step="5">
        </div>

        <button class="btn btn-primary btn-lg" id="btn-welcome-start" disabled>
          ${isAddProfile ? 'Créer le profil' : 'C\'est parti ! 🚀'}
        </button>

        ${isAddProfile ? '<button class="btn btn-secondary btn-sm welcome-cancel" id="btn-welcome-cancel">Annuler</button>' : ''}
      </div>`;

    document.body.appendChild(overlay);

    // Validation — activer le bouton quand le nom est rempli
    const nameInput = overlay.querySelector('#welcome-name');
    const startBtn  = overlay.querySelector('#btn-welcome-start');

    nameInput.addEventListener('input', () => {
      startBtn.disabled = nameInput.value.trim().length === 0;
    });

    // Annuler (ajout profil)
    overlay.querySelector('#btn-welcome-cancel')?.addEventListener('click', () => {
      overlay.remove();
    });

    // Soumettre
    startBtn.addEventListener('click', async () => {
      const name     = nameInput.value.trim();
      if (!name) return;

      const weight   = parseFloat(overlay.querySelector('#welcome-weight').value) || 75;
      const calories = parseInt(overlay.querySelector('#welcome-calories').value) || DEFAULT_GOALS.calories;
      const protein  = parseInt(overlay.querySelector('#welcome-protein').value) || DEFAULT_GOALS.protein;
      const carbs    = parseInt(overlay.querySelector('#welcome-carbs').value) || DEFAULT_GOALS.carbs;
      const fat      = parseInt(overlay.querySelector('#welcome-fat').value) || DEFAULT_GOALS.fat;

      // Créer le profil
      this.userManager.createUser({
        name,
        weight,
        goals: { calories, protein, carbs, fat },
      });

      overlay.remove();

      // Initialiser les modules si c'est le premier profil
      if (!this.modules.training) {
        await this._initModules();
      } else {
        // Re-sync modules avec le nouveau user
        await this._onUserChanged();
      }

      this.dashboard.render();
      this.profilePage.render();
      this.reminderManager.init();
      this._renderUserSwitcher();
      this.router.navigateTo('home');
    });

    // Focus
    setTimeout(() => nameInput.focus(), 100);
  }
}


/* ═════════════════════════════════════════════════════════════
   7. STYLES DYNAMIQUES (injectés par JS)
   ═════════════════════════════════════════════════════════════ */

(function injectAppStyles() {
  if (document.getElementById('muscu-app-dynamic-styles')) return;

  const style = document.createElement('style');
  style.id = 'muscu-app-dynamic-styles';
  style.textContent = `

    /* ── Modal Overlay ── */
    .modal-overlay {
      position: fixed;
      inset: 0;
      z-index: 1000;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      animation: fadeIn 0.2s ease;
    }
    .modal-overlay-fullscreen {
      align-items: flex-start;
      padding-top: 40px;
      overflow-y: auto;
    }
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    /* ── Modal Card ── */
    .modal-card, .welcome-card {
      background: #2C2C2E;
      border-radius: 16px;
      padding: 24px;
      width: 100%;
      max-width: 400px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
      animation: slideUp 0.3s ease;
    }
    .welcome-card {
      max-width: 440px;
    }
    @keyframes slideUp {
      from { transform: translateY(30px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }

    .modal-title, .welcome-title {
      font-size: 1.25rem;
      font-weight: 700;
      color: #fff;
      margin: 0 0 16px;
    }
    .welcome-title {
      font-size: 1.5rem;
      text-align: center;
    }
    .welcome-subtitle {
      text-align: center;
      color: #8E8E93;
      margin: -8px 0 20px;
      font-size: 0.95rem;
    }

    .modal-actions {
      display: flex;
      gap: 10px;
      margin-top: 20px;
      justify-content: flex-end;
    }

    .welcome-cancel {
      display: block;
      margin: 12px auto 0;
    }

    /* ── Form inputs ── */
    .form-group {
      margin-bottom: 14px;
    }
    .form-group label {
      display: block;
      font-size: 0.82rem;
      color: #8E8E93;
      margin-bottom: 6px;
      font-weight: 500;
    }
    .form-input {
      width: 100%;
      padding: 10px 14px;
      background: #3A3A3C;
      border: 1px solid transparent;
      border-radius: 10px;
      color: #fff;
      font-size: 1rem;
      outline: none;
      transition: border-color 0.2s;
      box-sizing: border-box;
      -webkit-appearance: none;
    }
    .form-input:focus {
      border-color: #0A84FF;
    }
    .form-input-sm {
      padding: 6px 10px;
      font-size: 0.9rem;
      width: auto;
      min-width: 120px;
    }

    /* ── Buttons extra ── */
    .btn-danger {
      background: #FF453A;
      color: #fff;
      border: none;
      padding: 8px 16px;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
      font-size: 0.9rem;
    }
    .btn-icon {
      background: none;
      border: none;
      color: #8E8E93;
      cursor: pointer;
      font-size: 1.1rem;
      padding: 4px 8px;
      border-radius: 6px;
      transition: color 0.2s, background 0.2s;
    }
    .btn-icon:hover {
      color: #FF453A;
      background: rgba(255, 69, 58, 0.12);
    }

    /* ── Dashboard: Programme du jour ── */
    .program-day-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 10px;
    }
    .program-day-header strong {
      font-size: 1rem;
      color: #fff;
    }
    .program-day-name {
      font-size: 0.85rem;
      color: #0A84FF;
      font-weight: 500;
    }
    .program-exercise-preview {
      list-style: none;
      margin: 0 0 14px;
      padding: 0;
    }
    .program-exercise-item {
      display: flex;
      justify-content: space-between;
      padding: 6px 0;
      border-bottom: 1px solid rgba(84, 84, 88, 0.3);
      font-size: 0.9rem;
    }
    .program-exercise-item:last-child { border-bottom: none; }
    .exercise-name { color: #fff; }
    .exercise-detail { color: #8E8E93; font-size: 0.85rem; }
    .program-exercise-more {
      color: #8E8E93;
      font-size: 0.85rem;
      text-align: center;
      padding: 6px 0;
    }

    /* ── Dashboard: Mini jauge calories ── */
    .mini-gauge {
      margin-bottom: 8px;
    }
    .mini-gauge-track {
      width: 100%;
      height: 10px;
      background: #3A3A3C;
      border-radius: 5px;
      overflow: hidden;
    }
    .mini-gauge-fill {
      height: 100%;
      border-radius: 5px;
      transition: width 0.5s ease, background 0.3s;
    }
    .mini-gauge-labels {
      display: flex;
      justify-content: space-between;
      margin-top: 6px;
      font-size: 0.9rem;
    }
    .mini-gauge-current {
      color: #fff;
      font-weight: 600;
    }
    .mini-gauge-goal {
      color: #8E8E93;
    }
    .mini-macros {
      display: flex;
      gap: 16px;
      font-size: 0.82rem;
      font-weight: 500;
    }
    .mini-macro {
      opacity: 0.9;
    }

    /* ── Dashboard: Rappels ── */
    .reminder-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 0;
      border-bottom: 1px solid rgba(84, 84, 88, 0.3);
      font-size: 0.9rem;
    }
    .reminder-item:last-child { border-bottom: none; }
    .reminder-passed {
      opacity: 0.45;
      text-decoration: line-through;
    }
    .reminder-icon { font-size: 1.1rem; }
    .reminder-label { flex: 1; color: #fff; }
    .reminder-time { color: #8E8E93; font-size: 0.85rem; font-variant-numeric: tabular-nums; }

    /* ── Profil: Objectifs ── */
    .goal-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 0;
      border-bottom: 1px solid rgba(84, 84, 88, 0.3);
    }
    .goal-item:last-child { border-bottom: none; }
    .goal-icon { font-size: 1.15rem; }
    .goal-label { flex: 1; color: #fff; font-size: 0.92rem; }
    .goal-value { color: #0A84FF; font-weight: 600; font-size: 0.92rem; font-variant-numeric: tabular-nums; }
    .goal-action {
      padding-top: 12px;
      text-align: center;
    }

    /* ── Profil: Avatar ── */
    .avatar-circle {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background: linear-gradient(135deg, #0A84FF, #30D158);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.75rem;
      font-weight: 700;
      color: #fff;
      margin: 0 auto;
    }

    /* ── Profil: Rappels settings ── */
    .notification-banner {
      background: rgba(10, 132, 255, 0.12);
      border: 1px solid rgba(10, 132, 255, 0.3);
      border-radius: 10px;
      padding: 12px 14px;
      margin-bottom: 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .notification-banner p {
      margin: 0;
      font-size: 0.85rem;
      color: #fff;
    }

    .reminder-settings-list {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .reminder-settings-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 0;
      border-bottom: 1px solid rgba(84, 84, 88, 0.3);
    }
    .reminder-settings-item:last-child { border-bottom: none; }
    .reminder-settings-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .reminder-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .reminder-time-display {
      font-size: 0.8rem;
      color: #8E8E93;
    }
    .reminder-settings-right {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .reminder-add-zone {
      margin-top: 14px;
      text-align: center;
    }

    /* ── Toggle switch ── */
    .toggle {
      position: relative;
      display: inline-block;
      width: 44px;
      height: 26px;
    }
    .toggle-input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    .toggle-slider {
      position: absolute;
      inset: 0;
      background: #48484A;
      border-radius: 26px;
      cursor: pointer;
      transition: background 0.25s;
    }
    .toggle-slider::before {
      content: '';
      position: absolute;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: #fff;
      top: 2px;
      left: 2px;
      transition: transform 0.25s;
    }
    .toggle-input:checked + .toggle-slider {
      background: #30D158;
    }
    .toggle-input:checked + .toggle-slider::before {
      transform: translateX(18px);
    }

    /* ── Profil: Réglages ── */
    .settings-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 0;
      border-bottom: 1px solid rgba(84, 84, 88, 0.3);
    }
    .settings-item:last-child { border-bottom: none; }
    .settings-icon { font-size: 1.15rem; }
    .settings-label { flex: 1; color: #fff; font-size: 0.92rem; }
    .settings-value { color: #8E8E93; font-size: 0.85rem; }
    .settings-action {
      justify-content: center;
      padding: 14px 0;
    }
    .settings-danger button {
      font-size: 0.85rem;
    }
    .settings-version {
      opacity: 0.5;
      font-size: 0.82rem;
    }

    /* ── User switcher bar ── */
    .user-switcher-bar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 900;
      background: #1C1C1E;
      border-bottom: 1px solid rgba(84, 84, 88, 0.5);
      padding: 8px 16px;
      display: flex;
      justify-content: flex-end;
      align-items: center;
    }
    .user-switcher-select {
      background: #3A3A3C;
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 6px 12px;
      font-size: 0.85rem;
      font-weight: 500;
      outline: none;
      cursor: pointer;
      -webkit-appearance: none;
    }
    /* Si la barre de switcher est présente, décaler le contenu */
    .user-switcher-bar ~ #app .page-header {
      padding-top: 42px;
    }

    /* ── Empty states ── */
    .empty-state {
      text-align: center;
      padding: 20px 10px;
      color: #8E8E93;
    }
    .empty-state p {
      margin: 0 0 12px;
    }
    .empty-state-small {
      text-align: center;
      padding: 12px;
      color: #636366;
      font-size: 0.85rem;
    }

    /* ── Divers ── */
    .text-muted { color: #8E8E93; }
    .reminder-list { list-style: none; margin: 0; padding: 0; }
    .goals-list { list-style: none; margin: 0; padding: 0; }
    .settings-list { list-style: none; margin: 0; padding: 0; }
  `;

  document.head.appendChild(style);
})();


/* ═════════════════════════════════════════════════════════════
   8. BOOTSTRAP — Lancement au chargement du DOM
   ═════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  window.muscuApp = new MuscuApp();
  window.muscuApp.init().catch(err => {
    console.error('[MuscuApp] Erreur fatale:', err);
  });
});
