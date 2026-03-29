/**
 * ═══════════════════════════════════════════════════════════════
 * MuscuApp — Module Entraînement (training.js)
 * ═══════════════════════════════════════════════════════════════
 *
 * Gère l'affichage du programme du jour, le suivi en live
 * des séances (séries, reps, kilos, timer de repos),
 * le résumé de fin de séance et la persistance localStorage.
 *
 * Exporté sur window.TrainingModule pour usage par app.js
 * ═══════════════════════════════════════════════════════════════
 */

'use strict';

/* ─────────────────────────────────────────────
   CONSTANTES
   ───────────────────────────────────────────── */

const STORAGE_KEYS = {
  workouts:       (uid) => `workouts_${uid}`,
  activeProgram:  (uid) => `active_program_${uid}`,
  programDayIdx:  (uid) => `program_day_index_${uid}`,
  personalBests:  (uid) => `personal_bests_${uid}`,
  settings:       (uid) => `training_settings_${uid}`,
};

const DEFAULTS = {
  restSeconds:       90,
  progressionKg:     2.5,    // incrément si toutes reps réussies
  progressionSmall:  1.25,   // incrément pour petits muscles (bras)
  beepFrequency:     880,    // Hz du bip de fin de repos
  beepDuration:      300,    // ms
  vibrationPattern:  [200, 100, 200, 100, 300],
};

const SMALL_MUSCLES = ['biceps', 'triceps'];

/* ─────────────────────────────────────────────
   UTILITAIRES
   ───────────────────────────────────────────── */

