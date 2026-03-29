// ═══════════════════════════════════════════════════════════════
// MuscuApp — Module Statistiques & Graphiques
// Canvas 2D natif · Pas de librairie externe · ES6 vanilla
// ═══════════════════════════════════════════════════════════════

'use strict';

// ─────────────────────────────────────────────
// Constantes & couleurs du design system
// ─────────────────────────────────────────────

const COULEURS = {
  accent:          '#0A84FF',
  accentHover:     '#409CFF',
  accentFonce:     '#0071E3',
  succes:          '#30D158',
  avertissement:   '#FF9F0A',
  danger:          '#FF453A',
  fond:            '#1C1C1E',
  surface:         '#2C2C2E',
  surfaceHover:    '#3A3A3C',
  surfaceActive:   '#48484A',
  textePrimaire:   '#FFFFFF',
  texteSecondaire: '#8E8E93',
  texteTertiaire:  '#636366',
  separateur:      'rgba(84, 84, 88, 0.65)',
};

const PERIODES = {
  '1S': { label: '1 Sem', jours: 7 },
  '1M': { label: '1 Mois', jours: 30 },
  '3M': { label: '3 Mois', jours: 90 },
  'TOUT': { label: 'Tout', jours: Infinity },
};

const CLE_SEANCES    = 'muscuapp_seances';
const CLE_NUTRITION  = 'muscuapp_nutrition';
const CLE_PROFIL     = 'muscuapp_profil';
const CLE_POTES      = 'muscuapp_potes';
const CLE_PROGRAMMES = 'muscuapp_programmes';


// ─────────────────────────────────────────────
// Utilitaires
// ─────────────────────────────────────────────

class Utils {
  /** Lire une clé localStorage (JSON) avec fallback */
  static lire(cle, defaut = []) {
    try {
      const data = localStorage.getItem(cle);
      return data ? JSON.parse(data) : defaut;
    } catch (e) {
      console.warn(`[Stats] Erreur lecture ${cle}:`, e);
      return defaut;
    }
  }

  /** Formater une date en texte court : "28 Mar" */
  static dateCourte(dateStr) {
    const d = new Date(dateStr);
    const mois = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun',
                  'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
    return `${d.getDate()} ${mois[d.getMonth()]}`;
  }

  /** Formater une date complète : "28 mars 2026" */
  static dateComplete(dateStr) {
    const d = new Date(dateStr);
    const mois = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
                  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
    return `${d.getDate()} ${mois[d.getMonth()]} ${d.getFullYear()}`;
  }

  /** Formater une durée en minutes → "1h 23min" */
  static dureeTexte(minutes) {
    if (!minutes || minutes <= 0) return '—';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m}min`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}min`;
  }

  /** Calculer le volume total d'une séance (somme poids × reps) */
  static volumeSeance(seance) {
    if (!seance.exercices) return 0;
    return seance.exercices.reduce((total, exo) => {
      const volExo = (exo.series || []).reduce((s, serie) => {
        return s + (serie.poids || 0) * (serie.reps || 0);
      }, 0);
      return total + volExo;
    }, 0);
  }

  /** Date ISO (YYYY-MM-DD) depuis un objet Date */
  static dateISO(date) {
    const d = date instanceof Date ? date : new Date(date);
    return d.toISOString().slice(0, 10);
  }

  /** Jours entre deux dates */
  static diffJours(d1, d2) {
    const ms = Math.abs(new Date(d1) - new Date(d2));
    return Math.ceil(ms / (1000 * 60 * 60 * 24));
  }

  /** Créer un élément DOM rapidement */
  static creer(tag, classes = '', html = '') {
    const el = document.createElement(tag);
    if (classes) el.className = classes;
    if (html) el.innerHTML = html;
    return el;
  }

  /** Pixel ratio du device pour canvas HD */
  static get dpr() {
    return window.devicePixelRatio || 1;
  }
}


// ─────────────────────────────────────────────
// Classe de base pour les graphiques Canvas
// ─────────────────────────────────────────────

class GraphiqueBase {
  constructor(conteneur, options = {}) {
    this.conteneur = conteneur;
    this.options = {
      paddingHaut:   30,
      paddingBas:    40,
      paddingGauche: 50,
      paddingDroit:  20,
      ...options,
    };
    this.canvas = null;
    this.ctx = null;
    this._resizeHandler = null;
  }

  /** Initialiser le canvas dans le conteneur */
  init() {
    // Nettoyer un éventuel canvas existant
    const ancien = this.conteneur.querySelector('canvas');
    if (ancien) ancien.remove();

    this.canvas = document.createElement('canvas');
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    this.conteneur.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    this.redimensionner();

    // Resize observer
    this._resizeHandler = () => this.redimensionner();
    window.addEventListener('resize', this._resizeHandler);
  }

  /** Ajuster la taille du canvas au conteneur (prise en charge Retina) */
  redimensionner() {
    if (!this.canvas || !this.conteneur) return;
    const rect = this.conteneur.getBoundingClientRect();
    const dpr = Utils.dpr;

    this.largeur = rect.width;
    this.hauteur = Math.max(rect.height, 200);

    this.canvas.width = this.largeur * dpr;
    this.canvas.height = this.hauteur * dpr;
    this.canvas.style.width = `${this.largeur}px`;
    this.canvas.style.height = `${this.hauteur}px`;

    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dessiner();
  }

  /** Zone de dessin utile */
  get zone() {
    const { paddingHaut, paddingBas, paddingGauche, paddingDroit } = this.options;
    return {
      x: paddingGauche,
      y: paddingHaut,
      w: this.largeur - paddingGauche - paddingDroit,
      h: this.hauteur - paddingHaut - paddingBas,
    };
  }

  /** Méthode à surcharger */
  dessiner() {}

  /** Nettoyage */
  detruire() {
    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler);
    }
    if (this.canvas) this.canvas.remove();
  }
}


// ─────────────────────────────────────────────
// Graphique linéaire de progression
// ─────────────────────────────────────────────

class GraphiqueProgression extends GraphiqueBase {
  constructor(conteneur, options = {}) {
    super(conteneur, options);
    this.donnees = [];        // [{date, valeur}]
    this.animation = 0;       // progression de l'animation (0→1)
    this._animFrame = null;
  }

