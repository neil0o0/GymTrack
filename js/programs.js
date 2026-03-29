/* ============================================================
   MuscuApp — Module Programmes
   Gestion des programmes d'entraînement (prédéfinis + custom)
   ============================================================ */

class ProgramsModule {

  // ── Constructeur ──────────────────────────────
  constructor(userId = 'default') {
    this.userId = userId;

    // Données chargées
    this.presetPrograms = [];
    this.exercises = [];
    this.exercisesMap = new Map();

    // État interne
    this._container = null;
    this._currentView = 'list';   // list | detail | form
    this._editingProgram = null;   // programme en cours d'édition (null = création)
    this._formDays = [];           // jours du formulaire en cours
    this._initialized = false;

    // Clés localStorage
    this._keyCustom = `customPrograms_${this.userId}`;
    this._keyActive = `activeProgram_${this.userId}`;
  }


  // ═══════════════════════════════════════════════
  // 1. INITIALISATION & CHARGEMENT
  // ═══════════════════════════════════════════════

  /**
   * Initialise le module : charge les données JSON + localStorage
   * @param {string|HTMLElement} container - sélecteur ou élément DOM
   */
  async init(container) {
    if (typeof container === 'string') {
      this._container = document.querySelector(container);
    } else {
      this._container = container;
    }

    if (!this._container) {
      console.error('[Programs] Conteneur introuvable');
      return;
    }

    try {
      await Promise.all([
        this._loadPresetPrograms(),
        this._loadExercises()
      ]);
      this._initialized = true;
      this.renderList();
    } catch (err) {
      console.error('[Programs] Erreur initialisation:', err);
      this._container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">⚠️</div>
          <div class="empty-state-title">Erreur de chargement</div>
          <div class="empty-state-description">Impossible de charger les programmes. Réessaie plus tard.</div>
        </div>`;
    }
  }

  /** Charge les programmes prédéfinis depuis programs.json */
  async _loadPresetPrograms() {
    const basePath = this._resolveDataPath('data/programs.json');
    const resp = await fetch(basePath);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    this.presetPrograms = await resp.json();
  }

  /** Charge la bibliothèque d'exercices depuis exercises.json */
  async _loadExercises() {
    const basePath = this._resolveDataPath('data/exercises.json');
    const resp = await fetch(basePath);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    this.exercises = await resp.json();
    this.exercisesMap.clear();
    for (const ex of this.exercises) {
      this.exercisesMap.set(ex.id, ex);
    }
  }

  /** Résout le chemin relatif vers les fichiers data */
  _resolveDataPath(path) {
    // Cherche le chemin par rapport au script ou la racine de l'app
    const scripts = document.querySelectorAll('script[src]');
    for (const s of scripts) {
      if (s.src.includes('/js/')) {
        const base = s.src.substring(0, s.src.lastIndexOf('/js/') + 1);
        return base + path;
      }
    }
    return path;
  }


  // ═══════════════════════════════════════════════
  // 2. STOCKAGE localStorage
  // ═══════════════════════════════════════════════

  /** Récupère les programmes custom */
  getCustomPrograms() {
    try {
      const raw = localStorage.getItem(this._keyCustom);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  /** Sauvegarde les programmes custom */
  _saveCustomPrograms(programs) {
    localStorage.setItem(this._keyCustom, JSON.stringify(programs));
  }

  /** Récupère le programme actif */
  getActiveProgram() {
    try {
      const raw = localStorage.getItem(this._keyActive);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /** Sauvegarde le programme actif */
  _saveActiveProgram(data) {
    if (data) {
      localStorage.setItem(this._keyActive, JSON.stringify(data));
    } else {
      localStorage.removeItem(this._keyActive);
    }
  }

  /** Retourne tous les programmes (prédéfinis + custom) */
  getAllPrograms() {
    return [...this.presetPrograms, ...this.getCustomPrograms()];
  }

  /** Trouve un programme par id */
  findProgramById(id) {
    return this.getAllPrograms().find(p => p.id === id) || null;
  }


  // ═══════════════════════════════════════════════
  // 3. PROGRAMME ACTIF — CYCLE DES JOURS
  // ═══════════════════════════════════════════════

  /**
   * Active un programme pour l'utilisateur
   * @param {string} programId
   */
  activateProgram(programId) {
    const program = this.findProgramById(programId);
    if (!program) return null;

    const data = {
      programId: program.id,
      currentDayIndex: 0,
      startDate: new Date().toISOString().split('T')[0],
      lastWorkoutDate: null
    };
    this._saveActiveProgram(data);
    return data;
  }

  /** Désactive le programme actif */
  deactivateProgram() {
    this._saveActiveProgram(null);
  }

  /**
   * Récupère le jour d'entraînement courant du programme actif.
   * Avance automatiquement au jour suivant si le dernier entraînement
   * est daté d'aujourd'hui (séance terminée).
   */
  getCurrentDay() {
    const active = this.getActiveProgram();
    if (!active) return null;

    const program = this.findProgramById(active.programId);
    if (!program || !program.days || program.days.length === 0) return null;

    const dayIndex = active.currentDayIndex % program.days.length;
    return {
      ...program.days[dayIndex],
      dayIndex,
      totalDays: program.days.length,
      programName: program.name
    };
  }

  /**
   * Avance au jour suivant dans le cycle.
   * Appelé après qu'une séance est terminée.
   */
  advanceToNextDay() {
    const active = this.getActiveProgram();
    if (!active) return null;

    const program = this.findProgramById(active.programId);
    if (!program) return null;

    const totalDays = program.days.length;
    const today = new Date().toISOString().split('T')[0];

    active.currentDayIndex = (active.currentDayIndex + 1) % totalDays;
    active.lastWorkoutDate = today;
    this._saveActiveProgram(active);

    return this.getCurrentDay();
  }

  /**
   * Force un jour spécifique dans le cycle
   * @param {number} dayIndex
   */
  setCurrentDayIndex(dayIndex) {
    const active = this.getActiveProgram();
    if (!active) return;

    const program = this.findProgramById(active.programId);
    if (!program) return;

    active.currentDayIndex = dayIndex % program.days.length;
    this._saveActiveProgram(active);
  }


  // ═══════════════════════════════════════════════
  // 4. CRUD PROGRAMMES CUSTOM
  // ═══════════════════════════════════════════════

  /**
   * Crée un nouveau programme custom
   * @param {Object} data - { name, description, level, days }
   * @returns {Object} le programme créé
   */
  createCustomProgram(data) {
    const programs = this.getCustomPrograms();
    const program = {
      id: 'custom-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6),
      name: data.name || 'Mon programme',
      description: data.description || '',
      level: data.level || 'intermédiaire',
      daysPerWeek: (data.days || []).length,
      createdBy: this.userId,
      createdAt: new Date().toISOString(),
      isCustom: true,
      days: (data.days || []).map(day => ({
        name: day.name || 'Jour',
        exercises: (day.exercises || []).map(ex => ({
          exerciseId: ex.exerciseId,
          sets: parseInt(ex.sets) || 3,
          reps: parseInt(ex.reps) || 10,
          restSeconds: parseInt(ex.restSeconds) || 90
        }))
      }))
    };

    programs.push(program);
    this._saveCustomPrograms(programs);
    return program;
  }

  /**
   * Met à jour un programme custom
   * @param {string} id
   * @param {Object} data
   */
  updateCustomProgram(id, data) {
    const programs = this.getCustomPrograms();
    const idx = programs.findIndex(p => p.id === id);
    if (idx === -1) return null;

    programs[idx] = {
      ...programs[idx],
      name: data.name ?? programs[idx].name,
      description: data.description ?? programs[idx].description,
      level: data.level ?? programs[idx].level,
      daysPerWeek: data.days ? data.days.length : programs[idx].daysPerWeek,
      updatedAt: new Date().toISOString(),
      days: data.days ? data.days.map(day => ({
        name: day.name || 'Jour',
        exercises: (day.exercises || []).map(ex => ({
          exerciseId: ex.exerciseId,
          sets: parseInt(ex.sets) || 3,
          reps: parseInt(ex.reps) || 10,
          restSeconds: parseInt(ex.restSeconds) || 90
        }))
      })) : programs[idx].days
    };

    this._saveCustomPrograms(programs);

    // Mettre à jour le programme actif si c'est celui-ci
    const active = this.getActiveProgram();
    if (active && active.programId === id) {
      // Réajuster l'index si nécessaire
      const totalDays = programs[idx].days.length;
      if (active.currentDayIndex >= totalDays) {
        active.currentDayIndex = 0;
        this._saveActiveProgram(active);
      }
    }

    return programs[idx];
  }

  /**
   * Supprime un programme custom
   * @param {string} id
   */
  deleteCustomProgram(id) {
    let programs = this.getCustomPrograms();
    programs = programs.filter(p => p.id !== id);
    this._saveCustomPrograms(programs);

    // Si c'est le programme actif, le désactiver
    const active = this.getActiveProgram();
    if (active && active.programId === id) {
      this.deactivateProgram();
    }
  }


  // ═══════════════════════════════════════════════
  // 5. RENDU — LISTE DES PROGRAMMES
  // ═══════════════════════════════════════════════

  /** Affiche la liste de tous les programmes */
  renderList() {
    this._currentView = 'list';
    const active = this.getActiveProgram();
    const allPrograms = this.getAllPrograms();
    const customPrograms = this.getCustomPrograms();

    // Séparer prédéfinis et custom
    const presets = allPrograms.filter(p => !p.isCustom);
    const customs = allPrograms.filter(p => p.isCustom);

    this._container.innerHTML = `
      <header class="page-header">
        <h1 class="heading-large">Programmes</h1>
        <p class="text-secondary mt-1">Choisis ou crée ton programme</p>
      </header>

      <!-- Programme actif -->
      ${active ? this._renderActiveProgramBanner(active) : ''}

      <!-- Bouton créer -->
      <button class="btn btn-primary btn-block btn-lg mb-6" id="btn-create-program">
        ＋ Créer mon programme
      </button>

      <!-- Programmes custom -->
      ${customs.length > 0 ? `
        <div class="section">
          <h2 class="heading-subsection mb-3">Mes programmes</h2>
          <div class="list col gap-3" id="custom-programs-list">
            ${customs.map(p => this._renderProgramCard(p, active)).join('')}
          </div>
        </div>
      ` : ''}

      <!-- Programmes prédéfinis -->
      <div class="section">
        <h2 class="heading-subsection mb-3">Programmes prêts</h2>
        <div class="list col gap-3" id="preset-programs-list">
          ${presets.map(p => this._renderProgramCard(p, active)).join('')}
        </div>
      </div>
    `;

    this._bindListEvents();
  }

  /** Rendu d'une carte programme */
  _renderProgramCard(program, active) {
    const isActive = active && active.programId === program.id;
    const isCustom = program.isCustom === true;
    const totalExercises = (program.days || []).reduce(
      (sum, d) => sum + (d.exercises || []).length, 0
    );

    const levelColors = {
      'débutant': 'tag-success',
      'intermédiaire': 'tag-accent',
      'avancé': 'tag-danger'
    };
    const tagClass = levelColors[program.level] || 'tag-accent';

    return `
      <div class="card program-card ${isActive ? 'program-card--active' : ''}"
           data-program-id="${program.id}"
           data-is-custom="${isCustom}">
        <div class="row-between mb-2">
          <div class="row gap-2" style="flex-wrap: wrap;">
            <span class="tag ${tagClass}">${this._capitalize(program.level || '—')}</span>
            <span class="tag tag-accent">${program.daysPerWeek || (program.days || []).length}j / sem</span>
            ${isCustom ? '<span class="tag tag-warning">Custom</span>' : ''}
            ${isActive ? '<span class="tag tag-success">✓ Actif</span>' : ''}
          </div>
          ${isCustom ? `
            <div class="row gap-1">
              <button class="btn btn-ghost btn-sm btn-edit-program"
                      data-program-id="${program.id}" title="Éditer">✏️</button>
              <button class="btn btn-ghost btn-sm btn-delete-program"
                      data-program-id="${program.id}" title="Supprimer">🗑️</button>
            </div>
          ` : ''}
        </div>

        <h3 class="card-title mb-1">${this._esc(program.name)}</h3>

        ${program.description ? `
          <p class="card-body text-sm mb-3">${this._esc(program.description)}</p>
        ` : ''}

        <div class="row-between">
          <span class="text-sm text-secondary">
            ${(program.days || []).length} jours · ${totalExercises} exercices
          </span>
          <div class="row gap-2">
            <button class="btn btn-secondary btn-sm btn-view-program"
                    data-program-id="${program.id}">Détails</button>
            ${!isActive ? `
              <button class="btn btn-primary btn-sm btn-activate-program"
                      data-program-id="${program.id}">Activer</button>
            ` : `
              <button class="btn btn-ghost btn-sm btn-deactivate-program"
                      data-program-id="${program.id}">Désactiver</button>
            `}
          </div>
        </div>
      </div>
    `;
  }

  /** Bannière du programme actif */
  _renderActiveProgramBanner(active) {
    const program = this.findProgramById(active.programId);
    if (!program) return '';

    const currentDay = this.getCurrentDay();
    if (!currentDay) return '';

    return `
      <div class="card mb-4" style="border: 1px solid rgba(48, 209, 88, 0.3); background: rgba(48, 209, 88, 0.06);">
        <div class="card-label text-success">🏋️ Programme actif</div>
        <h3 class="card-title mt-2">${this._esc(program.name)}</h3>
        <p class="text-sm text-secondary mt-1">
          Prochain : <strong class="text-primary">${this._esc(currentDay.name)}</strong>
          — Jour ${currentDay.dayIndex + 1} / ${currentDay.totalDays}
        </p>
        <div class="row gap-2 mt-3">
          ${program.days.map((d, i) => `
            <span class="chip ${i === currentDay.dayIndex ? 'active' : ''}"
                  style="cursor: pointer;"
                  data-day-index="${i}"
                  data-program-id="${program.id}">
              ${this._esc(d.name)}
            </span>
          `).join('')}
        </div>
      </div>
    `;
  }

  /** Attache les événements de la vue liste */
  _bindListEvents() {
    // Créer un programme
    const btnCreate = this._container.querySelector('#btn-create-program');
    if (btnCreate) {
      btnCreate.addEventListener('click', () => this.renderForm());
    }

    // Voir les détails
    this._container.querySelectorAll('.btn-view-program').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.renderDetail(btn.dataset.programId);
      });
    });

    // Activer un programme
    this._container.querySelectorAll('.btn-activate-program').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.activateProgram(btn.dataset.programId);
        this.renderList();
        this._dispatchEvent('program-activated', { programId: btn.dataset.programId });
      });
    });

    // Désactiver
    this._container.querySelectorAll('.btn-deactivate-program').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deactivateProgram();
        this.renderList();
        this._dispatchEvent('program-deactivated');
      });
    });

    // Éditer un custom
    this._container.querySelectorAll('.btn-edit-program').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.renderForm(btn.dataset.programId);
      });
    });

    // Supprimer un custom
    this._container.querySelectorAll('.btn-delete-program').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._confirmDelete(btn.dataset.programId);
      });
    });

    // Clic sur chips jours (programme actif)
    this._container.querySelectorAll('.chip[data-day-index]').forEach(chip => {
      chip.addEventListener('click', () => {
        const idx = parseInt(chip.dataset.dayIndex);
        this.setCurrentDayIndex(idx);
        this.renderList();
      });
    });
  }


  // ═══════════════════════════════════════════════
  // 6. RENDU — DÉTAIL D'UN PROGRAMME
  // ═══════════════════════════════════════════════

  /** Affiche le détail d'un programme */
  renderDetail(programId) {
    this._currentView = 'detail';
    const program = this.findProgramById(programId);
    if (!program) {
      this.renderList();
      return;
    }

    const active = this.getActiveProgram();
    const isActive = active && active.programId === programId;

    this._container.innerHTML = `
      <header class="page-header">
        <button class="btn btn-ghost btn-sm mb-2" id="btn-back-list">← Retour</button>
        <h1 class="heading-large">${this._esc(program.name)}</h1>
        ${program.description ? `
          <p class="text-secondary mt-1">${this._esc(program.description)}</p>
        ` : ''}
        <div class="row gap-2 mt-3">
          <span class="tag ${this._levelTagClass(program.level)}">
            ${this._capitalize(program.level || '—')}
          </span>
          <span class="tag tag-accent">
            ${program.daysPerWeek || (program.days || []).length}j / sem
          </span>
          ${isActive ? '<span class="tag tag-success">✓ Actif</span>' : ''}
        </div>
      </header>

      <!-- Actions -->
      <div class="row gap-3 mb-6">
        ${!isActive ? `
          <button class="btn btn-primary flex-1" id="btn-detail-activate"
                  data-program-id="${programId}">
            Activer ce programme
          </button>
        ` : `
          <button class="btn btn-ghost flex-1" id="btn-detail-deactivate"
                  data-program-id="${programId}">
            Désactiver
          </button>
        `}
        ${program.isCustom ? `
          <button class="btn btn-secondary" id="btn-detail-edit"
                  data-program-id="${programId}">✏️ Éditer</button>
        ` : ''}
      </div>

      <!-- Jours du programme -->
      <div class="list col gap-4" id="program-days-list">
        ${(program.days || []).map((day, i) => this._renderDayDetail(day, i, isActive, active)).join('')}
      </div>
    `;

    this._bindDetailEvents(programId);
  }

  /** Rendu d'un jour dans la vue détail */
  _renderDayDetail(day, index, isActive, active) {
    const isCurrent = isActive && active && active.currentDayIndex === index;

    return `
      <div class="card ${isCurrent ? 'program-card--active' : ''}"
           style="${isCurrent ? 'border: 1px solid rgba(48, 209, 88, 0.3);' : ''}">
        <div class="row-between mb-3">
          <h3 class="card-title">
            ${isCurrent ? '▶ ' : ''}${this._esc(day.name)}
          </h3>
          <span class="text-sm text-secondary">${(day.exercises || []).length} exos</span>
        </div>
        <div class="list col gap-2">
          ${(day.exercises || []).map(ex => this._renderExerciseRow(ex)).join('')}
        </div>
      </div>
    `;
  }

  /** Rendu d'une ligne exercice dans un jour */
  _renderExerciseRow(exData) {
    const exercise = this.exercisesMap.get(exData.exerciseId);
    if (!exercise) {
      return `
        <div class="list-item" style="opacity: 0.5;">
          <div class="exercise-icon">❓</div>
          <div class="list-item-content">
            <div class="list-item-title">Exercice inconnu</div>
            <div class="list-item-subtitle">${exData.exerciseId}</div>
          </div>
        </div>
      `;
    }

    return `
      <div class="exercise-card">
        <div class="exercise-icon" title="${this._esc(exercise.muscle)}">
          ${exercise.svg ? `<div style="width:40px;height:40px;">${exercise.svg}</div>` : '💪'}
        </div>
        <div class="exercise-info">
          <div class="exercise-name">${this._esc(exercise.name)}</div>
          <div class="exercise-meta">
            ${exData.sets}×${exData.reps} · repos ${this._formatRest(exData.restSeconds)}
          </div>
        </div>
        <span class="chip">${this._capitalize(exercise.muscle)}</span>
      </div>
    `;
  }

  /** Attache les événements de la vue détail */
  _bindDetailEvents(programId) {
    const btnBack = this._container.querySelector('#btn-back-list');
    if (btnBack) btnBack.addEventListener('click', () => this.renderList());

    const btnActivate = this._container.querySelector('#btn-detail-activate');
    if (btnActivate) {
      btnActivate.addEventListener('click', () => {
        this.activateProgram(programId);
        this.renderDetail(programId);
        this._dispatchEvent('program-activated', { programId });
      });
    }

    const btnDeactivate = this._container.querySelector('#btn-detail-deactivate');
    if (btnDeactivate) {
      btnDeactivate.addEventListener('click', () => {
        this.deactivateProgram();
        this.renderDetail(programId);
        this._dispatchEvent('program-deactivated');
      });
    }

    const btnEdit = this._container.querySelector('#btn-detail-edit');
    if (btnEdit) {
      btnEdit.addEventListener('click', () => {
        this.renderForm(programId);
      });
    }
  }


  // ═══════════════════════════════════════════════
  // 7. RENDU — FORMULAIRE CRÉATION / ÉDITION
  // ═══════════════════════════════════════════════

  /**
   * Affiche le formulaire de création ou d'édition
   * @param {string|null} programId - null pour créer, id pour éditer
   */
  renderForm(programId = null) {
    this._currentView = 'form';
    this._editingProgram = programId ? this.findProgramById(programId) : null;

    // Initialiser les jours du formulaire
    if (this._editingProgram) {
      this._formDays = JSON.parse(JSON.stringify(this._editingProgram.days || []));
    } else {
      this._formDays = [{ name: 'Jour 1', exercises: [] }];
    }

    const isEdit = !!this._editingProgram;
    const title = isEdit ? 'Modifier le programme' : 'Créer un programme';

    this._container.innerHTML = `
      <header class="page-header">
        <button class="btn btn-ghost btn-sm mb-2" id="btn-form-back">← Annuler</button>
        <h1 class="heading-large">${title}</h1>
      </header>

      <form id="program-form" class="col gap-4">
        <!-- Nom -->
        <div class="input-group">
          <label class="input-label" for="prog-name">Nom du programme</label>
          <input type="text" class="input" id="prog-name"
                 placeholder="Ex: Mon PPL perso"
                 value="${this._esc(this._editingProgram?.name || '')}"
                 required maxlength="60">
        </div>

        <!-- Description -->
        <div class="input-group">
          <label class="input-label" for="prog-desc">Description (optionnel)</label>
          <textarea class="input" id="prog-desc" rows="2"
                    placeholder="Décris ton programme en quelques mots…"
                    maxlength="200">${this._esc(this._editingProgram?.description || '')}</textarea>
        </div>

        <!-- Niveau -->
        <div class="input-group">
          <label class="input-label">Niveau</label>
          <div class="chip-group" id="prog-level-chips">
            ${['débutant', 'intermédiaire', 'avancé'].map(lvl => `
              <button type="button" class="chip ${(this._editingProgram?.level || 'intermédiaire') === lvl ? 'active' : ''}"
                      data-level="${lvl}">
                ${this._capitalize(lvl)}
              </button>
            `).join('')}
          </div>
        </div>

        <!-- Jours -->
        <div class="section">
          <div class="row-between mb-3">
            <h2 class="section-title">Jours d'entraînement</h2>
            <button type="button" class="btn btn-secondary btn-sm" id="btn-add-day">+ Jour</button>
          </div>
          <div id="form-days-container" class="col gap-4">
            ${this._formDays.map((day, i) => this._renderFormDay(day, i)).join('')}
          </div>
        </div>

        <!-- Boutons action -->
        <div class="row gap-3 mt-4 mb-8">
          <button type="button" class="btn btn-ghost flex-1" id="btn-form-cancel">
            Annuler
          </button>
          <button type="submit" class="btn btn-primary flex-1" id="btn-form-save">
            ${isEdit ? '💾 Enregistrer' : '✅ Créer'}
          </button>
        </div>
      </form>

      <!-- Modal bibliothèque exercices (caché) -->
      <div class="modal-overlay" id="exercise-picker-overlay"></div>
      <div class="bottom-sheet" id="exercise-picker-sheet">
        <div class="bottom-sheet-handle"></div>
        <div class="bottom-sheet-title">Ajouter un exercice</div>
        <div id="exercise-picker-content"></div>
      </div>
    `;

    this._bindFormEvents();
  }

  /** Rendu d'un jour dans le formulaire */
  _renderFormDay(day, index) {
    return `
      <div class="card form-day-card" data-day-index="${index}">
        <div class="row-between mb-3">
          <input type="text" class="input form-day-name"
                 value="${this._esc(day.name)}"
                 placeholder="Nom du jour"
                 data-day-index="${index}"
                 style="max-width: 200px; font-weight: 600;">
          ${this._formDays.length > 1 ? `
            <button type="button" class="btn btn-ghost btn-sm text-danger btn-remove-day"
                    data-day-index="${index}" title="Supprimer ce jour">
              🗑️
            </button>
          ` : ''}
        </div>

        <!-- Exercices du jour -->
        <div class="col gap-2 form-day-exercises" data-day-index="${index}">
          ${(day.exercises || []).map((ex, ei) => this._renderFormExercise(ex, index, ei)).join('')}
        </div>

        ${(day.exercises || []).length === 0 ? `
          <div class="empty-state" style="padding: var(--space-4) 0;">
            <div class="text-sm text-secondary">Aucun exercice</div>
          </div>
        ` : ''}

        <button type="button" class="btn btn-secondary btn-sm btn-block mt-3 btn-add-exercise"
                data-day-index="${index}">
          + Ajouter un exercice
        </button>
      </div>
    `;
  }

  /** Rendu d'un exercice dans le formulaire d'un jour */
  _renderFormExercise(exData, dayIndex, exerciseIndex) {
    const exercise = this.exercisesMap.get(exData.exerciseId);
    const name = exercise ? exercise.name : exData.exerciseId;

    return `
      <div class="card-flat list-item form-exercise-item"
           data-day-index="${dayIndex}" data-exercise-index="${exerciseIndex}"
           style="padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm);">
        <div class="exercise-icon" style="width: 36px; height: 36px;">
          ${exercise?.svg ? `<div style="width:32px;height:32px;">${exercise.svg}</div>` : '💪'}
        </div>
        <div class="flex-1" style="min-width: 0;">
          <div class="text-sm font-semibold truncate">${this._esc(name)}</div>
          <div class="row gap-2 mt-1">
            <div class="row gap-1" style="align-items: center;">
              <input type="number" class="input form-ex-sets"
                     value="${exData.sets || 3}" min="1" max="20"
                     data-day-index="${dayIndex}" data-exercise-index="${exerciseIndex}"
                     style="width: 44px; padding: 4px; text-align: center; font-size: var(--fs-sm);">
              <span class="text-xs text-secondary">×</span>
              <input type="number" class="input form-ex-reps"
                     value="${exData.reps || 10}" min="1" max="100"
                     data-day-index="${dayIndex}" data-exercise-index="${exerciseIndex}"
                     style="width: 44px; padding: 4px; text-align: center; font-size: var(--fs-sm);">
              <span class="text-xs text-secondary">repos</span>
              <input type="number" class="input form-ex-rest"
                     value="${exData.restSeconds || 90}" min="0" max="600" step="15"
                     data-day-index="${dayIndex}" data-exercise-index="${exerciseIndex}"
                     style="width: 52px; padding: 4px; text-align: center; font-size: var(--fs-sm);">
              <span class="text-xs text-secondary">s</span>
            </div>
          </div>
        </div>
        <button type="button" class="btn btn-ghost btn-sm btn-remove-exercise"
                data-day-index="${dayIndex}" data-exercise-index="${exerciseIndex}"
                style="padding: 4px; min-width: 32px;">
          ✕
        </button>
      </div>
    `;
  }

  /** Attache les événements du formulaire */
  _bindFormEvents() {
    // Retour / Annuler
    const btnBack = this._container.querySelector('#btn-form-back');
    const btnCancel = this._container.querySelector('#btn-form-cancel');
    const goBack = () => {
      if (this._editingProgram) {
        this.renderDetail(this._editingProgram.id);
      } else {
        this.renderList();
      }
    };
    if (btnBack) btnBack.addEventListener('click', goBack);
    if (btnCancel) btnCancel.addEventListener('click', goBack);

    // Choix du niveau
    this._container.querySelectorAll('#prog-level-chips .chip').forEach(chip => {
      chip.addEventListener('click', () => {
        this._container.querySelectorAll('#prog-level-chips .chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
      });
    });

    // Ajouter un jour
    const btnAddDay = this._container.querySelector('#btn-add-day');
    if (btnAddDay) {
      btnAddDay.addEventListener('click', () => {
        this._syncFormDaysFromDOM();
        this._formDays.push({ name: `Jour ${this._formDays.length + 1}`, exercises: [] });
        this._rerenderFormDays();
      });
    }

    // Délégation d'événements pour les jours
    this._bindFormDayEvents();

    // Soumission
    const form = this._container.querySelector('#program-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this._handleFormSubmit();
      });
    }
  }

  /** Attache les événements délégués sur les jours du formulaire */
  _bindFormDayEvents() {
    const container = this._container.querySelector('#form-days-container');
    if (!container) return;

    // Utiliser la délégation d'événements
    container.addEventListener('click', (e) => {
      const target = e.target.closest('button');
      if (!target) return;

      // Supprimer un jour
      if (target.classList.contains('btn-remove-day')) {
        const idx = parseInt(target.dataset.dayIndex);
        this._syncFormDaysFromDOM();
        this._formDays.splice(idx, 1);
        this._rerenderFormDays();
        return;
      }

      // Ajouter un exercice → ouvrir le picker
      if (target.classList.contains('btn-add-exercise')) {
        const dayIdx = parseInt(target.dataset.dayIndex);
        this._syncFormDaysFromDOM();
        this._openExercisePicker(dayIdx);
        return;
      }

      // Supprimer un exercice
      if (target.classList.contains('btn-remove-exercise')) {
        const dayIdx = parseInt(target.dataset.dayIndex);
        const exIdx = parseInt(target.dataset.exerciseIndex);
        this._syncFormDaysFromDOM();
        this._formDays[dayIdx].exercises.splice(exIdx, 1);
        this._rerenderFormDays();
        return;
      }
    });

    // Écouter les changements d'inputs pour sync
    container.addEventListener('change', (e) => {
      if (e.target.matches('.form-day-name, .form-ex-sets, .form-ex-reps, .form-ex-rest')) {
        this._syncFormDaysFromDOM();
      }
    });
  }

  /** Synchronise _formDays depuis le DOM */
  _syncFormDaysFromDOM() {
    const container = this._container.querySelector('#form-days-container');
    if (!container) return;

    const dayCards = container.querySelectorAll('.form-day-card');
    dayCards.forEach((card, dayIdx) => {
      if (!this._formDays[dayIdx]) return;

      // Nom du jour
      const nameInput = card.querySelector('.form-day-name');
      if (nameInput) this._formDays[dayIdx].name = nameInput.value;

      // Exercices
      const exItems = card.querySelectorAll('.form-exercise-item');
      exItems.forEach((item, exIdx) => {
        if (!this._formDays[dayIdx].exercises[exIdx]) return;

        const setsInput = item.querySelector('.form-ex-sets');
        const repsInput = item.querySelector('.form-ex-reps');
        const restInput = item.querySelector('.form-ex-rest');

        if (setsInput) this._formDays[dayIdx].exercises[exIdx].sets = parseInt(setsInput.value) || 3;
        if (repsInput) this._formDays[dayIdx].exercises[exIdx].reps = parseInt(repsInput.value) || 10;
        if (restInput) this._formDays[dayIdx].exercises[exIdx].restSeconds = parseInt(restInput.value) || 90;
      });
    });
  }

  /** Re-rend uniquement la section des jours */
  _rerenderFormDays() {
    const container = this._container.querySelector('#form-days-container');
    if (!container) return;
    container.innerHTML = this._formDays.map((d, i) => this._renderFormDay(d, i)).join('');
    // Pas besoin de re-binder : on utilise la délégation d'événements
  }

  /** Gère la soumission du formulaire */
  _handleFormSubmit() {
    this._syncFormDaysFromDOM();

    const name = this._container.querySelector('#prog-name')?.value?.trim();
    const description = this._container.querySelector('#prog-desc')?.value?.trim();
    const levelChip = this._container.querySelector('#prog-level-chips .chip.active');
    const level = levelChip?.dataset.level || 'intermédiaire';

    // Validation
    if (!name) {
      this._showToast('Donne un nom à ton programme', 'warning');
      this._container.querySelector('#prog-name')?.focus();
      return;
    }

    if (this._formDays.length === 0) {
      this._showToast('Ajoute au moins un jour', 'warning');
      return;
    }

    const hasExercises = this._formDays.some(d => d.exercises && d.exercises.length > 0);
    if (!hasExercises) {
      this._showToast('Ajoute au moins un exercice', 'warning');
      return;
    }

    const data = { name, description, level, days: this._formDays };

    if (this._editingProgram) {
      // Mise à jour
      this.updateCustomProgram(this._editingProgram.id, data);
      this._showToast('Programme mis à jour ✅', 'success');
      this._dispatchEvent('program-updated', { programId: this._editingProgram.id });
      this.renderDetail(this._editingProgram.id);
    } else {
      // Création
      const newProgram = this.createCustomProgram(data);
      this._showToast('Programme créé 🎉', 'success');
      this._dispatchEvent('program-created', { programId: newProgram.id });
      this.renderDetail(newProgram.id);
    }
  }


  // ═══════════════════════════════════════════════
  // 8. BIBLIOTHÈQUE D'EXERCICES — PICKER
  // ═══════════════════════════════════════════════

  /**
   * Ouvre le sélecteur d'exercices (bottom sheet)
   * @param {number} dayIndex - index du jour cible
   */
  _openExercisePicker(dayIndex) {
    this._pickerDayIndex = dayIndex;
    this._pickerFilter = '';

    const overlay = this._container.querySelector('#exercise-picker-overlay');
    const sheet = this._container.querySelector('#exercise-picker-sheet');
    const content = this._container.querySelector('#exercise-picker-content');

    if (!overlay || !sheet || !content) return;

    // Extraire les groupes musculaires uniques
    const muscles = [...new Set(this.exercises.map(e => e.muscle))].sort();

    content.innerHTML = `
      <!-- Barre de recherche -->
      <div class="input-group mb-3">
        <input type="search" class="input" id="exercise-picker-search"
               placeholder="Rechercher un exercice…" autocomplete="off">
      </div>

      <!-- Filtres par muscle -->
      <div class="chip-group mb-4" id="exercise-picker-filters">
        <button class="chip active" data-muscle="all">Tous</button>
        ${muscles.map(m => `
          <button class="chip" data-muscle="${this._esc(m)}">${this._capitalize(m)}</button>
        `).join('')}
      </div>

      <!-- Liste des exercices -->
      <div class="list col gap-2" id="exercise-picker-list"
           style="max-height: 50vh; overflow-y: auto;">
        ${this._renderExercisePickerList('all', '')}
      </div>
    `;

    // Ouvrir
    overlay.classList.add('active');
    sheet.classList.add('active');

    // Fermer sur overlay
    const closeSheet = () => {
      overlay.classList.remove('active');
      sheet.classList.remove('active');
    };
    overlay.addEventListener('click', closeSheet, { once: true });

    // Filtres muscle
    content.querySelectorAll('#exercise-picker-filters .chip').forEach(chip => {
      chip.addEventListener('click', () => {
        content.querySelectorAll('#exercise-picker-filters .chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const muscle = chip.dataset.muscle;
        const search = content.querySelector('#exercise-picker-search')?.value || '';
        content.querySelector('#exercise-picker-list').innerHTML =
          this._renderExercisePickerList(muscle, search);
        this._bindPickerItemEvents(closeSheet);
      });
    });

    // Recherche
    const searchInput = content.querySelector('#exercise-picker-search');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        const activeChip = content.querySelector('#exercise-picker-filters .chip.active');
        const muscle = activeChip?.dataset.muscle || 'all';
        content.querySelector('#exercise-picker-list').innerHTML =
          this._renderExercisePickerList(muscle, searchInput.value);
        this._bindPickerItemEvents(closeSheet);
      });
      // Focus sur la recherche
      requestAnimationFrame(() => searchInput.focus());
    }

    this._bindPickerItemEvents(closeSheet);
  }

  /** Rendu de la liste filtrée des exercices dans le picker */
  _renderExercisePickerList(muscle, search) {
    let filtered = this.exercises;

    if (muscle && muscle !== 'all') {
      filtered = filtered.filter(e =>
        e.muscle === muscle ||
        (e.secondaryMuscles || []).includes(muscle)
      );
    }

    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter(e =>
        e.name.toLowerCase().includes(q) ||
        e.muscle.toLowerCase().includes(q) ||
        (e.description || '').toLowerCase().includes(q)
      );
    }

    if (filtered.length === 0) {
      return `
        <div class="empty-state" style="padding: var(--space-6) 0;">
          <div class="text-sm text-secondary">Aucun exercice trouvé</div>
        </div>
      `;
    }

    return filtered.map(ex => `
      <div class="exercise-card picker-exercise-item"
           data-exercise-id="${ex.id}"
           style="cursor: pointer;">
        <div class="exercise-icon" style="width: 44px; height: 44px;">
          ${ex.svg ? `<div style="width:40px;height:40px;">${ex.svg}</div>` : '💪'}
        </div>
        <div class="exercise-info">
          <div class="exercise-name">${this._esc(ex.name)}</div>
          <div class="exercise-meta">
            ${this._capitalize(ex.muscle)}
            ${(ex.secondaryMuscles || []).length > 0
              ? ' · ' + ex.secondaryMuscles.map(m => this._capitalize(m)).join(', ')
              : ''}
          </div>
        </div>
        <span class="exercise-chevron">＋</span>
      </div>
    `).join('');
  }

  /** Attache les événements de sélection dans le picker */
  _bindPickerItemEvents(closeCallback) {
    const list = this._container.querySelector('#exercise-picker-list');
    if (!list) return;

    // Retirer les anciens listeners en remplaçant par délégation
    list.onclick = (e) => {
      const item = e.target.closest('.picker-exercise-item');
      if (!item) return;

      const exerciseId = item.dataset.exerciseId;
      const dayIdx = this._pickerDayIndex;

      if (dayIdx != null && this._formDays[dayIdx]) {
        this._formDays[dayIdx].exercises.push({
          exerciseId,
          sets: 3,
          reps: 10,
          restSeconds: 90
        });
        this._rerenderFormDays();
        this._showToast(`${this.exercisesMap.get(exerciseId)?.name || exerciseId} ajouté`, 'success');
      }

      if (closeCallback) closeCallback();
    };
  }


  // ═══════════════════════════════════════════════
  // 9. UTILITAIRES
  // ═══════════════════════════════════════════════

  /** Échappe le HTML */
  _esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  /** Met en majuscule la première lettre */
  _capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  /** Formate les secondes de repos */
  _formatRest(seconds) {
    if (!seconds) return '—';
    if (seconds >= 60) {
      const min = Math.floor(seconds / 60);
      const sec = seconds % 60;
      return sec > 0 ? `${min}min${sec}s` : `${min}min`;
    }
    return `${seconds}s`;
  }

  /** Retourne la classe CSS du tag selon le niveau */
  _levelTagClass(level) {
    const map = {
      'débutant': 'tag-success',
      'intermédiaire': 'tag-accent',
      'avancé': 'tag-danger'
    };
    return map[level] || 'tag-accent';
  }

  /** Affiche un toast (notification éphémère) */
  _showToast(message, type = 'info') {
    // Supprimer un toast existant
    const existing = document.querySelector('.toast.programs-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type} programs-toast`;
    toast.textContent = message;
    document.body.appendChild(toast);

    // Animer l'apparition
    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    // Disparition après 2.5s
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 400);
    }, 2500);
  }

  /** Dialogue de confirmation de suppression */
  _confirmDelete(programId) {
    const program = this.findProgramById(programId);
    if (!program) return;

    // Créer un dialog modal
    const overlayId = 'delete-confirm-overlay';
    const dialogId = 'delete-confirm-dialog';

    // Supprimer un dialogue existant
    document.getElementById(overlayId)?.remove();
    document.getElementById(dialogId)?.remove();

    const overlay = document.createElement('div');
    overlay.id = overlayId;
    overlay.className = 'modal-overlay active';

    const dialog = document.createElement('div');
    dialog.id = dialogId;
    dialog.className = 'dialog active';
    dialog.innerHTML = `
      <div class="dialog-title">Supprimer le programme ?</div>
      <div class="dialog-body">
        « ${this._esc(program.name)} » sera supprimé définitivement.
      </div>
      <div class="dialog-actions">
        <button class="btn btn-secondary" id="delete-cancel">Annuler</button>
        <button class="btn btn-danger" id="delete-confirm">Supprimer</button>
      </div>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(dialog);

    const close = () => {
      overlay.classList.remove('active');
      dialog.classList.remove('active');
      setTimeout(() => {
        overlay.remove();
        dialog.remove();
      }, 300);
    };

    overlay.addEventListener('click', close);
    dialog.querySelector('#delete-cancel').addEventListener('click', close);
    dialog.querySelector('#delete-confirm').addEventListener('click', () => {
      this.deleteCustomProgram(programId);
      close();
      this._showToast('Programme supprimé', 'danger');
      this._dispatchEvent('program-deleted', { programId });
      this.renderList();
    });
  }

  /** Dispatche un événement custom sur le conteneur */
  _dispatchEvent(name, detail = {}) {
    if (!this._container) return;
    this._container.dispatchEvent(new CustomEvent(`programs:${name}`, {
      bubbles: true,
      detail: { userId: this.userId, ...detail }
    }));
  }

  /** Change d'utilisateur */
  switchUser(userId) {
    this.userId = userId;
    this._keyCustom = `customPrograms_${userId}`;
    this._keyActive = `activeProgram_${userId}`;
    if (this._initialized) {
      this.renderList();
    }
  }


  // ═══════════════════════════════════════════════
  // 10. API PUBLIQUE — pour les autres modules
  // ═══════════════════════════════════════════════

  /**
   * Retourne les infos du programme du jour pour le dashboard.
   * Utilisé par le module Accueil / Training.
   * @returns {Object|null} { programName, dayName, dayIndex, totalDays, exercises[] }
   */
  getTodayWorkout() {
    const currentDay = this.getCurrentDay();
    if (!currentDay) return null;

    // Enrichir les exercices avec les données complètes
    const enrichedExercises = (currentDay.exercises || []).map(ex => {
      const full = this.exercisesMap.get(ex.exerciseId);
      return {
        ...ex,
        name: full?.name || ex.exerciseId,
        muscle: full?.muscle || '—',
        svg: full?.svg || null,
        description: full?.description || ''
      };
    });

    return {
      programName: currentDay.programName,
      dayName: currentDay.name,
      dayIndex: currentDay.dayIndex,
      totalDays: currentDay.totalDays,
      exercises: enrichedExercises
    };
  }

  /**
   * Retourne la bibliothèque complète d'exercices
   * @param {string} [muscle] - filtre par muscle principal
   * @returns {Array}
   */
  getExerciseLibrary(muscle = null) {
    if (muscle) {
      return this.exercises.filter(e => e.muscle === muscle);
    }
    return [...this.exercises];
  }

  /**
   * Retourne les groupes musculaires disponibles
   * @returns {string[]}
   */
  getMuscleGroups() {
    return [...new Set(this.exercises.map(e => e.muscle))].sort();
  }

  /**
   * Cherche un exercice par id
   * @param {string} id
   * @returns {Object|null}
   */
  getExerciseById(id) {
    return this.exercisesMap.get(id) || null;
  }
}


// ═══════════════════════════════════════════════
// EXPORT — Instance globale
// ═══════════════════════════════════════════════

// Export pour utilisation modulaire ou globale
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ProgramsModule;
} else {
  window.ProgramsModule = ProgramsModule;
}