/** Génère un UUID v4 simplifié */
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Formatte une durée en secondes → "1h 23min" ou "45min" ou "32s" */
function formatDuration(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}min`;
  if (m > 0) return `${m}min ${s > 0 ? String(s).padStart(2, '0') + 's' : ''}`.trim();
  return `${s}s`;
}

/** Formatte un nombre avec séparateur de milliers */
function formatNumber(n) {
  return n.toLocaleString('fr-FR');
}

/** Date du jour au format ISO (YYYY-MM-DD) */
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/** Crée un élément DOM avec attributs et enfants */
function el(tag, attrs = {}, ...children) {
  const elem = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') elem.className = v;
    else if (k === 'dataset') Object.assign(elem.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') {
      elem.addEventListener(k.slice(2).toLowerCase(), v);
    } else {
      elem.setAttribute(k, v);
    }
  }
  for (const child of children) {
    if (typeof child === 'string') elem.appendChild(document.createTextNode(child));
    else if (child) elem.appendChild(child);
  }
  return elem;
}

/* ─────────────────────────────────────────────
   CLASSE : RestTimer
   Timer de repos avec cercle animé SVG
   ───────────────────────────────────────────── */

class RestTimer {
  constructor() {
    this._interval = null;
    this._remaining = 0;
    this._total = 0;
    this._onComplete = null;
    this._audioCtx = null;
    this._container = null;
  }

  /** Retourne / crée le contexte AudioContext (lazy) */
  _getAudioCtx() {
    if (!this._audioCtx) {
      this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return this._audioCtx;
  }

  /** Joue un bip court */
  _beep() {
    try {
      const ctx = this._getAudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = DEFAULTS.beepFrequency;
      gain.gain.setValueAtTime(0.4, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + DEFAULTS.beepDuration / 1000);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + DEFAULTS.beepDuration / 1000);
    } catch (_) { /* pas d'audio disponible */ }
  }

  /** Fait vibrer si supporté */
  _vibrate() {
    if (navigator.vibrate) {
      navigator.vibrate(DEFAULTS.vibrationPattern);
    }
  }

  /**
   * Crée le DOM du timer (cercle SVG + texte)
   * @returns {HTMLElement}
   */
  createDOM() {
    this._container = el('div', { className: 'rest-timer-overlay', id: 'rest-timer-overlay' },
      el('div', { className: 'rest-timer-content' },
        // SVG circle
        (() => {
          const ns = 'http://www.w3.org/2000/svg';
          const svg = document.createElementNS(ns, 'svg');
          svg.setAttribute('class', 'rest-timer-svg');
          svg.setAttribute('viewBox', '0 0 120 120');
          svg.setAttribute('width', '200');
          svg.setAttribute('height', '200');

          // Background circle
          const bgCircle = document.createElementNS(ns, 'circle');
          bgCircle.setAttribute('cx', '60');
          bgCircle.setAttribute('cy', '60');
          bgCircle.setAttribute('r', '54');
          bgCircle.setAttribute('fill', 'none');
          bgCircle.setAttribute('stroke', '#2C2C2E');
          bgCircle.setAttribute('stroke-width', '8');
          svg.appendChild(bgCircle);

          // Progress circle
          const progCircle = document.createElementNS(ns, 'circle');
          progCircle.setAttribute('cx', '60');
          progCircle.setAttribute('cy', '60');
          progCircle.setAttribute('r', '54');
          progCircle.setAttribute('fill', 'none');
          progCircle.setAttribute('stroke', '#0A84FF');
          progCircle.setAttribute('stroke-width', '8');
          progCircle.setAttribute('stroke-linecap', 'round');
          progCircle.setAttribute('class', 'rest-timer-progress');
          // Circumference = 2 * π * 54 ≈ 339.29
          const circumference = 2 * Math.PI * 54;
          progCircle.setAttribute('stroke-dasharray', `${circumference}`);
          progCircle.setAttribute('stroke-dashoffset', '0');
          progCircle.setAttribute('transform', 'rotate(-90 60 60)');
          svg.appendChild(progCircle);

          return svg;
        })(),
        el('div', { className: 'rest-timer-label' }, 'Repos'),
        el('div', { className: 'rest-timer-time', id: 'rest-timer-time' }, '0:00'),
        el('div', { className: 'rest-timer-actions' },
          el('button', {
            className: 'btn btn-secondary btn-sm',
            id: 'rest-timer-add30',
            onClick: () => this.addTime(30),
          }, '+30s'),
          el('button', {
            className: 'btn btn-primary btn-sm',
            id: 'rest-timer-skip',
            onClick: () => this.skip(),
          }, 'Passer'),
          el('button', {
            className: 'btn btn-secondary btn-sm',
            id: 'rest-timer-sub30',
            onClick: () => this.subtractTime(30),
          }, '-30s'),
        )
      )
    );
    this._container.style.display = 'none';
    return this._container;
  }

  /**
   * Démarre le timer
   * @param {number} seconds — durée de repos
   * @param {Function} onComplete — callback quand terminé
   */
  start(seconds, onComplete) {
    this.stop();
    this._total = seconds;
    this._remaining = seconds;
    this._onComplete = onComplete;

    if (this._container) {
      this._container.style.display = 'flex';
    }

    this._updateDisplay();
    this._interval = setInterval(() => this._tick(), 1000);
  }

  /** Tick chaque seconde */
  _tick() {
    this._remaining--;
    this._updateDisplay();

    if (this._remaining <= 0) {
      this._finish();
    }
  }

  /** Met à jour l'affichage du timer */
  _updateDisplay() {
    if (!this._container) return;

    const timeEl = this._container.querySelector('#rest-timer-time');
    if (timeEl) {
      const m = Math.floor(Math.max(0, this._remaining) / 60);
      const s = Math.max(0, this._remaining) % 60;
      timeEl.textContent = `${m}:${String(s).padStart(2, '0')}`;
    }

    // Met à jour le cercle SVG
    const progressCircle = this._container.querySelector('.rest-timer-progress');
    if (progressCircle) {
      const circumference = 2 * Math.PI * 54;
      const fraction = this._total > 0 ? this._remaining / this._total : 0;
      const offset = circumference * (1 - fraction);
      progressCircle.setAttribute('stroke-dashoffset', `${offset}`);

      // Change couleur quand < 10s
      if (this._remaining <= 10 && this._remaining > 0) {
        progressCircle.setAttribute('stroke', '#FF9F0A');
      } else if (this._remaining <= 0) {
        progressCircle.setAttribute('stroke', '#30D158');
      } else {
        progressCircle.setAttribute('stroke', '#0A84FF');
      }
    }
  }

  /** Timer terminé */
  _finish() {
    this.stop();
    this._beep();
    this._vibrate();

    // Petit délai pour laisser le bip jouer puis fermer
    setTimeout(() => {
      if (this._container) {
        this._container.style.display = 'none';
      }
      if (this._onComplete) this._onComplete();
    }, 600);
  }

  /** Ajouter du temps */
  addTime(seconds) {
    this._remaining += seconds;
    this._total += seconds;
    this._updateDisplay();
  }

  /** Retirer du temps */
  subtractTime(seconds) {
    this._remaining = Math.max(1, this._remaining - seconds);
    this._updateDisplay();
  }

  /** Passer le repos */
  skip() {
    this._finish();
  }

  /** Arrêter le timer */
  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }

  /** Détruire le timer */
  destroy() {
    this.stop();
    if (this._container && this._container.parentNode) {
      this._container.parentNode.removeChild(this._container);
    }
    if (this._audioCtx) {
      this._audioCtx.close().catch(() => {});
      this._audioCtx = null;
    }
  }
}

/* ─────────────────────────────────────────────
   CLASSE : WorkoutSession
   Représente une séance en cours
   ───────────────────────────────────────────── */

class WorkoutSession {
  /**
   * @param {Object} programDay — objet jour du programme { name, exercises: [...] }
   * @param {number} dayIndex — index du jour dans le programme
   * @param {Object[]} exerciseDb — base d'exercices complète
   * @param {Object} suggestedWeights — { [exerciseId]: number }
   */
  constructor(programDay, dayIndex, exerciseDb, suggestedWeights) {
    this.id = uuid();
    this.programDay = programDay;
    this.dayIndex = dayIndex;
    this.startTime = Date.now();
    this.endTime = null;

    // Construire la liste des exercices de la séance
    this.exercises = programDay.exercises.map((pe) => {
      const exInfo = exerciseDb.find((e) => e.id === pe.exerciseId) || {};
      return {
        exerciseId:     pe.exerciseId,
        name:           exInfo.name || pe.exerciseId,
        muscle:         exInfo.muscle || '',
        svg:            exInfo.svg || '',
        targetSets:     pe.sets,
        targetReps:     pe.reps,
        restSeconds:    pe.restSeconds || DEFAULTS.restSeconds,
        suggestedWeight: (suggestedWeights[pe.exerciseId] || {}).weight || 0,
        suggestedReps:   (suggestedWeights[pe.exerciseId] || {}).reps || 0,
        sets: [],   // { reps: number, weight: number, completed: boolean }
      };
    });

    this.currentExerciseIdx = 0;
    this.currentSetIdx = 0;
    this.isActive = false;
    this.isFinished = false;
  }

  /** Exercice en cours */
  get currentExercise() {
    return this.exercises[this.currentExerciseIdx] || null;
  }

  /** Nombre total de séries prévues */
  get totalSetsPlanned() {
    return this.exercises.reduce((sum, ex) => sum + ex.targetSets, 0);
  }

  /** Nombre de séries complétées */
  get completedSets() {
    return this.exercises.reduce((sum, ex) => sum + ex.sets.length, 0);
  }

  /** Volume total (kg × reps) */
  get totalVolume() {
    let vol = 0;
    for (const ex of this.exercises) {
      for (const s of ex.sets) {
        vol += (s.weight || 0) * (s.reps || 0);
      }
    }
    return vol;
  }

  /** Durée en secondes */
  get durationSeconds() {
    const end = this.endTime || Date.now();
    return Math.floor((end - this.startTime) / 1000);
  }

  /**
   * Enregistre une série et avance le curseur
   * @param {number} reps
   * @param {number} weight
   * @returns {{ done: boolean, needsRest: boolean, restSeconds: number }}
   */
  logSet(reps, weight) {
    const ex = this.currentExercise;
    if (!ex) return { done: true, needsRest: false, restSeconds: 0 };

    ex.sets.push({ reps, weight, completed: true });
    this.currentSetIdx++;

    // Plus de séries pour cet exercice ?
    if (this.currentSetIdx >= ex.targetSets) {
      this.currentExerciseIdx++;
      this.currentSetIdx = 0;

      // Plus d'exercices ?
      if (this.currentExerciseIdx >= this.exercises.length) {
        this.isFinished = true;
        this.endTime = Date.now();
        return { done: true, needsRest: false, restSeconds: 0 };
      }
    }

    return {
      done: false,
      needsRest: true,
      restSeconds: ex.restSeconds,
    };
  }

  /**
   * Exporte la séance pour le stockage
   * @param {string} userId
   * @param {string} programId
   */
  toStorageFormat(userId, programId) {
    return {
      id:         this.id,
      userId,
      programId,
      programDay: this.programDay.name,
      dayIndex:   this.dayIndex,
      date:       todayISO(),
      startTime:  this.startTime,
      endTime:    this.endTime || Date.now(),
      exercises:  this.exercises.map((ex) => ({
        exerciseId: ex.exerciseId,
        sets:       ex.sets.map((s) => ({ reps: s.reps, weight: s.weight })),
      })),
      duration: this.durationSeconds,
      volume:   this.totalVolume,
    };
  }
}

/* ─────────────────────────────────────────────
   CLASSE PRINCIPALE : TrainingModule
   ───────────────────────────────────────────── */

class TrainingModule {
  /**
   * @param {Object} config
   * @param {string} config.userId — id de l'utilisateur courant
   * @param {Object[]} config.exercises — base d'exercices (tableau)
   * @param {Object[]} config.programs — programmes disponibles (tableau)
   * @param {HTMLElement} [config.container] — conteneur de la page training
   */
  constructor(config = {}) {
    this.userId = config.userId || 'default';
    this.exerciseDb = config.exercises || [];
    this.programs = config.programs || [];
    this.container = config.container || document.getElementById('page-training');

    this.activeProgram = null;
    this.currentDayIndex = 0;
    this.session = null;
    this.restTimer = new RestTimer();

    this._workoutOverlay = null;
    this._summaryOverlay = null;

    this._init();
  }

  /* ═══════════════════════════════════════════
     INITIALISATION
     ═══════════════════════════════════════════ */

  _init() {
    this._loadActiveProgram();
    this._loadCurrentDayIndex();
    this._renderProgramSelector();
    this._renderDayExercises();
    this._bindStartButton();
    this._injectOverlays();
  }

  /** Charge le programme actif depuis localStorage */
  _loadActiveProgram() {
    const savedId = localStorage.getItem(STORAGE_KEYS.activeProgram(this.userId));
    if (savedId) {
      this.activeProgram = this.programs.find((p) => p.id === savedId) || null;
    }
    // Fallback : premier programme
    if (!this.activeProgram && this.programs.length > 0) {
      this.activeProgram = this.programs[0];
      this._saveActiveProgram();
    }
  }

  _saveActiveProgram() {
    if (this.activeProgram) {
      localStorage.setItem(STORAGE_KEYS.activeProgram(this.userId), this.activeProgram.id);
    }
  }

  /** Charge l'index du jour courant */
  _loadCurrentDayIndex() {
    const saved = localStorage.getItem(STORAGE_KEYS.programDayIdx(this.userId));
    if (saved !== null) {
      this.currentDayIndex = parseInt(saved, 10) || 0;
    } else {
      // Déterminer le jour basé sur la dernière séance
      this.currentDayIndex = this._detectNextDayIndex();
    }
    // Vérifier que l'index est valide
    if (this.activeProgram && this.currentDayIndex >= this.activeProgram.days.length) {
      this.currentDayIndex = 0;
    }
  }

  _saveCurrentDayIndex() {
    localStorage.setItem(STORAGE_KEYS.programDayIdx(this.userId), String(this.currentDayIndex));
  }

  /** Détecte le prochain jour à faire basé sur l'historique */
  _detectNextDayIndex() {
    const workouts = this._getWorkouts();
    if (!this.activeProgram || workouts.length === 0) return 0;

    // Chercher la dernière séance de ce programme
    const lastOfProgram = workouts
      .filter((w) => w.programId === this.activeProgram.id)
      .sort((a, b) => (b.startTime || 0) - (a.startTime || 0))[0];

    if (!lastOfProgram) return 0;

    const nextIdx = ((lastOfProgram.dayIndex || 0) + 1) % this.activeProgram.days.length;
    return nextIdx;
  }

  /* ═══════════════════════════════════════════
     RENDU — SÉLECTEUR DE PROGRAMME
     ═══════════════════════════════════════════ */

  _renderProgramSelector() {
    const wrapper = document.getElementById('training-program-select');
    if (!wrapper) return;
    wrapper.innerHTML = '';

    if (this.programs.length === 0) {
      wrapper.appendChild(el('p', { className: 'text-muted' }, 'Aucun programme disponible'));
      return;
    }

    // Créer le select
    const select = el('select', {
      className: 'form-select',
      id: 'training-program-dropdown',
    });

    for (const prog of this.programs) {
      const option = el('option', { value: prog.id }, `${prog.name} (${prog.daysPerWeek}j/sem)`);
      if (this.activeProgram && prog.id === this.activeProgram.id) {
        option.selected = true;
      }
      select.appendChild(option);
    }

    select.addEventListener('change', () => {
      this.activeProgram = this.programs.find((p) => p.id === select.value) || null;
      this._saveActiveProgram();
      this.currentDayIndex = this._detectNextDayIndex();
      this._saveCurrentDayIndex();
      this._renderDayExercises();
    });

    wrapper.appendChild(select);

    // Chips pour les jours
    const chipContainer = el('div', { className: 'day-chips', id: 'training-day-chips' });
    wrapper.appendChild(chipContainer);

    this._renderDayChips();
  }

  /** Rend les chips de sélection de jour */
  _renderDayChips() {
    const chipContainer = document.getElementById('training-day-chips');
    if (!chipContainer || !this.activeProgram) return;
    chipContainer.innerHTML = '';

    this.activeProgram.days.forEach((day, idx) => {
      const chip = el('button', {
        className: `day-chip ${idx === this.currentDayIndex ? 'active' : ''}`,
        dataset: { dayIdx: String(idx) },
      }, day.name);

      chip.addEventListener('click', () => {
        this.currentDayIndex = idx;
        this._saveCurrentDayIndex();
        this._renderDayChips();
        this._renderDayExercises();
      });

      chipContainer.appendChild(chip);
    });
  }

  /* ═══════════════════════════════════════════
     RENDU — EXERCICES DU JOUR
     ═══════════════════════════════════════════ */

  _renderDayExercises() {
    const list = document.getElementById('training-exercise-list');
    const btn = document.getElementById('btn-start-workout');
    if (!list) return;
    list.innerHTML = '';

    if (!this.activeProgram) {
      list.innerHTML = '<li class="exercise-item empty">Sélectionne un programme pour commencer</li>';
      if (btn) btn.disabled = true;
      return;
    }

    const day = this.activeProgram.days[this.currentDayIndex];
    if (!day) {
      list.innerHTML = '<li class="exercise-item empty">Jour non trouvé</li>';
      if (btn) btn.disabled = true;
      return;
    }

    const suggestedWeights = this._getSuggestedWeights();

    for (const pe of day.exercises) {
      const exInfo = this.exerciseDb.find((e) => e.id === pe.exerciseId) || {};
      const suggestion = suggestedWeights[pe.exerciseId] || {};
      const weight = suggestion.weight || 0;

      const item = el('li', { className: 'exercise-item' },
        // Illustration SVG
        (() => {
          const svgWrap = el('div', { className: 'exercise-svg' });
          if (exInfo.svg) {
            svgWrap.innerHTML = exInfo.svg;
          } else {
            svgWrap.innerHTML = `<div class="exercise-svg-placeholder">🏋️</div>`;
          }
          return svgWrap;
        })(),
        // Infos
        el('div', { className: 'exercise-info' },
          el('span', { className: 'exercise-name' }, exInfo.name || pe.exerciseId),
          el('span', { className: 'exercise-muscle' }, exInfo.muscle || ''),
          el('span', { className: 'exercise-detail' },
            `${pe.sets} × ${pe.reps} reps${weight > 0 ? ` • ${weight} kg` : ''}`
          ),
        ),
        // Temps de repos
        el('div', { className: 'exercise-rest' },
          el('span', { className: 'exercise-rest-icon' }, '⏱'),
          el('span', { className: 'exercise-rest-value' }, `${pe.restSeconds || DEFAULTS.restSeconds}s`),
        ),
      );

      list.appendChild(item);
    }

    if (btn) btn.disabled = false;
    this._renderDayChips();
  }

  /* ═══════════════════════════════════════════
     KILOS SUGGÉRÉS
     ═══════════════════════════════════════════ */

  /**
   * Calcule les poids suggérés pour chaque exercice du jour
   * basé sur l'historique + objectif de progression
   * @returns {Object} { [exerciseId]: number }
   */
  _getSuggestedWeights() {
    const suggestions = {};
    if (!this.activeProgram) return suggestions;

    const day = this.activeProgram.days[this.currentDayIndex];
    if (!day) return suggestions;

    const workouts = this._getWorkouts();
    const personalBests = this._getPersonalBests();

    for (const pe of day.exercises) {
      const exId = pe.exerciseId;
      const exInfo = this.exerciseDb.find((e) => e.id === exId);
      const isSmallMuscle = exInfo && SMALL_MUSCLES.includes(exInfo.muscle);
      const increment = isSmallMuscle ? DEFAULTS.progressionSmall : DEFAULTS.progressionKg;

      // Chercher la dernière séance contenant cet exercice
      let lastWeight = 0;
      let lastReps = 0;
      let allRepsHit = false;

      for (let i = workouts.length - 1; i >= 0; i--) {
        const wEx = workouts[i].exercises?.find((e) => e.exerciseId === exId);
        if (wEx && wEx.sets && wEx.sets.length > 0) {
          // Prendre le poids max utilisé + reps associées
          for (const s of wEx.sets) {
            const w = s.weight || 0;
            const r = s.reps || 0;
            if (w > lastWeight || (w === lastWeight && r > lastReps)) {
              lastWeight = w;
              lastReps = r;
            }
          }

          // Vérifier si toutes les séries ont atteint les reps cibles
          allRepsHit = wEx.sets.every((s) => (s.reps || 0) >= pe.reps);
          break;
        }
      }

      if (lastWeight > 0) {
        // Si toutes les reps étaient atteintes → on progresse
        suggestions[exId] = {
          weight: allRepsHit ? lastWeight + increment : lastWeight,
          reps: lastReps,
        };
      } else if (personalBests[exId]) {
        // Fallback sur le PR
        const pb = personalBests[exId];
        const pbW = typeof pb === 'number' ? pb : (pb.weight || 0);
        const pbR = typeof pb === 'number' ? 0 : (pb.reps || 0);
        suggestions[exId] = { weight: pbW, reps: pbR };
      }
      // sinon pas de suggestion → l'utilisateur entre manuellement
    }

    return suggestions;
  }

  /* ═══════════════════════════════════════════
     MODE ENTRAÎNEMENT EN LIVE
     ═══════════════════════════════════════════ */

  _bindStartButton() {
    const btn = document.getElementById('btn-start-workout');
    if (!btn) return;
    btn.addEventListener('click', () => this.startWorkout());
  }

  /** Injecte les overlays (workout + timer + résumé) dans le DOM */
  _injectOverlays() {
    // Overlay d'entraînement en live
    this._workoutOverlay = el('div', {
      className: 'workout-overlay',
      id: 'workout-overlay',
    });
    this._workoutOverlay.style.display = 'none';
    document.body.appendChild(this._workoutOverlay);

    // Timer de repos
    const timerDOM = this.restTimer.createDOM();
    document.body.appendChild(timerDOM);

    // Overlay de résumé
    this._summaryOverlay = el('div', {
      className: 'summary-overlay',
      id: 'summary-overlay',
    });
    this._summaryOverlay.style.display = 'none';
    document.body.appendChild(this._summaryOverlay);
  }

  /** Démarre une séance */
  startWorkout() {
    if (!this.activeProgram) return;
    const day = this.activeProgram.days[this.currentDayIndex];
    if (!day) return;

    const suggestedWeights = this._getSuggestedWeights();
    this.session = new WorkoutSession(day, this.currentDayIndex, this.exerciseDb, suggestedWeights);
    this.session.isActive = true;

    this._showWorkoutOverlay();
    this._renderCurrentSet();
  }

  /** Affiche l'overlay d'entraînement */
  _showWorkoutOverlay() {
    if (!this._workoutOverlay) return;
    this._workoutOverlay.style.display = 'flex';

    // Masquer la tab bar
    const tabBar = document.getElementById('tab-bar');
    if (tabBar) tabBar.style.display = 'none';
  }

  /** Cache l'overlay d'entraînement */
  _hideWorkoutOverlay() {
    if (this._workoutOverlay) this._workoutOverlay.style.display = 'none';

    const tabBar = document.getElementById('tab-bar');
    if (tabBar) tabBar.style.display = '';
  }

  /** Rend la série en cours */
  _renderCurrentSet() {
    if (!this._workoutOverlay || !this.session) return;

    const s = this.session;
    const ex = s.currentExercise;
    this._workoutOverlay.innerHTML = '';

    if (!ex || s.isFinished) {
      this._finishWorkout();
      return;
    }

    const setNum = s.currentSetIdx + 1;
    const suggestedW = ex.suggestedWeight;

    // Header de progression
    const progressFraction = s.completedSets / s.totalSetsPlanned;
    const progressPct = Math.round(progressFraction * 100);

    const overlay = this._workoutOverlay;

    // ── Header ──
    overlay.appendChild(
      el('div', { className: 'workout-header' },
        el('button', {
          className: 'workout-close-btn',
          onClick: () => this._confirmQuit(),
        }, '✕'),
        el('div', { className: 'workout-progress-info' },
          el('span', { className: 'workout-progress-text' },
            `Exercice ${s.currentExerciseIdx + 1}/${s.exercises.length}`
          ),
          el('span', { className: 'workout-progress-pct' }, `${progressPct}%`),
        ),
        el('div', { className: 'workout-progress-bar' },
          (() => {
            const fill = el('div', { className: 'workout-progress-fill' });
            fill.style.width = `${progressPct}%`;
            return fill;
          })(),
        ),
      )
    );

    // ── Exercice en cours ──
    overlay.appendChild(
      el('div', { className: 'workout-exercise' },
        // SVG illustration
        (() => {
          const svgWrap = el('div', { className: 'workout-exercise-svg' });
          if (ex.svg) svgWrap.innerHTML = ex.svg;
          else svgWrap.innerHTML = '<div class="exercise-svg-placeholder">🏋️</div>';
          return svgWrap;
        })(),
        el('h2', { className: 'workout-exercise-name' }, ex.name),
        el('p', { className: 'workout-exercise-muscle' }, ex.muscle),
      )
    );

    // ── Séries déjà faites ──
    if (ex.sets.length > 0) {
      const setsHistory = el('div', { className: 'workout-sets-history' });
      ex.sets.forEach((doneSet, idx) => {
        setsHistory.appendChild(
          el('div', { className: 'workout-set-done' },
            el('span', { className: 'set-done-label' }, `Série ${idx + 1}`),
            el('span', { className: 'set-done-value' }, `${doneSet.reps} reps × ${doneSet.weight} kg`),
            el('span', { className: 'set-done-check' }, '✓'),
          )
        );
      });
      overlay.appendChild(setsHistory);
    }

    // ── Série actuelle ──
    const setCard = el('div', { className: 'workout-current-set' },
      el('div', { className: 'workout-set-label' },
        `Série ${setNum} / ${ex.targetSets}`
      ),
      el('div', { className: 'workout-set-target' },
        `Objectif : ${ex.targetReps} reps${suggestedW > 0 ? ` × ${suggestedW} kg` : ''}`
      ),
    );

    // Inputs reps + kilos
    const inputsRow = el('div', { className: 'workout-inputs' });

    const defaultReps = ex.suggestedReps > 0 ? ex.suggestedReps : ex.targetReps;
    const repsInput = el('input', {
      type: 'number',
      className: 'workout-input',
      id: 'input-reps',
      placeholder: 'Reps',
      value: String(defaultReps),
      min: '0',
      max: '999',
      inputmode: 'numeric',
    });

    const weightInput = el('input', {
      type: 'number',
      className: 'workout-input',
      id: 'input-weight',
      placeholder: 'Kilos',
      value: suggestedW > 0 ? String(suggestedW) : '',
      min: '0',
      max: '9999',
      step: '0.5',
      inputmode: 'decimal',
    });

    inputsRow.appendChild(
      el('div', { className: 'workout-input-group' },
        el('label', { className: 'workout-input-label', for: 'input-reps' }, 'Reps'),
        repsInput,
      )
    );
    inputsRow.appendChild(
      el('div', { className: 'workout-input-group' },
        el('label', { className: 'workout-input-label', for: 'input-weight' }, 'Kilos'),
        weightInput,
      )
    );

    setCard.appendChild(inputsRow);

    // Bouton "Série terminée"
    const logBtn = el('button', {
      className: 'btn btn-primary btn-lg workout-log-btn',
      id: 'btn-log-set',
    }, `✓ Série ${setNum} terminée`);

    logBtn.addEventListener('click', () => {
      const reps = parseInt(repsInput.value, 10) || 0;
      const weight = parseFloat(weightInput.value) || 0;

      if (reps <= 0) {
        repsInput.classList.add('shake');
        setTimeout(() => repsInput.classList.remove('shake'), 500);
        return;
      }

      const result = this.session.logSet(reps, weight);

      if (result.done) {
        this._finishWorkout();
      } else if (result.needsRest) {
        this.restTimer.start(result.restSeconds, () => {
          this._renderCurrentSet();
        });
        // Met à jour l'affichage derrière le timer
        this._renderCurrentSet();
      }
    });

    setCard.appendChild(logBtn);
    overlay.appendChild(setCard);

    // ── Timer info ──
    overlay.appendChild(
      el('div', { className: 'workout-timer-info' },
        el('span', { className: 'workout-elapsed-label' }, '⏱ Durée : '),
        el('span', { className: 'workout-elapsed-value', id: 'workout-elapsed' },
          formatDuration(this.session.durationSeconds)
        ),
      )
    );

    // Mettre à jour le chronomètre chaque seconde
    this._startElapsedUpdater();
  }

  /** Met à jour le chronomètre de la séance */
  _startElapsedUpdater() {
    // Nettoyer l'ancien
    if (this._elapsedInterval) clearInterval(this._elapsedInterval);

    this._elapsedInterval = setInterval(() => {
      const el = document.getElementById('workout-elapsed');
      if (el && this.session) {
        el.textContent = formatDuration(this.session.durationSeconds);
      } else {
        clearInterval(this._elapsedInterval);
      }
    }, 1000);
  }

  /** Demande de confirmation pour quitter l'entraînement */
  _confirmQuit() {
    // Crée un mini-dialog de confirmation
    const dialog = el('div', { className: 'confirm-dialog-overlay', id: 'confirm-quit-dialog' },
      el('div', { className: 'confirm-dialog' },
        el('h3', {}, 'Quitter la séance ?'),
        el('p', {}, 'Ta progression actuelle sera perdue.'),
        el('div', { className: 'confirm-dialog-actions' },
          el('button', {
            className: 'btn btn-secondary',
            onClick: () => {
              const d = document.getElementById('confirm-quit-dialog');
              if (d) d.remove();
            },
          }, 'Continuer'),
          el('button', {
            className: 'btn btn-danger',
            onClick: () => {
              const d = document.getElementById('confirm-quit-dialog');
              if (d) d.remove();
              this._quitWorkout();
            },
          }, 'Quitter'),
        ),
      )
    );
    document.body.appendChild(dialog);
  }

  /** Quitte la séance sans sauvegarder */
  _quitWorkout() {
    this.restTimer.stop();
    if (this._elapsedInterval) clearInterval(this._elapsedInterval);
    this.session = null;
    this._hideWorkoutOverlay();
  }

  /** Séance terminée → afficher le résumé */
  _finishWorkout() {
    this.restTimer.stop();
    if (this._elapsedInterval) clearInterval(this._elapsedInterval);
    this._hideWorkoutOverlay();
    this._renderSummary();
  }

  /* ═══════════════════════════════════════════
     RÉSUMÉ DE SÉANCE
     ═══════════════════════════════════════════ */

  _renderSummary() {
    if (!this._summaryOverlay || !this.session) return;
    this._summaryOverlay.innerHTML = '';
    this._summaryOverlay.style.display = 'flex';

    const s = this.session;
    const volume = s.totalVolume;
    const duration = formatDuration(s.durationSeconds);
    const totalSets = s.completedSets;

    // Détecter les records personnels
    const newPRs = this._detectNewPRs();

    const overlay = this._summaryOverlay;

    overlay.appendChild(
      el('div', { className: 'summary-content' },
        // Titre
        el('div', { className: 'summary-header' },
          el('span', { className: 'summary-emoji' }, '🎉'),
          el('h2', { className: 'summary-title' }, 'Séance terminée !'),
          el('p', { className: 'summary-day' }, s.programDay.name),
        ),

        // Stats principales
        el('div', { className: 'summary-stats' },
          el('div', { className: 'summary-stat' },
            el('span', { className: 'summary-stat-value' }, formatNumber(volume)),
            el('span', { className: 'summary-stat-label' }, 'kg de volume'),
          ),
          el('div', { className: 'summary-stat' },
            el('span', { className: 'summary-stat-value' }, duration),
            el('span', { className: 'summary-stat-label' }, 'durée'),
          ),
          el('div', { className: 'summary-stat' },
            el('span', { className: 'summary-stat-value' }, String(totalSets)),
            el('span', { className: 'summary-stat-label' }, 'séries'),
          ),
        ),

        // Records personnels
        newPRs.length > 0
          ? el('div', { className: 'summary-prs' },
              el('h3', { className: 'summary-prs-title' }, '🏆 Nouveaux records !'),
              ...newPRs.map((pr) =>
                el('div', { className: 'summary-pr-item' },
                  el('span', { className: 'pr-exercise' }, pr.name),
                  el('span', { className: 'pr-value' }, `${pr.weight} kg × ${pr.reps} reps (+${pr.improvement} kg)`),
                )
              )
            )
          : null,

        // Détail par exercice
        el('div', { className: 'summary-exercises' },
          el('h3', { className: 'summary-section-title' }, 'Détail'),
          ...s.exercises.map((ex) =>
            el('div', { className: 'summary-exercise-row' },
              el('span', { className: 'summary-ex-name' }, ex.name),
              el('span', { className: 'summary-ex-sets' },
                ex.sets.map((set) => `${set.reps}×${set.weight}kg`).join(' / ')
              ),
            )
          ),
        ),

        // Actions
        el('div', { className: 'summary-actions' },
          el('button', {
            className: 'btn btn-primary btn-lg',
            id: 'btn-save-workout',
            onClick: () => this._saveWorkout(),
          }, '💾 Sauvegarder'),
          el('button', {
            className: 'btn btn-secondary',
            id: 'btn-discard-workout',
            onClick: () => this._discardWorkout(),
          }, 'Annuler'),
        ),
      )
    );
  }

  /** Détecte les nouveaux records personnels */
  _detectNewPRs() {
    if (!this.session) return [];
    const prs = this._getPersonalBests();
    const newPRs = [];

    for (const ex of this.session.exercises) {
      if (ex.sets.length === 0) continue;

      // Trouver le poids max + reps associées
      let maxW = 0;
      let repsAtMax = 0;
      for (const s of ex.sets) {
        const w = s.weight || 0;
        const r = s.reps || 0;
        if (w > maxW || (w === maxW && r > repsAtMax)) {
          maxW = w;
          repsAtMax = r;
        }
      }

      // Rétro-compat ancien format
      const current = prs[ex.exerciseId];
      const currentW = typeof current === 'number' ? current : (current?.weight || 0);

      if (maxW > currentW && maxW > 0) {
        newPRs.push({
          exerciseId:  ex.exerciseId,
          name:        ex.name,
          weight:      maxW,
          reps:        repsAtMax,
          improvement: Math.round((maxW - currentW) * 100) / 100,
        });
      }
    }

    return newPRs;
  }

  /** Sauvegarde la séance */
  _saveWorkout() {
    if (!this.session || !this.activeProgram) return;

    const data = this.session.toStorageFormat(this.userId, this.activeProgram.id);

    // Sauvegarder dans la liste des workouts
    const workouts = this._getWorkouts();
    workouts.push(data);
    this._setWorkouts(workouts);

    // Mettre à jour les records personnels
    this._updatePersonalBests();

    // Avancer au jour suivant
    this.currentDayIndex = (this.currentDayIndex + 1) % this.activeProgram.days.length;
    this._saveCurrentDayIndex();

    // Nettoyer
    this.session = null;
    this._summaryOverlay.style.display = 'none';

    // Rafraîchir l'affichage
    this._renderDayExercises();

    // Feedback visuel
    this._showToast('Séance sauvegardée ! 💪');
  }

  /** Annule sans sauvegarder */
  _discardWorkout() {
    this.session = null;
    if (this._summaryOverlay) this._summaryOverlay.style.display = 'none';
  }

  /** Met à jour les records personnels (poids + reps associées) */
  _updatePersonalBests() {
    if (!this.session) return;
    const prs = this._getPersonalBests();

    for (const ex of this.session.exercises) {
      if (ex.sets.length === 0) continue;

      // Trouver le poids max et les reps associées
      let maxW = 0;
      let repsAtMax = 0;
      for (const s of ex.sets) {
        const w = s.weight || 0;
        const r = s.reps || 0;
        if (w > maxW || (w === maxW && r > repsAtMax)) {
          maxW = w;
          repsAtMax = r;
        }
      }

      // Rétro-compat : ancien format = nombre, nouveau = { weight, reps }
      const current = prs[ex.exerciseId];
      const currentW = typeof current === 'number' ? current : (current?.weight || 0);
      const currentR = typeof current === 'number' ? 0 : (current?.reps || 0);

      if (maxW > currentW || (maxW === currentW && repsAtMax > currentR)) {
        prs[ex.exerciseId] = { weight: maxW, reps: repsAtMax };
      }
    }

    this._setPersonalBests(prs);
  }

  /* ═══════════════════════════════════════════
     STOCKAGE localStorage
     ═══════════════════════════════════════════ */

  /** Récupère la liste des séances enregistrées */
  _getWorkouts() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.workouts(this.userId))) || [];
    } catch {
      return [];
    }
  }

  _setWorkouts(workouts) {
    localStorage.setItem(STORAGE_KEYS.workouts(this.userId), JSON.stringify(workouts));
  }

  /** Récupère les records personnels { [exerciseId]: weight } */
  _getPersonalBests() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.personalBests(this.userId))) || {};
    } catch {
      return {};
    }
  }

  _setPersonalBests(prs) {
    localStorage.setItem(STORAGE_KEYS.personalBests(this.userId), JSON.stringify(prs));
  }

  /* ═══════════════════════════════════════════
     TOAST (NOTIFICATION LÉGÈRE)
     ═══════════════════════════════════════════ */

  _showToast(message, duration = 2500) {
    const existing = document.querySelector('.muscu-toast');
    if (existing) existing.remove();

    const toast = el('div', { className: 'muscu-toast' }, message);
    document.body.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => toast.classList.add('visible'));

    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 400);
    }, duration);
  }

  /* ═══════════════════════════════════════════
     API PUBLIQUE
     ═══════════════════════════════════════════ */

  /**
   * Retourne le programme du jour pour affichage externe (Dashboard)
   * @returns {{ dayName: string, exercises: Object[] } | null}
   */
  getTodayProgram() {
    if (!this.activeProgram) return null;
    const day = this.activeProgram.days[this.currentDayIndex];
    if (!day) return null;

    const suggestedWeights = this._getSuggestedWeights();

    return {
      programName: this.activeProgram.name,
      dayName:     day.name,
      dayIndex:    this.currentDayIndex,
      exercises:   day.exercises.map((pe) => {
        const exInfo = this.exerciseDb.find((e) => e.id === pe.exerciseId) || {};
        return {
          exerciseId:      pe.exerciseId,
          name:            exInfo.name || pe.exerciseId,
          muscle:          exInfo.muscle || '',
          svg:             exInfo.svg || '',
          sets:            pe.sets,
          reps:            pe.reps,
          restSeconds:     pe.restSeconds || DEFAULTS.restSeconds,
          suggestedWeight: (suggestedWeights[pe.exerciseId] || {}).weight || 0,
        };
      }),
    };
  }

  /**
   * Retourne l'historique des séances
   * @param {number} [limit=10]
   * @returns {Object[]}
   */
  getWorkoutHistory(limit = 10) {
    return this._getWorkouts()
      .sort((a, b) => (b.startTime || 0) - (a.startTime || 0))
      .slice(0, limit);
  }

  /**
   * Retourne les records personnels
   * @returns {Object} { [exerciseId]: { weight, reps } }
   */
  getPersonalBests() {
    return this._getPersonalBests();
  }

  /**
   * Retourne les stats globales
   * @returns {Object}
   */
  getStats() {
    const workouts = this._getWorkouts();
    const totalSessions = workouts.length;
    const totalVolume = workouts.reduce((sum, w) => sum + (w.volume || 0), 0);
    const totalDuration = workouts.reduce((sum, w) => sum + (w.duration || 0), 0);

    return {
      totalSessions,
      totalVolume,
      totalDuration,
      averageVolume:   totalSessions > 0 ? Math.round(totalVolume / totalSessions) : 0,
      averageDuration: totalSessions > 0 ? Math.round(totalDuration / totalSessions) : 0,
    };
  }

  /**
   * Change l'utilisateur actif (multi-user)
   * @param {string} userId
   */
  setUser(userId) {
    this.userId = userId;
    this._loadActiveProgram();
    this._loadCurrentDayIndex();
    this._renderProgramSelector();
    this._renderDayExercises();
  }

  /**
   * Met à jour les données (exercices / programmes)
   * Utile si chargés en asynchrone
   */
  updateData({ exercises, programs } = {}) {
    if (exercises) this.exerciseDb = exercises;
    if (programs) this.programs = programs;
    this._loadActiveProgram();
    this._renderProgramSelector();
    this._renderDayExercises();
  }

  /**
   * Détruit le module et nettoie le DOM
   */
  destroy() {
    this.restTimer.destroy();
    if (this._elapsedInterval) clearInterval(this._elapsedInterval);
    if (this._workoutOverlay) this._workoutOverlay.remove();
    if (this._summaryOverlay) this._summaryOverlay.remove();
  }
}

/* ─────────────────────────────────────────────
   EXPORT GLOBAL
   ───────────────────────────────────────────── */

window.TrainingModule = TrainingModule;
window.RestTimer = RestTimer;
window.WorkoutSession = WorkoutSession;