  /** Charger les données pour un exercice et une période */
  charger(nomExercice, periodeCle = '1M') {
    const seances = Utils.lire(CLE_SEANCES, []);
    const periode = PERIODES[periodeCle];
    const maintenant = new Date();
    const limite = new Date();
    if (periode.jours !== Infinity) {
      limite.setDate(limite.getDate() - periode.jours);
    } else {
      limite.setFullYear(2000);
    }

    const points = [];

    for (const seance of seances) {
      const dateSeance = new Date(seance.date);
      if (dateSeance < limite || dateSeance > maintenant) continue;

      for (const exo of (seance.exercices || [])) {
        if (exo.nom !== nomExercice) continue;

        // Prendre la charge max de la séance pour cet exercice
        const chargeMax = Math.max(
          ...(exo.series || []).map(s => s.poids || 0),
          0
        );
        if (chargeMax > 0) {
          points.push({
            date: seance.date,
            valeur: chargeMax,
          });
        }
      }
    }

    // Trier par date
    points.sort((a, b) => new Date(a.date) - new Date(b.date));
    this.donnees = points;
    this.animer();
  }

  /** Lancer l'animation d'entrée */
  animer() {
    this.animation = 0;
    if (this._animFrame) cancelAnimationFrame(this._animFrame);

    const debut = performance.now();
    const duree = 600; // ms

    const boucle = (t) => {
      const progres = Math.min((t - debut) / duree, 1);
      // Easing ease-out cubic
      this.animation = 1 - Math.pow(1 - progres, 3);
      this.dessiner();
      if (progres < 1) {
        this._animFrame = requestAnimationFrame(boucle);
      }
    };
    this._animFrame = requestAnimationFrame(boucle);
  }

  dessiner() {
    const ctx = this.ctx;
    if (!ctx) return;
    const { x, y, w, h } = this.zone;
    const donnees = this.donnees;
    const anim = this.animation;

    // Effacer
    ctx.clearRect(0, 0, this.largeur, this.hauteur);

    // État vide
    if (donnees.length === 0) {
      ctx.font = `500 14px -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.fillStyle = COULEURS.texteSecondaire;
      ctx.textAlign = 'center';
      ctx.fillText('Aucune donnée pour cet exercice', this.largeur / 2, this.hauteur / 2);
      return;
    }

    // Calcul des bornes
    const valeurs = donnees.map(d => d.valeur);
    let valMin = Math.min(...valeurs);
    let valMax = Math.max(...valeurs);
    // Ajouter une marge de 10%
    const marge = (valMax - valMin) * 0.1 || 5;
    valMin = Math.max(0, valMin - marge);
    valMax = valMax + marge;

    // Fonctions de mapping
    const mapX = (i) => x + (i / Math.max(donnees.length - 1, 1)) * w;
    const mapY = (v) => y + h - ((v - valMin) / (valMax - valMin)) * h;

    // ── Grille horizontale ──
    this._dessinerGrille(ctx, x, y, w, h, valMin, valMax);

    // ── Axe X (dates) ──
    this._dessinerAxeX(ctx, x, y, w, h, donnees, mapX);

    // ── Zone colorée sous la courbe ──
    if (donnees.length > 1) {
      ctx.beginPath();
      ctx.moveTo(mapX(0), mapY(donnees[0].valeur * anim));
      for (let i = 1; i < donnees.length; i++) {
        const px = mapX(i);
        const py = mapY(donnees[i].valeur * anim);
        // Courbe de Bézier pour lissage
        const prevX = mapX(i - 1);
        const prevY = mapY(donnees[i - 1].valeur * anim);
        const cpx = (prevX + px) / 2;
        ctx.bezierCurveTo(cpx, prevY, cpx, py, px, py);
      }
      // Fermer le path vers le bas
      ctx.lineTo(mapX(donnees.length - 1), y + h);
      ctx.lineTo(mapX(0), y + h);
      ctx.closePath();

      // Dégradé vertical
      const gradient = ctx.createLinearGradient(0, y, 0, y + h);
      gradient.addColorStop(0, 'rgba(10, 132, 255, 0.3)');
      gradient.addColorStop(1, 'rgba(10, 132, 255, 0.02)');
      ctx.fillStyle = gradient;
      ctx.fill();
    }

    // ── Ligne de la courbe ──
    if (donnees.length > 1) {
      ctx.beginPath();
      ctx.moveTo(mapX(0), mapY(donnees[0].valeur * anim));
      for (let i = 1; i < donnees.length; i++) {
        const px = mapX(i);
        const py = mapY(donnees[i].valeur * anim);
        const prevX = mapX(i - 1);
        const prevY = mapY(donnees[i - 1].valeur * anim);
        const cpx = (prevX + px) / 2;
        ctx.bezierCurveTo(cpx, prevY, cpx, py, px, py);
      }
      ctx.strokeStyle = COULEURS.accent;
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // ── Points ──
    for (let i = 0; i < donnees.length; i++) {
      const px = mapX(i);
      const py = mapY(donnees[i].valeur * anim);

      // Halo
      ctx.beginPath();
      ctx.arc(px, py, 6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(10, 132, 255, 0.2)';
      ctx.fill();

      // Point central
      ctx.beginPath();
      ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = COULEURS.accent;
      ctx.fill();

      // Centre blanc
      ctx.beginPath();
      ctx.arc(px, py, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = COULEURS.fond;
      ctx.fill();
    }

    // ── Valeur au dernier point ──
    if (donnees.length > 0) {
      const dernier = donnees[donnees.length - 1];
      const dx = mapX(donnees.length - 1);
      const dy = mapY(dernier.valeur * anim);

      ctx.font = `bold 13px -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.fillStyle = COULEURS.textePrimaire;
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.round(dernier.valeur * anim)} kg`, dx, dy - 14);
    }
  }

  /** Dessiner la grille horizontale + labels Y */
  _dessinerGrille(ctx, zx, zy, zw, zh, valMin, valMax) {
    const nbLignes = 5;
    ctx.font = `500 11px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.textAlign = 'right';

    for (let i = 0; i <= nbLignes; i++) {
      const ratio = i / nbLignes;
      const yPos = zy + zh - ratio * zh;
      const valeur = valMin + ratio * (valMax - valMin);

      // Ligne de grille
      ctx.beginPath();
      ctx.moveTo(zx, yPos);
      ctx.lineTo(zx + zw, yPos);
      ctx.strokeStyle = 'rgba(84, 84, 88, 0.2)';
      ctx.lineWidth = 0.5;
      ctx.stroke();

      // Label
      ctx.fillStyle = COULEURS.texteTertiaire;
      ctx.fillText(`${Math.round(valeur)}`, zx - 8, yPos + 4);
    }
  }

