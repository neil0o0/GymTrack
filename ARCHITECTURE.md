# 💪 MuscuApp — Architecture Complète

## 🎯 Vision
App PWA de suivi musculation + nutrition pour 3 utilisateurs.
Style Apple épuré, tons sombres, navigation simple.

---

## 📱 Pages de l'App

### 1. 🏠 Accueil (Dashboard)
- Salut [Prénom] !
- Programme du jour (exos, séries, reps, kilos)
- Jauge calorique du jour
- Rappels du jour (créatine, whey...)
- Bouton "Commencer l'entraînement"

### 2. 🏋️ Entraînement
- **Programme du jour** avec liste d'exos
- Chaque exo : illustration visuelle + muscles ciblés
- Pour chaque exo : séries × reps × kilos (pré-rempli selon objectifs)
- ⏱️ Timer de repos entre séries
- Bouton "Série terminée" → passe à la suivante
- Résumé en fin de séance

### 3. 📋 Programmes
- **Programmes prêts :** PPL, Upper/Lower, Full Body, etc.
- **Créer mon programme :** choix d'exos dans la bibliothèque
- **Bibliothèque d'exos :** classés par muscle, avec illustrations
- Éditer / supprimer un programme

### 4. 🥗 Nutrition
- **Ajouter un aliment** : recherche (ex: "3 œufs") → affiche calories + macros
- **Jauge du jour** : calories consommées / objectif
- **Macros** : protéines, lipides, glucides (barres de progression)
- **Historique** des repas de la journée
- **Objectifs** : définir calories + macros cibles

### 5. ⏰ Rappels
- Rappel créatine (heure configurable)
- Rappel whey (post-entraînement)
- Rappel repas
- Rappels personnalisés

### 6. 📊 Progression
- **Graphiques** de progression par exo (charges sur le temps)
- **Historique** des séances passées
- **Objectifs** : suivi des objectifs de force
- **Comparaison** entre potes (classement)

### 7. 👥 Social
- Voir les perfs des potes
- Classement (qui soulève le plus, qui progresse le plus)
- Programme partagé

### 8. ⚙️ Profil / Réglages
- Nom, photo
- Poids corporel (suivi optionnel)
- Objectifs (force, nutrition)
- Rappels
- Mode sombre/clair

---

## 🗄️ Base de Données

### Users
```json
{
  "id": "uuid",
  "name": "Neil",
  "email": "",
  "weight": 75,
  "calorieGoal": 2500,
  "proteinGoal": 150,
  "fatGoal": 80,
  "carbGoal": 250,
  "reminders": [
    { "type": "creatine", "time": "08:00" },
    { "type": "whey", "time": "post-workout" }
  ]
}
```

### Exercises (Bibliothèque)
```json
{
  "id": "bench-press",
  "name": "Développé couché",
  "muscle": "pectoraux",
  "secondaryMuscles": ["triceps", "épaules"],
  "image": "bench-press.svg",
  "description": "Allongé sur un banc, poussez la barre vers le haut"
}
```

### Programs
```json
{
  "id": "uuid",
  "name": "PPL - Push Pull Legs",
  "createdBy": "system",
  "shared": true,
  "days": [
    {
      "name": "Push",
      "exercises": [
        { "exerciseId": "bench-press", "sets": 4, "reps": 10, "restSeconds": 90 }
      ]
    }
  ]
}
```

### Workouts (Séances enregistrées)
```json
{
  "id": "uuid",
  "userId": "uuid",
  "programDayId": "push",
  "date": "2026-03-28",
  "exercises": [
    {
      "exerciseId": "bench-press",
      "sets": [
        { "reps": 10, "weight": 80, "completed": true },
        { "reps": 10, "weight": 80, "completed": true }
      ]
    }
  ]
}
```

### Meals (Repas)
```json
{
  "id": "uuid",
  "userId": "uuid",
  "date": "2026-03-28",
  "items": [
    {
      "name": "3 œufs",
      "calories": 210,
      "protein": 18,
      "fat": 15,
      "carbs": 1
    }
  ]
}
```

---

## 🛠️ Stack Technique (100% gratuit)

| Composant | Techno | Pourquoi |
|-----------|--------|----------|
| **Frontend** | HTML/CSS/JS vanilla (ou Preact) | Léger, rapide, PWA native |
| **Style** | CSS custom (dark theme Apple-like) | Pas de framework = contrôle total |
| **Stockage** | localStorage + IndexedDB | Hors ligne, pas de serveur |
| **Sync entre potes** | JSON partagé (GitHub Gist ou Firebase free tier) | Gratuit |
| **Base alimentaire** | Open Food Facts API (gratuite) | Données nutritionnelles |
| **Illustrations exos** | SVG libres (MuscleWiki / custom) | Visuels des mouvements |
| **Hébergement** | GitHub Pages ou Cloudflare Pages | Gratuit |
| **PWA** | Service Worker + manifest.json | Installable sur téléphone |

