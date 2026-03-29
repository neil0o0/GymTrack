/**
 * ═══════════════════════════════════════════════════════════════
 * MuscuApp — Module Nutrition
 * ═══════════════════════════════════════════════════════════════
 * Gère : recherche aliments, journal du jour, jauges,
 *        objectifs nutritionnels, historique.
 *
 * Stockage localStorage :
 *   meals_[userId]_[date]        → { items, totalCalories, totalProtein, totalFat, totalCarbs }
 *   nutritionGoals_[userId]      → { calories, protein, fat, carbs }
 *
 * Dépendances : aucune (vanilla JS, ES6 classes)
 * ═══════════════════════════════════════════════════════════════
 */

// ── Couleurs design system ──────────────────────────────────────
const COLORS = {
  bg:        '#1C1C1E',
  surface:   '#2C2C2E',
  surfaceAlt:'#3A3A3C',
  accent:    '#0A84FF',
  success:   '#30D158',
  warning:   '#FF9F0A',
  danger:    '#FF453A',
  textPri:   '#FFFFFF',
  textSec:   '#8E8E93',
  protein:   '#0A84FF',
  fat:       '#FF9F0A',
  carbs:     '#30D158',
};

// ── Helpers ─────────────────────────────────────────────────────

/** Retourne la date du jour au format YYYY-MM-DD */
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/** Formate une date ISO en texte français court */
function formatDateFR(iso) {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Debounce classique */
function debounce(fn, ms = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/** Arrondi à 1 décimale */
function r1(n) { return Math.round(n * 10) / 10; }

/** Génère un id unique court */
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

/** Normalise une chaîne pour la recherche (minuscules, sans accents) */
function normalize(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// ── Classe principale ───────────────────────────────────────────

class NutritionModule {

  /**
   * @param {Object} opts
   * @param {string} opts.userId       – identifiant utilisateur courant
   * @param {string} [opts.foodsPath]  – chemin vers foods.json
   */
  constructor(opts = {}) {
    this.userId    = opts.userId || 'default';
    this.foodsPath = opts.foodsPath || 'data/foods.json';
    this.foods     = [];           // base locale chargée
    this.date      = todayISO();   // date affichée (navigation historique)

    // État du journal
    this.journal   = this._loadJournal(this.date);
    this.goals     = this._loadGoals();

    // Refs DOM (initialisées dans init)
    this._refs = {};

    // Injecte CSS dynamiques (jauges, popup…)
    this._injectStyles();
  }

  // ═══════════════════════════════════════════════════════════════
  // Initialisation
  // ═══════════════════════════════════════════════════════════════

  async init() {
    await this._loadFoods();
    this._cacheDOM();
    this._bindEvents();
    this.render();
  }

  /** Charge la base alimentaire locale */
  async _loadFoods() {
    try {
      const res = await fetch(this.foodsPath);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.foods = await res.json();
      console.log(`[Nutrition] ${this.foods.length} aliments chargés`);
    } catch (err) {
      console.warn('[Nutrition] Erreur chargement foods.json:', err);
      this.foods = [];
    }
  }

  /** Met en cache les refs DOM principales */
  _cacheDOM() {
    const $ = (sel) => document.querySelector(sel);
    this._refs = {
      // Recherche
      searchInput:   $('#food-search-input'),
      searchResults: $('#food-search-results'),
      // Jauges
      calorieGauge:  $('#nutrition-calories-gauge'),
      macrosGrid:    $('#nutrition-macros-grid'),
      // Journal
      mealList:      $('#nutrition-meal-list'),
      btnAddMeal:    $('#btn-add-meal'),
      // Containers
      pageContent:   $('#page-nutrition .page-content'),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // Événements
  // ═══════════════════════════════════════════════════════════════

  _bindEvents() {
    const r = this._refs;

    // ── Recherche ──
    if (r.searchInput) {
      r.searchInput.addEventListener('input', debounce((e) => {
        this._onSearch(e.target.value.trim());
      }, 200));

      r.searchInput.addEventListener('focus', () => {
        if (r.searchInput.value.trim().length >= 1) {
          this._onSearch(r.searchInput.value.trim());
        }
      });

      // Fermer résultats en cliquant à l'extérieur
      document.addEventListener('click', (e) => {
        if (!e.target.closest('#nutrition-search')) {
          this._hideSearchResults();
        }
      });
    }

    // ── Bouton ajouter un repas → ouvre la recherche ──
    if (r.btnAddMeal) {
      r.btnAddMeal.addEventListener('click', () => {
        if (r.searchInput) {
          r.searchInput.focus();
          r.searchInput.value = '';
          this._onSearch('');
        }
      });
    }

    // ── Suppression aliment (event delegation) ──
    if (r.mealList) {
      r.mealList.addEventListener('click', (e) => {
        const btn = e.target.closest('.meal-item-delete');
        if (!btn) return;
        const itemId = btn.dataset.itemId;
        if (itemId) this.removeItem(itemId);
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 1. Recherche d'aliments
  // ═══════════════════════════════════════════════════════════════

  _onSearch(query) {
    const r = this._refs;
    if (!r.searchResults) return;

    if (query.length < 1) {
      this._hideSearchResults();
      return;
    }

    const results = this._searchFoods(query);
    this._renderSearchResults(results, query);
  }

  /** Recherche dans la base locale (fuzzy-ish) */
  _searchFoods(query) {
    const q = normalize(query);
    const terms = q.split(/\s+/);

    // Parsing quantité optionnelle (ex: "3 oeufs" → qty=3, termes=["oeufs"])
    let qty = 1;
    const firstTerm = terms[0];
    if (/^\d+(\.\d+)?$/.test(firstTerm)) {
      qty = parseFloat(firstTerm);
      terms.shift();
    }

    if (terms.length === 0) return [];

    const scored = this.foods
      .map(food => {
        const name = normalize(food.name);
        const cat  = normalize(food.category || '');
        let score = 0;

        for (const t of terms) {
          if (name.includes(t)) score += 10;
          if (name.startsWith(t)) score += 5;
          if (cat.includes(t)) score += 3;
        }
        // Bonus exact
        if (name === terms.join(' ')) score += 20;

        return { food, score, qty };
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);

    return scored;
  }

  _renderSearchResults(results, query) {
    const r = this._refs;
    if (results.length === 0) {
      r.searchResults.innerHTML = `
        <div class="search-no-result">Aucun résultat pour « ${this._esc(query)} »</div>
      `;
      r.searchResults.classList.add('visible');
      return;
    }

    r.searchResults.innerHTML = results.map(({ food, qty }) => {
      const portionCal = r1((food.calories / 100) * food.servingGrams * qty);
      const qtyLabel = qty > 1 ? `${qty} × ` : '';
      return `
        <button class="search-result-item" data-food-id="${food.id}" data-qty="${qty}">
          <span class="sri-emoji">${food.emoji}</span>
          <span class="sri-info">
            <span class="sri-name">${qtyLabel}${this._esc(food.name)}</span>
            <span class="sri-detail">${portionCal} kcal · ${food.serving}</span>
          </span>
          <span class="sri-arrow">›</span>
        </button>
      `;
    }).join('');

    r.searchResults.classList.add('visible');

    // Bind clic → popup détails
    r.searchResults.querySelectorAll('.search-result-item').forEach(el => {
      el.addEventListener('click', () => {
        const foodId = el.dataset.foodId;
        const qty = parseFloat(el.dataset.qty) || 1;
        const food = this.foods.find(f => f.id === foodId);
        if (food) this._showFoodPopup(food, qty);
      });
    });
  }

  _hideSearchResults() {
    const r = this._refs;
    if (r.searchResults) {
      r.searchResults.classList.remove('visible');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Popup détails aliment
  // ═══════════════════════════════════════════════════════════════

  _showFoodPopup(food, initialQty = 1) {
    this._hideSearchResults();

    // Supprime une éventuelle popup existante
    document.querySelector('.food-popup-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'food-popup-overlay';

    const calcForQty = (qty) => {
      const factor = (food.servingGrams / 100) * qty;
      return {
        calories: r1(food.calories * factor),
        protein:  r1(food.protein * factor),
        fat:      r1(food.fat * factor),
        carbs:    r1(food.carbs * factor),
      };
    };

    const renderContent = (qty) => {
      const vals = calcForQty(qty);
      return `
        <div class="food-popup">
          <button class="food-popup-close" aria-label="Fermer">✕</button>
          <div class="fp-header">
            <span class="fp-emoji">${food.emoji}</span>
            <div>
              <h3 class="fp-name">${this._esc(food.name)}</h3>
              <p class="fp-serving">${food.serving}</p>
            </div>
          </div>

          <div class="fp-macros">
            <div class="fp-macro">
              <span class="fp-macro-val">${vals.calories}</span>
              <span class="fp-macro-label">kcal</span>
            </div>
            <div class="fp-macro" style="color:${COLORS.protein}">
              <span class="fp-macro-val">${vals.protein}g</span>
              <span class="fp-macro-label">Protéines</span>
            </div>
            <div class="fp-macro" style="color:${COLORS.fat}">
              <span class="fp-macro-val">${vals.fat}g</span>
              <span class="fp-macro-label">Lipides</span>
            </div>
            <div class="fp-macro" style="color:${COLORS.carbs}">
              <span class="fp-macro-val">${vals.carbs}g</span>
              <span class="fp-macro-label">Glucides</span>
            </div>
          </div>

          <div class="fp-qty-row">
            <label class="fp-qty-label">Quantité (portions)</label>
            <div class="fp-qty-controls">
              <button class="fp-qty-btn fp-qty-minus" aria-label="Moins">−</button>
              <input type="number" class="fp-qty-input" value="${qty}" min="0.25" step="0.25">
              <button class="fp-qty-btn fp-qty-plus" aria-label="Plus">+</button>
            </div>
          </div>

          <button class="btn btn-primary fp-add-btn">Ajouter au journal</button>
        </div>
      `;
    };

    overlay.innerHTML = renderContent(initialQty);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('visible'));

    // ── Interactions popup ──
    let currentQty = initialQty;

    const qtyInput = overlay.querySelector('.fp-qty-input');
    const updatePopup = (newQty) => {
      currentQty = Math.max(0.25, newQty);
      qtyInput.value = currentQty;
      // Met à jour les valeurs macro affichées
      const vals = calcForQty(currentQty);
      const macroVals = overlay.querySelectorAll('.fp-macro-val');
      macroVals[0].textContent = vals.calories;
      macroVals[1].textContent = vals.protein + 'g';
      macroVals[2].textContent = vals.fat + 'g';
      macroVals[3].textContent = vals.carbs + 'g';
    };

    overlay.querySelector('.fp-qty-minus').addEventListener('click', () => {
      updatePopup(currentQty - 0.25);
    });
    overlay.querySelector('.fp-qty-plus').addEventListener('click', () => {
      updatePopup(currentQty + 0.25);
    });
    qtyInput.addEventListener('change', () => {
      updatePopup(parseFloat(qtyInput.value) || 1);
    });

    // Fermer
    const closePopup = () => {
      overlay.classList.remove('visible');
      setTimeout(() => overlay.remove(), 250);
    };
    overlay.querySelector('.food-popup-close').addEventListener('click', closePopup);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closePopup();
    });

    // Ajouter au journal
    overlay.querySelector('.fp-add-btn').addEventListener('click', () => {
      const vals = calcForQty(currentQty);
      this.addItem({
        id:       uid(),
        foodId:   food.id,
        name:     food.name,
        emoji:    food.emoji,
        qty:      currentQty,
        serving:  food.serving,
        calories: vals.calories,
        protein:  vals.protein,
        fat:      vals.fat,
        carbs:    vals.carbs,
      });
      closePopup();
      // Clear search
      if (this._refs.searchInput) this._refs.searchInput.value = '';
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // 2. Journal du jour (CRUD)
  // ═══════════════════════════════════════════════════════════════

  /** Ajoute un aliment au journal du jour */
  addItem(item) {
    this.journal.items.push(item);
    this._recalcTotals();
    this._saveJournal(this.date);
    this.render();
    this._showToast(`${item.emoji} ${item.name} ajouté !`);
  }

  /** Supprime un aliment par id */
  removeItem(itemId) {
    const idx = this.journal.items.findIndex(i => i.id === itemId);
    if (idx === -1) return;
    const item = this.journal.items[idx];
    this.journal.items.splice(idx, 1);
    this._recalcTotals();
    this._saveJournal(this.date);
    this.render();
    this._showToast(`${item.emoji} ${item.name} retiré`);
  }

  /** Recalcule les totaux */
  _recalcTotals() {
    const items = this.journal.items;
    this.journal.totalCalories = r1(items.reduce((s, i) => s + i.calories, 0));
    this.journal.totalProtein  = r1(items.reduce((s, i) => s + i.protein, 0));
    this.journal.totalFat      = r1(items.reduce((s, i) => s + i.fat, 0));
    this.journal.totalCarbs    = r1(items.reduce((s, i) => s + i.carbs, 0));
  }

  // ═══════════════════════════════════════════════════════════════
  // 3. Rendu principal
  // ═══════════════════════════════════════════════════════════════

  render() {
    this._renderCalorieGauge();
    this._renderMacros();
    this._renderMealList();
    this._renderNavigationDate();
  }

  // ── Jauge circulaire calories ──

  _renderCalorieGauge() {
    const el = this._refs.calorieGauge;
    if (!el) return;

    const consumed = this.journal.totalCalories;
    const goal     = this.goals.calories;
    const pct      = goal > 0 ? Math.min(consumed / goal, 1.5) : 0;
    const pctClamped = Math.min(pct, 1);
    const overBudget = consumed > goal;

    // SVG circulaire
    const size   = 160;
    const stroke = 12;
    const radius = (size - stroke) / 2;
    const circ   = 2 * Math.PI * radius;
    const offset = circ * (1 - pctClamped);
    const color  = overBudget ? COLORS.danger : COLORS.accent;

    el.innerHTML = `
      <div class="calorie-gauge-wrap">
        <svg class="calorie-gauge-svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
          <!-- Fond -->
          <circle cx="${size/2}" cy="${size/2}" r="${radius}"
            fill="none" stroke="${COLORS.surfaceAlt}" stroke-width="${stroke}" />
          <!-- Progression -->
          <circle cx="${size/2}" cy="${size/2}" r="${radius}"
            fill="none" stroke="${color}" stroke-width="${stroke}"
            stroke-linecap="round"
            stroke-dasharray="${circ}"
            stroke-dashoffset="${offset}"
            transform="rotate(-90 ${size/2} ${size/2})"
            class="calorie-gauge-progress" />
        </svg>
        <div class="calorie-gauge-text">
          <span class="cg-consumed">${Math.round(consumed)}</span>
          <span class="cg-separator">/ ${Math.round(goal)} kcal</span>
        </div>
      </div>
      <div class="calorie-gauge-footer">
        ${overBudget
          ? `<span class="cg-over">+${Math.round(consumed - goal)} kcal en surplus</span>`
          : `<span class="cg-remaining">${Math.round(goal - consumed)} kcal restantes</span>`
        }
      </div>
    `;
  }

  // ── Barres macros ──

  _renderMacros() {
    const el = this._refs.macrosGrid;
    if (!el) return;

    const macros = [
      { key: 'protein', label: 'Protéines', color: COLORS.protein, current: this.journal.totalProtein, goal: this.goals.protein },
      { key: 'fat',     label: 'Lipides',   color: COLORS.fat,     current: this.journal.totalFat,     goal: this.goals.fat },
      { key: 'carbs',   label: 'Glucides',  color: COLORS.carbs,   current: this.journal.totalCarbs,   goal: this.goals.carbs },
    ];

    el.innerHTML = macros.map(m => {
      const pct = m.goal > 0 ? Math.min((m.current / m.goal) * 100, 100) : 0;
      return `
        <div class="macro-bar-item">
          <div class="macro-bar-header">
            <span class="macro-bar-label" style="color:${m.color}">${m.label}</span>
            <span class="macro-bar-values">${r1(m.current)}g / ${m.goal}g</span>
          </div>
          <div class="macro-bar-track">
            <div class="macro-bar-fill" style="width:${pct}%; background:${m.color}"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  // ── Liste repas du jour ──

  _renderMealList() {
    const el = this._refs.mealList;
    if (!el) return;

    const items = this.journal.items;

    if (items.length === 0) {
      el.innerHTML = `
        <li class="meal-empty">
          <span class="meal-empty-icon">🍽️</span>
          <span>Aucun aliment ajouté</span>
        </li>
      `;
      return;
    }

    el.innerHTML = items.map(item => `
      <li class="meal-item" data-item-id="${item.id}">
        <span class="mi-emoji">${item.emoji}</span>
        <div class="mi-info">
          <span class="mi-name">${this._esc(item.name)}${item.qty > 1 ? ` ×${item.qty}` : ''}</span>
          <span class="mi-macros">${Math.round(item.calories)} kcal · P ${r1(item.protein)}g · L ${r1(item.fat)}g · G ${r1(item.carbs)}g</span>
        </div>
        <button class="meal-item-delete" data-item-id="${item.id}" aria-label="Supprimer">✕</button>
      </li>
    `).join('') + `
      <li class="meal-total">
        <span class="mt-label">Total</span>
        <span class="mt-values">${Math.round(this.journal.totalCalories)} kcal · P ${r1(this.journal.totalProtein)}g · L ${r1(this.journal.totalFat)}g · G ${r1(this.journal.totalCarbs)}g</span>
      </li>
    `;
  }

  // ── Navigation de date (pour historique) ──

  _renderNavigationDate() {
    const container = this._refs.pageContent;
    if (!container) return;

    // Crée ou met à jour la barre de navigation date
    let nav = container.querySelector('.nutrition-date-nav');
    if (!nav) {
      nav = document.createElement('div');
      nav.className = 'nutrition-date-nav';
      // Insère après la search bar
      const searchBar = container.querySelector('.search-bar');
      if (searchBar) {
        searchBar.after(nav);
      } else {
        container.prepend(nav);
      }
    }

    const isToday = this.date === todayISO();

    nav.innerHTML = `
      <button class="ndn-btn ndn-prev" aria-label="Jour précédent">‹</button>
      <span class="ndn-date ${isToday ? 'ndn-today' : ''}">${isToday ? "Aujourd'hui" : formatDateFR(this.date)}</span>
      <button class="ndn-btn ndn-next ${isToday ? 'ndn-disabled' : ''}" aria-label="Jour suivant" ${isToday ? 'disabled' : ''}>›</button>
      <button class="ndn-btn ndn-goals" aria-label="Objectifs" title="Objectifs">⚙️</button>
      <button class="ndn-btn ndn-history" aria-label="Historique" title="Historique 7j">📊</button>
    `;

    // Événements navigation
    nav.querySelector('.ndn-prev').onclick = () => this._navigateDate(-1);
    nav.querySelector('.ndn-next').onclick = () => {
      if (!isToday) this._navigateDate(1);
    };
    nav.querySelector('.ndn-goals').onclick = () => this._showGoalsPopup();
    nav.querySelector('.ndn-history').onclick = () => this._showHistoryPopup();
  }

  _navigateDate(delta) {
    const d = new Date(this.date + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    this.date = d.toISOString().slice(0, 10);
    this.journal = this._loadJournal(this.date);
    this.render();
  }

  // ═══════════════════════════════════════════════════════════════
  // 4. Objectifs nutritionnels
  // ═══════════════════════════════════════════════════════════════

  _showGoalsPopup() {
    document.querySelector('.goals-popup-overlay')?.remove();

    const g = this.goals;
    const overlay = document.createElement('div');
    overlay.className = 'food-popup-overlay';

    overlay.innerHTML = `
      <div class="food-popup goals-popup">
        <button class="food-popup-close" aria-label="Fermer">✕</button>
        <h3 class="fp-title">🎯 Objectifs nutritionnels</h3>

        <div class="goals-form">
          <div class="goal-field">
            <label>Calories (kcal/jour)</label>
            <input type="number" class="goal-input" data-key="calories" value="${g.calories}" min="500" max="10000" step="50">
          </div>
          <div class="goal-field">
            <label style="color:${COLORS.protein}">Protéines (g/jour)</label>
            <input type="number" class="goal-input" data-key="protein" value="${g.protein}" min="10" max="500" step="5">
          </div>
          <div class="goal-field">
            <label style="color:${COLORS.fat}">Lipides (g/jour)</label>
            <input type="number" class="goal-input" data-key="fat" value="${g.fat}" min="10" max="300" step="5">
          </div>
          <div class="goal-field">
            <label style="color:${COLORS.carbs}">Glucides (g/jour)</label>
            <input type="number" class="goal-input" data-key="carbs" value="${g.carbs}" min="10" max="800" step="5">
          </div>
        </div>

        <button class="btn btn-primary fp-add-btn goals-save-btn">Enregistrer</button>
      </div>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('visible'));

    const closePopup = () => {
      overlay.classList.remove('visible');
      setTimeout(() => overlay.remove(), 250);
    };

    overlay.querySelector('.food-popup-close').addEventListener('click', closePopup);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closePopup();
    });

    overlay.querySelector('.goals-save-btn').addEventListener('click', () => {
      overlay.querySelectorAll('.goal-input').forEach(input => {
        const key = input.dataset.key;
        const val = parseFloat(input.value);
        if (key && !isNaN(val) && val > 0) {
          this.goals[key] = val;
        }
      });
      this._saveGoals();
      closePopup();
      this.render();
      this._showToast('🎯 Objectifs mis à jour !');
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // 5. Historique (7 jours + moyenne)
  // ═══════════════════════════════════════════════════════════════

  _showHistoryPopup() {
    document.querySelector('.history-popup-overlay')?.remove();

    const days = this._getLast7Days();
    const avg  = this._calcAverage(days);

    const overlay = document.createElement('div');
    overlay.className = 'food-popup-overlay history-popup-overlay';

    overlay.innerHTML = `
      <div class="food-popup history-popup">
        <button class="food-popup-close" aria-label="Fermer">✕</button>
        <h3 class="fp-title">📊 Historique — 7 derniers jours</h3>

        <div class="history-avg">
          <div class="ha-title">Moyenne quotidienne</div>
          <div class="ha-grid">
            <div class="ha-item">
              <span class="ha-val">${Math.round(avg.calories)}</span>
              <span class="ha-label">kcal</span>
            </div>
            <div class="ha-item" style="color:${COLORS.protein}">
              <span class="ha-val">${r1(avg.protein)}g</span>
              <span class="ha-label">Prot.</span>
            </div>
            <div class="ha-item" style="color:${COLORS.fat}">
              <span class="ha-val">${r1(avg.fat)}g</span>
              <span class="ha-label">Lip.</span>
            </div>
            <div class="ha-item" style="color:${COLORS.carbs}">
              <span class="ha-val">${r1(avg.carbs)}g</span>
              <span class="ha-label">Gluc.</span>
            </div>
          </div>
        </div>

        <div class="history-chart">
          ${this._renderMiniBarChart(days)}
        </div>

        <ul class="history-day-list">
          ${days.map(d => `
            <li class="hd-item ${d.date === todayISO() ? 'hd-today' : ''}">
              <span class="hd-date">${d.date === todayISO() ? "Auj." : formatDateFR(d.date)}</span>
              <span class="hd-cal">${Math.round(d.calories)} kcal</span>
              <span class="hd-macros">P ${r1(d.protein)}g · L ${r1(d.fat)}g · G ${r1(d.carbs)}g</span>
            </li>
          `).join('')}
        </ul>
      </div>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('visible'));

    const closePopup = () => {
      overlay.classList.remove('visible');
      setTimeout(() => overlay.remove(), 250);
    };

    overlay.querySelector('.food-popup-close').addEventListener('click', closePopup);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closePopup();
    });
  }

  /** Récupère les données des 7 derniers jours */
  _getLast7Days() {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      const journal = this._loadJournal(iso);
      days.push({
        date:     iso,
        calories: journal.totalCalories,
        protein:  journal.totalProtein,
        fat:      journal.totalFat,
        carbs:    journal.totalCarbs,
        items:    journal.items.length,
      });
    }
    return days;
  }

  /** Calcule la moyenne sur les jours qui ont des données */
  _calcAverage(days) {
    const active = days.filter(d => d.items > 0);
    if (active.length === 0) return { calories: 0, protein: 0, fat: 0, carbs: 0 };
    const n = active.length;
    return {
      calories: active.reduce((s, d) => s + d.calories, 0) / n,
      protein:  active.reduce((s, d) => s + d.protein, 0) / n,
      fat:      active.reduce((s, d) => s + d.fat, 0) / n,
      carbs:    active.reduce((s, d) => s + d.carbs, 0) / n,
    };
  }

  /** Mini bar chart SVG pour l'historique */
  _renderMiniBarChart(days) {
    const maxCal = Math.max(this.goals.calories, ...days.map(d => d.calories), 1);
    const barW = 28;
    const gap = 8;
    const chartH = 100;
    const chartW = days.length * (barW + gap) - gap;

    const bars = days.map((d, i) => {
      const h = (d.calories / maxCal) * (chartH - 20);
      const x = i * (barW + gap);
      const y = chartH - h - 10;
      const isOver = d.calories > this.goals.calories;
      const color = d.items === 0 ? COLORS.surfaceAlt : (isOver ? COLORS.danger : COLORS.accent);
      const dayLabel = new Date(d.date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'narrow' });
      return `
        <rect x="${x}" y="${y}" width="${barW}" height="${Math.max(h, 2)}" rx="4" fill="${color}" />
        <text x="${x + barW/2}" y="${chartH}" text-anchor="middle" fill="${COLORS.textSec}" font-size="10">${dayLabel}</text>
      `;
    }).join('');

    // Ligne objectif
    const goalY = chartH - 10 - (this.goals.calories / maxCal) * (chartH - 20);

    return `
      <svg class="history-bars-svg" width="${chartW}" height="${chartH}" viewBox="0 0 ${chartW} ${chartH}">
        <line x1="0" y1="${goalY}" x2="${chartW}" y2="${goalY}" stroke="${COLORS.textSec}" stroke-width="1" stroke-dasharray="4 3" opacity="0.5" />
        ${bars}
      </svg>
    `;
  }

  // ═══════════════════════════════════════════════════════════════
  // Stockage localStorage
  // ═══════════════════════════════════════════════════════════════

  _storageKey(type, date) {
    if (type === 'meals') return `meals_${this.userId}_${date}`;
    if (type === 'goals') return `nutritionGoals_${this.userId}`;
    return `nutrition_${this.userId}_${type}`;
  }

  _loadJournal(date) {
    try {
      const raw = localStorage.getItem(this._storageKey('meals', date));
      if (raw) {
        const data = JSON.parse(raw);
        return {
          items:         Array.isArray(data.items) ? data.items : [],
          totalCalories: data.totalCalories || 0,
          totalProtein:  data.totalProtein || 0,
          totalFat:      data.totalFat || 0,
          totalCarbs:    data.totalCarbs || 0,
        };
      }
    } catch (e) {
      console.warn('[Nutrition] Erreur lecture journal:', e);
    }
    return { items: [], totalCalories: 0, totalProtein: 0, totalFat: 0, totalCarbs: 0 };
  }

  _saveJournal(date) {
    try {
      localStorage.setItem(
        this._storageKey('meals', date),
        JSON.stringify(this.journal)
      );
    } catch (e) {
      console.warn('[Nutrition] Erreur sauvegarde journal:', e);
    }
  }

  _loadGoals() {
    try {
      const raw = localStorage.getItem(this._storageKey('goals'));
      if (raw) {
        const data = JSON.parse(raw);
        return {
          calories: data.calories || 2500,
          protein:  data.protein  || 150,
          fat:      data.fat      || 80,
          carbs:    data.carbs    || 250,
        };
      }
    } catch (e) {
      console.warn('[Nutrition] Erreur lecture objectifs:', e);
    }
    // Valeurs par défaut
    return { calories: 2500, protein: 150, fat: 80, carbs: 250 };
  }

  _saveGoals() {
    try {
      localStorage.setItem(
        this._storageKey('goals'),
        JSON.stringify(this.goals)
      );
    } catch (e) {
      console.warn('[Nutrition] Erreur sauvegarde objectifs:', e);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // API publique (pour app.js / dashboard)
  // ═══════════════════════════════════════════════════════════════

  /** Retourne les totaux du jour (pour le dashboard accueil) */
  getTodaySummary() {
    const journal = this._loadJournal(todayISO());
    return {
      calories: journal.totalCalories,
      protein:  journal.totalProtein,
      fat:      journal.totalFat,
      carbs:    journal.totalCarbs,
      goal:     this.goals.calories,
      items:    journal.items.length,
    };
  }

  /** Change l'utilisateur actif */
  setUser(userId) {
    this.userId = userId;
    this.goals = this._loadGoals();
    this.journal = this._loadJournal(this.date);
    this.render();
  }

  /** Force le rechargement des données du jour */
  refresh() {
    this.date = todayISO();
    this.journal = this._loadJournal(this.date);
    this.goals = this._loadGoals();
    this.render();
  }

  // ═══════════════════════════════════════════════════════════════
  // Utilitaires
  // ═══════════════════════════════════════════════════════════════

  /** Échappe le HTML */
  _esc(str) {
    const el = document.createElement('span');
    el.textContent = str;
    return el.innerHTML;
  }

  /** Toast notification rapide */
  _showToast(msg, durationMs = 2200) {
    const existing = document.querySelector('.nutrition-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'nutrition-toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('visible'));

    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 300);
    }, durationMs);
  }

  // ═══════════════════════════════════════════════════════════════
  // Styles dynamiques (injectés une seule fois)
  // ═══════════════════════════════════════════════════════════════

  _injectStyles() {
    if (document.getElementById('nutrition-module-styles')) return;

    const style = document.createElement('style');
    style.id = 'nutrition-module-styles';
    style.textContent = `

      /* ── Recherche ────────────────────────────── */
      .search-bar { position: relative; }

      .search-results {
        position: absolute;
        top: 100%;
        left: 0; right: 0;
        z-index: 100;
        background: ${COLORS.surface};
        border-radius: 0 0 12px 12px;
        max-height: 320px;
        overflow-y: auto;
        display: none;
        box-shadow: 0 8px 32px rgba(0,0,0,.4);
      }
      .search-results.visible { display: block; }

      .search-result-item {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        padding: 10px 14px;
        border: none;
        background: none;
        color: ${COLORS.textPri};
        font-size: 15px;
        cursor: pointer;
        text-align: left;
        transition: background .15s;
      }
      .search-result-item:hover,
      .search-result-item:focus { background: ${COLORS.surfaceAlt}; }

      .sri-emoji { font-size: 24px; flex-shrink: 0; width: 32px; text-align: center; }
      .sri-info  { flex: 1; display: flex; flex-direction: column; gap: 1px; }
      .sri-name  { font-weight: 600; }
      .sri-detail { font-size: 13px; color: ${COLORS.textSec}; }
      .sri-arrow  { color: ${COLORS.textSec}; font-size: 20px; flex-shrink: 0; }

      .search-no-result {
        padding: 18px 14px;
        color: ${COLORS.textSec};
        font-size: 14px;
        text-align: center;
      }

      /* ── Popup aliment ───────────────────────── */
      .food-popup-overlay {
        position: fixed;
        inset: 0;
        z-index: 1000;
        background: rgba(0,0,0,.55);
        display: flex;
        align-items: flex-end;
        justify-content: center;
        opacity: 0;
        transition: opacity .25s;
      }
      .food-popup-overlay.visible { opacity: 1; }

      .food-popup {
        position: relative;
        width: 100%;
        max-width: 440px;
        background: ${COLORS.surface};
        border-radius: 20px 20px 0 0;
        padding: 24px 20px 32px;
        transform: translateY(100%);
        transition: transform .3s cubic-bezier(.22,1,.36,1);
        max-height: 90vh;
        overflow-y: auto;
      }
      .food-popup-overlay.visible .food-popup { transform: translateY(0); }

      .food-popup-close {
        position: absolute;
        top: 14px; right: 14px;
        background: ${COLORS.surfaceAlt};
        border: none;
        color: ${COLORS.textSec};
        width: 32px; height: 32px;
        border-radius: 50%;
        font-size: 16px;
        cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        transition: background .15s;
      }
      .food-popup-close:hover { background: ${COLORS.danger}; color: #fff; }

      .fp-title {
        font-size: 18px;
        font-weight: 700;
        margin-bottom: 18px;
        color: ${COLORS.textPri};
      }

      .fp-header {
        display: flex;
        align-items: center;
        gap: 14px;
        margin-bottom: 20px;
      }
      .fp-emoji { font-size: 42px; }
      .fp-name  { font-size: 18px; font-weight: 700; margin: 0; color: ${COLORS.textPri}; }
      .fp-serving { font-size: 13px; color: ${COLORS.textSec}; margin: 2px 0 0; }

      .fp-macros {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 8px;
        background: ${COLORS.bg};
        border-radius: 12px;
        padding: 14px 10px;
        margin-bottom: 18px;
        text-align: center;
      }
      .fp-macro-val   { display: block; font-size: 18px; font-weight: 700; }
      .fp-macro-label { display: block; font-size: 11px; color: ${COLORS.textSec}; margin-top: 2px; }

      .fp-qty-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 20px;
      }
      .fp-qty-label { font-size: 14px; color: ${COLORS.textSec}; }
      .fp-qty-controls { display: flex; align-items: center; gap: 6px; }
      .fp-qty-btn {
        width: 36px; height: 36px;
        border-radius: 10px;
        border: none;
        background: ${COLORS.surfaceAlt};
        color: ${COLORS.textPri};
        font-size: 20px;
        cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        transition: background .15s;
      }
      .fp-qty-btn:hover { background: ${COLORS.accent}; }
      .fp-qty-input {
        width: 54px;
        text-align: center;
        background: ${COLORS.bg};
        border: 1px solid ${COLORS.surfaceAlt};
        border-radius: 8px;
        color: ${COLORS.textPri};
        font-size: 16px;
        font-weight: 600;
        padding: 6px 4px;
      }

      .fp-add-btn {
        width: 100%;
        padding: 14px;
        border: none;
        border-radius: 12px;
        font-size: 16px;
        font-weight: 600;
        cursor: pointer;
      }

      /* ── Jauge calories ──────────────────────── */
      .calorie-gauge-wrap {
        position: relative;
        display: flex;
        justify-content: center;
        padding: 10px 0;
      }
      .calorie-gauge-text {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        text-align: center;
        line-height: 1.2;
      }
      .cg-consumed { display: block; font-size: 28px; font-weight: 800; color: ${COLORS.textPri}; }
      .cg-separator { display: block; font-size: 12px; color: ${COLORS.textSec}; }

      .calorie-gauge-progress {
        transition: stroke-dashoffset .6s cubic-bezier(.22,1,.36,1);
      }

      .calorie-gauge-footer {
        text-align: center;
        padding: 4px 0 2px;
        font-size: 13px;
      }
      .cg-remaining { color: ${COLORS.textSec}; }
      .cg-over { color: ${COLORS.danger}; font-weight: 600; }

      /* ── Barres macros ───────────────────────── */
      .macro-bar-item { margin-bottom: 14px; }
      .macro-bar-item:last-child { margin-bottom: 0; }

      .macro-bar-header {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        margin-bottom: 6px;
      }
      .macro-bar-label { font-size: 14px; font-weight: 600; }
      .macro-bar-values { font-size: 13px; color: ${COLORS.textSec}; }

      .macro-bar-track {
        width: 100%;
        height: 8px;
        background: ${COLORS.surfaceAlt};
        border-radius: 4px;
        overflow: hidden;
      }
      .macro-bar-fill {
        height: 100%;
        border-radius: 4px;
        transition: width .5s cubic-bezier(.22,1,.36,1);
      }

      /* ── Liste repas ─────────────────────────── */
      .meal-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 0;
        border-bottom: 1px solid ${COLORS.surfaceAlt};
        list-style: none;
      }
      .meal-item:last-of-type { border-bottom: none; }

      .mi-emoji { font-size: 24px; flex-shrink: 0; width: 32px; text-align: center; }
      .mi-info  { flex: 1; display: flex; flex-direction: column; gap: 2px; }
      .mi-name  { font-size: 15px; font-weight: 600; color: ${COLORS.textPri}; }
      .mi-macros { font-size: 12px; color: ${COLORS.textSec}; }

      .meal-item-delete {
        background: none;
        border: none;
        color: ${COLORS.textSec};
        font-size: 16px;
        padding: 6px 8px;
        cursor: pointer;
        border-radius: 8px;
        transition: all .15s;
      }
      .meal-item-delete:hover { color: ${COLORS.danger}; background: rgba(255,69,58,.15); }

      .meal-total {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 0 4px;
        border-top: 2px solid ${COLORS.surfaceAlt};
        list-style: none;
        margin-top: 4px;
      }
      .mt-label  { font-size: 15px; font-weight: 700; color: ${COLORS.textPri}; }
      .mt-values { font-size: 13px; color: ${COLORS.accent}; font-weight: 600; }

      .meal-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        padding: 24px 0;
        color: ${COLORS.textSec};
        font-size: 14px;
        list-style: none;
      }
      .meal-empty-icon { font-size: 32px; }

      /* ── Navigation date ─────────────────────── */
      .nutrition-date-nav {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 8px 0 4px;
      }
      .ndn-btn {
        background: ${COLORS.surfaceAlt};
        border: none;
        color: ${COLORS.textPri};
        width: 34px; height: 34px;
        border-radius: 10px;
        font-size: 18px;
        cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        transition: background .15s;
      }
      .ndn-btn:hover { background: ${COLORS.accent}; }
      .ndn-btn.ndn-disabled { opacity: .3; cursor: not-allowed; }
      .ndn-btn.ndn-disabled:hover { background: ${COLORS.surfaceAlt}; }

      .ndn-date {
        font-size: 15px;
        font-weight: 600;
        color: ${COLORS.textPri};
        min-width: 110px;
        text-align: center;
      }
      .ndn-today { color: ${COLORS.accent}; }

      /* ── Objectifs form ──────────────────────── */
      .goals-form { display: flex; flex-direction: column; gap: 14px; margin-bottom: 20px; }
      .goal-field label {
        display: block;
        font-size: 13px;
        color: ${COLORS.textSec};
        margin-bottom: 6px;
        font-weight: 600;
      }
      .goal-input {
        width: 100%;
        padding: 10px 12px;
        background: ${COLORS.bg};
        border: 1px solid ${COLORS.surfaceAlt};
        border-radius: 10px;
        color: ${COLORS.textPri};
        font-size: 16px;
        font-weight: 600;
        box-sizing: border-box;
      }
      .goal-input:focus {
        outline: none;
        border-color: ${COLORS.accent};
      }

      /* ── Historique popup ────────────────────── */
      .history-popup { max-height: 85vh; }

      .history-avg {
        background: ${COLORS.bg};
        border-radius: 12px;
        padding: 14px;
        margin-bottom: 16px;
      }
      .ha-title { font-size: 13px; color: ${COLORS.textSec}; margin-bottom: 10px; text-align: center; }
      .ha-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 6px;
        text-align: center;
      }
      .ha-val   { display: block; font-size: 18px; font-weight: 700; }
      .ha-label { display: block; font-size: 11px; color: ${COLORS.textSec}; margin-top: 2px; }

      .history-chart {
        display: flex;
        justify-content: center;
        padding: 8px 0 14px;
        overflow-x: auto;
      }

      .history-day-list {
        list-style: none;
        padding: 0;
        margin: 0;
      }
      .hd-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 0;
        border-bottom: 1px solid ${COLORS.surfaceAlt};
        font-size: 13px;
      }
      .hd-item:last-child { border-bottom: none; }
      .hd-date  { width: 60px; font-weight: 600; color: ${COLORS.textSec}; }
      .hd-today .hd-date { color: ${COLORS.accent}; }
      .hd-cal   { font-weight: 700; color: ${COLORS.textPri}; min-width: 70px; }
      .hd-macros { color: ${COLORS.textSec}; flex: 1; text-align: right; }

      /* ── Toast ───────────────────────────────── */
      .nutrition-toast {
        position: fixed;
        bottom: 90px;
        left: 50%;
        transform: translateX(-50%) translateY(20px);
        background: ${COLORS.surface};
        color: ${COLORS.textPri};
        padding: 10px 20px;
        border-radius: 12px;
        font-size: 14px;
        font-weight: 600;
        box-shadow: 0 4px 20px rgba(0,0,0,.4);
        z-index: 2000;
        opacity: 0;
        transition: all .3s cubic-bezier(.22,1,.36,1);
        pointer-events: none;
        white-space: nowrap;
      }
      .nutrition-toast.visible {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }

      /* ── Responsive ──────────────────────────── */
      @media (min-width: 500px) {
        .food-popup {
          border-radius: 20px;
          margin-bottom: 20px;
        }
      }
    `;

    document.head.appendChild(style);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Auto-init quand le DOM est prêt
// ═══════════════════════════════════════════════════════════════════

// Exporte pour usage externe (app.js, dashboard…)
if (typeof window !== 'undefined') {
  window.NutritionModule = NutritionModule;
}

// Auto-initialise si la page nutrition est présente
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('page-nutrition')) {
    // Récupère userId depuis le profil si disponible, sinon "default"
    const storedUser = (() => {
      try {
        const p = localStorage.getItem('currentUser');
        return p ? JSON.parse(p).id || 'default' : 'default';
      } catch { return 'default'; }
    })();

    window.nutritionModule = new NutritionModule({ userId: storedUser });
    window.nutritionModule.init().then(() => {
      console.log('[Nutrition] Module initialisé ✓');
    });
  }
});