  /** Dessiner les labels de l'axe X (dates) */
  _dessinerAxeX(ctx, zx, zy, zw, zh, donnees, mapX) {
    if (donnees.length === 0) return;

    ctx.font = `500 10px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.fillStyle = COULEURS.texteTertiaire;
    ctx.textAlign = 'center';

    // Afficher max 6 labels pour la lisibilité
    const maxLabels = 6;
    const step = Math.max(1, Math.ceil(donnees.length / maxLabels));

    for (let i = 0; i < donnees.length; i += step) {
      const px = mapX(i);
      ctx.fillText(Utils.dateCourte(donnees[i].date), px, zy + zh + 20);
    }

    // Toujours afficher le dernier
    if (donnees.length > 1 && (donnees.length - 1) % step !== 0) {
      const px = mapX(donnees.length - 1);
      ctx.fillText(Utils.dateCourte(donnees[donnees.length - 1].date), px, zy + zh + 20);
    }
  }

  detruire() {
    if (this._animFrame) cancelAnimationFrame(this._animFrame);
    super.detruire();
  }
}


// ─────────────────────────────────────────────
// Graphique Nutrition (courbe calories)
// ─────────────────────────────────────────────

class GraphiqueNutrition extends GraphiqueBase {
  constructor(conteneur, options = {}) {
    super(conteneur, options);
    this.donnees = [];         // [{date, calories}]
    this.objectifCal = 2500;   // par défaut
    this.animation = 0;
    this._animFrame = null;
  }

  /** Charger les données nutrition sur une période */
  charger(periodeCle = '1S') {
    const nutrition = Utils.lire(CLE_NUTRITION, []);
    const profil = Utils.lire(CLE_PROFIL, {});
    this.objectifCal = profil.objectifCalories || 2500;

    const periode = PERIODES[periodeCle];
    const maintenant = new Date();
    const limite = new Date();
    if (periode.jours !== Infinity) {
      limite.setDate(limite.getDate() - periode.jours);
    } else {
      limite.setFullYear(2000);
    }

    const points = nutrition
      .filter(j => {
        const d = new Date(j.date);
        return d >= limite && d <= maintenant;
      })
      .map(j => ({ date: j.date, calories: j.calories || 0 }))
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    this.donnees = points;
    this.animer();
  }

  animer() {
    this.animation = 0;
    if (this._animFrame) cancelAnimationFrame(this._animFrame);

    const debut = performance.now();
    const duree = 600;

    const boucle = (t) => {
      const progres = Math.min((t - debut) / duree, 1);
      this.animation = 1 - Math.pow(1 - progres, 3);
      this.dessiner();
      if (progres < 1) {
        this._animFrame = requestAnimationFrame(boucle);
      }
    };
    this._animFrame = requestAnimationFrame(boucle);
  }

  dessiner() {
    const ctx = this.ctx;
    if (!ctx) return;
    const { x, y, w, h } = this.zone;
    const donnees = this.donnees;
    const anim = this.animation;

    ctx.clearRect(0, 0, this.largeur, this.hauteur);

    if (donnees.length === 0) {
      ctx.font = `500 14px -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.fillStyle = COULEURS.texteSecondaire;
      ctx.textAlign = 'center';
      ctx.fillText('Aucune donnée nutrition', this.largeur / 2, this.hauteur / 2);
      return;
    }

    // Bornes
    const cals = donnees.map(d => d.calories);
    let valMin = 0;
    let valMax = Math.max(...cals, this.objectifCal) * 1.1;

    const mapX = (i) => x + (i / Math.max(donnees.length - 1, 1)) * w;
    const mapY = (v) => y + h - ((v - valMin) / (valMax - valMin)) * h;

    // Grille
    this._dessinerGrilleNutrition(ctx, x, y, w, h, valMin, valMax);

    // ── Ligne objectif (en pointillés) ──
    const yObj = mapY(this.objectifCal);
    ctx.beginPath();
    ctx.setLineDash([6, 4]);
    ctx.moveTo(x, yObj);
    ctx.lineTo(x + w, yObj);
    ctx.strokeStyle = 'rgba(48, 209, 88, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);

    // Label objectif
    ctx.font = `600 10px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.fillStyle = COULEURS.succes;
    ctx.textAlign = 'left';
    ctx.fillText(`Objectif ${this.objectifCal} kcal`, x + 4, yObj - 6);

    // ── Barres de calories ──
    if (donnees.length <= 14) {
      // Mode barres pour peu de données
      const barW = Math.min(24, (w / donnees.length) * 0.6);
      for (let i = 0; i < donnees.length; i++) {
        const px = mapX(i);
        const val = donnees[i].calories * anim;
        const barH = ((val - valMin) / (valMax - valMin)) * h;
        const barY = y + h - barH;

        // Couleur selon objectif
        const ratio = donnees[i].calories / this.objectifCal;
        let couleur;
        if (ratio >= 0.9 && ratio <= 1.1) {
          couleur = COULEURS.succes;
        } else if (ratio < 0.9) {
          couleur = COULEURS.accent;
        } else {
          couleur = COULEURS.avertissement;
        }

        // Barre avec coins arrondis en haut
        const r = Math.min(4, barW / 2);
        ctx.beginPath();
        ctx.moveTo(px - barW / 2, y + h);
        ctx.lineTo(px - barW / 2, barY + r);
        ctx.quadraticCurveTo(px - barW / 2, barY, px - barW / 2 + r, barY);
        ctx.lineTo(px + barW / 2 - r, barY);
        ctx.quadraticCurveTo(px + barW / 2, barY, px + barW / 2, barY + r);
        ctx.lineTo(px + barW / 2, y + h);
        ctx.closePath();

        ctx.fillStyle = couleur;
        ctx.globalAlpha = 0.8;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    } else {
      // Mode courbe pour beaucoup de données
      // Zone colorée
      ctx.beginPath();
      ctx.moveTo(mapX(0), mapY(donnees[0].calories * anim));
      for (let i = 1; i < donnees.length; i++) {
        const px = mapX(i);
        const py = mapY(donnees[i].calories * anim);
        const prevX = mapX(i - 1);
        const prevY = mapY(donnees[i - 1].calories * anim);
        const cpx = (prevX + px) / 2;
        ctx.bezierCurveTo(cpx, prevY, cpx, py, px, py);
      }
      ctx.lineTo(mapX(donnees.length - 1), y + h);
      ctx.lineTo(mapX(0), y + h);
      ctx.closePath();

      const gradient = ctx.createLinearGradient(0, y, 0, y + h);
      gradient.addColorStop(0, 'rgba(48, 209, 88, 0.25)');
      gradient.addColorStop(1, 'rgba(48, 209, 88, 0.02)');
      ctx.fillStyle = gradient;
      ctx.fill();

      // Ligne
      ctx.beginPath();
      ctx.moveTo(mapX(0), mapY(donnees[0].calories * anim));
      for (let i = 1; i < donnees.length; i++) {
        const px = mapX(i);
        const py = mapY(donnees[i].calories * anim);
        const prevX = mapX(i - 1);
        const prevY = mapY(donnees[i - 1].calories * anim);
        const cpx = (prevX + px) / 2;
        ctx.bezierCurveTo(cpx, prevY, cpx, py, px, py);
      }
      ctx.strokeStyle = COULEURS.succes;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Axe X dates
    ctx.font = `500 10px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.fillStyle = COULEURS.texteTertiaire;
    ctx.textAlign = 'center';