---

## 🎨 Design System

### Couleurs
- **Background :** `#1C1C1E` (gris très foncé Apple)
- **Surface :** `#2C2C2E` (cartes, modals)
- **Accent :** `#0A84FF` (bleu Apple)
- **Success :** `#30D158` (vert Apple)
- **Warning :** `#FF9F0A` (orange Apple)
- **Danger :** `#FF453A` (rouge Apple)
- **Text primary :** `#FFFFFF`
- **Text secondary :** `#8E8E93`

### Typographie
- Font : `-apple-system, BlinkMacSystemFont, 'SF Pro', sans-serif`
- Titres : Bold, grandes tailles
- Corps : Regular, 16px

### Composants
- Boutons arrondis (border-radius: 12px)
- Cartes avec ombre douce
- Navigation bottom tab bar (5 onglets)
- Transitions douces entre pages
- Pas de scroll horizontal, tout vertical

### Navigation (Bottom Tab Bar)
```
🏠 Accueil  |  🏋️ Training  |  🥗 Nutrition  |  📊 Stats  |  👤 Profil
```

---

## 📦 Base d'Exercices (à intégrer)

### Pectoraux
- Développé couché (barre)
- Développé incliné (haltères)
- Écarté couché
- Pec deck / butterfly
- Dips (pecs)
- Pompes

### Dos
- Tractions
- Rowing barre
- Rowing haltère
- Tirage vertical
- Tirage horizontal
- Soulevé de terre

### Épaules
- Développé militaire
- Élévations latérales
- Élévations frontales
- Oiseau
- Face pull
- Shrug

### Bras
- Curl biceps barre
- Curl haltères
- Curl marteau
- Extensions triceps poulie
- Barre au front
- Dips (triceps)

### Jambes
- Squat
- Presse à cuisses
- Fentes
- Leg extension
- Leg curl
- Mollets debout
- Hip thrust

### Abdos
- Crunch
- Relevé de jambes
- Planche
- Russian twist
- Ab wheel

---

## 🥗 Base Alimentaire (exemples courants)

L'app utilisera l'API Open Food Facts + une base locale d'aliments courants :

| Aliment | Cal | Prot | Lip | Glu | Pour |
|---------|-----|------|-----|-----|------|
| Œuf | 70 | 6g | 5g | 0.4g | 1 œuf |
| Poulet (100g) | 165 | 31g | 3.6g | 0g | 100g |
| Riz (100g cuit) | 130 | 2.7g | 0.3g | 28g | 100g |
| Whey (30g) | 120 | 24g | 1.5g | 3g | 1 dose |
| Banane | 89 | 1.1g | 0.3g | 23g | 1 moyenne |
| Flocons avoine (40g) | 150 | 5g | 2.7g | 27g | 40g |
| Beurre de cacahuète (15g) | 94 | 3.5g | 8g | 3g | 1 c.à.s |
| Lait (250ml) | 125 | 8g | 5g | 12g | 1 verre |
| Pâtes (100g cuites) | 131 | 5g | 1.1g | 25g | 100g |
| Saumon (100g) | 208 | 20g | 13g | 0g | 100g |

---

## ⏰ Planning de Dev

### Phase 1 — Structure + Design (maintenant)
- [x] Architecture
- [ ] HTML/CSS base (shell de l'app, navigation)
- [ ] Design system implémenté

### Phase 2 — Core Features
- [ ] Page Accueil (dashboard)
- [ ] Bibliothèque d'exercices avec visuels
- [ ] Création/édition de programmes
- [ ] Page entraînement (suivi en live)
- [ ] Timer de repos

### Phase 3 — Nutrition
- [ ] Calculateur de calories
- [ ] Base alimentaire
- [ ] Jauge du jour + macros
- [ ] Rappels

### Phase 4 — Stats & Social
- [ ] Graphiques de progression
- [ ] Historique des séances
- [ ] Classement entre potes
- [ ] Sync entre utilisateurs

### Phase 5 — Polish & Deploy
- [ ] PWA (installable)
- [ ] Tests sur iPhone/Android
- [ ] Hébergement
- [ ] Partage du lien

---

_Créé le 28 mars 2026_