    const maxLabels = 7;
    const step = Math.max(1, Math.ceil(donnees.length / maxLabels));
    for (let i = 0; i < donnees.length; i += step) {
      ctx.fillText(Utils.dateCourte(donnees[i].date), mapX(i), y + h + 20);
    }
    if (donnees.length > 1 && (donnees.length - 1) % step !== 0) {
      ctx.fillText(
        Utils.dateCourte(donnees[donnees.length - 1].date),
        mapX(donnees.length - 1), y + h + 20
      );
    }
  }

  _dessinerGrilleNutrition(ctx, zx, zy, zw, zh, valMin, valMax) {
    const nbLignes = 4;
    ctx.font = `500 11px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.textAlign = 'right';

    for (let i = 0; i <= nbLignes; i++) {
      const ratio = i / nbLignes;
      const yPos = zy + zh - ratio * zh;
      const valeur = valMin + ratio * (valMax - valMin);

      ctx.beginPath();
      ctx.moveTo(zx, yPos);
      ctx.lineTo(zx + zw, yPos);
      ctx.strokeStyle = 'rgba(84, 84, 88, 0.2)';
      ctx.lineWidth = 0.5;
      ctx.stroke();

      ctx.fillStyle = COULEURS.texteTertiaire;
      ctx.fillText(`${Math.round(valeur)}`, zx - 8, yPos + 4);
    }
  }

  detruire() {
    if (this._animFrame) cancelAnimationFrame(this._animFrame);
    super.detruire();
  }
}


// ─────────────────────────────────────────────
// Panneau Progression (sélecteur exercice + période + graphiques)
// ─────────────────────────────────────────────

class PanneauProgression {
  constructor(conteneur) {
    this.conteneur = conteneur;
    this.graphiqueCharge = null;
    this.graphiqueNutrition = null;
    this.exerciceActif = null;
    this.periodeActive = '1M';
    this.periodeNutrition = '1S';
  }

  /** Construire l'UI et initialiser */
  init() {
    this.conteneur.innerHTML = '';

    // ── Section Graphique Progression ──
    const sectionProg = Utils.creer('div', 'chart-container mb-4');
    sectionProg.innerHTML = `
      <div class="chart-header">
        <span class="chart-title">Progression des charges</span>
      </div>
      <div class="select-wrapper mb-3">
        <select class="select" id="stats-exercice-select">
          <option value="">— Choisir un exercice —</option>
        </select>
      </div>
      <div class="period-tabs mb-3" id="stats-period-tabs"></div>
      <div id="stats-chart-canvas" style="width:100%;height:220px;position:relative;"></div>
    `;
    this.conteneur.appendChild(sectionProg);

    // ── Section Records personnels ──
    const sectionRecords = Utils.creer('div', 'mb-4');
    sectionRecords.innerHTML = `
      <div class="heading-subsection mb-3" style="padding:0 4px;">🏆 Records personnels</div>
      <div id="stats-records-list"></div>
    `;
    this.conteneur.appendChild(sectionRecords);

    // ── Section Graphique Nutrition ──
    const sectionNutri = Utils.creer('div', 'chart-container mb-4');
    sectionNutri.innerHTML = `
      <div class="chart-header">
        <span class="chart-title">Calories</span>
      </div>
      <div class="period-tabs mb-3" id="stats-nutri-period-tabs"></div>
      <div id="stats-nutri-canvas" style="width:100%;height:200px;position:relative;"></div>
    `;
    this.conteneur.appendChild(sectionNutri);

    // Peupler
    this._peuplerExercices();
    this._peuplerPeriodes();
    this._peuplerPeriodesNutrition();
    this._afficherRecords();

    // Init graphiques
    const canvasZone = document.getElementById('stats-chart-canvas');
    this.graphiqueCharge = new GraphiqueProgression(canvasZone);
    this.graphiqueCharge.init();

    const nutCanvasZone = document.getElementById('stats-nutri-canvas');
    this.graphiqueNutrition = new GraphiqueNutrition(nutCanvasZone);
    this.graphiqueNutrition.init();

    // Événements
    this._lierEvenements();

    // Charger données initiales
    if (this.exerciceActif) {
      this.graphiqueCharge.charger(this.exerciceActif, this.periodeActive);
    }
    this.graphiqueNutrition.charger(this.periodeNutrition);
  }

  /** Récupérer la liste unique des exercices depuis l'historique */
  _getExercicesUniques() {
    const seances = Utils.lire(CLE_SEANCES, []);
    const set = new Set();
    for (const seance of seances) {
      for (const exo of (seance.exercices || [])) {
        if (exo.nom) set.add(exo.nom);
      }
    }
    return [...set].sort();
  }

  /** Remplir le select des exercices */
  _peuplerExercices() {
    const select = document.getElementById('stats-exercice-select');
    if (!select) return;

    const exercices = this._getExercicesUniques();
    for (const nom of exercices) {
      const opt = document.createElement('option');
      opt.value = nom;
      opt.textContent = nom;
      select.appendChild(opt);
    }

    if (exercices.length > 0) {
      select.value = exercices[0];
      this.exerciceActif = exercices[0];
    }
  }

  /** Construire les onglets de période pour la progression */
  _peuplerPeriodes() {
    const container = document.getElementById('stats-period-tabs');
    if (!container) return;

    for (const [cle, info] of Object.entries(PERIODES)) {
      const btn = Utils.creer('button', `period-tab${cle === this.periodeActive ? ' active' : ''}`, info.label);
      btn.dataset.periode = cle;
      container.appendChild(btn);
    }
  }

  /** Construire les onglets de période pour la nutrition */
  _peuplerPeriodesNutrition() {
    const container = document.getElementById('stats-nutri-period-tabs');
    if (!container) return;

    for (const [cle, info] of Object.entries(PERIODES)) {
      const btn = Utils.creer('button', `period-tab${cle === this.periodeNutrition ? ' active' : ''}`, info.label);
      btn.dataset.periode = cle;
      container.appendChild(btn);
    }
  }

  /** Afficher les records personnels */
  _afficherRecords() {
    const container = document.getElementById('stats-records-list');
    if (!container) return;

    const seances = Utils.lire(CLE_SEANCES, []);
    const records = RecordsPersonnels.calculer(seances);

    if (records.charges.length === 0 && !records.meilleurVolume) {
      container.innerHTML = `
        <div class="empty-state" style="padding:24px 16px;">
          <div class="empty-state-icon">🏋️</div>
          <div class="empty-state-description">Enregistre des séances pour voir tes records !</div>
        </div>
      `;
      return;
    }

    let html = '';

    // Top charges par exercice
    for (const rec of records.charges.slice(0, 5)) {
      html += `
        <div class="pr-card mb-2">
          <div class="pr-icon">🏅</div>
          <div class="pr-info">
            <div class="pr-exercise">${rec.exercice}</div>
            <div class="pr-value">${rec.poids} kg × ${rec.reps} reps</div>
          </div>
          <div class="text-sm text-secondary">${Utils.dateCourte(rec.date)}</div>
        </div>
      `;
    }

    // Meilleur volume
    if (records.meilleurVolume) {
      const mv = records.meilleurVolume;
      html += `
        <div class="pr-card mb-2" style="border-color:rgba(10,132,255,0.25);background:linear-gradient(135deg,rgba(10,132,255,0.12),rgba(10,132,255,0.04));">
          <div class="pr-icon">📊</div>
          <div class="pr-info">
            <div class="pr-exercise">Meilleur volume total</div>
            <div class="pr-value">${mv.volume.toLocaleString('fr-FR')} kg</div>
          </div>
          <div class="text-sm text-secondary">${Utils.dateCourte(mv.date)}</div>
        </div>
      `;
    }

    container.innerHTML = html;
  }

  /** Lier les événements (select, period tabs) */
  _lierEvenements() {
    // Sélecteur d'exercice
    const select = document.getElementById('stats-exercice-select');
    if (select) {
      select.addEventListener('change', () => {
        this.exerciceActif = select.value;
        if (this.exerciceActif) {
          this.graphiqueCharge.charger(this.exerciceActif, this.periodeActive);
        }
      });
    }

    // Onglets période progression
    const periodeContainer = document.getElementById('stats-period-tabs');
    if (periodeContainer) {
      periodeContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.period-tab');
        if (!btn) return;

        periodeContainer.querySelectorAll('.period-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        this.periodeActive = btn.dataset.periode;
        if (this.exerciceActif) {
          this.graphiqueCharge.charger(this.exerciceActif, this.periodeActive);
        }
      });
    }

    // Onglets période nutrition
    const nutriContainer = document.getElementById('stats-nutri-period-tabs');
    if (nutriContainer) {
      nutriContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.period-tab');
        if (!btn) return;

        nutriContainer.querySelectorAll('.period-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        this.periodeNutrition = btn.dataset.periode;
        this.graphiqueNutrition.charger(this.periodeNutrition);
      });
    }
  }

  /** Nettoyage */
  detruire() {
    if (this.graphiqueCharge) this.graphiqueCharge.detruire();
    if (this.graphiqueNutrition) this.graphiqueNutrition.detruire();
  }
}


// ─────────────────────────────────────────────
// Records Personnels (calculs)
// ─────────────────────────────────────────────

class RecordsPersonnels {
  /**
   * Calculer tous les records depuis un tableau de séances
   * @returns {{ charges: [{exercice, poids, reps, date}], meilleurVolume: {date, volume, programme} | null }}
   */
  static calculer(seances) {
    const chargesMax = {};  // { nomExo: {poids, reps, date} }
    let meilleurVolume = null;

    for (const seance of seances) {
      // Records de charge par exercice (+ reps associées)
      for (const exo of (seance.exercices || [])) {
        for (const s of (exo.series || [])) {
          const w = s.poids || 0;
          const r = s.reps || 0;
          if (w > 0) {
            const current = chargesMax[exo.nom];
            if (!current || w > current.poids || (w === current.poids && r > current.reps)) {
              chargesMax[exo.nom] = { poids: w, reps: r, date: seance.date };
            }
          }
        }
      }

      // Record de volume
      const volume = Utils.volumeSeance(seance);
      if (volume > 0 && (!meilleurVolume || volume > meilleurVolume.volume)) {
        meilleurVolume = {
          date: seance.date,
          volume,
          programme: seance.programme || '—',
        };
      }
    }

    // Convertir en tableau trié par poids décroissant
    const charges = Object.entries(chargesMax)
      .map(([exercice, data]) => ({ exercice, ...data }))
      .sort((a, b) => b.poids - a.poids);

    return { charges, meilleurVolume };
  }
}


// ─────────────────────────────────────────────
// Panneau Historique des séances
// ─────────────────────────────────────────────

class PanneauHistorique {
  constructor(conteneur) {
    this.conteneur = conteneur;
    this.seanceDetailOuverte = null;
  }

  init() {
    this.afficher();
  }

  /** Afficher la liste des séances */
  afficher() {
    const seances = Utils.lire(CLE_SEANCES, []);
    this.conteneur.innerHTML = '';

    if (seances.length === 0) {
      this.conteneur.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📋</div>
          <div class="empty-state-title">Aucune séance</div>
          <div class="empty-state-description">Tes séances passées apparaîtront ici</div>
        </div>
      `;
      return;
    }

    // Trier par date décroissante
    const triees = [...seances].sort((a, b) => new Date(b.date) - new Date(a.date));

    // Grouper par mois
    const parMois = {};
    for (const seance of triees) {
      const d = new Date(seance.date);
      const cleMois = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const moisNoms = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
                        'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
      const label = `${moisNoms[d.getMonth()]} ${d.getFullYear()}`;

      if (!parMois[cleMois]) parMois[cleMois] = { label, seances: [] };
      parMois[cleMois].seances.push(seance);
    }

    // Générer le HTML
    for (const [cleMois, groupe] of Object.entries(parMois)) {
      const section = Utils.creer('div', 'mb-6');

      // Titre du mois
      const titre = Utils.creer('div', 'heading-subsection mb-3', groupe.label);
      titre.style.padding = '0 4px';
      section.appendChild(titre);

      // Liste des séances
      const liste = Utils.creer('div', 'list-grouped');

      for (const seance of groupe.seances) {
        const volume = Utils.volumeSeance(seance);
        const nbExos = (seance.exercices || []).length;

        const item = Utils.creer('div', 'list-item');
        item.style.cursor = 'pointer';
        item.innerHTML = `
          <div class="list-item-icon" style="background:rgba(10,132,255,0.15);color:${COULEURS.accent};font-size:1.2rem;">
            🏋️
          </div>
          <div class="list-item-content">
            <div class="list-item-title">${seance.programme || 'Séance libre'}</div>
            <div class="list-item-subtitle">
              ${Utils.dateCourte(seance.date)} · ${nbExos} exo${nbExos > 1 ? 's' : ''} · ${Utils.dureeTexte(seance.duree)}
            </div>
          </div>
          <div class="list-item-trailing">
            <span style="font-variant-numeric:tabular-nums;">${volume > 0 ? volume.toLocaleString('fr-FR') + ' kg' : '—'}</span>
            <span style="margin-left:4px;">›</span>
          </div>
        `;

        item.addEventListener('click', () => this._afficherDetail(seance));
        liste.appendChild(item);
      }

      section.appendChild(liste);
      this.conteneur.appendChild(section);
    }
  }

  /** Afficher le détail d'une séance */
  _afficherDetail(seance) {
    this.seanceDetailOuverte = seance;
    this.conteneur.innerHTML = '';

    // Bouton retour
    const retour = Utils.creer('button', 'btn btn-ghost mb-4', '← Retour');
    retour.addEventListener('click', () => {
      this.seanceDetailOuverte = null;
      this.afficher();
    });
    this.conteneur.appendChild(retour);

    // En-tête de la séance
    const header = Utils.creer('div', 'workout-summary mb-4');
    const volume = Utils.volumeSeance(seance);
    const nbSeries = (seance.exercices || []).reduce(
      (t, exo) => t + (exo.series || []).length, 0
    );
    header.innerHTML = `
      <div class="workout-summary-title">${seance.programme || 'Séance libre'}</div>
      <div class="text-sm text-secondary mb-4">${Utils.dateComplete(seance.date)}</div>
      <div class="workout-summary-stats">
        <div class="workout-summary-stat">
          <div class="stat-value">${Utils.dureeTexte(seance.duree)}</div>
          <div class="stat-label">Durée</div>
        </div>
        <div class="workout-summary-stat">
          <div class="stat-value">${nbSeries}</div>
          <div class="stat-label">Séries</div>
        </div>
        <div class="workout-summary-stat">
          <div class="stat-value">${volume > 0 ? volume.toLocaleString('fr-FR') : '—'}</div>
          <div class="stat-label">Volume (kg)</div>
        </div>
      </div>
    `;
    this.conteneur.appendChild(header);

    // Détail de chaque exercice
    for (const exo of (seance.exercices || [])) {
      const card = Utils.creer('div', 'card mb-3');

      let seriesHTML = '';
      for (let i = 0; i < (exo.series || []).length; i++) {
        const serie = exo.series[i];
        seriesHTML += `
          <div class="set-row">
            <div class="set-number">${i + 1}</div>
            <div style="text-align:center;font-variant-numeric:tabular-nums;">${serie.poids || 0} kg</div>
            <div style="text-align:center;font-variant-numeric:tabular-nums;">${serie.reps || 0} reps</div>
            <div class="set-check completed">✓</div>
          </div>
        `;
      }

      card.innerHTML = `
        <div class="card-header">
          <span class="card-title">${exo.nom || 'Exercice'}</span>
          <span class="text-sm text-secondary">${(exo.series || []).length} série${(exo.series || []).length > 1 ? 's' : ''}</span>
        </div>
        <div class="set-header">
          <span>Série</span>
          <span>Poids</span>
          <span>Reps</span>
          <span>✓</span>
        </div>
        ${seriesHTML}
      `;

      this.conteneur.appendChild(card);
    }
  }
}


// ─────────────────────────────────────────────
// Panneau Classement entre potes
// ─────────────────────────────────────────────

class PanneauClassement {
  constructor(conteneur) {
    this.conteneur = conteneur;
  }

  init() {
    this.afficher();
  }

  /** Récupérer les données des potes + profil actuel */
  _getDonnees() {
    const profil = Utils.lire(CLE_PROFIL, { nom: 'Moi' });
    const seances = Utils.lire(CLE_SEANCES, []);
    const potes = Utils.lire(CLE_POTES, []);

    // Calculer les stats de l'utilisateur
    const volumeTotal = seances.reduce((t, s) => t + Utils.volumeSeance(s), 0);
    const nbSeances = seances.length;

    // Meilleure charge de l'utilisateur
    let chargeMax = 0;
    for (const s of seances) {
      for (const exo of (s.exercices || [])) {
        for (const serie of (exo.series || [])) {
          if ((serie.poids || 0) > chargeMax) chargeMax = serie.poids;
        }
      }
    }

    const utilisateur = {
      nom: profil.nom || 'Moi',
      avatar: profil.avatar || '🏋️',
      volumeTotal,
      nbSeances,
      chargeMax,
      estMoi: true,
    };

    // Calculer les stats des potes
    const participants = [utilisateur];

    for (const pote of potes) {
      const pSeances = pote.seances || [];
      const pVol = pSeances.reduce((t, s) => t + Utils.volumeSeance(s), 0);
      let pCharge = 0;
      for (const s of pSeances) {
        for (const exo of (s.exercices || [])) {
          for (const serie of (exo.series || [])) {
            if ((serie.poids || 0) > pCharge) pCharge = serie.poids;
          }
        }
      }

      participants.push({
        nom: pote.nom || '???',
        avatar: pote.avatar || '👤',
        volumeTotal: pVol,
        nbSeances: pSeances.length,
        chargeMax: pCharge,
        estMoi: false,
      });
    }

    // Trier par volume total (décroissant)
    participants.sort((a, b) => b.volumeTotal - a.volumeTotal);
    return participants;
  }

  afficher() {
    const participants = this._getDonnees();
    this.conteneur.innerHTML = '';

    if (participants.length <= 1 && participants[0]?.volumeTotal === 0) {
      this.conteneur.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">👥</div>
          <div class="empty-state-title">Classement</div>
          <div class="empty-state-description">Ajoute des potes et enregistre des séances pour comparer vos performances !</div>
        </div>
      `;
      return;
    }

    // ── Podium visuel ──
    const podium = Utils.creer('div', 'mb-6');
    podium.style.cssText = 'display:flex;align-items:flex-end;justify-content:center;gap:12px;padding:24px 0 16px;';

    const medailles = ['🥇', '🥈', '🥉'];
    const hauteurs = [120, 90, 70];
    const ordreAffichage = [1, 0, 2]; // 2e, 1er, 3e (1er au milieu)

    for (const idx of ordreAffichage) {
      if (idx >= participants.length) continue;
      const p = participants[idx];
      const h = hauteurs[idx];

      const col = Utils.creer('div', '');
      col.style.cssText = `
        display:flex;flex-direction:column;align-items:center;gap:8px;flex:1;max-width:120px;
        animation:fadeInUp 0.5s ease forwards;animation-delay:${idx * 0.1}s;opacity:0;
      `;

      // Avatar
      const avatarSize = idx === 0 ? 56 : 44;
      col.innerHTML = `
        <div style="font-size:${idx === 0 ? '2rem' : '1.5rem'};">${medailles[idx] || ''}</div>
        <div style="width:${avatarSize}px;height:${avatarSize}px;border-radius:50%;background:${COULEURS.surface};
             display:flex;align-items:center;justify-content:center;font-size:${idx === 0 ? '1.5rem' : '1.2rem'};
             ${p.estMoi ? `border:2px solid ${COULEURS.accent};` : ''}">
          ${p.avatar}
        </div>
        <div style="font-size:13px;font-weight:600;${p.estMoi ? `color:${COULEURS.accent};` : ''}">${p.nom}</div>
        <div style="width:100%;height:${h}px;border-radius:12px 12px 0 0;
             background:${idx === 0 ? `linear-gradient(180deg, ${COULEURS.accent}, ${COULEURS.accentFonce})` :
               idx === 1 ? `linear-gradient(180deg, ${COULEURS.surfaceHover}, ${COULEURS.surface})` :
               `linear-gradient(180deg, ${COULEURS.surfaceActive}, ${COULEURS.surface})`};
             display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:8px;">
          <div style="font-size:16px;font-weight:700;font-variant-numeric:tabular-nums;">
            ${p.volumeTotal > 0 ? (p.volumeTotal / 1000).toFixed(1) + 't' : '—'}
          </div>
          <div style="font-size:10px;opacity:0.7;">Volume</div>
        </div>
      `;

      podium.appendChild(col);
    }

    this.conteneur.appendChild(podium);

    // ── Tableau comparatif détaillé ──
    const tableau = Utils.creer('div', 'card');

    let rowsHTML = '';
    for (let i = 0; i < participants.length; i++) {
      const p = participants[i];
      const bordure = i < participants.length - 1
        ? `border-bottom:0.5px solid ${COULEURS.separateur};`
        : '';

      rowsHTML += `
        <div class="list-item" style="${bordure}">
          <div style="width:28px;text-align:center;font-weight:700;color:${COULEURS.texteSecondaire};">
            ${i < 3 ? medailles[i] : i + 1}
          </div>
          <div style="width:36px;height:36px;border-radius:50%;background:${COULEURS.surfaceHover};
               display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0;
               ${p.estMoi ? `border:2px solid ${COULEURS.accent};` : ''}">
            ${p.avatar}
          </div>
          <div class="list-item-content" style="min-width:0;">
            <div class="list-item-title" style="${p.estMoi ? `color:${COULEURS.accent};font-weight:600;` : ''}">
              ${p.nom}${p.estMoi ? ' (toi)' : ''}
            </div>
            <div class="list-item-subtitle">
              ${p.nbSeances} séance${p.nbSeances > 1 ? 's' : ''} · max ${p.chargeMax} kg
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:15px;font-weight:700;font-variant-numeric:tabular-nums;">
              ${p.volumeTotal > 0 ? p.volumeTotal.toLocaleString('fr-FR') : '—'}
            </div>
            <div style="font-size:11px;color:${COULEURS.texteSecondaire};">kg total</div>
          </div>
        </div>
      `;
    }

    tableau.innerHTML = `
      <div class="card-header">
        <span class="card-title">Classement détaillé</span>
        <span class="text-sm text-secondary">${participants.length} participants</span>
      </div>
      ${rowsHTML}
    `;

    this.conteneur.appendChild(tableau);
  }
}


// ═══════════════════════════════════════════════════════════════
// Module Stats principal — orchestre tout
// ═══════════════════════════════════════════════════════════════

class StatsModule {
  constructor() {
    this.panneaux = {};
    this.ongletActif = 'progression';
    this._initOk = false;
  }

  /** Initialiser le module — appeler une fois le DOM prêt */
  init() {
    if (this._initOk) return;
    this._initOk = true;

    // Référencer les containers depuis le HTML
    const panelProg = document.getElementById('panel-progression');
    const panelHist = document.getElementById('panel-historique');
    const panelClass = document.getElementById('panel-classement');

    if (!panelProg || !panelHist || !panelClass) {
      console.warn('[Stats] Panels non trouvés dans le DOM');
      return;
    }

    // Assurer que les chart-zone internes existent ou créer les conteneurs
    const chartProg = panelProg.querySelector('.chart-zone') || panelProg;
    const chartHist = panelHist.querySelector('.chart-zone') || panelHist;
    const chartClass = panelClass.querySelector('.leaderboard') || panelClass;

    // Créer les panneaux
    this.panneaux.progression = new PanneauProgression(chartProg);
    this.panneaux.historique = new PanneauHistorique(chartHist);
    this.panneaux.classement = new PanneauClassement(chartClass);

    // Initialiser le panneau actif
    this._initPanneau(this.ongletActif);

    // Écouter les changements d'onglets
    this._lierOnglets();

    console.log('[Stats] Module initialisé ✓');
  }

  /** Initialiser un panneau s'il ne l'est pas encore */
  _initPanneau(nom) {
    const panneau = this.panneaux[nom];
    if (panneau && typeof panneau.init === 'function') {
      panneau.init();
    }
  }

  /** Écouter les clics sur les onglets stats */
  _lierOnglets() {
    const tabsNav = document.getElementById('stats-tabs');
    if (!tabsNav) return;

    tabsNav.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab');
      if (!btn) return;

      const target = btn.dataset.tab;
      if (target === this.ongletActif) return;

      this.ongletActif = target;
      this._initPanneau(target);
    });
  }

  /** Rafraîchir le panneau actif (après ajout de données) */
  rafraichir() {
    this._initPanneau(this.ongletActif);
  }

  /** Nettoyage complet */
  detruire() {
    for (const panneau of Object.values(this.panneaux)) {
      if (typeof panneau.detruire === 'function') panneau.detruire();
    }
    this.panneaux = {};
    this._initOk = false;
  }
}


// ─────────────────────────────────────────────
// Données de démo (pour test sans séances réelles)
// ─────────────────────────────────────────────

class DonneesDemoStats {
  /** Injecter des données fictives dans localStorage si vide */
  static injecterSiVide() {
    const seances = Utils.lire(CLE_SEANCES, []);
    if (seances.length > 0) return; // Déjà des données

    const maintenant = new Date();
    const seancesDemo = [];

    // Générer 12 séances sur les 2 derniers mois
    const programmes = ['Push', 'Pull', 'Legs'];
    const exercicesPush = [
      { nom: 'Développé couché', baseKg: 60 },
      { nom: 'Développé incliné haltères', baseKg: 24 },
      { nom: 'Dips', baseKg: 0 },
    ];
    const exercicesPull = [
      { nom: 'Tractions', baseKg: 0 },
      { nom: 'Rowing barre', baseKg: 50 },
      { nom: 'Curl biceps', baseKg: 14 },
    ];
    const exercicesLegs = [
      { nom: 'Squat', baseKg: 80 },
      { nom: 'Presse à cuisses', baseKg: 120 },
      { nom: 'Mollets debout', baseKg: 40 },
    ];

    const tousExos = { Push: exercicesPush, Pull: exercicesPull, Legs: exercicesLegs };

    for (let i = 0; i < 12; i++) {
      const date = new Date(maintenant);
      date.setDate(date.getDate() - (i * 5));

      const prog = programmes[i % 3];
      const exos = tousExos[prog];

      // Progression linéaire simulée
      const progression = 1 + (12 - i) * 0.02;

      seancesDemo.push({
        id: `demo-${i}`,
        date: Utils.dateISO(date),
        programme: prog,
        duree: 45 + Math.floor(Math.random() * 30),
        exercices: exos.map(exo => ({
          nom: exo.nom,
          series: [
            { poids: Math.round(exo.baseKg * progression), reps: 10 + Math.floor(Math.random() * 3) },
            { poids: Math.round(exo.baseKg * progression), reps: 8 + Math.floor(Math.random() * 3) },
            { poids: Math.round(exo.baseKg * progression * 1.05), reps: 6 + Math.floor(Math.random() * 3) },
            { poids: Math.round(exo.baseKg * progression * 1.1), reps: 4 + Math.floor(Math.random() * 2) },
          ],
        })),
      });
    }

    localStorage.setItem(CLE_SEANCES, JSON.stringify(seancesDemo));

    // Données nutrition demo
    const nutritionDemo = [];
    for (let i = 0; i < 14; i++) {
      const date = new Date(maintenant);
      date.setDate(date.getDate() - i);
      nutritionDemo.push({
        date: Utils.dateISO(date),
        calories: 2000 + Math.floor(Math.random() * 800),
        proteines: 120 + Math.floor(Math.random() * 60),
        glucides: 200 + Math.floor(Math.random() * 100),
        lipides: 60 + Math.floor(Math.random() * 40),
      });
    }
    localStorage.setItem(CLE_NUTRITION, JSON.stringify(nutritionDemo));

    // Profil
    localStorage.setItem(CLE_PROFIL, JSON.stringify({
      nom: 'Neil',
      avatar: '💪',
      objectifCalories: 2500,
    }));

    // Potes
    const potesDemo = [
      {
        nom: 'Maxime',
        avatar: '🦁',
        seances: [
          {
            date: Utils.dateISO(new Date(maintenant.getTime() - 2 * 86400000)),
            exercices: [
              { nom: 'Développé couché', series: [{ poids: 70, reps: 8 }, { poids: 75, reps: 6 }, { poids: 80, reps: 4 }] },
              { nom: 'Squat', series: [{ poids: 100, reps: 8 }, { poids: 110, reps: 6 }] },
            ],
          },
          {
            date: Utils.dateISO(new Date(maintenant.getTime() - 5 * 86400000)),
            exercices: [
              { nom: 'Tractions', series: [{ poids: 10, reps: 10 }, { poids: 10, reps: 8 }] },
              { nom: 'Rowing barre', series: [{ poids: 60, reps: 10 }, { poids: 65, reps: 8 }] },
            ],
          },
        ],
      },
      {
        nom: 'Lucas',
        avatar: '🐺',
        seances: [
          {
            date: Utils.dateISO(new Date(maintenant.getTime() - 1 * 86400000)),
            exercices: [
              { nom: 'Développé couché', series: [{ poids: 55, reps: 10 }, { poids: 60, reps: 8 }] },
              { nom: 'Dips', series: [{ poids: 0, reps: 15 }, { poids: 0, reps: 12 }] },
            ],
          },
        ],
      },
    ];
    localStorage.setItem(CLE_POTES, JSON.stringify(potesDemo));

    console.log('[Stats] Données de démo injectées ✓');
  }
}


// ─────────────────────────────────────────────
// Auto-init au chargement du DOM
// ─────────────────────────────────────────────

const muscuStats = new StatsModule();

document.addEventListener('DOMContentLoaded', () => {
  // Injecter les données de démo si localStorage est vide
  DonneesDemoStats.injecterSiVide();

  // Initialiser le module
  muscuStats.init();
});

// Export pour utilisation externe
if (typeof window !== 'undefined') {
  window.MuscuStats = muscuStats;
  window.DonneesDemoStats = DonneesDemoStats;
}
